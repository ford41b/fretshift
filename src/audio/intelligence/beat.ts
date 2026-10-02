import type { AudioFeatures, BeatAnalysis, BeatAnalyzer } from "./types";

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

export class OnsetBeatAnalyzer implements BeatAnalyzer {
  readonly id = "fretshift-onset-grid-v1";

  analyze(features: AudioFeatures): BeatAnalysis {
    const envelope = features.onsets.map((frame) => frame.strength);
    const sorted = [...envelope].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const peak = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const threshold = Math.max(median * 2.2, peak * 0.18);
    const attacks = features.onsets.filter((frame, i) =>
      frame.strength > threshold &&
      frame.strength >= (envelope[i - 1] ?? 0) &&
      frame.strength >= (envelope[i + 1] ?? 0));
    const distinct = attacks.filter((attack, i) =>
      i === 0 || attack.time - attacks[i - 1].time > 0.14);
    const empty: BeatAnalysis = {
      providerId: this.id, tempoBpm: null, beats: [], downbeats: [], meter: null,
      status: "insufficient-evidence", evidence: 0,
      warnings: ["No reliable pulse was found; set beats and downbeats during review."],
    };
    if (distinct.length < 4 || peak < 0.001) return empty;

    // Global onset autocorrelation: a lightweight baseline, not a tempo-change tracker.
    const step = features.onsets[1].time - features.onsets[0].time;
    const centered = envelope.map((value) => Math.max(0, value - median));
    const minLag = Math.round((60 / 190) / step);
    const maxLag = Math.round((60 / 55) / step);
    let bestLag = 0, bestScore = -Infinity;
    const scores = new Map<number, number>();
    for (let lag = minLag; lag <= maxLag; lag++) {
      let numerator = 0, left = 0, right = 0;
      for (let i = lag; i < centered.length; i++) {
        numerator += centered[i] * centered[i - lag];
        left += centered[i] ** 2;
        right += centered[i - lag] ** 2;
      }
      const score = numerator / Math.sqrt(left * right || 1);
      // Weak preference for the main quarter-note range resolves some half-time ties.
      const bpm = 60 / (lag * step);
      const adjusted = score * (bpm >= 75 && bpm <= 160 ? 1.04 : 1);
      scores.set(lag, adjusted);
      if (adjusted > bestScore) { bestScore = adjusted; bestLag = lag; }
    }
    if (!bestLag || bestScore < 0.12) return empty;
    const halfLag = Math.round(bestLag / 2);
    if (halfLag >= minLag && (scores.get(halfLag) ?? 0) >= bestScore * 0.76 &&
        60 / (halfLag * step) <= 175) bestLag = halfLag;
    const period = bestLag * step;
    let bestPhase = 0, phaseScore = -Infinity;
    for (let phase = 0; phase < period; phase += step) {
      let score = 0;
      for (const attack of distinct) {
        const offset = Math.abs((attack.time - phase) / period -
          Math.round((attack.time - phase) / period)) * period;
        score += attack.strength * Math.max(0, 1 - offset / 0.085);
      }
      if (score > phaseScore) { phaseScore = score; bestPhase = phase; }
    }
    const beats: number[] = [];
    for (let time = bestPhase; time < features.duration; time += period)
      beats.push(Number(time.toFixed(4)));
    const totalAttack = distinct.reduce((sum, attack) => sum + attack.strength, 0);
    const evidence = clamp(phaseScore / (totalAttack || 1));

    // A bar phase is published only when an accent clearly favors one position.
    let meter: 3 | 4 | null = null;
    let downbeats: number[] = [];
    let winning = 0, runnerUp = 0, phase = 0;
    if (beats.length >= 8) {
      for (const candidateMeter of [3, 4] as const) {
        const strength = beats.map((time) =>
          distinct.filter((attack) => Math.abs(attack.time - time) < 0.09)
            .reduce((sum, attack) => sum + attack.strength, 0));
        for (let candidatePhase = 0; candidatePhase < candidateMeter; candidatePhase++) {
          const accented = strength.filter((_, i) => i % candidateMeter === candidatePhase);
          const rest = strength.filter((_, i) => i % candidateMeter !== candidatePhase);
          const contrast = accented.reduce((a, b) => a + b, 0) / accented.length -
            rest.reduce((a, b) => a + b, 0) / rest.length;
          if (contrast > winning) {
            runnerUp = winning; winning = contrast;
            meter = candidateMeter; phase = candidatePhase;
          } else runnerUp = Math.max(runnerUp, contrast);
        }
      }
      if (winning < peak * 0.12 || winning - runnerUp < peak * 0.08) meter = null;
      if (meter) downbeats = beats.filter((_, i) => i % meter! === phase);
    }
    const warnings = ["Beat grid is provisional; confirm tempo, meter and first downbeat against the audio."];
    if (!meter) warnings.push("Downbeat and meter could not be distinguished from accents.");
    if (evidence < 0.45) warnings.push("Attacks fit the global beat grid weakly; tempo may vary or be half/double time.");
    return { providerId: this.id, tempoBpm: Number((60 / period).toFixed(2)),
      beats, downbeats, meter, status: "estimated", evidence, warnings };
  }
}
