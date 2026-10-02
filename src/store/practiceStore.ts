import { create } from "zustand";
export const usePracticeStore = create<{
  loopStartMeasureId: string | null;
  loopEndMeasureId: string | null;
  tempoMultiplier: number;
  scrollPosition: number;
  seed: number;
  setLoop: (a: string | null, b: string | null) => void;
  setMultiplier: (v: number) => void;
  reroll: () => void;
}>((set) => ({
  loopStartMeasureId: null,
  loopEndMeasureId: null,
  tempoMultiplier: 1,
  scrollPosition: 0,
  seed: 1,
  setLoop: (a, b) => set({ loopStartMeasureId: a, loopEndMeasureId: b }),
  setMultiplier: (v) => set({ tempoMultiplier: v }),
  reroll: () => set((s) => ({ seed: s.seed + 1 })),
}));
