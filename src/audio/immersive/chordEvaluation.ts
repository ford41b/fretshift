/**
 * Release thresholds for chord scoring and the report format written by
 * `scripts/eval-chord-recordings.mjs`. The flag is derived from the counts in
 * the committed report, never from a stored pass/fail boolean.
 *
 * Why these numbers (see docs/handoffs/IMMERSIVE_RELEASE_HANDOFF.md):
 * - A false ✓ on a wrong chord teaches the mistake and costs trust, so its
 *   bound is the strictest and uses the Wilson 95% upper bound: a small corpus
 *   cannot pass by luck (0/100 → 3.7%; 1/100 → 5.4% fails; 1/150 → 3.7%).
 * - Strums missing a written chord tone (root-only, two strings) must not earn
 *   credit either; slightly looser because these are partial, not wrong, shapes.
 * - Silence and muted strums must never earn credit (0 allowed).
 * - "Uncertain" is the safe outcome, so correct strums may be uncertain up to
 *   20% (≥ 80% hits), but a correct strum called "wrong" is discouraging:
 *   ≤ 3% point estimate.
 */
export const CHORD_THRESHOLDS = {
  minCorrect: 150,
  minWrongChord: 100,
  minMissingTone: 50,
  minNoChord: 20,
  minChordShapes: 8,
  maxFalseAccept: 0.02,
  maxFalseAcceptUpper95: 0.05,
  maxMissingToneAcceptUpper95: 0.1,
  maxNoChordAccepts: 0,
  minCorrectHitRate: 0.8,
  maxCorrectWrongRate: 0.03,
} as const;

export type ChordLabel = "correct" | "wrong-chord" | "missing-tone" | "single-note" | "muted" | "silence";
/** `missed`: no attack was detected for a labeled strum (no credit, like a live miss). */
export type OutcomeCounts = { n: number; hit: number; wrong: number; uncertain: number; missed: number };
export type ChordEvaluationReport = {
  version: 1;
  generatedAt: string | null;
  /** "physical" only for real guitar recordings; synthetic fixtures never qualify. */
  evidence: "none" | "synthetic" | "physical";
  recordings: number;
  chordShapes: number;
  devices: string[];
  guitars: string[];
  counts: Record<ChordLabel, OutcomeCounts>;
};

/** Wilson score interval upper bound (95%) for k successes in n trials. */
export function wilsonUpper(k: number, n: number, z = 1.96) {
  if (!n) return 1;
  const p = k / n,
    z2 = z * z,
    centre = p + z2 / (2 * n),
    margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (centre + margin) / (1 + z2 / n);
}

export function chordRates(report: ChordEvaluationReport) {
  const c = report.counts;
  // A single note is the extreme missing-tone case (root-only signals).
  const partial = { n: c["missing-tone"].n + c["single-note"].n, hit: c["missing-tone"].hit + c["single-note"].hit };
  return {
    falseAccept: c["wrong-chord"].n ? c["wrong-chord"].hit / c["wrong-chord"].n : null,
    falseAcceptUpper95: wilsonUpper(c["wrong-chord"].hit, c["wrong-chord"].n),
    missingToneAcceptUpper95: wilsonUpper(partial.hit, partial.n),
    noChordAccepts: c.muted.hit + c.silence.hit,
    noChordN: c.muted.n + c.silence.n,
    correctHitRate: c.correct.n ? c.correct.hit / c.correct.n : null,
    correctWrongRate: c.correct.n ? c.correct.wrong / c.correct.n : null,
    correctUncertainRate: c.correct.n ? c.correct.uncertain / c.correct.n : null,
  };
}

/** Every unmet release criterion for chord scoring; empty means the flag may turn on. */
export function chordThresholdFailures(report: ChordEvaluationReport): string[] {
  const t = CHORD_THRESHOLDS,
    c = report.counts,
    r = chordRates(report),
    failures: string[] = [];
  if (report.evidence !== "physical")
    failures.push(`Evidence is "${report.evidence}"; only real labeled guitar recordings qualify.`);
  if (c.correct.n < t.minCorrect) failures.push(`${c.correct.n}/${t.minCorrect} correct strums.`);
  if (c["wrong-chord"].n < t.minWrongChord) failures.push(`${c["wrong-chord"].n}/${t.minWrongChord} wrong-chord strums.`);
  if (c["missing-tone"].n < t.minMissingTone) failures.push(`${c["missing-tone"].n}/${t.minMissingTone} missing-tone strums.`);
  if (r.noChordN < t.minNoChord) failures.push(`${r.noChordN}/${t.minNoChord} muted or silent clips.`);
  if (report.chordShapes < t.minChordShapes) failures.push(`${report.chordShapes}/${t.minChordShapes} chord shapes.`);
  if (r.falseAccept === null || r.falseAccept > t.maxFalseAccept)
    failures.push(`False accept on wrong chords ${pct(r.falseAccept)} (max ${pct(t.maxFalseAccept)}).`);
  if (r.falseAcceptUpper95 > t.maxFalseAcceptUpper95)
    failures.push(`False accept 95% upper bound ${pct(r.falseAcceptUpper95)} (max ${pct(t.maxFalseAcceptUpper95)}).`);
  if (r.missingToneAcceptUpper95 > t.maxMissingToneAcceptUpper95)
    failures.push(`Missing-tone accept 95% upper bound ${pct(r.missingToneAcceptUpper95)} (max ${pct(t.maxMissingToneAcceptUpper95)}).`);
  if (r.noChordAccepts > t.maxNoChordAccepts) failures.push(`${r.noChordAccepts} muted/silent clips earned credit.`);
  if (r.correctHitRate === null || r.correctHitRate < t.minCorrectHitRate)
    failures.push(`Correct strums accepted ${pct(r.correctHitRate)} (min ${pct(t.minCorrectHitRate)}).`);
  if (r.correctWrongRate === null || r.correctWrongRate > t.maxCorrectWrongRate)
    failures.push(`Correct strums called wrong ${pct(r.correctWrongRate)} (max ${pct(t.maxCorrectWrongRate)}).`);
  return failures;
}
const pct = (v: number | null) => (v === null ? "n/a" : `${(100 * v).toFixed(1)}%`);

export const emptyCounts = (): Record<ChordLabel, OutcomeCounts> => ({
  correct: { n: 0, hit: 0, wrong: 0, uncertain: 0, missed: 0 },
  "wrong-chord": { n: 0, hit: 0, wrong: 0, uncertain: 0, missed: 0 },
  "missing-tone": { n: 0, hit: 0, wrong: 0, uncertain: 0, missed: 0 },
  "single-note": { n: 0, hit: 0, wrong: 0, uncertain: 0, missed: 0 },
  muted: { n: 0, hit: 0, wrong: 0, uncertain: 0, missed: 0 },
  silence: { n: 0, hit: 0, wrong: 0, uncertain: 0, missed: 0 },
});
