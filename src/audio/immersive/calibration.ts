import { z } from "zod";
import type { Attack } from "./score";

/**
 * Guided timing calibration. The player plucks one open string on each cue
 * while the same microphone pipeline used for scoring timestamps the attacks.
 * The stored value is the median offset of detected attacks behind the cue,
 * after rejecting outlier taps. It measures input-side delay (capture,
 * buffering, onset timestamping) plus the player's own habit around a cue.
 * It does not measure screen delay. Nothing is scored during calibration.
 */
export const CALIBRATION_BPM = 80;
export const BEAT_SECONDS = 60 / CALIBRATION_BPM;
export const LEAK_CLICKS = 3;
export const COUNT_IN_CUES = 4;
export const MEASURED_CUES = 12;
export const MIN_USED_TAPS = 8;
export const MAX_SPREAD_MS = 35;
export const PLAUSIBLE_MS = { min: -100, max: 250 } as const;
/** Window, relative to a cue, in which an attack counts as that cue's tap. */
const TAP_WINDOW = { early: -0.15, late: 0.3 };
/** Attack identity arrives up to ~0.3 s after onset; leave one more packet. */
const RESOLVE_MARGIN = 0.62;

export type Cue = "click" | "visual";
export type CalibrationPlan = {
  cue: Cue;
  /** Clicks played while the strings stay still, to detect speaker leakage. */
  leak: number[];
  countIn: number[];
  measured: number[];
  /** Seconds between a scheduled click and its estimated acoustic output. */
  outputDelay: number;
  end: number;
};

export function calibrationPlan(
  start: number,
  cue: Cue,
  outputDelay = 0,
): CalibrationPlan {
  const at = (i: number) => start + i * BEAT_SECONDS;
  const leak =
    cue === "click" ? Array.from({ length: LEAK_CLICKS }, (_, i) => at(i)) : [];
  // One silent beat separates the still check from the count-in.
  const first = leak.length ? leak.length + 1 : 0;
  const countIn = Array.from({ length: COUNT_IN_CUES }, (_, i) => at(first + i));
  const measured = Array.from({ length: MEASURED_CUES }, (_, i) =>
    at(first + COUNT_IN_CUES + i),
  );
  return {
    cue,
    leak,
    countIn,
    measured,
    // A visual cue has no audio output path to compensate.
    outputDelay: cue === "click" ? Math.max(0, outputDelay) : 0,
    end: measured[measured.length - 1] + BEAT_SECONDS,
  };
}

export const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b),
    mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
/** Robust standard deviation estimate (scaled median absolute deviation). */
const robustSpread = (values: number[], centre: number) =>
  1.4826 * median(values.map((v) => Math.abs(v - centre)));

export type CalibrationFailure =
  | "leak"
  | "noise"
  | "too-few"
  | "inconsistent"
  | "implausible";
export type CalibrationOutcome =
  | {
      ok: true;
      offsetMs: number;
      spreadMs: number;
      used: number;
      rejected: number;
      unclear: number;
      cues: number;
    }
  | { ok: false; reason: CalibrationFailure; message: string };

/** Median of tap offsets after rejecting outliers; refuses weak or inconsistent evidence. */
export function summarizeTaps(
  offsetsMs: number[],
  unclear = 0,
  cues = MEASURED_CUES,
): CalibrationOutcome {
  const tooFew = (n: number): CalibrationOutcome => ({
    ok: false,
    reason: "too-few",
    message: `Only ${n} of ${cues} cues had a clear single note. Pluck one open string firmly on each cue, then try again.`,
  });
  if (offsetsMs.length < MIN_USED_TAPS) return tooFew(offsetsMs.length);
  const first = median(offsetsMs);
  const limit = Math.max(30, 3 * robustSpread(offsetsMs, first));
  const used = offsetsMs.filter((v) => Math.abs(v - first) <= limit);
  if (used.length < MIN_USED_TAPS) return tooFew(used.length);
  const centre = median(used),
    spread = robustSpread(used, centre);
  if (spread > MAX_SPREAD_MS)
    return {
      ok: false,
      reason: "inconsistent",
      message: `Your taps varied by about ±${Math.round(spread)} ms. Try again and lock in with each cue.`,
    };
  if (centre < PLAUSIBLE_MS.min || centre > PLAUSIBLE_MS.max)
    return {
      ok: false,
      reason: "implausible",
      message: `Measured ${Math.round(centre)} ms, outside the expected ${PLAUSIBLE_MS.min} to +${PLAUSIBLE_MS.max} ms. Bluetooth headphones add delay a browser may not report: use wired headphones or the visual cue. Nothing was saved.`,
    };
  return {
    ok: true,
    offsetMs: Math.round(centre),
    spreadMs: Math.round(spread * 10) / 10,
    used: used.length,
    rejected: offsetsMs.length - used.length,
    unclear,
    cues,
  };
}

