import { z } from "zod";

const seconds = z.number().finite().nonnegative();
const midi = z.number().int().min(0).max(127);
export const FingeringSchema = z.object({
  string: z.number().int().min(0).max(5),
  fret: z.number().int().min(0).max(22),
});
export const FingeringOptionsSchema = z
  .object({
    tuningId: z.string(),
    capo: z.number().int().min(0).max(7),
    availableStrings: z.array(z.number().int().min(0).max(5)).min(1).max(6),
    minFret: z.number().int().min(0).max(22),
    maxFret: z.number().int().min(0).max(22),
    position: z.number().int().min(0).max(22),
    preferOpen: z.boolean(),
  })
  .refine(
    (o) =>
      o.minFret <= o.maxFret &&
      new Set(o.availableStrings).size === o.availableStrings.length,
    "Choose an ordered fret range and distinct available strings.",
  );
export const DetectedNoteSchema = z
  .object({
    id: z.string(),
    start: seconds,
    end: seconds,
    midi,
    confidence: z.number().finite().min(0).max(1),
    inferredArticulation: z.literal("unknown"),
  })
  .refine((n) => n.end > n.start, "Note offset must follow onset.");
export const NoteAnalysisSchema = z.object({
  providerId: z.string(),
  notes: z.array(DetectedNoteSchema),
  warnings: z.array(z.string()),
  // Complete output of this DSP provider, including rejected/unvoiced frames.
  frames: z.array(
    z.object({
      time: seconds,
      rms: z.number().finite().nonnegative(),
      midi: midi.nullable(),
      cents: z.number().finite(),
      confidence: z.number().finite().min(0).max(1),
      flatness: z.number().finite().nonnegative(),
    }),
  ),
  hopSeconds: z.number().finite().positive(),
  windowSeconds: z.number().finite().positive(),
});
export const ReviewedNoteSchema = z
  .object({
    id: z.string(),
    detectedId: z.string().nullable(),
    start: seconds,
    end: seconds,
    midi,
    uncertain: z.boolean(),
    confirmed: z.boolean(),
    deleted: z.boolean(),
    fingering: FingeringSchema.extend({
      source: z.enum(["suggested", "user"]),
    }).nullable(),
    quantized: z
      .object({ startBeat: z.number().finite(), endBeat: z.number().finite() })
      .refine(q => q.endBeat > q.startBeat, "Quantized offset must follow onset.")
      .nullable(),
  })
  .refine(
    (n) => n.end > n.start && !(n.confirmed && (n.uncertain || n.deleted)),
    "Notes need a positive duration; uncertain or deleted notes cannot be confirmed.",
  );
export const NoteTranscriptionSchema = z.object({
  version: z.literal(1),
  scope: z.literal("single-note-user-selected"),
  detected: NoteAnalysisSchema,
  options: FingeringOptionsSchema,
  notes: z.array(ReviewedNoteSchema),
  chartSignature: z.string().optional(),
});
export type Fingering = z.infer<typeof FingeringSchema>;
export type FingeringOptions = z.infer<typeof FingeringOptionsSchema>;
export type NoteAnalysis = z.infer<typeof NoteAnalysisSchema>;
export type ReviewedNote = z.infer<typeof ReviewedNoteSchema>;
export type NoteTranscription = z.infer<typeof NoteTranscriptionSchema>;
