/** Taps further apart than this start a new attempt. */
export const TAP_RESET_SECONDS = 2.5;
export const MIN_TAPS = 4;

/** Adds a tap (media seconds). A long pause or a backwards seek starts over. */
export function addTap(taps: number[], time: number): number[] {
  const last = taps.at(-1);
  if (last !== undefined && (time - last > TAP_RESET_SECONDS || time <= last)) return [time];
  return [...taps, time].slice(-32);
}

/**
 * Least-squares beat line through the taps: slope gives the tempo, the line at
 * tap 0 gives the first downbeat (more stable than the raw first tap).
 */
export function tapTempo(taps: number[]): { bpm: number; firstDownbeat: number; jitterMs: number } | null {
  if (taps.length < MIN_TAPS) return null;
  const n = taps.length, meanX = (n - 1) / 2, meanY = taps.reduce((sum, t) => sum + t, 0) / n;
  let num = 0, den = 0;
  taps.forEach((t, i) => { num += (i - meanX) * (t - meanY); den += (i - meanX) ** 2; });
  const slope = num / den, intercept = meanY - slope * meanX;
  if (!(slope >= 60 / 400 && slope <= 60 / 20)) return null;
  const jitter = Math.sqrt(taps.reduce((sum, t, i) => sum + (t - (intercept + slope * i)) ** 2, 0) / n);
  return { bpm: Number((60 / slope).toFixed(1)), firstDownbeat: Number(Math.max(0, intercept).toFixed(3)),
    jitterMs: Math.round(jitter * 1000) };
}
