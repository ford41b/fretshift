import { formatChordName, parseChordName, pcOf } from "../theory/chordName";
import {
  CLOSE_UP_FPS,
  DEFAULT_FPS,
  MAX_REQUEST_SECONDS,
  type AccuracyOptions,
  type AnalysisRange,
  type Evidence,
  type PlannedRequest,
  type YouTubeAnalysis,
} from "./types";

/** A contiguous stretch of the analyzed range with one decision. */
export type Region = {
  start: number;
  end: number;
  kind: "chord" | "unknown" | "no-chord";
  /** FretShift-supported chord symbol when kind is "chord". */
  label: string | null;
  confidence: number;
  evidence: Evidence[];
  /** Fraction of passes that agreed (1 for a single pass). */
  agreement: number;
  /** Labels proposed by passes that did not win, for review. */
  alternatives: Array<{ label: string; score: number }>;
  disagreement: boolean;
};

const round = (value: number) => Number(value.toFixed(3));

/** Rewrites common chord spellings into FretShift's vocabulary; null if unsupported. */
export function normalizeChordSymbol(input: string): string | null {
  const text = input.trim().replace(/♯/g, "#").replace(/♭/g, "b").replace(/Δ/g, "maj7");
  const root = /^[A-G](?:#|b)?/.exec(text)?.[0];
  if (!root) return null;
  const rest = text.slice(root.length);
  const candidates = [
    rest,
    rest.replace(/^maj$/, "").replace(/^major$/, ""),
    rest.replace(/^(min|minor|-)(?=$|\d|maj|add|\/)/, "m"),
    rest.replace(/^M7/, "maj7").replace(/^M9/, "maj9").replace(/^M$/, ""),
    rest.replace(/^sus(?=$|\/)/, "sus4"),
    rest.replace(/^ø7?/, "m7b5"),
    rest.replace(/^(°|o)7?(?=$|\/)/, "dim"),
    rest.replace(/^(m?)7sus([24])/, (_, minor: string, n: string) => `${minor ? "m" : ""}sus${n}7`),
    rest.replace(/^add2/, "add9"),
    rest.replace(/^(m?)\(add9\)/, "$1add9"),
  ];
  for (const candidate of new Set(candidates)) {
    try {
      return formatChordName(parseChordName(`${root}${candidate}`));
    } catch {
      // try the next spelling
    }
  }
  return null;
}

/** Enharmonic-insensitive identity: A#m and Bbm compare equal. */
export function chordKey(label: string): string {
  try {
    const chord = parseChordName(label);
    return `${pcOf(chord.root)}:${chord.quality}:${chord.extensions.join(",")}:${chord.bass ? pcOf(chord.bass) : ""}`;
  } catch {
    return `raw:${label}`;
  }
}

const regionKey = (region: Pick<Region, "kind" | "label">) =>
  region.kind === "chord" && region.label ? `c:${chordKey(region.label)}` : region.kind;

/** Evenly spaced overlapping windows (b) × passes (d), each at the chosen fps (c). */
export function planRequests(range: AnalysisRange, options: AccuracyOptions): PlannedRequest[] {
  const length = range.endSeconds - range.startSeconds;
  if (!(length > 0)) throw new Error("Choose an end time after the start time.");
  const fps = options.closeUp ? CLOSE_UP_FPS : DEFAULT_FPS;
  const size = Math.min(options.windowSeconds ?? MAX_REQUEST_SECONDS, MAX_REQUEST_SECONDS);
  const overlap = Math.min(Math.max(0, options.overlapSeconds), size / 3);
  let segments: AnalysisRange[] = [range];
  if (length > size) {
    const count = Math.ceil((length - overlap) / (size - overlap));
    const actual = (length + (count - 1) * overlap) / count;
    segments = Array.from({ length: count }, (_, index) => {
      const startSeconds = round(range.startSeconds + index * (actual - overlap));
      return { startSeconds, endSeconds: index === count - 1 ? range.endSeconds : round(startSeconds + actual) };
    });
  }
  return segments.flatMap((segment, window) =>
    Array.from({ length: options.passes }, (_, pass) => ({ window, pass: pass + 1, segment, fps })));
}

/** One pass of one window as regions, with gaps inside the window filled as Unknown. */
export function analysisToRegions(analysis: YouTubeAnalysis, segment: AnalysisRange): Region[] {
  const regions: Region[] = [];
  let cursor = segment.startSeconds;
  const gap = (start: number, end: number) => {
    if (end - start >= 0.05)
      regions.push({ start, end, kind: "unknown", label: null, confidence: 0, evidence: [], agreement: 1,
        alternatives: [], disagreement: false });
  };
  for (const chord of analysis.chords) {
    const start = Math.max(chord.startSeconds, cursor), end = Math.min(chord.endSeconds, segment.endSeconds);
    if (end - start < 0.05) continue;
    gap(cursor, start);
    const label = chord.kind === "chord" && chord.chord ? normalizeChordSymbol(chord.chord) : null;
    regions.push({ start, end, kind: chord.kind === "chord" && !label ? "unknown" : chord.kind, label,
      confidence: label || chord.kind === "no-chord" ? chord.confidence : 0, evidence: [chord.evidence], agreement: 1,
      alternatives: [], disagreement: false });
    cursor = end;
  }
  gap(cursor, segment.endSeconds);
  return joinEqual(regions);
}

function joinEqual(regions: Region[]): Region[] {
  const joined: Region[] = [];
  for (const region of regions) {
    const previous = joined.at(-1);
    if (previous && Math.abs(previous.end - region.start) < 0.001 && regionKey(previous) === regionKey(region) &&
        previous.disagreement === region.disagreement) {
      const a = previous.end - previous.start, b = region.end - region.start;
      previous.confidence = round((previous.confidence * a + region.confidence * b) / (a + b));
      previous.agreement = round((previous.agreement * a + region.agreement * b) / (a + b));
      previous.evidence = [...new Set([...previous.evidence, ...region.evidence])];
      previous.alternatives = mergeAlternatives(previous.alternatives, region.alternatives);
      previous.end = region.end;
    } else joined.push({ ...region, evidence: [...region.evidence], alternatives: [...region.alternatives] });
  }
  return joined;
}

function mergeAlternatives(a: Region["alternatives"], b: Region["alternatives"]) {
  const best = new Map<string, number>();
  for (const item of [...a, ...b]) best.set(item.label, Math.max(best.get(item.label) ?? 0, item.score));
  return [...best].map(([label, score]) => ({ label, score: round(score) })).sort((x, y) => y.score - x.score);
}

/**
 * (b) Joins per-window region lists. Inside an overlap, each window keeps the
 * half nearest its own centre (the cut is the overlap midpoint), so the model's
 * weaker context at a window edge is discarded. Equal chords across the cut join.
 */
export function mergeWindows(windows: Array<{ segment: AnalysisRange; regions: Region[] }>, range: AnalysisRange): Region[] {
  const sorted = [...windows].sort((a, b) => a.segment.startSeconds - b.segment.startSeconds);
  const out: Region[] = [];
  sorted.forEach((window, index) => {
    const before = sorted[index - 1], after = sorted[index + 1];
    const low = before ? Math.max(window.segment.startSeconds, (window.segment.startSeconds + before.segment.endSeconds) / 2)
      : window.segment.startSeconds;
    const high = after ? Math.min(window.segment.endSeconds, (after.segment.startSeconds + window.segment.endSeconds) / 2)
      : window.segment.endSeconds;
    const cursor = out.at(-1)?.end ?? range.startSeconds;
    if (low - cursor >= 0.05)
      out.push({ start: cursor, end: low, kind: "unknown", label: null, confidence: 0, evidence: [], agreement: 0,
        alternatives: [], disagreement: false });
    for (const region of window.regions) {
      const start = Math.max(region.start, low, out.at(-1)?.end ?? -Infinity), end = Math.min(region.end, high);
      if (end - start >= 0.05) out.push({ ...region, start: round(start), end: round(end) });
    }
  });
  const last = out.at(-1)?.end ?? range.startSeconds;
  if (range.endSeconds - last >= 0.05)
    out.push({ start: last, end: range.endSeconds, kind: "unknown", label: null, confidence: 0, evidence: [],
      agreement: 0, alternatives: [], disagreement: false });
  return joinEqual(out);
}

/**
 * (d) Majority vote per 50 ms tick across independent passes. A label wins only
 * with a strict majority; otherwise the tick becomes a reviewed-Unknown
 * disagreement carrying every proposed chord as an alternative. Confidence is
 * scaled by agreement. Slivers shorter than `minSeconds` (boundary jitter
 * between passes) are absorbed, which puts a disputed change at the midpoint.
 */
export function votePasses(passes: Region[][], range: AnalysisRange, minSeconds = 0.3): Region[] {
  if (passes.length === 1) return passes[0].map((region) => ({ ...region }));
  const step = 0.05, total = Math.max(1, Math.round((range.endSeconds - range.startSeconds) / step));
  const pointers = passes.map(() => 0);
  const ticks: Region[] = [];
  for (let i = 0; i < total; i++) {
    const start = range.startSeconds + i * step, time = start + step / 2;
    const tally = new Map<string, { count: number; confidence: number; region: Region; evidence: Set<Evidence> }>();
    passes.forEach((regions, p) => {
      while (pointers[p] < regions.length && regions[pointers[p]].end <= time) pointers[p]++;
      const region = regions[pointers[p]];
      const covering = region && region.start <= time ? region : null;
      const key = covering ? regionKey(covering) : "unknown";
      const entry = tally.get(key) ?? { count: 0, confidence: 0, region: covering ?? ticksUnknown(), evidence: new Set() };
      entry.count++;
      entry.confidence += covering?.confidence ?? 0;
      covering?.evidence.forEach((item) => entry.evidence.add(item));
      tally.set(key, entry);
    });
    const ranked = [...tally.entries()].sort((a, b) => b[1].count - a[1].count);
    const [key, winner] = ranked[0];
    const end = Math.min(range.endSeconds, start + step);
    const alternatives = ranked.filter(([, entry]) => entry.region.label)
      .map(([, entry]) => ({ label: entry.region.label!, score: round((entry.count / passes.length) * (entry.confidence / entry.count)) }));
    if (winner.count * 2 > passes.length)
      ticks.push({ start, end, kind: winner.region.kind, label: key.startsWith("c:") ? winner.region.label : null,
        confidence: round((winner.confidence / winner.count) * (winner.count / passes.length)),
        evidence: [...winner.evidence], agreement: round(winner.count / passes.length),
        alternatives: alternatives.filter((item) => item.label !== winner.region.label), disagreement: false });
    else
      ticks.push({ start, end, kind: "unknown", label: null, confidence: 0, evidence: [],
        agreement: round(winner.count / passes.length), alternatives, disagreement: true });
  }
  return absorbSlivers(joinEqual(ticks.map((tick) => ({ ...tick, start: round(tick.start), end: round(tick.end) }))), minSeconds);
}

function ticksUnknown(): Region {
  return { start: 0, end: 0, kind: "unknown", label: null, confidence: 0, evidence: [], agreement: 0, alternatives: [],
    disagreement: false };
}

function absorbSlivers(regions: Region[], minSeconds: number): Region[] {
  let current = regions;
  for (let guard = 0; guard < 1000; guard++) {
    const index = current.findIndex((region) => region.end - region.start < minSeconds - 1e-9);
    if (index < 0 || current.length === 1) return current;
    const next = [...current];
    const sliver = next[index], before = next[index - 1], after = next[index + 1];
    if (before && after && regionKey(before) === regionKey(after)) {
      before.end = sliver.start; // joinEqual will merge across the removed sliver below
      after.start = sliver.start;
      next.splice(index, 1);
    } else if (before && after) {
      const middle = round((sliver.start + sliver.end) / 2);
      before.end = middle;
      after.start = middle;
      next.splice(index, 1);
    } else if (before) {
      before.end = sliver.end;
      next.splice(index, 1);
    } else {
      after!.start = sliver.start;
      next.splice(index, 1);
    }
    current = joinEqual(next.map((region) => ({ ...region })));
  }
  return current;
}

/**
 * (e) Moves chord boundaries onto the nearest beat or half-beat of a confirmed
 * grid when within `maxShiftBeats` of a beat interval. Region order and minimum
 * lengths are preserved; a boundary that cannot move safely stays put.
 */
export function snapToGrid<T extends { start: number; end: number }>(
  segments: T[], beats: number[], options: { subdivision?: 1 | 2; maxShiftBeats?: number } = {},
): { segments: T[]; moved: number } {
  if (beats.length < 2 || !segments.length) return { segments, moved: 0 };
  const subdivision = options.subdivision ?? 2, maxShift = options.maxShiftBeats ?? 0.5;
  const grid: number[] = [];
  beats.forEach((beat, i) => {
    grid.push(beat);
    const next = beats[i + 1];
    if (next !== undefined && subdivision === 2) grid.push((beat + next) / 2);
  });
  const interval = (time: number) => {
    const i = Math.max(0, Math.min(beats.length - 2, beats.findIndex((beat) => beat > time) - 1));
    return beats[i + 1] - beats[i];
  };
  const snap = (time: number) => {
    let best = time, distance = Infinity;
    for (const point of grid) {
      const d = Math.abs(point - time);
      if (d < distance) { distance = d; best = point; }
    }
    return distance <= maxShift * interval(time) ? round(best) : time;
  };
  const out = segments.map((segment) => ({ ...segment }));
  let moved = 0;
  out.forEach((segment, i) => {
    const previous = out[i - 1];
    const shared = previous && Math.abs(previous.end - segment.start) < 0.001;
    const start = snap(segment.start);
    const lower = previous ? (shared ? previous.start + 0.05 : previous.end) : -Infinity;
    if (start !== segment.start && start > lower && start < segment.end - 0.05) {
      moved++;
      segment.start = start;
      if (shared) previous.end = start;
    }
    const nextSegment = out[i + 1];
    const end = snap(segment.end);
    const upper = nextSegment ? (Math.abs(nextSegment.start - segment.end) < 0.001 ? nextSegment.end - 0.05 : nextSegment.start)
      : Infinity;
    if (!(nextSegment && Math.abs(nextSegment.start - segment.end) < 0.001) && end !== segment.end &&
        end > segment.start + 0.05 && end <= upper) {
      moved++;
      segment.end = end;
    }
  });
  return { segments: out, moved };
}

/** Median of finite values, or null. */
export function median(values: Array<number | null | undefined>): number | null {
  const list = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

/** Most common non-null value (first seen wins ties), or null. */
export function mode<T>(values: Array<T | null | undefined>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) if (value !== null && value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null, count = 0;
  for (const [value, n] of counts) if (n > count) { best = value; count = n; }
  return best;
}
