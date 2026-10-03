import { z } from "zod";

export const MAX_ANALYSIS_SECONDS = 15 * 60;
export const MAX_VIDEO_SECONDS = 60 * 60;
export const MAX_REQUEST_SECONDS = 10 * 60;
export const DEFAULT_FPS = 1;
/** Close-up lessons: more frames so chord shapes on the fretboard are sampled between strums. */
export const CLOSE_UP_FPS = 4;

const seconds = z.number().finite().nonnegative();
const EvidenceSchema = z.enum(["heard", "seen", "heard_and_seen"]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const YouTubeChordSchema = z
  .object({
    startSeconds: seconds,
    endSeconds: z.number().finite().positive(),
    chord: z.string().min(1).max(16).nullable(),
    kind: z.enum(["chord", "unknown", "no-chord"]),
    confidence: z.number().min(0).max(1),
    evidence: EvidenceSchema,
  })
  .strict()
  .refine((chord) => chord.endSeconds > chord.startSeconds, "Chord changes must end after they start.")
  .refine((chord) => (chord.kind === "chord") === (chord.chord !== null), "Only chord entries carry a chord symbol.");

export const YouTubeAnalysisSchema = z
  .object({
    tempoBpm: z.number().min(20).max(400).nullable(),
    meter: z.union([z.literal(3), z.literal(4), z.null()]),
    key: z.string().max(4).nullable(),
    capoGuess: z.number().int().min(0).max(12).nullable(),
    firstDownbeatSeconds: seconds.nullable(),
    sections: z
      .array(
        z.object({ label: z.string().min(1).max(20), startSeconds: seconds, endSeconds: z.number().finite().positive() }).strict(),
      )
      .max(60),
    chords: z.array(YouTubeChordSchema).max(800),
    sanitized: z.object({ labels: z.number().int().nonnegative(), times: z.number().int().nonnegative(),
      outsideWindowSeconds: seconds }).strict(),
    timingSuspect: z.boolean(),
  })
  .strict();
export type YouTubeAnalysis = z.infer<typeof YouTubeAnalysisSchema>;
export type YouTubeChord = YouTubeAnalysis["chords"][number];

export const YouTubeWireSchema = z
  .object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    segment: z.object({ startSeconds: seconds, endSeconds: z.number().finite().positive() }).strict(),
    fps: z.number().positive().max(24),
    pass: z.number().int().min(1).max(3),
    analysis: YouTubeAnalysisSchema,
    video: z.object({ title: z.string().max(300).optional(), channel: z.string().max(300).optional() }).strict(),
    usage: z.object({ promptTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative() }).strict().nullable(),
    modelId: z.string().min(1).max(80),
    promptVersion: z.string().min(1).max(80),
    processedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((wire, ctx) => {
    const { startSeconds, endSeconds } = wire.segment;
    let previous = startSeconds;
    for (const [index, chord] of wire.analysis.chords.entries()) {
      if (chord.startSeconds < previous - 0.001 || chord.endSeconds > endSeconds + 0.001)
        ctx.addIssue({ code: "custom", path: ["analysis", "chords", index],
          message: "Chord changes must be ordered and inside the requested range." });
      previous = chord.endSeconds;
    }
  });
export type YouTubeWire = z.infer<typeof YouTubeWireSchema>;

export const YouTubeHintsSchema = z
  .object({
    title: z.string().max(160).optional(),
    artist: z.string().max(160).optional(),
    /** Tuning label sent to the prompt, e.g. "Drop D". */
    tuning: z.string().max(60).optional(),
    capo: z.number().int().min(0).max(12).optional(),
  })
  .strict();
export type YouTubeHints = z.infer<typeof YouTubeHintsSchema>;

/** Accuracy options (a)–(e). Defaults are set from measurements; see YOUTUBE_IMPORT_HANDOFF.md. */
export type AccuracyOptions = {
  /** (a) Send title/artist/tuning/capo hints to Gemini. */
  useHints: boolean;
  /** (b) Analyze overlapping windows instead of one request. null = single request. */
  windowSeconds: number | null;
  overlapSeconds: number;
  /** (c) Close-up lesson video: sample frames at CLOSE_UP_FPS. */
  closeUp: boolean;
  /** (d) Independent passes voted per region. */
  passes: 1 | 2 | 3;
  /** (e) Snap chord changes to the user-confirmed beat grid. */
  snapToBeats: boolean;
};

export const DEFAULT_ACCURACY: AccuracyOptions = {
  useHints: true,
  windowSeconds: null,
  overlapSeconds: 10,
  closeUp: false,
  passes: 1,
  snapToBeats: true,
};

export type AnalysisRange = { startSeconds: number; endSeconds: number };
export type PlannedRequest = { window: number; pass: number; segment: AnalysisRange; fps: number };
