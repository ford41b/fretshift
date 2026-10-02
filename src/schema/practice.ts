import { z } from "zod";
export const PracticeSessionSchema = z.object({
  id: z.string(),
  songId: z.string(),
  startedAt: z.string().datetime(),
  durationSec: z.number().nonnegative(),
  tempoMultiplierMax: z.number().positive(),
  loopCount: z.number().int().nonnegative(),
  immersive: z
    .object({
      version: z.literal(1),
      ownerId: z.string().nullable(),
      mode: z.enum(["learn", "rhythm", "visual"]),
      firstMeasure: z.number().int().nonnegative(),
      lastMeasure: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      assessed: z.number().int().nonnegative(),
      matched: z.number().int().nonnegative(),
      wrong: z.number().int().nonnegative(),
      missed: z.number().int().nonnegative(),
      uncertain: z.number().int().nonnegative(),
      unsupported: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      unassessed: z.number().int().nonnegative(),
      timed: z.number().int().nonnegative(),
      onTime: z.number().int().nonnegative(),
      extraAttacks: z.number().int().nonnegative(),
      visualProgressPercent: z.number().min(0).max(100).optional(),
      troublesome: z.array(z.number().int().nonnegative()),
    })
    .optional(),
});
export type PracticeSession = z.infer<typeof PracticeSessionSchema>;
export const HeatmapEntrySchema = z.object({
  songId: z.string(),
  measureId: z.string(),
  score: z.number().min(0).max(100),
  updatedAt: z.string().datetime(),
});
export type HeatmapEntry = z.infer<typeof HeatmapEntrySchema>;
export const ChordPairRecordSchema = z.object({
  chordA: z.string(),
  chordB: z.string(),
  tuningId: z.string(),
  best: z.number().nonnegative(),
  history: z.array(
    z.object({ at: z.string().datetime(), count: z.number().nonnegative() }),
  ),
});
export type ChordPairRecord = z.infer<typeof ChordPairRecordSchema>;
export const StrumRecordSchema = z.object({
  at: z.string().datetime(),
  tempo: z.number().positive(),
  score: z.number().min(0).max(100),
  meanOffsetMs: z.number(),
});
export type StrumRecord = z.infer<typeof StrumRecordSchema>;
