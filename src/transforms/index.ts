import { z } from "zod";
import {
  type Song,
  type Slot,
  type Measure,
  type Tuning,
  type Voicing,
  emptySlot,
  resolveTuning,
} from "../schema/song.v1";
import {
  shiftChord,
  spell,
  pcOf,
  parseChordName,
  formatChordName,
  intervalsOf,
  mod,
} from "../theory/chordName";
import {
  asVoicing,
  findVoicings,
  voicingPitches,
  identifyChord,
} from "../theory/voicingSearch";
import { fretsFor } from "../theory/pitch";
export const TransformResultSchema = z.object({
  summary: z.string(),
  changed: z.boolean(),
  warnings: z.array(z.string()),
});
export type TransformInfo = z.infer<typeof TransformResultSchema>;
export type TransformResult = TransformInfo & { song: Song };
const clone = (s: Song) => structuredClone(s);
const result = (
  song: Song,
  summary: string,
  warnings: string[] = [],
  changed = true,
): TransformResult => ({ song, summary, warnings, changed });
function rebuildPinnedVoicing(
  frets: Voicing["frets"],
  original?: Voicing,
  barreFret?: number,
): Voicing {
  const rebuilt = asVoicing(frets),
    barre =
      original?.barre && barreFret !== undefined
        ? { ...original.barre, fret: barreFret }
        : undefined;
  if (
    barre &&
    barre.fret >= 1 &&
    barre.fret <= 22 &&
    frets
      .slice(
        Math.min(barre.fromString, barre.toString),
        Math.max(barre.fromString, barre.toString) + 1,
      )
      .every((f) => typeof f === "number" && f >= barre.fret)
  )
    rebuilt.barre = barre;
  const fingering = original?.fingering;
  if (
    fingering &&
    frets.every((f, i) =>
      f === "x"
        ? fingering[i] === 0
        : f === 0
          ? fingering[i] === 0
          : fingering[i] >= 1,
    )
  )
    rebuilt.fingering = [...fingering];
  return rebuilt;
}
function placePitches(
  notes: { source: number; midi: number; hold: boolean }[],
  t: Tuning,
  capo: number,
  previous: Map<number, number>,
  muted: number[] = [],
) {
  let best: { cost: number; slot: Slot; map: Map<number, number> } | undefined;
  const dfs = (
    i: number,
    slot: Slot,
    map: Map<number, number>,
    cost: number,
  ) => {
    if (best && cost >= best.cost) return;
    if (i === notes.length) {
      best = { cost, slot: [...slot], map: new Map(map) };
      return;
    }
    const n = notes[i];
    let choices = fretsFor(t, n.midi, capo);
    if (n.hold)
      choices = choices.filter((c) => c.stringIdx === previous.get(n.source));
    choices.sort(
      (a, b) =>
        Math.abs(a.stringIdx - n.source) - Math.abs(b.stringIdx - n.source),
    );
    for (const c of choices) {
      if (slot[c.stringIdx] !== null) continue;
      slot[c.stringIdx] = n.hold ? "hold" : c.fret;
      map.set(n.source, c.stringIdx);
      dfs(
        i + 1,
        slot,
        map,
        cost + Math.abs(c.stringIdx - n.source) * 5 + c.fret * 0.001,
      );
      slot[c.stringIdx] = null;
      map.delete(n.source);
    }
  };
  const initial = emptySlot();
  muted.forEach((s) => (initial[s] = "x"));
  dfs(0, initial, new Map(), 0);
  return best;
}
function repitch(
  song: Song,
  from: Tuning,
  to: Tuning,
  delta: number,
  oldCapo: number,
  newCapo: number,
) {
  const originalTabs = song.measures.map((m) =>
    m.tab ? structuredClone(m.tab) : undefined,
  );
  const warnings: string[] = [];
  const active: (number | null)[] = Array(6).fill(null);
  let previous = new Map<number, number>();
  song.measures.forEach((m, mi) => {
    let bad = false;
    if (!m.tab) {
      active.fill(null);
      previous.clear();
      return;
    }
    m.tab.slots = m.tab.slots.map((slot, si) => {
      const notes: { source: number; midi: number; hold: boolean }[] = [];
      slot.forEach((c, s) => {
        if (typeof c === "number") active[s] = from.midi[s] + oldCapo + c;
        else if (c !== "hold") active[s] = null;
        if (typeof c === "number" || c === "hold") {
          if (active[s] !== null)
            notes.push({
              source: s,
              midi: active[s]! + delta,
              hold: c === "hold",
            });
        }
      });
      const placed = placePitches(
        notes,
        to,
        newCapo,
        previous,
        slot.flatMap((c, s) => (c === "x" ? [s] : [])),
      );
      if (!placed) {
        bad = true;
        warnings.push(
          `Measure ${mi + 1}, slot ${si + 1}: exact pitches cannot fit; original cells retained.`,
        );
        previous = new Map(
          slot.flatMap((c, s) =>
            typeof c === "number" || c === "hold" ? [[s, s]] : [],
          ),
        );
        return slot;
      }
      slot.forEach((c, s) => {
        if (c === "x" && placed.slot[s] === null) placed.slot[s] = "x";
      });
      previous = placed.map;
      return placed.slot;
    });
    m.outOfRange = bad || undefined;
  });
  let start = 0;
  for (let end = 0; end < song.measures.length; end++) {
    const next = song.measures[end + 1];
    if (next?.tab?.slots[0]?.includes("hold")) continue;
    const group = song.measures.slice(start, end + 1);
    if (group.some((m) => m.outOfRange)) {
      group.forEach((m, i) => {
        m.tab = originalTabs[start + i];
        m.outOfRange = true;
      });
      warnings.push(
        `Measures ${start + 1}–${end + 1}: retained the complete sustain group to keep holds attached to their strikes.`,
      );
    }
    start = end + 1;
  }
  return warnings;
}
export function transposeKey(input: Song, semitones: number): TransformResult {
  if (!Number.isInteger(semitones))
    throw new Error("Transpose by whole semitones.");
  const song = clone(input);
  const target = {
    ...song.currentKey,
    root: spell(pcOf(song.currentKey.root) + semitones, song.currentKey),
  };
  const tuning = resolveTuning(song.tuningId);
  const warnings = repitch(
    song,
    tuning,
    tuning,
    semitones,
    song.capo,
    song.capo,
  );
  song.currentKey = target;
  for (const m of song.measures)
    for (const c of m.chords) {
      c.chordName = shiftChord(c.chordName, semitones, target);
      if (c.voicingPinned && c.voicing) {
        const original = c.voicing,
          f = original.frets.map((v) =>
            typeof v === "number" ? v + semitones : v,
          );
        if (f.every((v) => v === "x" || (v >= 0 && v <= 22)))
          c.voicing = rebuildPinnedVoicing(
            f as Voicing["frets"],
            original,
            original.barre ? original.barre.fret + semitones : undefined,
          );
        else {
          m.outOfRange = true;
          warnings.push(
            `Pinned ${c.chordName} cannot shift in place; retained for review.`,
          );
        }
      } else c.voicing = findVoicings(c.chordName, tuning, song.capo, 1)[0];
    }
  song.difficulty = scoreDifficulty(song);
  return result(
    song,
    `Transposed ${semitones >= 0 ? "+" : ""}${semitones} semitone${Math.abs(semitones) === 1 ? "" : "s"} to ${target.root}${target.mode === "minor" ? " minor" : ""}. Capo stays ${song.capo}.`,
    warnings,
  );
}
export function transposeTuning(input: Song, tuning: Tuning): TransformResult {
  const song = clone(input),
    from = resolveTuning(song.tuningId);
  const warnings = repitch(song, from, tuning, 0, song.capo, song.capo);
  song.tuningId = tuning.id;
  for (const m of song.measures)
    for (const c of m.chords) {
      if (c.voicingPinned && c.voicing) {
        const notes = c.voicing.frets.flatMap((v, s) =>
          typeof v === "number"
            ? [{ source: s, midi: from.midi[s] + song.capo + v, hold: false }]
            : [],
        );
        const placed = placePitches(notes, tuning, song.capo, new Map());
        if (placed)
          c.voicing = rebuildPinnedVoicing(
            placed.slot.map((v) =>
              typeof v === "number" ? v : "x",
            ) as Voicing["frets"],
          );
        else {
          m.outOfRange = true;
          warnings.push(`Pinned ${c.chordName} cannot fit this tuning.`);
        }
      } else c.voicing = findVoicings(c.chordName, tuning, song.capo, 1)[0];
    }
  song.difficulty = scoreDifficulty(song);
  return result(
    song,
    `Retuned to ${tuning.label}. ${warnings.length ? "Review flagged notes." : "All written pitches preserved."}`,
    warnings,
  );
}
export function setCapo(input: Song, capo: number): TransformResult {
  if (capo < 0 || capo > 7 || !Number.isInteger(capo))
    throw new Error("Capo must be 0–7.");
  const song = clone(input),
    t = resolveTuning(song.tuningId);
  const warnings = repitch(song, t, t, 0, song.capo, capo);
  song.capo = capo;
  for (const m of song.measures)
    for (const c of m.chords) {
      if (c.voicingPinned && c.voicing) {
        const original = c.voicing,
          frets = original.frets.map((f) =>
            typeof f === "number" ? f + input.capo - capo : f,
          );
        if (frets.every((f) => f === "x" || (f >= 0 && f <= 22)))
          c.voicing = rebuildPinnedVoicing(
            frets as Voicing["frets"],
            original,
            original.barre
              ? original.barre.fret + input.capo - capo
              : undefined,
          );
        else {
          m.outOfRange = true;
          warnings.push("Pinned voicing needs review after capo change.");
        }
      } else c.voicing = findVoicings(c.chordName, t, capo, 1)[0];
    }
  song.difficulty = scoreDifficulty(song);
  return result(
    song,
    `Capo ${capo === 0 ? "removed" : `at fret ${capo}`}; sounding chord names preserved.`,
    warnings,
  );
}
export function chordToTab(input: Song): TransformResult {
  const song = clone(input),
    t = resolveTuning(song.tuningId),
    warnings: string[] = [];
  for (const m of song.measures) {
    m.outOfRange = undefined;
    const slots = Array.from(
      { length: (m.timeSignature ?? song.timeSignature)[0] * m.subdivision },
      emptySlot,
    );
    const chords = [...m.chords].sort((a, b) => a.beat - b.beat);
    for (let i = 0; i < chords.length; i++) {
      const c = chords[i],
        v = c.voicing ?? findVoicings(c.chordName, t, song.capo, 1)[0];
      if (!v) {
        warnings.push(
          `Measure ${m.index + 1}: no complete voicing for ${c.chordName}.`,
        );
        m.outOfRange = true;
        continue;
      }
      c.voicing = v;
      const start = c.beat * m.subdivision,
        end =
          (chords[i + 1]?.beat ?? (m.timeSignature ?? song.timeSignature)[0]) *
          m.subdivision;
      slots[start] = [...v.frets];
      for (let s = start + 1; s < end; s++)
        slots[s] = v.frets.map((f) =>
          typeof f === "number" ? "hold" : null,
        ) as Slot;
    }
    if (m.chords.length && !m.outOfRange) m.tab = { slots };
  }
  song.difficulty = scoreDifficulty(song);
  return result(
    song,
    "Converted chord voicings into sustained guitar tab.",
    warnings,
  );
}
export function tabToChord(input: Song): TransformResult {
  const song = clone(input),
    t = resolveTuning(song.tuningId),
    warnings: string[] = [];
  const active: (number | null)[] = Array(6).fill(null);
  for (const m of song.measures) {
    if (!m.tab) {
      active.fill(null);
      continue;
    }
    const chords: Measure["chords"] = [];
    m.tab.slots.forEach((slot, i) => {
      slot.forEach((c, s) => {
        if (typeof c === "number") active[s] = t.midi[s] + song.capo + c;
        else if (c !== "hold") active[s] = null;
      });
      if (!slot.some((c) => typeof c === "number")) return;
      const pitches = active.filter((n): n is number => n !== null);
      if (pitches.length < 2) return;
      const names = identifyChord(pitches, song.currentKey);
      if (names.length) {
        chords.push({
          id: crypto.randomUUID(),
          beat: i / m.subdivision,
          chordName: names[0],
          voicing: {
            frets: active.map((n, s) =>
              n === null ? "x" : n - t.midi[s] - song.capo,
            ) as Voicing["frets"],
          },
        });
        if (names.length > 1)
          warnings.push(
            `Measure ${m.index + 1}, beat ${i / m.subdivision + 1}: ${names.join(" / ")} are candidates; review ${names[0]}.`,
          );
      } else
        warnings.push(
          `Measure ${m.index + 1}, beat ${i / m.subdivision + 1}: no supported chord matches.`,
        );
    });
    if (chords.length) m.chords = chords;
  }
  song.difficulty = scoreDifficulty(song);
  return result(
    song,
    "Identified chord candidates from sounding tab pitches.",
    warnings,
  );
}
export function scoreDifficulty(song: Song): number {
  const values: number[] = [];
  const t = resolveTuning(song.tuningId);
  for (const m of song.measures) {
    if (!m.chords.length) continue;
    const vs = m.chords.map(
      (c) => c.voicing ?? findVoicings(c.chordName, t, song.capo, 1)[0],
    );
    const barres = vs.filter((v) => v?.barre).length / vs.length;
    const open =
      vs.filter((v) => v && v.frets.filter((f) => f === 0).length >= 2).length /
      vs.length;
    const ext =
      m.chords.reduce(
        (sum, c) =>
          sum +
          Math.max(0, intervalsOf(parseChordName(c.chordName)).length - 3),
        0,
      ) / m.chords.length;
    let changes = 0;
    const low = (v: Voicing | undefined) => {
      const ns =
        v?.frets.filter((f): f is number => typeof f === "number" && f > 0) ??
        [];
      return ns.length ? Math.min(...ns) : 0;
    };
    for (let i = 1; i < vs.length; i++)
      if (Math.abs(low(vs[i]) - low(vs[i - 1])) >= 3) changes++;
    values.push(
      barres * 3 +
        ext * 1.5 +
        (vs.length > 1 ? (changes / (vs.length - 1)) * 1.5 : 0) -
        open,
    );
  }
  return Math.max(
    1,
    Math.min(
      10,
      Math.round(
        1 +
          (values.length
            ? values.reduce((a, b) => a + b, 0) / values.length
            : 0) *
            1.8,
      ),
    ),
  );
}
export function suggestCapo(input: Song): TransformResult {
  let best = input,
    bestScore = Infinity;
  const t = resolveTuning(input.tuningId);
  for (let capo = 0; capo <= 7; capo++) {
    const s = clone(input);
    s.capo = capo;
    let valid = true;
    for (const m of s.measures)
      for (const c of m.chords) {
        if (c.voicingPinned && capo !== input.capo) {
          valid = false;
          break;
        }
        c.voicing = c.voicingPinned
          ? c.voicing
          : findVoicings(c.chordName, t, capo, 1)[0];
        if (!c.voicing) valid = false;
      }
    if (!valid) continue;
    const score = scoreDifficulty(s);
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  if (!Number.isFinite(bestScore))
    return result(
      input,
      "No capo position supports all selected voicings.",
      [],
      false,
    );
  const changed = setCapo(input, best.capo);
  changed.song.measures.forEach((m, i) => {
    m.chords = best.measures[i].chords;
  });
  changed.song.difficulty = scoreDifficulty(changed.song);
  return {
    ...changed,
    summary: `Suggested capo ${best.capo}: difficulty ${changed.song.difficulty}/10.`,
    changed: best.capo !== input.capo,
  };
}
export function planSetlistCapos(entries: Song[]) {
  const repeated = new Set(
    entries
      .filter(
        (song, index) =>
          entries.findIndex((candidate) => candidate.id === song.id) !== index,
      )
      .map((song) => song.id),
  );
  const candidates = entries.map((song) => {
    if (repeated.has(song.id)) return [clone(song)];
    const valid = Array.from({ length: 8 }, (_, capo) =>
      setCapo(song, capo),
    ).filter(
      (r) => !r.warnings.length && !r.song.measures.some((m) => m.outOfRange),
    );
    const easiest = Math.min(...valid.map((r) => r.song.difficulty));
    return valid
      .filter((r) => r.song.difficulty === easiest)
      .map((r) => r.song);
  });
  type State = {
    song: Song;
    transitions: number;
    capoSum: number;
    path: Song[];
  };
  let states: State[] =
    candidates[0]?.map((song) => ({
      song,
      transitions: 0,
      capoSum: song.capo,
      path: [song],
    })) ?? [];
  for (let index = 1; index < candidates.length; index++) {
    states = candidates[index].map((song) => {
      const prior = states
        .map((state) => ({
          ...state,
          transitions:
            state.transitions + Number(state.song.capo !== song.capo),
          capoSum: state.capoSum + song.capo,
        }))
        .sort(
          (a, b) => a.transitions - b.transitions || a.capoSum - b.capoSum,
        )[0];
      return {
        song,
        transitions: prior.transitions,
        capoSum: prior.capoSum,
        path: [...prior.path, song],
      };
    });
  }
  const best = states.sort(
      (a, b) => a.transitions - b.transitions || a.capoSum - b.capoSum,
    )[0],
    byId = new Map<string, Song>();
  for (const song of best?.path ?? [])
    if (!byId.has(song.id)) byId.set(song.id, song);
  return {
    songs: [...byId.values()],
    capoTransitions: best?.transitions ?? 0,
    tuningTransitions: entries
      .slice(1)
      .filter((song, index) => song.tuningId !== entries[index].tuningId)
      .length,
    warnings: repeated.size
      ? [
          `Repeated songs kept their current capo because capo lives on the shared song.`,
        ]
      : [],
  };
}
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function scaleDifficulty(
  input: Song,
  target: number,
  seed = 1,
): TransformResult {
  const before = scoreDifficulty(input);
  if (target >= 5 && target <= 6)
    return result(
      input,
      "Levels 5–6 keep the arrangement unchanged.",
      [],
      false,
    );
  let s = clone(input);
  const t = resolveTuning(s.tuningId);
  if (target <= 4) {
    for (const m of s.measures)
      for (const c of m.chords) {
        if (c.voicingPinned) continue;
        const p = parseChordName(c.chordName);
        p.extensions =
          mod(pcOf(p.root) - pcOf(s.currentKey.root)) === 7 &&
          p.extensions.some((e) => ["7", "9", "11", "13"].includes(e))
            ? ["7"]
            : [];
        c.chordName = formatChordName(p);
        c.voicing = findVoicings(c.chordName, t, s.capo, 8).sort(
          (a, b) =>
            Number(!!a.barre) - Number(!!b.barre) ||
            b.frets.filter((f) => f === 0).length -
              a.frets.filter((f) => f === 0).length,
        )[0];
      }
    s = suggestCapo(s).song;
    if (scoreDifficulty(s) >= before)
      return result(input, "Already as simple as we can make it.", [], false);
    s = chordToTab(s).song;
    s.difficulty = scoreDifficulty(s);
    return result(s, `Simplified from ${before} to ${s.difficulty}/10.`);
  }
  if (before === 10)
    return result(input, "This arrangement already reaches 10/10.", [], false);
  const rng = random(seed);
  for (const m of s.measures)
    for (const c of m.chords) {
      if (c.voicingPinned) continue;
      const p = parseChordName(c.chordName),
        degree = mod(pcOf(p.root) - pcOf(s.currentKey.root));
      p.extensions =
        degree === 0 || degree === 5
          ? ["maj7"]
          : degree === 2 || degree === 7
            ? ["9"]
            : [rng() > 0.5 ? "7" : "add9"];
      const name = formatChordName(p),
        v = findVoicings(name, t, s.capo, 4);
      if (v.length) {
        c.chordName = name;
        c.voicing = v[Math.floor(rng() * v.length)];
      }
    }
  if (scoreDifficulty(s) <= before)
    return result(
      input,
      "No playable enrichment increased this arrangement’s score. Try another seed or unpin a voicing.",
      [],
      false,
    );
  s = chordToTab(s).song;
  for (const m of s.measures)
    if (m.tab) {
      m.tab.slots = m.tab.slots.map((slot, i) => {
        const c = [...m.chords]
          .reverse()
          .find((c) => c.beat * m.subdivision <= i);
        if (!c?.voicing) return slot;
        const available = c.voicing.frets
          .flatMap((f, st) => (typeof f === "number" ? [st] : []))
          .sort((a, b) => t.midi[a] - t.midi[b]);
        if (!available.length) return slot;
        const out = emptySlot(),
          chosen = available[i % available.length];
        out[chosen] = c.voicing.frets[chosen];
        return out;
      });
    }
  s.difficulty = scoreDifficulty(s);
  return result(
    s,
    `Enriched from ${before} to ${s.difficulty}/10 with a seeded fingerstyle pattern.`,
  );
}
export function displayName(
  name: string,
  song: Song,
  mode: "sounding" | "shape",
) {
  return mode === "shape"
    ? shiftChord(name, -song.capo, song.currentKey)
    : name;
}
export function setlistTransitions(songs: Song[]) {
  return songs.slice(1).map((s, i) => ({
    index: i + 1,
    capo: s.capo !== songs[i].capo,
    tuning: s.tuningId !== songs[i].tuningId,
  }));
}
export { voicingPitches };
