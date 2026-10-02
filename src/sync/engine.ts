import { db } from "../persistence/dexie";
import { loadSong } from "../schema/migrations";
import { TuningSchema, registerTuning } from "../schema/song.v1";
import { SetlistSchema } from "../schema/setlist";
import { SettingsSchema } from "../schema/settings";
import {
  PracticeSessionSchema,
  HeatmapEntrySchema,
  ChordPairRecordSchema,
  StrumRecordSchema,
} from "../schema/practice";
import type { SyncAdapter, SyncKind, SyncRecord } from "./adapter";
import type { ConflictChoice, SyncConflict } from "./conflicts";

const kinds: SyncKind[] = [
  "song",
  "setlist",
  "tuning",
  "preference",
  "session",
  "heat",
  "pair",
  "strum",
];
type Baseline = Record<string, SyncRecord>;
type Captured = { records: SyncRecord[]; byKey: Map<string, SyncRecord> };
export class AccountWorkspaceMismatchError extends Error {
  constructor() {
    super(
      "This device library is linked to a different account. You can relink this device to the account you are signed into, or sign back into the previous account.",
    );
    this.name = "AccountWorkspaceMismatchError";
  }
}
export type SyncResult = {
  conflicts: SyncConflict[];
  applied: number;
  uploaded: number;
};
const key = (r: Pick<SyncRecord, "kind" | "id">) => `${r.kind}:${r.id}`;
// Postgres jsonb does not preserve object key order, so compare canonically;
// an order-sensitive check re-uploads (and conflicts on) every record forever.
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
        )
      : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const baselineKey = (accountId: string) => `sync:baseline:${accountId}`;
// Server updated_at of the newest record this account has fully settled.
const cursorKey = (accountId: string) => `sync:cursor:${accountId}`;
/**
 * sync_records.updated_at is the writing transaction's start time, so a row can
 * become visible after a pull already saw newer rows. Every incremental pull
 * re-reads this much history before the cursor; records already settled at the
 * same revision are no-ops. sync_cas transactions are a single statement, so a
 * minute is a wide margin.
 */
export const PULL_OVERLAP_MS = 60_000;

const workspaceOwnerKey = "sync:account";

export async function relinkWorkspaceOwner(accountId: string): Promise<void> {
  const current = await db.meta.get(workspaceOwnerKey);
  if (current?.value === accountId) return;

  // A relink is always explicit in the UI. Keep the local library intact,
  // discard only the target account's old sync baseline, and let the next sync
  // reconcile the local library with whatever is already in that account.
  await db.transaction("rw", db.meta, async () => {
    await db.meta.delete(baselineKey(accountId));
    await db.meta.delete(cursorKey(accountId));
    await db.meta.put({ id: workspaceOwnerKey, value: accountId });
  });
}


export type SyncEngineOptions = { pullOverlapMs?: number };

