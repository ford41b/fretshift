import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../persistence/dexie";
import { FakeSyncService } from "../persistence/fakes/sync";
import { newSong, type Tuning } from "../schema/song.v1";
import { defaultSettings } from "../schema/settings";
import type { SyncAdapter, SyncRecord } from "./adapter";
import {
  AccountWorkspaceMismatchError,
  SyncEngine,
  relinkWorkspaceOwner,
} from "./engine";

// jsonb does not keep insertion order: shorter keys first, then bytewise.
const jsonb = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(jsonb)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
            .map((k) => [k, jsonb((value as Record<string, unknown>)[k])]),
        )
      : value;
const reorder = (record: SyncRecord | null) =>
  record && { ...record, payload: jsonb(record.payload) };
/** The fake service, but returning payloads in Postgres jsonb key order. */
const jsonbAdapter = (owner: string): SyncAdapter => {
  const direct = service.adapter(owner);
  return {
    pull: async (options) => (await direct.pull(options)).map((r) => reorder(r)!),
    cas: async (record) => {
      const result = await direct.cas(record);
      return result.ok
        ? { ok: true, record: reorder(result.record)! }
        : { ok: false, record: reorder(result.record) };
    },
    createShare: (song, tuning) => direct.createShare(song, tuning),
    listShares: () => direct.listShares(),
    readShare: (token) => direct.readShare(token),
    revokeShare: (token) => direct.revokeShare(token),
  };
};
/** Moves every server timestamp back so it falls outside the overlap window. */
function ageServerRecords(owner: string, ms: number) {
  for (const record of service.recordsFor(owner).values())
    service.put(owner, {
      ...record,
      updatedAt: new Date(Date.parse(record.updatedAt) - ms).toISOString(),
    });
}