/** Collects attacks from the scoring recognizer against a calibration plan. Pure; no audio. */
export class CalibrationRun {
  private taps = new Map<number, number>();
  private leakAligned = 0;
  private leakOther = 0;
  private unhealthy = false;
  unclear = 0;
  extra = 0;
  analyzedThrough = -Infinity;
  constructor(public plan: CalibrationPlan) {}
  frame(time: number, attack?: Attack, unhealthy = false) {
    this.analyzedThrough = Math.max(this.analyzedThrough, time);
    this.unhealthy ||= unhealthy;
    if (attack) this.attack(attack);
  }
  attack(a: Attack) {
    const p = this.plan;
    const heard = (cue: number) => a.time - (cue + p.outputDelay);
    if (p.leak.length && a.time < p.countIn[0] - 0.1) {
      if (a.time < p.leak[0] - 0.2) return;
      // Any sound while the strings should be still invalidates the check.
      if (p.leak.some((c) => heard(c) >= -0.03 && heard(c) <= TAP_WINDOW.late))
        this.leakAligned++;
      else this.leakOther++;
      return;
    }
    if (a.time < p.measured[0] + TAP_WINDOW.early) return; // count-in is for listening
    let best = -1;
    for (let i = 0; i < p.measured.length; i++) {
      const offset = heard(p.measured[i]);
      if (offset < TAP_WINDOW.early || offset > TAP_WINDOW.late) continue;
      if (best < 0 || Math.abs(offset) < Math.abs(heard(p.measured[best])))
        best = i;
    }
    if (best < 0 || this.taps.has(best)) {
      this.extra++;
      return;
    }
    // Pitched evidence only: a click or noise burst has no stable pitch.
    if (a.midi === null) {
      this.unclear++;
      return;
    }
    this.taps.set(best, heard(p.measured[best]) * 1000);
  }
  get tapsHeard() {
    return this.taps.size;
  }
  get done() {
    return this.analyzedThrough >= this.plan.end + RESOLVE_MARGIN;
  }
  /** What the player should be doing at audio-clock time `now`. */
  step(now: number): { stage: "still" | "count-in" | "play" | "analyzing"; beat: number } {
    const p = this.plan,
      index = (cues: number[]) =>
        cues.filter((c) => c <= now + 0.02).length;
    if (p.leak.length && now < p.countIn[0] - BEAT_SECONDS / 2)
      return { stage: "still", beat: index(p.leak) };
    if (now < p.measured[0] - BEAT_SECONDS / 2)
      return { stage: "count-in", beat: index(p.countIn) };
    if (now < p.end) return { stage: "play", beat: index(p.measured) };
    return { stage: "analyzing", beat: p.measured.length };
  }
  result(): CalibrationOutcome {
    if (this.unhealthy)
      return {
        ok: false,
        reason: "noise",
        message: "Input was noisy or clipping. Quiet the room, then try again. Nothing was saved.",
      };
    if (this.leakAligned >= 2)
      return {
        ok: false,
        reason: "leak",
        message: "The microphone picked up the click itself. Use wired headphones or the visual cue, then try again. Nothing was saved.",
      };
    if (this.leakAligned + this.leakOther > 0)
      return {
        ok: false,
        reason: "noise",
        message: "Sound was detected while the strings should be still. Keep them muted during the first three clicks, then try again.",
      };
    return summarizeTaps([...this.taps.values()], this.unclear, this.plan.measured.length);
  }
}

const STORAGE_KEY = "fretshift:immersive-calibration:v1";
const RecordSchema = z.object({
  offsetMs: z.number().finite().min(PLAUSIBLE_MS.min).max(PLAUSIBLE_MS.max),
  spreadMs: z.number().finite().nonnegative(),
  used: z.number().int().min(MIN_USED_TAPS),
  rejected: z.number().int().nonnegative(),
  cue: z.enum(["click", "visual"]),
  outputDelayMs: z.number().finite().nonnegative(),
  outputLatencyReported: z.boolean(),
  sampleRate: z.number().positive(),
  inputLabel: z.string(),
  measuredAt: z.string().datetime(),
});
export type CalibrationRecord = z.infer<typeof RecordSchema>;

/** Calibration is per browser on this device (localStorage), keyed by microphone. Never synced or backed up. */
export function inputKey(label: string | undefined) {
  return label?.trim() || "Default microphone";
}
function readAll(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
export function loadCalibration(key: string): CalibrationRecord | null {
  const parsed = RecordSchema.safeParse(readAll()[key]);
  return parsed.success ? parsed.data : null;
}
export function saveCalibration(key: string, record: CalibrationRecord) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readAll(), [key]: RecordSchema.parse(record) }),
    );
    return true;
  } catch {
    return false;
  }
}
export function clearCalibration(key: string) {
  try {
    const all = readAll();
    delete all[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: nothing persisted to clear */
  }
}
