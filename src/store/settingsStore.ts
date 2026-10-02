import { create } from "zustand";
import {
  type Settings,
  defaultSettings,
  SettingsSchema,
} from "../schema/settings";
import { settingsRepo } from "../persistence/dexie";
import { type Tuning, BUILT_IN_TUNINGS } from "../schema/song.v1";
export const useSettingsStore = create<{
  settings: Settings;
  tunings: Tuning[];
  error: string;
  init: () => Promise<void>;
  update: (value: Partial<Settings>) => Promise<void>;
  addTuning: (t: Tuning) => Promise<void>;
}>((set, get) => ({
  settings: defaultSettings,
  tunings: BUILT_IN_TUNINGS,
  error: "",
  init: async () => {
    try {
      set({
        settings: localStorage.getItem("fretshift-settings")
          ? SettingsSchema.parse(
              JSON.parse(localStorage.getItem("fretshift-settings")!),
            )
          : await settingsRepo.get(),
        tunings: [...BUILT_IN_TUNINGS, ...(await settingsRepo.tunings())],
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  update: async (v) => {
    const settings = { ...get().settings, ...v };
    localStorage.setItem("fretshift-settings", JSON.stringify(settings));
    set({ settings });
    try {
      await settingsRepo.put(settings);
    } catch (e) {
      set({ error: `Settings were not saved: ${String(e)}` });
    }
  },
  addTuning: async (t) => {
    await settingsRepo.putTuning(t);
    set((s) => ({ tunings: [...s.tunings, t] }));
  },
}));
