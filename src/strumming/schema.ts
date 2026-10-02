import { z } from "zod";

export const MeterSchema = z.tuple([
  z.number().int().min(1).max(32),
  z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
]);
export const StrokeSchema = z.enum(["down", "up", "mute", "rest"]);
export type Stroke = z.infer<typeof StrokeSchema>;
export const DifficultySchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
]);
export const EventSchema = z.object({
  // Position/duration are denominator beats, matching FretShift's chord grid.
  position: z.number().finite().min(0),
  duration: z.number().finite().positive(),
  stroke: StrokeSchema,
  accent: z.number().min(0).max(1),
  chord: z.string().optional(),
});
export const PatternSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    meter: MeterSchema,
    subdivision: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    feel: z.enum(["straight", "compound"]),
    difficulty: DifficultySchema,
    events: z.array(EventSchema).min(1).max(128),
  })
  .superRefine((pattern, ctx) => {
    const count = pattern.meter[0] * pattern.subdivision;
    if (pattern.subdivision * pattern.meter[1] > 16)
      ctx.addIssue({
        code: "custom",
        message: "The finest supported grid is sixteenth notes.",
      });
    if (pattern.events.length !== count)
      ctx.addIssue({
        code: "custom",
        message: "Every grid position must have exactly one event or rest.",
      });
    pattern.events.forEach((event, i) => {
      if (
        Math.abs(event.position - i / pattern.subdivision) > 1e-8 ||
        Math.abs(event.duration - 1 / pattern.subdivision) > 1e-8 ||
        event.position + event.duration > pattern.meter[0] + 1e-8
      )
        ctx.addIssue({
          code: "custom",
          path: ["events", i],
          message: "Event is outside the measure or off the rhythmic grid.",
        });
      if (event.stroke === "rest" && event.accent !== 0)
        ctx.addIssue({
          code: "custom",
          path: ["events", i],
          message: "A rest cannot have an accent.",
        });
    });
  });
export type Pattern = z.infer<typeof PatternSchema>;
export type StrumEvent = z.infer<typeof EventSchema>;
export type Difficulty = z.infer<typeof DifficultySchema>;
export const RecommendationSchema = z.object({
  role: z.enum(["Simple", "Recommended", "Expressive"]),
  pattern: PatternSchema,
  explanation: z.string(),
  score: z.number().finite(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
export const InputSettingsSchema = z.object({
  tempo: z.number().min(20).max(400).optional(),
  meter: MeterSchema.optional(),
  metadataConfirmed: z.boolean().optional(),
  chordTimingConfirmed: z.boolean().optional(),
  style: z
    .enum([
      "auto",
      "pop",
      "folk",
      "rock",
      "country",
      "worship",
      "blues",
      "funk",
      "ballad",
    ])
    .optional(),
  difficulty: DifficultySchema.optional(),
});
export type InputSettings = z.infer<typeof InputSettingsSchema>;
export const StrummingStateSchema = z.object({
  schemaVersion: z.literal(1),
  inputs: InputSettingsSchema,
  contexts: z.record(
    z.object({
      fingerprint: z.string(),
      generation: z.number().int().nonnegative(),
      recommendations: z.array(RecommendationSchema).length(3),
      selectedId: z.string(),
    }),
  ),
  customs: z.array(
    z.object({
      id: z.string().min(1),
      contextId: z.string(),
      sourceId: z.string(),
      fingerprint: z.string(),
      tempo: z.number().min(20).max(400),
      pattern: PatternSchema,
      savedAt: z.string().datetime(),
    }),
  ),
});
export type StrummingState = z.infer<typeof StrummingStateSchema>;
export const emptyStrummingState = (): StrummingState => ({
  schemaVersion: 1,
  inputs: {},
  contexts: {},
  customs: [],
});
