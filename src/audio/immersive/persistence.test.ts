import { beforeEach, expect, it } from "vitest";
import { db, practiceRepo } from "../../persistence/dexie";
import { exportBackup, importBackup } from "../../io/backup";
import { PracticeSessionSchema } from "../../schema/practice";
import { newSong } from "../../schema/song.v1";
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
});
it("old sessions parse; immersive results round-trip through backup and stay out of song exports", async () => {
  const s = newSong();
  await db.songs.put(s);
  const old = {
    id: "old",
    songId: s.id,
    startedAt: new Date().toISOString(),
    durationSec: 10,
    tempoMultiplierMax: 1,
    loopCount: 0,
  };
  expect(PracticeSessionSchema.parse(old)).toEqual(old);
  const immersive = {
    version: 1 as const,
    ownerId: null,
    mode: "learn" as const,
    firstMeasure: 0,
    lastMeasure: 0,
    total: 3,
    assessed: 1,
    matched: 1,
    wrong: 0,
    missed: 0,
    uncertain: 1,
    unsupported: 1,
    skipped: 0,
    unassessed: 0,
    timed: 0,
    onTime: 0,
    extraAttacks: 0,
    troublesome: [],
  };
  await practiceRepo.saveSession({ ...old, immersive });
  const backup = await exportBackup();
  await db.sessions.clear();
  await importBackup(backup);
  expect((await practiceRepo.sessions())[0].immersive).toEqual(immersive);
  expect(backup.songs[0]).not.toHaveProperty("immersive");
});
it("another account's immersive summary is not exposed in current practice history", async () => {
  await db.sessions.put({
    id: "private",
    songId: "s",
    startedAt: new Date().toISOString(),
    durationSec: 1,
    tempoMultiplierMax: 1,
    loopCount: 0,
    immersive: {
      version: 1,
      ownerId: "another-account",
      mode: "learn",
      firstMeasure: 0,
      lastMeasure: 0,
      total: 0,
      assessed: 0,
      matched: 0,
      wrong: 0,
      missed: 0,
      uncertain: 0,
      unsupported: 0,
      skipped: 0,
      unassessed: 0,
      timed: 0,
      onTime: 0,
      extraAttacks: 0,
      troublesome: [],
    },
  });
  expect(await practiceRepo.sessions()).toEqual([]);
});
