import { resolveTuning, SongV1, type Song } from "../../schema/song.v1";
import { audioNotePlan } from "../intelligence/notePractice";
import { noteLabel } from "../../theory/pitch";
import { judgeChord, type Peak } from "./chord";

export type Target = {
  id: string;
  time: number;
  measure: number;
  label: string;
  notes: { string: number; fret: number | "x"; midi: number }[];
  kind: "note" | "chord" | "muted";
  supported: boolean;
};
export type CompileOptions = {
  /** Release flag: score voiced chords by required-tone coverage. Off by default. */
  chordScoring?: boolean;
};
const chordTones = (notes: Target["notes"]) =>
  notes.flatMap((n) => (n.fret === "x" ? [] : [n.midi]));
/** A chord can be scored only with a known voicing of at least two pitch classes in range. */
function chordScorable(notes: Target["notes"]) {
  const tones = chordTones(notes);
  return new Set(tones.map((m) => m % 12)).size >= 2 && tones.every((m) => m >= 40 && m <= 88);
}
export function compileTargets(
  song: Song,
  speed = 1,
  first = 0,
  last = song.measures.length - 1,
  options: CompileOptions = {},
) {
  SongV1.parse(song);
  if (
    !(speed >= 0.25 && speed <= 1) ||
    first < 0 ||
    last < first ||
    last >= song.measures.length
  )
    throw new Error("Select a valid passage and speed.");
  const notePlan = audioNotePlan(song,speed,first,last);
  if (notePlan) return notePlan;
  const tuning = resolveTuning(song.tuningId).midi;
  const reviewed = song.provenance?.source === "audio" ? song.provenance.audioReview?.reviewed : undefined;
  const exactTiming = !!reviewed?.timingConfirmed &&
    song.measures.slice(first, last + 1).every((measure) => measure.timingConfirmed === true);
  const passageStart = exactTiming && reviewed
    ? reviewed.beats[reviewed.firstDownbeatIndex + first * reviewed.meter]
    : undefined;
  const targets: Target[] = [],
    beats: { time: number; number: number }[] = [];
  const held: (number | null)[] = Array(6).fill(null);
  let time = 0,
    needsTimingConfirmation = false;
  for (let mi = 0; mi <= last; mi++) {
    const m = song.measures[mi],
      [count, denominator] = m.timeSignature ?? song.timeSignature;
    const beat =
      ((60 / (m.tempoOverride ?? song.tempo) / speed) * 4) / denominator;
    if (mi >= first)
      for (let b = 0; b < count; b++) {
        const exact = exactTiming && reviewed && passageStart !== undefined
          ? reviewed.beats[reviewed.firstDownbeatIndex + mi * reviewed.meter + b]
          : undefined;
        beats.push({ time: exact === undefined ? time + b * beat : (exact - passageStart!) / speed,
          number: b + 1 });
      }
    if (m.tab) {
      m.tab.slots.forEach((slot, si) => {
        slot.forEach((fret, string) => {
          held[string] =
            typeof fret === "number"
              ? fret
              : fret === "hold"
                ? held[string]
                : null;
        });
        if (
          mi < first ||
          !slot.some((fret) => typeof fret === "number" || fret === "x")
        )
          return;
        const sounding = slot.map((fret, string) =>
          fret === "hold" ? held[string] : fret,
        );
        const notes = sounding.flatMap((fret, string) =>
          typeof fret === "number" || fret === "x"
            ? [
                {
                  string,
                  fret,
                  midi: tuning[string] + song.capo + (fret === "x" ? 0 : fret),
                },
              ]
            : [],
        );
        if (!notes.length) return; // Rests and holds never become attacks, including at passage start.
        const kind = notes.every((n) => n.fret === "x")
          ? "muted"
          : notes.length === 1
            ? "note"
            : "chord";
        targets.push({
          id: `${m.id}:${si}`,
          time: time + (si * beat) / m.subdivision,
          measure: mi,
          notes,
          kind,
          supported:
            kind === "note"
              ? notes[0].midi >= 40 && notes[0].midi <= 88
              : kind === "chord" && options.chordScoring === true && chordScorable(notes),
          label:
            kind === "note"
              ? noteLabel(notes[0].midi)
              : kind === "muted"
                ? "Muted attack"
                : (m.chords.find((c) => c.beat === si / m.subdivision)
                    ?.chordName ?? "Chord"),
        });
      });
    } else {
      held.fill(null);
      if (mi < first) continue;
      if (m.chords.length && !exactTiming) needsTimingConfirmation = true;
      for (const c of m.chords) {
        const notes =
          c.voicing?.frets.flatMap((fret, string) =>
            fret === "x"
              ? []
              : [{ string, fret, midi: tuning[string] + song.capo + fret }],
          ) ?? [];
        targets.push({
          id: c.id,
          time: exactTiming && passageStart !== undefined && c.audioTimeSeconds !== undefined
            ? Math.max(0, (c.audioTimeSeconds - passageStart) / speed)
            : time + c.beat * beat,
          measure: mi,
          label: c.chordName,
          kind: "chord",
          supported: options.chordScoring === true && chordScorable(notes),
          notes,
        });
      }
    }
    if (mi >= first) time += count * beat;
  }
  targets.sort((a, b) => a.time - b.time);
  // Imported/generated tablature may contain inferred timing too. Require a player review.
  needsTimingConfirmation ||= song.provenance?.timingNeedsConfirmation === true ||
    song.measures.slice(first, last + 1).some(m => m.timingConfirmed === false);
  needsTimingConfirmation ||= [
    "chordpro",
    "audio",
    "photo",
    "pdf-scan",
    "pdf-text",
  ].includes(song.provenance?.source ?? "") &&
    !song.measures.slice(first, last + 1).every(m => m.timingConfirmed === true);
  const minGap = targets.reduce(
    (gap, t, i) => (i ? Math.min(gap, t.time - targets[i - 1].time) : gap),
    Infinity,
  );
  const exactEnd = exactTiming && reviewed && passageStart !== undefined
    ? reviewed.beats[reviewed.firstDownbeatIndex + (last + 1) * reviewed.meter]
    : undefined;
  return {
    targets,
    beats,
    duration: exactEnd === undefined ? time : (exactEnd - passageStart!) / speed,
    needsTimingConfirmation,
    rhythmSupported: minGap >= 0.32,
    countBeat: exactTiming && reviewed && passageStart !== undefined &&
      reviewed.beats[reviewed.firstDownbeatIndex + first * reviewed.meter + 1] !== undefined
      ? (reviewed.beats[reviewed.firstDownbeatIndex + first * reviewed.meter + 1] - passageStart) / speed
      : ((60 / (song.measures[first].tempoOverride ?? song.tempo) / speed) * 4) /
        (song.measures[first].timeSignature ?? song.timeSignature)[1],
  };
}