export class SyncEngine {
  private readonly pullOverlapMs: number;
  constructor(
    private readonly adapter: SyncAdapter,
    options: SyncEngineOptions = {},
  ) {
    this.pullOverlapMs = options.pullOverlapMs ?? PULL_OVERLAP_MS;
  }
  async sync(accountId: string): Promise<SyncResult> {
    await assertWorkspaceOwner(accountId);
    // Bind before the first network request. A partial first sync must never
    // leave another account free to adopt records already pulled or uploaded.
    await db.meta.put({ id: workspaceOwnerKey, value: accountId });
    const captured = await capture();
    const baseline = ((await db.meta.get(baselineKey(accountId)))?.value ??
      {}) as Baseline;
    // Incremental pull. Only a record absent from the pull is assumed to be
    // unchanged since it was settled into the baseline, so pull everything
    // when there is no cursor or baseline yet, or when a settled record has
    // vanished locally (e.g. a backup restore) and must be re-offered.
    const storedCursor = (await db.meta.get(cursorKey(accountId)))?.value;
    const cursor =
      typeof storedCursor === "string" && !Number.isNaN(Date.parse(storedCursor))
        ? storedCursor
        : null;
    const incremental =
      cursor !== null &&
      Object.keys(baseline).length > 0 &&
      Object.keys(baseline).every((k) => captured.byKey.has(k));
    const since = incremental
      ? new Date(Date.parse(cursor) - this.pullOverlapMs).toISOString()
      : null;
    const remote: SyncRecord[] = [];
    const seen = new Set<string>();
    let pulledInvalid = false;
    for (const raw of await this.adapter.pull(since ? { since } : {})) {
      try {
        const record = validateRemoteRecord(raw);
        if (seen.has(key(record)))
          throw new Error("Duplicate cloud record key.");
        seen.add(key(record));
        remote.push(record);
      } catch (error) {
        pulledInvalid = true;
        await quarantine(raw, error);
      }
    }
    const remoteByKey = new Map(remote.map((x) => [key(x), x]));
    const conflicts: SyncConflict[] = [];
    let applied = 0,
      uploaded = 0;
    // Server-stamped copies of our own accepted uploads also advance the cursor.
    const acceptedUploads: SyncRecord[] = [];
    // Process the union in dependency order so a cloud tuning exists before any
    // existing or new song that references it is validated.
    const orderedKeys = [
      ...new Set([...captured.byKey.keys(), ...remoteByKey.keys()]),
    ].sort(
      (a, b) =>
        Number(!a.startsWith("tuning:")) - Number(!b.startsWith("tuning:")) ||
        a.localeCompare(b),
    );
    for (const k of orderedKeys) {
      const local = captured.byKey.get(k),
        base = baseline[k],
        server = remoteByKey.get(k);
      if (!local && server) {
        if (await applyIfAbsent(server)) {
          baseline[k] = server;
          applied++;
        }
        continue;
      }
      if (!local) continue;
      const localChanged =
        !base ||
        !same(local.payload, base.payload) ||
        local.deletedAt !== base.deletedAt;
      const serverChanged =
        !!server && (!base || server.revision !== base.revision);
      if (localChanged && serverChanged && server) {
        if (
          !same(local.payload, server.payload) ||
          local.deletedAt !== server.deletedAt
        ) {
          conflicts.push({
            key: k,
            mine: local,
            server,
            choices:
              local.kind === "song" || local.kind === "setlist"
                ? ["mine", "server", "both"]
                : ["mine", "server"],
          });
          continue;
        }
        if (await applyIfUnchanged(local, server)) {
          baseline[k] = server;
          applied++;
        }
        continue;
      }
      if (localChanged) {
        const response = await this.adapter.cas({
          kind: local.kind,
          id: local.id,
          payload: local.payload,
          deletedAt: local.deletedAt,
          revision: server?.revision ?? base?.revision ?? null,
        });
        if (response.ok) {
          const accepted = validateRemoteRecord(response.record, local);
          baseline[k] = accepted;
          acceptedUploads.push(accepted);
          await applyIfUnchanged(local, accepted);
          uploaded++;
        } else if (response.record) {
          const accepted = validateRemoteRecord(response.record, local);
          conflicts.push({
            key: k,
            mine: local,
            server: accepted,
            choices:
              local.kind === "song" || local.kind === "setlist"
                ? ["mine", "server", "both"]
                : ["mine", "server"],
          });
        }
      } else if (serverChanged && server) {
        if (await applyIfUnchanged(local, server)) {
          baseline[k] = server;
          applied++;
        }
      }
    }
    await db.meta.put({ id: baselineKey(accountId), value: baseline });
    await db.meta.put({
      id: cursorKey(accountId),
      value: nextCursor(
        incremental ? cursor : null,
        remote,
        acceptedUploads,
        baseline,
        pulledInvalid,
      ),
    });
    return { conflicts, applied, uploaded };
  }

  async resolve(
    accountId: string,
    conflict: SyncConflict,
    choice: ConflictChoice,
  ): Promise<void> {
    await assertWorkspaceOwner(accountId);
    const server = validateRemoteRecord(conflict.server, conflict.mine);
    const current = await readRecord(conflict.mine.kind, conflict.mine.id);
    if (
      !current ||
      !same(current.payload, conflict.mine.payload) ||
      current.deletedAt !== conflict.mine.deletedAt
    )
      return; // user edited while prompt was open
    const base = ((await db.meta.get(baselineKey(accountId)))?.value ??
      {}) as Baseline;
    if (choice === "server") {
      if (!(await applyRecord(server)))
        throw new Error(
          "Could not apply the server version; the invalid record was quarantined.",
        );
      base[conflict.key] = server;
    } else if (choice === "mine") {
      const response = await this.adapter.cas({
        ...conflict.mine,
        revision: server.revision,
      });
      if (!response.ok)
        throw new Error("Conflict changed on the server; sync again.");
      const accepted = validateRemoteRecord(response.record, conflict.mine);
      base[conflict.key] = accepted;
      await applyIfUnchanged(conflict.mine, accepted);
    } else {
      if (conflict.mine.kind !== "song" && conflict.mine.kind !== "setlist")
        throw new Error("This record type cannot be copied.");
      const copyId = crypto.randomUUID();
      const copy = {
        ...conflict.mine,
        id: copyId,
        payload: copyPayload(conflict.mine, copyId),
        deletedAt: null,
      };
      const response = await this.adapter.cas({ ...copy, revision: null });
      if (!response.ok) throw new Error("Could not create conflict copy.");
      const accepted = validateRemoteRecord(response.record, copy);
      if (!(await applyRecord(server)) || !(await applyRecord(accepted)))
        throw new Error("Could not save both conflict versions locally.");
      base[conflict.key] = server;
      base[key(copy)] = accepted;
    }
    await db.meta.put({ id: baselineKey(accountId), value: base });
  }
}

