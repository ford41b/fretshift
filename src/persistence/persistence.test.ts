import { it, expect, beforeEach } from "vitest";
import { cleanupKnownQuarantineArtifacts, db, songsRepo, practiceRepo } from "./dexie";
import { newSong, registerTuning } from "../schema/song.v1";
import { useSongStore, flushPersistence } from "../store/songStore";
import { exportBackup, importBackup } from "../io/backup";
beforeEach(async () => {
  await flushPersistence();
  useSongStore.setState({ ready: false, songs: [], setlists: [] });
  for (const table of db.tables) await table.clear();
  useSongStore.temporal.getState().clear();
});
it("persists and reloads a song through schema validation", async () => {
  const s = newSong("Saved");
  await songsRepo.put(s);
  expect(await songsRepo.all()).toEqual([s]);
});
it("undo/redo restores exact state including soft deletes", async () => {
  const s = newSong("History");
  useSongStore.setState({ songs: [s], ready: true });
  useSongStore.temporal.getState().clear();
  const before = structuredClone(useSongStore.getState().songs);
  useSongStore.getState().edit(s.id, (x) => {
    x.title = "Changed";
  });
  const after = structuredClone(useSongStore.getState().songs);
  useSongStore.temporal.getState().undo();
  expect(useSongStore.getState().songs).toEqual(before);
  useSongStore.temporal.getState().redo();
  expect(useSongStore.getState().songs).toEqual(after);
  useSongStore.getState().remove(s.id);
  expect(useSongStore.getState().songs[0].deletedAt).toBeTruthy();
  useSongStore.temporal.getState().undo();
  expect(useSongStore.getState().songs).toEqual(after);
  await flushPersistence();
});
it("round-trips all backup collections", async () => {
  const s = newSong("Backup");
  await songsRepo.put(s);
  const t = registerTuning({
    id: "custom-test",
    label: "Test",
    midi: [64, 59, 55, 50, 45, 39],
    builtIn: false,
  });
  await db.tunings.put(t);
  await db.setlists.put({
    id: "set",
    name: "Set",
    entries: [{ songId: s.id, note: "Quiet intro" }],
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  });
  await db.sessions.put({
    id: "practice",
    songId: s.id,
    startedAt: s.createdAt,
    durationSec: 60,
    tempoMultiplierMax: 0.8,
    loopCount: 2,
  });
  const before = await exportBackup();
  for (const table of db.tables) await table.clear();
  await importBackup(before);
  expect(await exportBackup()).toEqual(before);
});
it("quarantines unknown song versions", async () => {
  await db.songs.put({ ...newSong(), schemaVersion: 88 } as never);
  expect(await songsRepo.all()).toHaveLength(0);
  expect(await db.quarantine.count()).toBe(1);
});

it("persists practice evidence without changing the saved song or its timestamp", async () => {
  const song = newSong("Practice boundary");
  await songsRepo.put(song);
  const before = await songsRepo.all();
  await practiceRepo.saveSession({
    id: "session-test",
    songId: song.id,
    startedAt: new Date().toISOString(),
    durationSec: 90,
    tempoMultiplierMax: 0.8,
    loopCount: 2,
  });
  await practiceRepo.saveHeat({
    songId: song.id,
    measureId: song.measures[0].id,
    score: 42,
    updatedAt: new Date().toISOString(),
  });
  expect((await practiceRepo.sessions()).length).toBe(1);
  expect((await practiceRepo.heatmap())[0].score).toBe(42);
  expect(await songsRepo.all()).toEqual(before);
});


it("cleans up stale cloud timestamp quarantine notices", async () => {
  await db.quarantine.bulkPut([
    {
      id: "cloud:song:sample-1:legacy-a",
      raw: {},
      error: "Error: updatedAt: Invalid datetime",
      at: new Date().toISOString(),
    },
    {
      id: "cloud:song:truly-bad",
      raw: {},
      error: "Error: schemaVersion unsupported",
      at: new Date().toISOString(),
    },
  ]);
  expect(await cleanupKnownQuarantineArtifacts()).toBe(1);
  expect((await db.quarantine.toArray()).map((row) => row.id)).toEqual([
    "cloud:song:truly-bad",
  ]);
});