/**
 * Measure ranges where every written attack is a supported single note, using
 * the same compiler (and therefore the same hold/chord/range rules) as the
 * practice room. Measures without attacks only extend a run, never start one.
 */
export function scorablePassages(song: Song, limit = 6, options: CompileOptions = {}) {
  if (!song.measures.length) return [];
  const { targets } = compileTargets(song, 1, 0, song.measures.length - 1, options);
  const perMeasure = song.measures.map(() => ({ notes: 0, blocked: false }));
  for (const t of targets) {
    const m = perMeasure[t.measure];
    if (!m) continue;
    if (t.supported) m.notes++;
    else m.blocked = true;
  }
  const runs: { first: number; last: number; notes: number }[] = [];
  let run: { first: number; last: number; notes: number } | null = null;
  perMeasure.forEach((m, i) => {
    if (m.blocked) {
      run = null;
      return;
    }
    if (!m.notes) return; // a rest-only measure joins a run only if notes follow
    if (run) {
      run.last = i;
      run.notes += m.notes;
    } else {
      run = { first: i, last: i, notes: m.notes };
      runs.push(run);
    }
  });
  return runs.slice(0, limit);
}

export type Attack = {
  id: number;
  time: number;
  resolvedAt: number;
  midi: number | null;
  cents: number;
  confidence: number;
  /** Spectral peaks after the attack; present only when chord scoring is enabled. */
  peaks?: Peak[];
};
export type Outcome =
  | "hit"
  | "wrong"
  | "missed"
  | "uncertain"
  | "unsupported"
  | "skipped"
  | "unassessed";
