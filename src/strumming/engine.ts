import type { Song } from "../schema/song.v1";
import { templatesFor } from "./library";
import {
  PatternSchema,
  MeterSchema,
  emptyStrummingState,
  type Pattern,
  type Difficulty,
  type InputSettings,
  type Recommendation,
  type StrummingState,
  type Stroke,
} from "./schema";

export const ENGINE_VERSION = 1;
export type Analysis = {
  meter: Pattern["meter"];
  bpm: number;
  section?: string;
  styles: string[];
  chords: { beat: number; chordName: string }[];
  changesPerMeasure: number;
  timingKnown: boolean;
  difficulty: Difficulty;
  notes: string[];
};
export function analyzeSong(
  song: Partial<Song>,
  measureId?: string,
  inputs: InputSettings = {},
): Analysis {
  const measures = song.measures ?? [];
  const measure = measures.find((m) => m.id === measureId) ?? measures[0];
  const meterResult = MeterSchema.safeParse(
    inputs.meter ?? measure?.timeSignature ?? song.timeSignature ?? [4, 4],
  );
  const meter: Pattern["meter"] = meterResult.success
    ? meterResult.data
    : [4, 4];
  const rawBpm = inputs.tempo ?? measure?.tempoOverride ?? song.tempo ?? 90;
  const validTempo = Number.isFinite(rawBpm) && rawBpm >= 20 && rawBpm <= 400;
  const bpm = validTempo ? rawBpm : 90;
  const sectionIndex = measure ? measures.indexOf(measure) : -1;
  const section = measures
    .slice(0, sectionIndex + 1)
    .reverse()
    .find((m) => m.section)?.section?.kind;
  const known = !!inputs.chordTimingConfirmed;
  const recognized = new Set([
    "pop",
    "folk",
    "rock",
    "country",
    "worship",
    "blues",
    "funk",
    "ballad",
  ]);
  const styles =
    inputs.style && inputs.style !== "auto"
      ? [inputs.style]
      : (song.tags ?? [])
          .map((t) => t.toLowerCase().trim())
          .filter((t) => recognized.has(t));
  const notes = [];
  if (!validTempo)
    notes.push(
      "The score tempo is invalid; using a provisional practice tempo of 90 BPM.",
    );
  if (!meterResult.success)
    notes.push(
      "The score meter is invalid; using a provisional 4/4 practice meter.",
    );
  if (!inputs.metadataConfirmed)
    notes.push(
      `${bpm} BPM is a practice tempo; ${meter.join("/")} is provisional until confirmed. Existing scores can contain import defaults.`,
    );
  if (!known)
    notes.push(
      "Chord timing is unconfirmed; no precise chord accents are inferred.",
    );
  if (!styles.length)
    notes.push("No style supplied; using broadly suitable grooves.");
  if (styles.includes("blues") && meter[1] !== 8)
    notes.push(
      "Straight blues accompaniment; swing/shuffle timing is not inferred.",
    );
  if (!templatesFor(meter).length)
    notes.push(
      `Pattern generation supports 2–12 beats with denominators 2, 4 or 8. ${meter.join("/")} is not supported; choose a practice meter to explore alternatives.`,
    );
  const chords = known
    ? (measure?.chords ?? [])
        .filter(
          (c) => Number.isFinite(c.beat) && c.beat >= 0 && c.beat < meter[0],
        )
        .sort((a, b) => a.beat - b.beat)
    : [];
  return {
    meter,
    bpm,
    section,
    styles,
    chords,
    timingKnown: known,
    difficulty: inputs.difficulty ?? "intermediate",
    changesPerMeasure: measures.length
      ? measures.reduce((n, m) => n + m.chords.length, 0) / measures.length
      : 0,
    notes,
  };
}
export function fingerprint(
  song: Partial<Song>,
  measureId?: string,
  inputs: InputSettings = {},
) {
  // Exact canonical input avoids hash collisions. Excludes title, timestamps and saved patterns.
  return JSON.stringify([
    ENGINE_VERSION,
    measureId ?? "song",
    analyzeSong(song, measureId, inputs),
    inputs,
  ]);
}
const difficultyRank: Record<Difficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};
export function complexity(pattern: Pattern): number {
  const sounding = pattern.events.filter((e) => e.stroke !== "rest");
  const density = sounding.length / pattern.meter[0];
  const offbeats =
    sounding.filter((e) => e.position % 1 !== 0).length /
    Math.max(1, sounding.length);
  const muted = sounding.some((e) => e.stroke === "mute") ? 2 : 0;
  const displaced = pattern.events.filter(
    (e, i) =>
      e.stroke === "rest" &&
      Number.isInteger(e.position) &&
      pattern.events[i + 1]?.stroke !== "rest",
  ).length;
  return (
    density +
    offbeats * 2 +
    muted +
    displaced * 0.5 +
    (pattern.subdivision === 4 ? 2 : 0)
  );
}
function adapt(
  pattern: Pattern,
  analysis: Analysis,
  role: Recommendation["role"],
): { pattern: Pattern; aligned: number } {
  const copy = structuredClone(pattern);
  // Preserve the template's rhythmic identity. Only emphasize chord changes on its grid.
  let aligned = 0;
  copy.events.forEach((event) => {
    const change = analysis.chords.find(
      (c) => Math.abs(c.beat - event.position) < 1e-8,
    );
    if (change && role !== "Simple") {
      if (event.stroke === "rest" || event.stroke === "mute")
        event.stroke = Number.isInteger(event.position) ? "down" : "up";
      event.accent = Math.max(event.accent, 0.8);
      aligned++;
    } else if (change && event.stroke !== "rest") {
      event.accent = Math.max(event.accent, 0.8);
      aligned++;
    }
    const chord = analysis.chords
      .filter((c) => c.beat <= event.position)
      .at(-1);
    if (chord) event.chord = chord.chordName;
  });
  return { pattern: PatternSchema.parse(copy), aligned };
}
function shape(p: Pattern) {
  return JSON.stringify(
    p.events
      .filter((e) => e.stroke !== "rest")
      .map((e) => [e.position, e.stroke]),
  );
}
export function recommend(
  analysis: Analysis,
  generation = 0,
): Recommendation[] {
  const templates = templatesFor(analysis.meter);
  const used = new Set<string>(),
    shapes = new Set<string>();
  const roles: Recommendation["role"][] = [
    "Simple",
    "Recommended",
    "Expressive",
  ];
  return roles.map((role) => {
    const target =
      role === "Simple"
        ? 0
        : role === "Expressive"
          ? Math.min(2, difficultyRank[analysis.difficulty] + 1)
          : difficultyRank[analysis.difficulty];
    const ranked = templates
      .map((t) => {
        const base = PatternSchema.parse({
          ...t,
          id: `${t.id}:${analysis.meter.join("-")}`,
          name: t.name,
        });
        const { pattern, aligned } = adapt(base, analysis, role);
        const strokesPerSecond =
          pattern.events.filter((e) => e.stroke !== "rest").length /
          ((((analysis.meter[0] * 4) / analysis.meter[1]) * 60) / analysis.bpm);
        const tempoDistance = Math.max(
          0,
          t.tempo[0] - analysis.bpm,
          analysis.bpm - t.tempo[1],
        );
        const style = t.genres.some((g) => analysis.styles.includes(g));
        const section =
          !!analysis.section && t.sections.includes(analysis.section);
        const score =
          100 -
          Math.abs(difficultyRank[t.difficulty] - target) * 32 -
          tempoDistance * 0.35 -
          Math.max(0, strokesPerSecond - (role === "Simple" ? 3 : 6)) * 18 +
          (style ? 22 : 0) +
          (section ? 10 : 0) +
          aligned * 2 -
          (analysis.changesPerMeasure > 2 ? complexity(pattern) * 2 : 0);
        return { t, pattern, aligned, style, section, score };
      })
      .filter((c) => !used.has(c.t.family) && !shapes.has(shape(c.pattern)))
      .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
    if (!ranked.length)
      throw new Error(
        "No distinct patterns available for this meter. Choose a supported practice meter.",
      );
    const best = ranked[0];
    // Regeneration cycles equally practical choices; never randomizes notes or violates meter.
    const viable = ranked.filter(
      (c) =>
        c.score >= best.score - 16 &&
        (role !== "Simple" || c.t.difficulty === "beginner"),
    );
    const choice = viable.length ? viable[generation % viable.length] : best;
    used.add(choice.t.family);
    shapes.add(shape(choice.pattern));
    const strokes = choice.pattern.events.filter(
      (e) => e.stroke !== "rest",
    ).length;
    const rests = choice.pattern.events.length - strokes;
    const explanation = [
      `${analysis.meter.join("/")} at ${analysis.bpm} quarter-note BPM: ${strokes} strokes${rests ? ` and ${rests} ${rests === 1 ? "rest" : "rests"}` : ""} per bar.`,
      choice.style
        ? `Matches the supplied ${analysis.styles.filter((g) => choice.t.genres.includes(g)).join("/")} style.`
        : "",
      choice.section
        ? `Suited to the ${analysis.section}'s ${analysis.section === "chorus" ? "fuller motion" : "phrasing"}.`
        : "",
      analysis.changesPerMeasure > 2
        ? "Frequent written chord changes favor simpler movement."
        : "",
      choice.aligned
        ? `Emphasizes ${choice.aligned} confirmed chord ${choice.aligned === 1 ? "change" : "changes"} on this grid.`
        : "",
      analysis.chords.length > choice.aligned
        ? "Other chord positions are retained without forcing extra strokes."
        : "",
      role === "Simple"
        ? "Start here to practice clean chord changes."
        : choice.pattern.events.some((e) => e.stroke === "mute")
          ? "Muted strokes add a percussive pulse."
          : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      role,
      pattern: choice.pattern,
      explanation,
      score: Math.round(choice.score * 100) / 100,
    };
  });
}
export function ensureRecommendations(
  song: Song,
  contextId: string,
  regenerate = false,
): StrummingState {
  const state = song.strumming ?? emptyStrummingState();
  const key = fingerprint(song, contextId, state.inputs);
  const cached = state.contexts[contextId];
  if (cached?.fingerprint === key && !regenerate) return state;
  const generation = regenerate ? (cached?.generation ?? 0) + 1 : 0;
  const recommendations = recommend(
    analyzeSong(song, contextId, state.inputs),
    generation,
  );
  const customSelected = state.customs.some((c) => c.id === cached?.selectedId);
  return {
    ...state,
    contexts: {
      ...state.contexts,
      [contextId]: {
        fingerprint: key,
        generation,
        recommendations,
        selectedId: customSelected
          ? cached.selectedId
          : recommendations[1].pattern.id,
      },
    },
  };
}
export function editEvent(
  pattern: Pattern,
  index: number,
  patch: { stroke?: Stroke; accent?: number },
): Pattern {
  if (!Number.isInteger(index) || !pattern.events[index])
    throw new Error("Choose an event on the pattern grid.");
  if (
    patch.accent !== undefined &&
    (!Number.isFinite(patch.accent) || patch.accent < 0 || patch.accent > 1)
  )
    throw new Error("Accent must be between 0 and 1.");
  const copy = structuredClone(pattern);
  const event = copy.events[index];
  Object.assign(event, patch);
  if (event.stroke === "rest") event.accent = 0;
  else if (patch.stroke && patch.accent === undefined && event.accent === 0)
    event.accent = 0.35;
  // Only the selected event changes. Difficulty describes the resulting motor complexity.
  const value = complexity(copy);
  copy.difficulty =
    value >= 4 ? "advanced" : value >= 1.7 ? "intermediate" : "beginner";
  return PatternSchema.parse(copy);
}
export function beatLabel(pattern: Pattern, index: number) {
  const event = pattern.events[index],
    beat = Math.floor(event.position) + 1,
    part = index % pattern.subdivision;
  return part === 0
    ? String(beat)
    : pattern.subdivision === 4
      ? ["", "e", "&", "a"][part]
      : "&";
}