let service: FakeSyncService;
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  service = new FakeSyncService();
});
describe("sync engine", () => {
  it("isolates account data and binds a local workspace", async () => {
    await db.songs.put(newSong("Private"));
    await new SyncEngine(service.adapter("one")).sync("one");
    expect(await service.adapter("two").pull()).toEqual([]);
    await expect(
      new SyncEngine(service.adapter("two")).sync("two"),
    ).rejects.toBeInstanceOf(AccountWorkspaceMismatchError);
  });
  it("binds the account before a failing first network request", async () => {
    const direct = service.adapter("one");
    const failing: SyncAdapter = {
      pull: async () => {
        throw new Error("offline");
      },
      cas: (record) => direct.cas(record),
      createShare: (song, tuning) => direct.createShare(song, tuning),
      listShares: () => direct.listShares(),
      readShare: (token) => direct.readShare(token),
      revokeShare: (token) => direct.revokeShare(token),
    };
    await expect(new SyncEngine(failing).sync("one")).rejects.toThrow(
      /offline/,
    );
    await expect(
      new SyncEngine(service.adapter("two")).sync("two"),
    ).rejects.toBeInstanceOf(AccountWorkspaceMismatchError);
  });
  it("reconciles an offline one-sided edit without overwriting local state", async () => {
    const song = newSong("Original");
    await db.songs.put(song);
    const engine = new SyncEngine(service.adapter("owner"));
    await engine.sync("owner");
    await db.songs.put({
      ...song,
      title: "Offline",
      updatedAt: new Date().toISOString(),
    });
    const result = await engine.sync("owner");
    expect(result.uploaded).toBe(1);
    expect((await service.adapter("owner").pull())[0].payload).toMatchObject({
      title: "Offline",
    });
  });
  it("adopts server timestamps after upload so a second sync is stable", async () => {
    const song = newSong("Stable");
    await db.songs.put(song);
    const engine = new SyncEngine(service.adapter("owner"));
    expect((await engine.sync("owner")).uploaded).toBe(1);
    expect(await engine.sync("owner")).toMatchObject({
      uploaded: 0,
      conflicts: [],
    });
    const local = await db.songs.get(song.id),
      remote = (await service.adapter("owner").pull())[0];
    expect(local?.updatedAt).toBe(remote.updatedAt);
  });
  it("prompts when two clients changed the same baseline", async () => {
    const song = newSong("Original");
    await db.songs.put(song);
    const first = new SyncEngine(service.adapter("owner"));
    await first.sync("owner");
    const remote = (await service.adapter("owner").pull())[0];
    await service.adapter("owner").cas({
      ...remote,
      payload: { ...(remote.payload as object), title: "Other device" },
      revision: remote.revision,
    });
    await db.songs.put({
      ...song,
      title: "Mine",
      updatedAt: new Date().toISOString(),
    });
    const result = await first.sync("owner");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].choices).toEqual(["mine", "server", "both"]);
  });
  it("does not overwrite an edit made while an upload is in flight", async () => {
    const song = newSong("Original");
    await db.songs.put(song);
    const direct = service.adapter("owner");
    await new SyncEngine(direct).sync("owner");
    await db.songs.put({
      ...song,
      title: "Started upload",
      updatedAt: "2026-09-13T10:00:00.000Z",
    });
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const called = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const gated: SyncAdapter = {
      pull: () => direct.pull(),
      cas: async (record) => {
        observed();
        await gate;
        return direct.cas(record);
      },
      createShare: (nextSong, tuning) => direct.createShare(nextSong, tuning),
      listShares: () => direct.listShares(),
      readShare: (token) => direct.readShare(token),
      revokeShare: (token) => direct.revokeShare(token),
    };
    const syncing = new SyncEngine(gated).sync("owner");
    await called;
    await db.songs.put({
      ...song,
      title: "Latest edit",
      updatedAt: "2026-09-13T11:00:00.000Z",
    });
    release();
    await syncing;
    expect((await db.songs.get(song.id))?.title).toBe("Latest edit");
    const followUp = await new SyncEngine(direct).sync("owner");
    expect(followUp).toMatchObject({ uploaded: 1, conflicts: [] });
    expect((await direct.pull())[0].payload).toMatchObject({
      title: "Latest edit",
    });
  });

  it("installs a new remote tuning before applying an update to an existing song", async () => {
    const song = newSong("Retuned");
    await db.songs.put(song);
    const engine = new SyncEngine(service.adapter("owner"));
    await engine.sync("owner");
    const tuning: Tuning = {
      id: "custom-sync",
      label: "Custom sync",
      midi: [64, 59, 55, 50, 45, 39],
      builtIn: false,
    };
    service.put("owner", {
      kind: "tuning",
      id: tuning.id,
      payload: tuning,
      // Server timestamps come from now(), so they are newer than any cursor.
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      revision: 1,
    });
    const remote = (await service.adapter("owner").pull()).find(
      (record) => record.kind === "song",
    )!;
    service.put("owner", {
      ...remote,
      payload: { ...(remote.payload as object), tuningId: tuning.id },
      updatedAt: new Date().toISOString(),
      revision: remote.revision + 1,
    });
    expect((await engine.sync("owner")).conflicts).toEqual([]);
    expect((await db.songs.get(song.id))?.tuningId).toBe(tuning.id);
  });

  it("resolves mine, server, and both choices with stable local copies", async () => {
    async function makeConflict() {
      const song = newSong("Original");
      await db.songs.put(song);
      const adapter = service.adapter("owner"),
        engine = new SyncEngine(adapter);
      await engine.sync("owner");
      const remote = (await adapter.pull())[0];
      await adapter.cas({
        ...remote,
        payload: { ...(remote.payload as object), title: "Server" },
        revision: remote.revision,
      });
      await db.songs.put({
        ...song,
        title: "Mine",
        updatedAt: "2026-09-13T11:00:00.000Z",
      });
      return {
        engine,
        conflict: (await engine.sync("owner")).conflicts[0],
        song,
      };
    }

    let state = await makeConflict();
    await state.engine.resolve("owner", state.conflict, "mine");
    expect((await db.songs.get(state.song.id))?.title).toBe("Mine");
    expect((await state.engine.sync("owner")).uploaded).toBe(0);

    for (const table of db.tables) await table.clear();
    service = new FakeSyncService();
    state = await makeConflict();
    await state.engine.resolve("owner", state.conflict, "server");
    expect((await db.songs.get(state.song.id))?.title).toBe("Server");

    for (const table of db.tables) await table.clear();
    service = new FakeSyncService();
    state = await makeConflict();
    await state.engine.resolve("owner", state.conflict, "both");
    const songs = await db.songs.toArray();
    expect(songs.map((value) => value.title).sort()).toEqual([
      "Mine (conflict copy)",
      "Server",
    ]);
    expect((await state.engine.sync("owner")).uploaded).toBe(0);
  });

  it("detects delete conflicts and protects conflict resolution ownership", async () => {
    const song = newSong("Original");
    await db.songs.put(song);
    const adapter = service.adapter("owner"),
      engine = new SyncEngine(adapter);
    await engine.sync("owner");
    const remote = (await adapter.pull())[0];
    await adapter.cas({
      ...remote,
      payload: { ...(remote.payload as object), title: "Server edit" },
      revision: remote.revision,
    });
    await db.songs.put({
      ...song,
      deletedAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:00.000Z",
    });
    const conflict = (await engine.sync("owner")).conflicts[0];
    expect(conflict).toBeTruthy();
    await db.meta.put({ id: "sync:account", value: "other" });
    await expect(
      engine.resolve("owner", conflict, "server"),
    ).rejects.toBeInstanceOf(AccountWorkspaceMismatchError);
  });

  it("round-trips tunings, preferences, and every practice record kind", async () => {
    const at = "2026-09-13T12:00:00.000Z";
    const tuning: Tuning = {
      id: "roundtrip",
      label: "Round trip",
      midi: [64, 59, 55, 50, 45, 39],
      builtIn: false,
    };
    await db.tunings.put(tuning);
    await db.settings.put({
      id: "device",
      value: { ...defaultSettings, leftHanded: true },
    });
    await db.sessions.put({
      id: "session-1",
      songId: "song-1",
      startedAt: at,
      durationSec: 60,
      tempoMultiplierMax: 1,
      loopCount: 2,
    });
    await db.heat.put({
      songId: "song-1",
      measureId: "measure-1",
      score: 80,
      updatedAt: at,
    });
    await db.pairs.put({
      chordA: "C",
      chordB: "G",
      tuningId: tuning.id,
      best: 2,
      history: [{ at, count: 3 }],
    });
    await db.strums.put({ at, tempo: 100, score: 90, meanOffsetMs: 4 });
    await new SyncEngine(service.adapter("owner")).sync("owner");
    for (const table of db.tables) await table.clear();
    await new SyncEngine(service.adapter("owner")).sync("owner");
    expect(await db.tunings.get(tuning.id)).toEqual(tuning);
    expect((await db.settings.get("device"))?.value.leftHanded).toBe(true);
    expect(
      await Promise.all([
        db.sessions.count(),
        db.heat.count(),
        db.pairs.count(),
        db.strums.count(),
      ]),
    ).toEqual([1, 1, 1, 1]);
  });
  it("propagates soft deletes and quarantines invalid cloud songs", async () => {
    const song = newSong("Delete me");
    await db.songs.put(song);
    const engine = new SyncEngine(service.adapter("owner"));
    await engine.sync("owner");
    await db.songs.put({
      ...song,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await engine.sync("owner");
    expect((await service.adapter("owner").pull())[0].deletedAt).toBeTruthy();
    await db.meta.clear();
    await db.songs.clear();
    service.put("bad", {
      kind: "song",
      id: "bad",
      payload: { id: "bad", schemaVersion: 99 },
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      revision: 1,
    });
    await new SyncEngine(service.adapter("bad")).sync("bad");
    expect(await db.quarantine.count()).toBe(1);
  });

  it("quarantines an envelope/payload identity mismatch before applying it", async () => {
    const payload = newSong("Wrong identity");
    service.put("owner", {
      kind: "song",
      id: "envelope-id",
      payload,
      updatedAt: payload.updatedAt,
      deletedAt: null,
      revision: 1,
    } as SyncRecord);
    await new SyncEngine(service.adapter("owner")).sync("owner");
    expect(await db.songs.count()).toBe(0);
    expect(await db.quarantine.count()).toBe(1);
  });

  it("keeps only one quarantine notice per repeatedly invalid cloud record", async () => {
    service.put("owner", {
      kind: "song",
      id: "bad-repeat",
      payload: { id: "bad-repeat", schemaVersion: 99 },
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      revision: 1,
    });
    const engine = new SyncEngine(service.adapter("owner"));
    await engine.sync("owner");
    await engine.sync("owner");
    expect(await db.quarantine.count()).toBe(1);
  });

  it("normalizes Supabase offset timestamps before validating cloud songs", async () => {
    const song = { ...newSong("Offset time"), id: "offset-song" };
    const direct = service.adapter("owner");
    service.put("owner", {
      kind: "song",
      id: song.id,
      payload: song,
      updatedAt: "2026-09-14T22:41:08.330697+00:00",
      deletedAt: null,
      revision: 1,
    });
    await db.quarantine.put({
      id: `cloud:song:${song.id}:old-error`,
      raw: song,
      error: "Error: updatedAt: Invalid datetime",
      at: new Date().toISOString(),
    });
    await new SyncEngine(direct).sync("owner");
    expect((await db.songs.get(song.id))?.updatedAt).toBe(
      "2026-09-14T22:41:08.330Z",
    );
    expect(await db.quarantine.count()).toBe(0);
  });

  it("clears every legacy quarantine duplicate once that cloud song validates", async () => {
    const song = { ...newSong("Recovered warning"), id: "recovered-warning" };
    const direct = service.adapter("owner");
    service.put("owner", {
      kind: "song",
      id: song.id,
      payload: song,
      updatedAt: "2026-09-14T22:41:08.330697+00:00",
      deletedAt: null,
      revision: 1,
    });
    for (const suffix of [
      "1789425399264:one",
      "1789425416368:two",
      "1789425428442",
    ]) {
      await db.quarantine.put({
        id: `cloud:song:${song.id}:${suffix}`,
        raw: song,
        error: "Error: updatedAt: Invalid datetime",
        at: new Date().toISOString(),
      });
    }
    await new SyncEngine(direct).sync("owner");
    expect(await db.quarantine.count()).toBe(0);
  });

  it("preserves local reference-audio metadata when applying a cloud edit", async () => {
    const song = {
      ...newSong("Reference"),
      referenceAudio: { fileName: "local.wav", offsetMs: 12, sourceTempo: 120 },
    };
    await db.songs.put(song);
    const adapter = service.adapter("owner"),
      engine = new SyncEngine(adapter);
    await engine.sync("owner");
    const remote = (await adapter.pull())[0];
    await adapter.cas({
      ...remote,
      payload: { ...(remote.payload as object), title: "Remote title" },
      revision: remote.revision,
    });
    await engine.sync("owner");
    expect(await db.songs.get(song.id)).toMatchObject({
      title: "Remote title",
      referenceAudio: song.referenceAudio,
    });
  });
  it("stays stable when the server reorders payload keys like Postgres jsonb", async () => {
    await db.songs.put(newSong("Ordered"));
    await db.settings.put({ id: "device", value: defaultSettings });
    const engine = new SyncEngine(jsonbAdapter("owner"));
    expect((await engine.sync("owner")).uploaded).toBe(2);
    expect(await engine.sync("owner")).toMatchObject({
      uploaded: 0,
      applied: 0,
      conflicts: [],
    });
    const revisions = [...service.recordsFor("owner").values()].map(
      (r) => r.revision,
    );
    expect(revisions).toEqual([1, 1]);
  });
});

