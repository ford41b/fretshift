import { z } from "zod";
export const PassSchema = z.object({
  stopped: z.boolean(),
  rewound: z.boolean(),
  onsetOffsets: z.array(z.number()),
  pitchAccuracy: z.number().min(0).max(1).optional(),
  monophonic: z.boolean(),
});
export type Pass = z.infer<typeof PassSchema>;
export function isCleanPass(p: Pass, tolerance = 60) {
  return (
    !p.stopped &&
    !p.rewound &&
    p.onsetOffsets.length > 0 &&
    p.onsetOffsets.every((o) => Math.abs(o) <= tolerance) &&
    (!p.monophonic || (p.pitchAccuracy ?? 0) >= 0.9)
  );
}
export function advanceRamp(
  current: number,
  step: number,
  target: number,
  clean: boolean,
) {
  return clean ? Math.max(current, Math.min(target, current + step)) : current;
}
export function aggregateHeat(
  previous: number,
  signals: {
    stops?: number;
    rewinds?: number;
    repeats?: number;
    offsetMs?: number;
    offPitch?: number;
    marked?: boolean;
  },
) {
  return Math.min(
    100,
    Math.max(
      0,
      previous * 0.96 +
        (signals.stops ?? 0) * 12 +
        (signals.rewinds ?? 0) * 10 +
        (signals.repeats ?? 0) * 2 +
        Math.min(15, Math.abs(signals.offsetMs ?? 0) / 10) +
        (signals.offPitch ?? 0) * 5 +
        (signals.marked ? 25 : 0),
    ),
  );
}
