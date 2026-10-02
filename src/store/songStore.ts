import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import { type Song } from "../schema/song.v1";
import { type Setlist } from "../schema/setlist";
import { SongV1 } from "../schema/song.v1";
import {
  cleanupKnownQuarantineArtifacts,
  db,
  songsRepo,
  setlistsRepo,
} from "../persistence/dexie";
import { createSamples } from "../samples";
import { scoreDifficulty } from "../transforms";
type LibraryState = {
  songs: Song[];
  setlists: Setlist[];
  ready: boolean;
  error: string;
  saveState: string;
  initialize: () => Promise<void>;
  edit: (id: string, fn: (s: Song) => void) => void;
  applySongs: (songs: Song[]) => void;
  add: (s: Song) => void;
  remove: (id: string) => void;
  restore: (id: string) => void;
  putSetlist: (s: Setlist) => void;
  removeSetlist: (id: string) => void;
};
export const useSongStore = create<LibraryState>()(
  temporal(
    immer((set) => ({
      songs: [],
      setlists: [],
      ready: false,
      error: "",
      saveState: "Saved on this device",
      initialize: async () => {
        try {
          let songs = await songsRepo.all();
          if (!(await db.meta.get("seeded"))) {
            songs = createSamples();
            await songsRepo.replace(songs);
            await db.meta.put({ id: "seeded", value: true });
          }
          const setlists = await setlistsRepo.all();
          await cleanupKnownQuarantineArtifacts();
          const quarantined = await db.quarantine.count();
          set({
            songs,
            setlists,
            ready: true,
            error: quarantined
              ? `${quarantined} invalid record(s) quarantined. Open Settings for details.`
              : "",
          });
          useSongStore.temporal.getState().clear();
        } catch (e) {
          set({
            ready: true,
            error: `Could not load your library: ${String(e)}`,
          });
        }
      },
      edit: (id, fn) =>
        set((state) => {
          const song = state.songs.find((s) => s.id === id);
          if (song) {
            const before = JSON.stringify(song);
            fn(song);
            if (JSON.stringify(song) === before) return;
            song.updatedAt = new Date().toISOString();
            try {
              song.difficulty = scoreDifficulty(song);
            } catch (e) {
              state.error = String(e);
            }
          }
        }),
      applySongs: (replacements) =>
        set((state) => {
          const byId = new Map(replacements.map((song) => [song.id, song])),
            now = new Date().toISOString();
          state.songs = state.songs.map((song) =>
            byId.has(song.id)
              ? { ...byId.get(song.id)!, updatedAt: now }
              : song,
          );
        }),
      add: (s) =>
        set((state) => {
          state.songs.push(s);
        }),
      remove: (id) =>
        set((state) => {
          const s = state.songs.find((s) => s.id === id);
          if (s) {
            s.deletedAt = new Date().toISOString();
            s.updatedAt = s.deletedAt;
          }
        }),
      restore: (id) =>
        set((state) => {
          const s = state.songs.find((s) => s.id === id);
          if (s) {
            s.deletedAt = null;
            s.updatedAt = new Date().toISOString();
          }
        }),
      putSetlist: (s) =>
        set((state) => {
          const i = state.setlists.findIndex((x) => x.id === s.id);
          if (i < 0) state.setlists.push(s);
          else state.setlists[i] = s;
        }),
      removeSetlist: (id) =>
        set((state) => {
          const s = state.setlists.find((x) => x.id === id);
          if (s) {
            s.deletedAt = new Date().toISOString();
            s.updatedAt = s.deletedAt;
          }
        }),
    })),
    {
      partialize: (s) => ({ songs: s.songs, setlists: s.setlists }),
      limit: 80,
      equality: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
  ),
);
let queue = Promise.resolve();
let pendingWrites = 0;
let persistencePaused = false;
/** Sync merges remote records with edits made during its network request before resuming. */
export function pauseLibraryPersistence() {
  persistencePaused = true;
  return () => {
    persistencePaused = false;
    const state = useSongStore.getState();
    useSongStore.setState({ songs: [...state.songs], setlists: [...state.setlists] });
  };
}
useSongStore.subscribe((s, prev) => {
  if (persistencePaused || !s.ready || (s.songs === prev.songs && s.setlists === prev.setlists))
    return;
  const valid = s.songs.every((song) => SongV1.safeParse(song).success);
  if (!valid) {
    useSongStore.setState({
      saveState: "Draft has validation errors — export and sync paused",
    });
    return;
  }
  const songs = structuredClone(s.songs),
    sets = structuredClone(s.setlists);
  pendingWrites++;
  useSongStore.setState({ saveState: "Saving…" });
  queue = queue
    .then(async () => {
      await songsRepo.replace(songs);
      await setlistsRepo.replace(sets);
      pendingWrites--;
      if (pendingWrites === 0)
        useSongStore.setState({ saveState: "Saved on this device" });
    })
    .catch((e) => {
      pendingWrites = Math.max(0, pendingWrites - 1);
      useSongStore.setState({
        error: `Save failed: ${String(e)}`,
        saveState: "Not saved — retry after resolving storage error",
      });
    });
});
export const flushPersistence = () => queue;

/** Keep the global quarantine banner aligned with IndexedDB after sync repairs. */
export async function refreshQuarantineStatus() {
  const count = await db.quarantine.count();
  const current = useSongStore.getState().error;
  if (!current || /invalid record\(s\) quarantined/i.test(current)) {
    useSongStore.setState({
      error: count
        ? `${count} invalid record(s) quarantined. Open Settings for details.`
        : "",
    });
  }
  return count;
}