describe("incremental pull", () => {
  const HOUR = 60 * 60_000;

  it("downloads only records changed since the last sync (jsonb ordering)", async () => {
    for (const title of ["One", "Two", "Three"]) await db.songs.put(newSong(title));
    await db.settings.put({ id: "device", value: defaultSettings });
    const engine = new SyncEngine(jsonbAdapter("owner"));
    expect((await engine.sync("owner")).uploaded).toBe(4);
    ageServerRecords("owner", HOUR);
    service.pullLog.length = 0;

    expect(await engine.sync("owner")).toMatchObject({
      uploaded: 0,
      applied: 0,
      conflicts: [],
    });
    // Old behaviour pulled all 4 rows (multi-MB audio songs) every 30 s.
    expect(service.pullLog).toEqual([0]);

    // Another device edits one song: exactly that row is downloaded.
    const remote = [...service.recordsFor("owner").values()].find(
      (r) => r.kind === "song",
    )!;
    await service.adapter("owner").cas({
      ...remote,
      payload: { ...(remote.payload as object), title: "Edited elsewhere" },
      revision: remote.revision,
    });
    service.pullLog.length = 0;
    expect(await engine.sync("owner")).toMatchObject({ applied: 1, uploaded: 0 });
    expect(service.pullLog).toEqual([1]);
    expect((await db.songs.get(remote.id))?.title).toBe("Edited elsewhere");
    const revisions = [...service.recordsFor("owner").values()].map((r) => r.revision);
    expect(revisions.sort()).toEqual([1, 1, 1, 2]);
  });

  it("re-reads the overlap window so a late-committed row is not skipped", async () => {
    await db.songs.put(newSong("Anchor"));
    const engine = new SyncEngine(jsonbAdapter("owner"));
    await engine.sync("owner");
    const cursor = (await db.meta.get("sync:cursor:owner"))?.value as string;
    expect(typeof cursor).toBe("string");
    // A transaction that started before the cursor but committed after our pull
    // carries an updated_at slightly earlier than the cursor.
    const late = { ...newSong("Late commit"), id: "late-song" };
    service.put("owner", {
      kind: "song",
      id: late.id,
      payload: late,
      updatedAt: new Date(Date.parse(cursor) - 5_000).toISOString(),
      deletedAt: null,
      revision: 1,
    });
    expect((await engine.sync("owner")).applied).toBe(1);
    expect((await db.songs.get(late.id))?.title).toBe("Late commit");
  });

  it("keeps re-raising an unresolved conflict on later syncs", async () => {
    const song = newSong("Original");
    await db.songs.put(song);
    const engine = new SyncEngine(jsonbAdapter("owner"));
    await engine.sync("owner");
    const remote = [...service.recordsFor("owner").values()][0];
    await service.adapter("owner").cas({
      ...remote,
      payload: { ...(remote.payload as object), title: "Server" },
      revision: remote.revision,
    });
    await db.songs.put({ ...song, title: "Mine", updatedAt: new Date().toISOString() });
    expect((await engine.sync("owner")).conflicts).toHaveLength(1);
    ageServerRecords("owner", HOUR);
    expect((await engine.sync("owner")).conflicts).toHaveLength(1);
  });

  it("falls back to a full pull when a synced record disappeared locally", async () => {
    const keep = newSong("Keep"),
      restored = newSong("Restored by sync");
    await db.songs.bulkPut([keep, restored]);
    const engine = new SyncEngine(jsonbAdapter("owner"));
    await engine.sync("owner");
    ageServerRecords("owner", HOUR);
    // e.g. a backup restore replaces the local songs table.
    await db.songs.delete(restored.id);
    service.pullLog.length = 0;
    await engine.sync("owner");
    expect(service.pullLog).toEqual([2]);
    expect((await db.songs.get(restored.id))?.title).toBe("Restored by sync");
  });

  it("does a full pull again after relinking this device back to an account", async () => {
    await db.songs.put(newSong("Linked"));
    const engine = new SyncEngine(jsonbAdapter("owner"));
    await engine.sync("owner");
    ageServerRecords("owner", HOUR);
    expect(await db.meta.get("sync:cursor:owner")).toBeDefined();
    // The device was used with another account in between.
    await db.meta.put({ id: "sync:account", value: "someone-else" });
    await relinkWorkspaceOwner("owner");
    expect(await db.meta.get("sync:cursor:owner")).toBeUndefined();
    service.pullLog.length = 0;
    await engine.sync("owner");
    expect(service.pullLog).toEqual([1]);
  });
});
