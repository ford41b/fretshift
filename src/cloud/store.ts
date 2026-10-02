import { create } from "zustand";
import {
  claimPendingAuthHandoff,
  cloudConfig,
  getAccessToken,
  getSession,
  hasPendingAuthHandoff,
  initializeAuth,
  subscribeAuth,
  type Session,
} from "./client";
import { SupabaseSyncAdapter } from "../persistence/supabase";
import {
  AccountWorkspaceMismatchError,
  SyncEngine,
  relinkWorkspaceOwner,
  type SyncResult,
} from "../sync/engine";
import type { SyncConflict, ConflictChoice } from "../sync/conflicts";
import {
  useSongStore,
  flushPersistence,
  pauseLibraryPersistence,
  refreshQuarantineStatus,
} from "../store/songStore";
import { useSettingsStore } from "../store/settingsStore";
import { db, songsRepo, setlistsRepo } from "../persistence/dexie";

export function cloudAdapter(
  expectedAccountId = getSession()?.user.id ?? null,
) {
  const config = cloudConfig();
  if (!config)
    throw new Error("Cloud features aren't configured. Follow README setup.");
  return new SupabaseSyncAdapter({
    url: config.url,
    anonKey: config.key,
    expectedAccountId,
    getAccountId: () => getSession()?.user.id ?? null,
    getAccessToken,
  });
}
export const useCloudStore = create<{
  session: Session | null;
  busy: boolean;
  error: string;
  status: string;
  conflicts: SyncConflict[];
  workspaceMismatch: boolean;
}>(() => ({
  session: getSession(),
  busy: false,
  error: "",
  status: "",
  conflicts: [],
  workspaceMismatch: false,
}));

