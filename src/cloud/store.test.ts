import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../persistence/dexie";
import { newSong } from "../schema/song.v1";
import { defaultSettings } from "../schema/settings";
import { flushPersistence, useSongStore } from "../store/songStore";
import { useSettingsStore } from "../store/settingsStore";
import { updateLibrary } from "./store";

beforeEach(async () => {
  await flushPersistence();
  for (const table of db.tables) await table.clear();
  localStorage.clear();
  useSongStore.setState({
    songs: [],
    setlists: [],
    ready: false,
    error: "",
    saveState: "Saved on this device",
  });
  useSongStore.temporal.getState().clear();
  useSettingsStore.setState({
    settings: defaultSettings,
    tunings: [],
    error: "",
  });
});

async function seedSong() {
  const song = newSong("Original");
  await db.songs.put(song);
  useSongStore.setState({ songs: [song], setlists: [], ready: true });
  await flushPersistence();
  useSongStore.temporal.getState().clear();
  return song;
}

describe("cloud library reconciliation", () => {
  it("hydrates partial remote changes even when the operation fails", async () => {
    const song = await seedSong();
    const remote = {
      ...song,
      title: "Remote",
      updatedAt: "2026-09-13T12:00:00.000Z",
    };
    await expect(
      updateLibrary(async () => {
        await db.songs.put(remote);
        throw new Error("network failed after apply");
      }),
    ).rejects.toThrow(/network failed/);

    expect(useSongStore.getState().songs[0].title).toBe("Remote");
    expect((await db.songs.get(song.id))?.title).toBe("Remote");
    useSongStore.temporal.getState().undo();
    expect(useSongStore.getState().songs[0].title).toBe("Remote");
  });

  it("keeps and persists a local edit made during a failing request", async () => {
    const song = await seedSong();
    await expect(
      updateLibrary(async () => {
        await db.songs.put({
          ...song,
          title: "Remote",
          updatedAt: "2026-09-13T12:00:00.000Z",
        });
        useSongStore.getState().edit(song.id, (draft) => {
          draft.title = "Edited while syncing";
        });
        throw new Error("partial failure");
      }),
    ).rejects.toThrow(/partial failure/);

    expect(useSongStore.getState().songs[0].title).toBe("Edited while syncing");
    expect((await db.songs.get(song.id))?.title).toBe("Edited while syncing");
  });

  it("adopts remote settings unless settings changed during the request", async () => {
    await db.settings.put({ id: "device", value: defaultSettings });
    useSettingsStore.setState({ settings: defaultSettings });
    const remote = { ...defaultSettings, leftHanded: true };
    await expect(
      updateLibrary(async () => {
        await db.settings.put({ id: "device", value: remote });
        throw new Error("after settings");
      }),
    ).rejects.toThrow();
    expect(useSettingsStore.getState().settings.leftHanded).toBe(true);
    expect(
      JSON.parse(localStorage.getItem("fretshift-settings") ?? "null"),
    ).toMatchObject({ leftHanded: true });

    const before = useSettingsStore.getState().settings;
    await expect(
      updateLibrary(async () => {
        await db.settings.put({
          id: "device",
          value: { ...before, theme: "dark" },
        });
        await useSettingsStore.getState().update({ a4Hz: 442 });
        throw new Error("after local settings edit");
      }),
    ).rejects.toThrow();
    expect((await db.settings.get("device"))?.value).toMatchObject({
      a4Hz: 442,
    });
  });
});