/**
 * The cursor only advances past records that are settled in the baseline at
 * (or beyond) the pulled revision. Anything else (a conflict, a record that
 * failed to apply, or an apply skipped because the user edited mid-sync) holds
 * the cursor at its timestamp, so it is pulled and evaluated again exactly as
 * the old full pull did. An envelope too broken to date keeps the old cursor.
 */
function nextCursor(
  previous: string | null,
  pulled: SyncRecord[],
  uploaded: SyncRecord[],
  baseline: Baseline,
  pulledInvalid: boolean,
): string | null {
  const ms = (value: string) => Date.parse(value);
  let newest = previous;
  let held: string | null = null;
  for (const record of uploaded)
    if (newest === null || ms(record.updatedAt) > ms(newest))
      newest = record.updatedAt;
  for (const record of pulled) {
    if (newest === null || ms(record.updatedAt) > ms(newest))
      newest = record.updatedAt;
    const settled = baseline[key(record)];
    if (!settled || settled.revision < record.revision)
      if (held === null || ms(record.updatedAt) < ms(held))
        held = record.updatedAt;
  }
  if (pulledInvalid) return previous;
  if (held !== null && (newest === null || ms(held) < ms(newest))) return held;
  return newest;
}

function copyPayload(record: SyncRecord, id: string) {
  const payload = structuredClone(record.payload) as Record<string, unknown>;
  payload.id = id;
  payload.updatedAt = new Date().toISOString();
  payload.createdAt = payload.updatedAt;
  if (typeof payload.title === "string") payload.title += " (conflict copy)";
  return payload;
}
function cloudPayload(value: unknown) {
  const copy = structuredClone(value) as Record<string, unknown>;
  delete copy.referenceAudio;
  return copy;
}
function normalizeRecord(record: SyncRecord): SyncRecord {
  if (record.kind !== "song" && record.kind !== "setlist") return record;
  return {
    ...record,
    payload: {
      ...(record.payload as object),
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    },
  };
}
function validateRemoteRecord(
  record: SyncRecord,
  expected?: Pick<SyncRecord, "kind" | "id">,
): SyncRecord {
  if (
    !record ||
    typeof record !== "object" ||
    !kinds.includes(record.kind) ||
    typeof record.id !== "string" ||
    !record.id ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    typeof record.updatedAt !== "string" ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    (record.deletedAt !== null &&
      (typeof record.deletedAt !== "string" ||
        Number.isNaN(Date.parse(record.deletedAt))))
  )
    throw new Error("Invalid cloud record envelope.");
  if (expected && (record.kind !== expected.kind || record.id !== expected.id))
    throw new Error(
      "Cloud response record identity did not match the request.",
    );
  if (!record.payload || typeof record.payload !== "object")
    throw new Error("Invalid cloud record payload.");
  if (
    ["song", "setlist", "tuning", "session"].includes(record.kind) &&
    (record.payload as { id?: unknown }).id !== record.id
  )
    throw new Error(
      "Cloud payload identity did not match its record envelope.",
    );
  const updatedAt = new Date(record.updatedAt).toISOString();
  const deletedAt =
    record.deletedAt === null
      ? null
      : new Date(record.deletedAt).toISOString();
  return normalizeRecord({ ...record, updatedAt, deletedAt });
}
async function assertWorkspaceOwner(accountId: string) {
  const owner = await db.meta.get(workspaceOwnerKey);
  if (owner && owner.value !== accountId)
    throw new AccountWorkspaceMismatchError();
}
async function quarantine(raw: unknown, error: unknown) {
  const candidate = raw as Partial<SyncRecord>;
  await db.quarantine.put({
    // One current diagnostic per cloud record. Older builds used a timestamp +
    // UUID here, which could turn one recurring problem into dozens of notices.
    id: `cloud:${candidate.kind ?? "unknown"}:${candidate.id ?? "unknown"}`,
    raw,
    error: String(error),
    at: new Date().toISOString(),
  });
}
/* eslint-disable @typescript-eslint/no-explicit-any -- rows differ per table */
const tables = {
  song: () => db.songs,
  setlist: () => db.setlists,
  tuning: () => db.tunings,
  session: () => db.sessions,
  heat: () => db.heat,
  pair: () => db.pairs,
  strum: () => db.strums,
} as const satisfies Record<Exclude<SyncKind, "preference">, () => unknown>;
/** The single row-to-record mapping. Returns null for rows that never sync. */
function toRecord(kind: SyncKind, row: any, now: string): SyncRecord | null {
  const r = (id: string, updatedAt: string, payload: unknown = row) => ({
    kind,
    id,
    payload,
    updatedAt,
    deletedAt: row.deletedAt ?? null,
    revision: 0,
  });
  switch (kind) {
    case "song":
      return r(row.id, row.updatedAt, cloudPayload(row));
    case "setlist":
      return r(row.id, row.updatedAt);
    case "tuning":
      return r(row.id, now);
    case "preference":
      return r("preferences", now, row.value);
    case "session":
      return row.immersive ? null : r(row.id, row.startedAt);
    case "heat":
      return r(`${row.songId}:${row.measureId}`, row.updatedAt);
    case "pair":
      return r(`${row.chordA}:${row.chordB}:${row.tuningId}`, now);
    case "strum":
      return r(`${row.at}:${row.tempo}`, row.at);
  }
}
async function recordsOf(kind: SyncKind, now: string): Promise<SyncRecord[]> {
  const rows: any[] =
    kind === "preference"
      ? [await db.settings.get("device")].filter(Boolean)
      : await (tables[kind]() as any).toArray();
  return rows.flatMap((row) => toRecord(kind, row, now) ?? []);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
async function capture(): Promise<Captured> {
  const now = new Date().toISOString();
  const records = (
    await Promise.all(kinds.map((kind) => recordsOf(kind, now)))
  ).flat();
  return { records, byKey: new Map(records.map((r) => [key(r), r])) };
}
/**
 * Current local state of one record. Id-keyed tables use a primary-key read and
 * composite-id kinds scan only their own table. (This used to re-capture the
 * whole database per record, which made every sync O(records²).)
 */
async function readRecord(
  kind: SyncKind,
  id: string,
): Promise<SyncRecord | null> {
  const now = new Date().toISOString();
  if (kind === "song" || kind === "setlist" || kind === "tuning" || kind === "session") {
    const row = await tables[kind]().get(id);
    return row ? toRecord(kind, row, now) : null;
  }
  return (await recordsOf(kind, now)).find((r) => r.id === id) ?? null;
}
async function applyIfUnchanged(captured: SyncRecord, server: SyncRecord) {
  const current = await readRecord(captured.kind, captured.id);
  if (
    !current ||
    !same(current.payload, captured.payload) ||
    current.deletedAt !== captured.deletedAt
  )
    return false;
  return applyRecord(server);
}
async function applyIfAbsent(server: SyncRecord) {
  if (await readRecord(server.kind, server.id)) return false;
  return applyRecord(server);
}
async function applyRecord(record: SyncRecord): Promise<boolean> {
  try {
    await putLocal(record);
    await clearResolvedCloudQuarantine(record);
    return true;
  } catch (error) {
    await db.quarantine.put({
      id: `cloud:${key(record)}`,
      raw: record.payload,
      error: String(error),
      at: new Date().toISOString(),
    });
    return false;
  }
}
async function clearResolvedCloudQuarantine(record: SyncRecord) {
  const currentId = `cloud:${key(record)}`;
  const legacyPrefix = `${currentId}:`;
  const ids = (await db.quarantine.toArray())
    .filter(
      (entry) =>
        entry.id === currentId || entry.id.startsWith(legacyPrefix),
    )
    .map((entry) => entry.id);
  if (ids.length) await db.quarantine.bulkDelete(ids);
}

async function putLocal(record: SyncRecord) {
  if (record.kind === "song") {
    const existing = await db.songs.get(record.id);
    const song = loadSong({
      ...(record.payload as object),
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      ...(existing?.referenceAudio
        ? { referenceAudio: existing.referenceAudio }
        : {}),
    });
    await db.songs.put(song);
  } else if (record.kind === "setlist")
    await db.setlists.put(
      SetlistSchema.parse({
        ...(record.payload as object),
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt,
      }) as never,
    );
  else if (record.kind === "tuning") {
    const t = TuningSchema.parse(record.payload);
    registerTuning(t);
    await db.tunings.put(t);
  } else if (record.kind === "preference")
    await db.settings.put({
      id: "device",
      value: SettingsSchema.parse(record.payload),
    });
  else if (record.kind === "session")
    await db.sessions.put(PracticeSessionSchema.parse(record.payload));
  else if (record.kind === "heat")
    await db.heat.put(HeatmapEntrySchema.parse(record.payload));
  else if (record.kind === "pair")
    await db.pairs.put(ChordPairRecordSchema.parse(record.payload));
  else if (record.kind === "strum")
    await db.strums.put(StrumRecordSchema.parse(record.payload));
}

/** UI bridge: parent flushes the Zustand queue before calling this. */
export async function syncCurrentAccount(
  accountId: string,
  adapter: SyncAdapter,
) {
  return new SyncEngine(adapter).sync(accountId);
}