function mergeRows<T extends { id: string }>(
  before: T[],
  now: T[],
  remote: T[],
): T[] {
  const original = new Map(before.map((row) => [row.id, row]));
  const latest = new Map(now.map((row) => [row.id, row]));
  const result = remote.map((row) => {
    const current = latest.get(row.id);
    latest.delete(row.id);
    return current &&
      JSON.stringify(current) !== JSON.stringify(original.get(row.id))
      ? current
      : row;
  });
  return [...result, ...latest.values()];
}
export async function updateLibrary(
  operation: () => Promise<SyncResult | void>,
) {
  const resume = pauseLibraryPersistence();
  const beforeSongs = structuredClone(useSongStore.getState().songs);
  const beforeSetlists = structuredClone(useSongStore.getState().setlists);
  const settingsBefore = structuredClone(useSettingsStore.getState().settings);
  const tuningsBefore = structuredClone(useSettingsStore.getState().tunings);
  let result: SyncResult | void = undefined;
  let operationError: unknown;
  try {
    await flushPersistence();
    if (useSongStore.getState().saveState.includes("validation errors"))
      throw new Error("Fix song validation errors before syncing.");
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  let reconciliationError: unknown;
  try {
    const [songs, setlists, settings, tunings] = await Promise.all([
      songsRepo.all(),
      setlistsRepo.all(),
      db.settings.get("device"),
      db.tunings.toArray(),
    ]);
    const current = useSongStore.getState();
    const nextSongs = mergeRows(beforeSongs, current.songs, songs);
    const nextSetlists = mergeRows(beforeSetlists, current.setlists, setlists);
    const libraryChanged =
      JSON.stringify(nextSongs) !== JSON.stringify(current.songs) ||
      JSON.stringify(nextSetlists) !== JSON.stringify(current.setlists);
    const temporal = useSongStore.temporal.getState();
    temporal.pause();
    try {
      useSongStore.setState({ songs: nextSongs, setlists: nextSetlists });
    } finally {
      temporal.resume();
    }
    if (libraryChanged) temporal.clear();
    const currentSettings = useSettingsStore.getState().settings;
    if (
      settings &&
      JSON.stringify(currentSettings) === JSON.stringify(settingsBefore)
    ) {
      useSettingsStore.setState({ settings: settings.value });
      localStorage.setItem(
        "fretshift-settings",
        JSON.stringify(settings.value),
      );
    } else await db.settings.put({ id: "device", value: currentSettings });
    const currentTunings = useSettingsStore.getState().tunings;
    useSettingsStore.setState({
      tunings: mergeRows(tuningsBefore, currentTunings, tunings),
    });
  } catch (error) {
    reconciliationError = error;
  } finally {
    resume();
    try {
      await flushPersistence();
    } catch (error) {
      reconciliationError ??= error;
    }
  }
  if (operationError) throw operationError;
  if (reconciliationError) throw reconciliationError;
  return result;
}
export async function relinkCurrentDeviceLibrary() {
  const state = useCloudStore.getState();
  const session = getSession();
  if (state.busy || !session) return;

  useCloudStore.setState({
    busy: true,
    error: "",
    status: "Relinking this device library…",
  });

  let relinked = false;
  try {
    await relinkWorkspaceOwner(session.user.id);
    relinked = true;
    useCloudStore.setState({
      workspaceMismatch: false,
      status: navigator.onLine
        ? "Device library relinked · Starting sync…"
        : "Device library relinked · Will sync when online",
    });
  } catch (error) {
    useCloudStore.setState({
      error: error instanceof Error ? error.message : String(error),
      status: "Relink needs attention",
    });
  } finally {
    useCloudStore.setState({ busy: false });
  }

  if (relinked && navigator.onLine) await syncNow();
}

export async function syncNow(
  conflict?: SyncConflict,
  choice?: ConflictChoice,
) {
  const state = useCloudStore.getState(),
    session = getSession();
  if (state.busy || !session) return;
  if (!navigator.onLine) {
    useCloudStore.setState({ status: "Offline · Changes stay on this device" });
    return;
  }
  useCloudStore.setState({
    busy: true,
    error: "",
    status: "Syncing…",
    workspaceMismatch: false,
  });
  try {
    const engine = new SyncEngine(cloudAdapter(session.user.id));
    const result = await updateLibrary(async () => {
      if (conflict && choice)
        await engine.resolve(session.user.id, conflict, choice);
      return engine.sync(session.user.id);
    });
    await refreshQuarantineStatus();
    useCloudStore.setState({
      conflicts: result?.conflicts ?? [],
      status: result?.conflicts.length
        ? "Choose which changes to keep"
        : `Synced at ${new Date().toLocaleTimeString()}`,
    });
  } catch (error) {
    const workspaceMismatch = error instanceof AccountWorkspaceMismatchError;
    useCloudStore.setState({
      error: error instanceof Error ? error.message : String(error),
      status: "Changes saved locally · Sync needs attention",
      workspaceMismatch,
    });
  } finally {
    useCloudStore.setState({ busy: false });
  }
}
let initialized: Promise<void> | undefined;
export function startCloud() {
  initialized ??= initializeAuth().catch((error) => {
    useCloudStore.setState({ error: String(error) });
  });
  let stopped = false;
  let handoffBusy = false;

  const tryAuthHandoff = async () => {
    if (
      stopped ||
      handoffBusy ||
      getSession() ||
      !hasPendingAuthHandoff() ||
      !navigator.onLine
    )
      return;
    handoffBusy = true;
    useCloudStore.setState({ status: "Finishing sign-in…", error: "" });
    try {
      const claimed = await claimPendingAuthHandoff();
      if (!claimed && !getSession())
        useCloudStore.setState({
          status: "Waiting for the email sign-in to finish…",
        });
    } catch (error) {
      useCloudStore.setState({
        error: String(error),
        status: "Sign-in transfer needs attention",
      });
    } finally {
      handoffBusy = false;
    }
  };

  void initialized.then(() => {
    if (stopped) return;
    useCloudStore.setState({ session: getSession() });
    if (getSession()) void syncNow();
    else void tryAuthHandoff();
  });
  const unsubscribe = subscribeAuth(() => {
    const previous = useCloudStore.getState().session?.user.id;
    const session = getSession();
    useCloudStore.setState({
      session,
      ...(session
        ? {}
        : {
            conflicts: [],
            workspaceMismatch: false,
            status: "Signed out · Library stays on this device",
          }),
    });
    if (session?.user.id !== previous && session) void syncNow();
  });
  const onOnline = () => {
    void tryAuthHandoff();
    void syncNow();
  };
  const onOffline = () =>
    useCloudStore.setState({ status: "Offline · Changes stay on this device" });
  const onVisibility = () => {
    if (document.visibilityState === "visible") void tryAuthHandoff();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibility);
  const handoffTimer = window.setInterval(() => void tryAuthHandoff(), 3000);
  const timer = window.setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      !useCloudStore.getState().conflicts.length
    )
      void syncNow();
  }, 30000);
  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(timer);
    clearInterval(handoffTimer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
