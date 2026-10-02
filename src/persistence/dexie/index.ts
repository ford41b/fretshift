import Dexie, { type Table } from "dexie";
import { getSession } from "../../cloud/client";
import {
  type Song,
  type Tuning,
  registerTuning,
  TuningSchema,
} from "../../schema/song.v1";
import { type Setlist, SetlistSchema } from "../../schema/setlist";
import {
  SettingsSchema,
  defaultSettings,
  type Settings,
} from "../../schema/settings";
import {
  PracticeSessionSchema,
  HeatmapEntrySchema,
  ChordPairRecordSchema,
  StrumRecordSchema,
  type PracticeSession,
  type HeatmapEntry,
  type ChordPairRecord,
  type StrumRecord,
} from "../../schema/practice";
import { loadSong } from "../../schema/migrations";
import { scoreDifficulty } from "../../transforms";
import {
  type SongRepository,
  type SetlistRepository,
  type PracticeRepository,
  type SettingsRepository,
} from "../repositories";
export class FretDB extends Dexie {
  songs!: Table<Song, string>;
  setlists!: Table<Setlist, string>;
  settings!: Table<{ id: string; value: Settings }, string>;
  tunings!: Table<Tuning, string>;
  sessions!: Table<PracticeSession, string>;
  heat!: Table<HeatmapEntry, string>;
  pairs!: Table<ChordPairRecord, string>;
  strums!: Table<StrumRecord, string>;
  blobs!: Table<{ id: string; blob: Blob }, string>;
  meta!: Table<{ id: string; value: unknown }, string>;
  quarantine!: Table<
    { id: string; raw: unknown; error: string; at: string },
    string
  >;
  constructor(name = "fretshift-v1") {
    super(name);
    this.version(1).stores({
      songs: "id,updatedAt,deletedAt",
      setlists: "id,updatedAt",
      settings: "id",
      tunings: "id",
      sessions: "id,songId,startedAt",
      heat: "[songId+measureId],songId",
      pairs: "[chordA+chordB+tuningId]",
      strums: "at",
      blobs: "id",
      meta: "id",
      quarantine: "id",
    });
  }
}
export const db = new FretDB();

/** Remove quarantine entries created by the old Supabase timestamp parser.
 * Those records were valid; Postgres merely returned an offset timestamp with
 * microseconds that Zod's strict datetime parser rejected before normalization.
 */
export async function cleanupKnownQuarantineArtifacts() {
  const staleIds = (await db.quarantine.toArray())
    .filter(
      (entry) =>
        entry.id.startsWith("cloud:") &&
        /updatedAt.*Invalid datetime/i.test(entry.error),
    )
    .map((entry) => entry.id);
  if (staleIds.length) await db.quarantine.bulkDelete(staleIds);
  return staleIds.length;
}
export const songsRepo: SongRepository = {
  async all() {
    for (const t of await db.tunings.toArray()) registerTuning(t);
    const songs: Song[] = [];
    for (const raw of await db.songs.toArray())
      try {
        songs.push(loadSong(raw));
      } catch (e) {
        await db.quarantine.put({
          id: raw.id,
          raw,
          error: String(e),
          at: new Date().toISOString(),
        });
      }
    return songs;
  },
  async put(song) {
    const s = loadSong(song);
    s.difficulty = scoreDifficulty(s);
    await db.songs.put(s);
  },
  async replace(songs) {
    const valid = songs.map(loadSong);
    await db.transaction("rw", db.songs, async () => {
      await db.songs.clear();
      await db.songs.bulkPut(
        valid.map((s) => ({ ...s, difficulty: scoreDifficulty(s) })),
      );
    });
  },
};
export const setlistsRepo: SetlistRepository = {
  all: () =>
    db.setlists.toArray().then((s) => s.map((x) => SetlistSchema.parse(x))),
  async put(s) {
    await db.setlists.put(SetlistSchema.parse(s));
  },
  async replace(sets) {
    const parsed = sets.map((s) => SetlistSchema.parse(s));
    await db.transaction("rw", db.setlists, async () => {
      await db.setlists.clear();
      await db.setlists.bulkPut(parsed);
    });
  },
};
export const practiceRepo: PracticeRepository = {
  sessions: () =>
    db.sessions
      .toArray()
      .then((v) => v.map((x) => PracticeSessionSchema.parse(x)).filter(x =>
        !x.immersive || x.immersive.ownerId === (getSession()?.user.id ?? null))),
  async saveSession(s) {
    await db.sessions.put(PracticeSessionSchema.parse(s));
  },
  heatmap: () =>
    db.heat.toArray().then((v) => v.map((x) => HeatmapEntrySchema.parse(x))),
  async saveHeat(e) {
    await db.heat.put(HeatmapEntrySchema.parse(e));
  },
  pairs: () =>
    db.pairs
      .toArray()
      .then((v) => v.map((x) => ChordPairRecordSchema.parse(x))),
  async savePair(r) {
    await db.pairs.put(ChordPairRecordSchema.parse(r));
  },
  strums: () =>
    db.strums.toArray().then((v) => v.map((x) => StrumRecordSchema.parse(x))),
  async saveStrum(r) {
    await db.strums.put(StrumRecordSchema.parse(r));
  },
};
export const settingsRepo: SettingsRepository = {
  async get() {
    const r = await db.settings.get("device");
    return r ? SettingsSchema.parse(r.value) : defaultSettings;
  },
  async put(value) {
    await db.settings.put({ id: "device", value: SettingsSchema.parse(value) });
  },
  tunings: () => db.tunings.toArray(),
  async putTuning(t) {
    const valid = TuningSchema.parse(t);
    registerTuning(valid);
    await db.tunings.put(valid);
  },
};
