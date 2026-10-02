import { z } from "zod";
import { SongBase, TuningSchema, registerTuning } from "../../schema/song.v1";
import { SetlistSchema } from "../../schema/setlist";
import { SettingsSchema } from "../../schema/settings";
import {
  PracticeSessionSchema,
  HeatmapEntrySchema,
  ChordPairRecordSchema,
  StrumRecordSchema,
} from "../../schema/practice";
import { loadSong } from "../../schema/migrations";
import { db } from "../../persistence/dexie";
export const BackupSchema = z.object({
  format: z.literal("fretshift-backup"),
  version: z.literal(1),
  songs: z.array(SongBase),
  tunings: z.array(TuningSchema),
  setlists: z.array(SetlistSchema),
  settings: SettingsSchema,
  sessions: z.array(PracticeSessionSchema),
  heatmap: z.array(HeatmapEntrySchema),
  pairs: z.array(ChordPairRecordSchema),
  strums: z.array(StrumRecordSchema),
});
export type Backup = z.infer<typeof BackupSchema>;
export async function exportBackup(): Promise<Backup> {
  const [songs, tunings, setlists, settings, sessions, heatmap, pairs, strums] =
    await Promise.all([
      db.songs.toArray(),
      db.tunings.toArray(),
      db.setlists.toArray(),
      db.settings.get("device"),
      db.sessions.toArray(),
      db.heat.toArray(),
      db.pairs.toArray(),
      db.strums.toArray(),
    ]);
  return BackupSchema.parse({
    format: "fretshift-backup",
    version: 1,
    songs: songs.map(loadSong),
    tunings,
    setlists,
    settings: settings?.value ?? SettingsSchema.parse({}),
    sessions,
    heatmap,
    pairs,
    strums,
  });
}
export async function importBackup(raw: unknown) {
  const b = BackupSchema.parse(raw);
  b.tunings.forEach(registerTuning);
  const songs = b.songs.map(loadSong);
  const ids = new Set(songs.map((s) => s.id));
  for (const set of b.setlists)
    for (const entry of set.entries)
      if (!ids.has(entry.songId))
        throw new Error(`Setlist “${set.name}” refers to a missing song.`);
  await db.transaction(
    "rw",
    [
      db.songs,
      db.tunings,
      db.setlists,
      db.settings,
      db.sessions,
      db.heat,
      db.pairs,
      db.strums,
    ],
    async () => {
      await Promise.all([
        db.songs.bulkPut(songs),
        db.tunings.bulkPut(b.tunings),
        db.setlists.bulkPut(b.setlists),
        db.settings.put({ id: "device", value: b.settings }),
        db.sessions.bulkPut(b.sessions),
        db.heat.bulkPut(b.heatmap),
        db.pairs.bulkPut(b.pairs),
        db.strums.bulkPut(b.strums),
      ]);
    },
  );
  return b;
}