export type Result = {
  target: Target;
  outcome: Outcome;
  timing?: "on time" | "early" | "late";
  offsetMs?: number;
};
export class EventScorer {
  results: (Result | undefined)[];
  index = 0;
  extraAttacks = 0;
  feedback = "Play when you’re ready";
  private seen = new Set<number>();
  private acceptAfter = -Infinity;
  constructor(
    public targets: Target[],
    public mode: "learn" | "rhythm",
    public offsetMs = 0,
  ) {
    this.results = Array(targets.length);
  }
  attack(a: Attack) {
    if (this.seen.has(a.id)) return;
    this.seen.add(a.id);
    if (this.mode === "learn" && a.time <= this.acceptAfter) return;
    let i = this.index;
    const time = a.time - this.offsetMs / 1000;
    if (this.mode === "rhythm") {
      const candidates = this.targets
        .map((t, index) => ({ index, distance: Math.abs(t.time - time) }))
        .filter((c) => !this.results[c.index] && c.distance <= 0.22)
        .sort((a, b) => a.distance - b.distance);
      if (!candidates.length) {
        this.extraAttacks++;
        this.feedback = "Extra attack · outside a target";
        return;
      }
      if (
        candidates[1] &&
        candidates[1].distance - candidates[0].distance < 0.04
      ) {
        for (const c of candidates.slice(0, 2))
          this.results[c.index] = {
            target: this.targets[c.index],
            outcome: "uncertain",
          };
        this.feedback = "Uncertain · between two targets";
        return;
      }
      i = candidates[0].index;
    }
    const target = this.targets[i];
    if (!target) return;
    const confident =
      a.midi !== null && a.confidence >= 0.8 && Math.abs(a.cents) <= 40;
    const chord =
      target.supported && target.kind === "chord"
        ? judgeChord(a.peaks ?? [], chordTones(target.notes))
        : null;
    const outcome: Outcome = !target.supported
      ? "unsupported"
      : chord
        ? chord.outcome
        : !confident
          ? "uncertain"
          : a.midi === target.notes[0].midi
            ? "hit"
            : "wrong";
    const ms = (time - target.time) * 1000;
    const timing =
      this.mode === "rhythm"
        ? ms < -80
          ? "early"
          : ms > 80
            ? "late"
            : "on time"
        : undefined;
    this.feedback = `${
      chord
        ? `${outcome === "hit" ? "✓ Chord" : outcome === "wrong" ? "× Chord" : "? Chord uncertain"} · ${chord.reason}`
        : outcome === "hit"
          ? "✓ Match"
          : outcome === "wrong"
            ? "× Wrong pitch"
            : outcome === "unsupported"
              ? "◇ Chord / muted target · unscored"
              : "? Uncertain · try a clear single note"
    }${timing ? ` · ${timing}` : ""}`;
    if (this.mode === "learn" && outcome !== "hit") return;
    this.results[i] = {
      target,
      outcome,
      ...(this.mode === "rhythm" && target.supported
        ? { timing, offsetMs: ms }
        : {}),
    };
    if (this.mode === "learn") {
      this.index++;
      this.acceptAfter = a.resolvedAt;
    }
  }
  tick(time: number) {
    if (this.mode !== "rhythm") return;
    this.targets.forEach((t, i) => {
      // Identity arrives later than the attack. Leave time for the analysis window.
      if (!this.results[i] && time > t.time + 0.62) {
        this.results[i] = {
          target: t,
          outcome: t.supported ? "missed" : "unsupported",
        };
        this.feedback = t.supported
          ? "− Missed · no clear attack"
          : "◇ Unsupported · unscored";
      }
    });
    this.index = this.results.findIndex((r) => !r);
    if (this.index === -1) this.index = this.targets.length;
  }
  skip(time = -Infinity) {
    const t = this.targets[this.index];
    if (!t) return;
    this.results[this.index++] = {
      target: t,
      outcome: t.supported ? "skipped" : "unsupported",
    };
    this.acceptAfter = Math.max(this.acceptAfter, time);
    this.feedback = "→ Skipped · no hit awarded";
  }
  interrupt(time: number) {
    if (this.mode !== "rhythm" || time < 0) return;
    this.targets.forEach((target, i) => {
      if (
        !this.results[i] &&
        time >= target.time - 0.22 &&
        time <= target.time + 0.62
      )
        this.results[i] = {
          target,
          outcome: target.supported ? "uncertain" : "unsupported",
        };
    });
  }
  finish(): Result[] {
    return this.targets.map(
      (target, i) => this.results[i] ?? { target, outcome: "unassessed" },
    );
  }
}
export function summarize(results: Result[]) {
  const count = (kind: Outcome) =>
    results.filter((r) => r.outcome === kind).length;
  const assessed = results.filter((r) =>
    ["hit", "wrong", "missed"].includes(r.outcome),
  ).length;
  const timed = results.filter((r) => r.timing);
  const troublesome = [
    ...new Set(
      results
        .filter(
          (r) =>
            ["wrong", "missed", "skipped"].includes(r.outcome) ||
            (r.timing && r.timing !== "on time"),
        )
        .map((r) => r.target.measure),
    ),
  ];
  return {
    total: results.length,
    assessed,
    matched: count("hit"),
    wrong: count("wrong"),
    missed: count("missed"),
    uncertain: count("uncertain"),
    unsupported: count("unsupported"),
    skipped: count("skipped"),
    unassessed: count("unassessed"),
    accuracy: assessed ? Math.round((count("hit") / assessed) * 100) : null,
    coverage: results.length
      ? Math.round((assessed / results.length) * 100)
      : 0,
    timed: timed.length,
    onTime: timed.filter((r) => r.timing === "on time").length,
    meanOffsetMs: timed.length
      ? Math.round(timed.reduce((s, r) => s + r.offsetMs!, 0) / timed.length)
      : null,
    troublesome,
  };
}
