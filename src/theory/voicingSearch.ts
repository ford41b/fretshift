import {
  type Tuning,
  type Voicing,
  type Fret,
  MAX_FRET,
} from "../schema/song.v1";
import {
  parseChordName,
  intervalsOf,
  pcOf,
  mod,
  shiftChord,
  spell,
  formatChordName,
} from "./chordName";
export const curated: Record<string, Voicing["frets"]> = {
  E: [0, 0, 1, 2, 2, 0],
  Em: [0, 0, 0, 2, 2, 0],
  A: [0, 2, 2, 2, 0, "x"],
  Am: [0, 1, 2, 2, 0, "x"],
  D: [2, 3, 2, 0, "x", "x"],
  Dm: [1, 3, 2, 0, "x", "x"],
  G: [3, 0, 0, 0, 2, 3],
  C: [0, 1, 0, 2, 3, "x"],
  F: [1, 1, 2, 3, 3, 1],
  B7: [2, 0, 2, 1, 2, "x"],
  E7: [0, 0, 1, 0, 2, 0],
  A7: [0, 2, 0, 2, 0, "x"],
  D7: [2, 1, 2, 0, "x", "x"],
  G7: [1, 0, 0, 0, 2, 3],
  C7: [0, 1, 3, 2, 3, "x"],
  Cmaj7: [0, 0, 0, 2, 3, "x"],
  Am7: [0, 1, 0, 2, 0, "x"],
  Em7: [0, 0, 0, 0, 2, 0],
  Dsus4: [3, 3, 2, 0, "x", "x"],
  Asus2: [0, 0, 2, 2, 0, "x"],
};
const cache = new Map<string, Voicing[]>();
export function asVoicing(frets: Voicing["frets"]): Voicing {
  const positive = frets.filter(
    (f): f is number => typeof f === "number" && f > 0,
  );
  const min = Math.min(...positive);
  const strings = frets.flatMap((f, i) => (f === min ? [i] : []));
  return {
    frets,
    ...(positive.length > 4 &&
    strings.length >= 2 &&
    frets
      .slice(strings[0], strings.at(-1)! + 1)
      .every((f) => typeof f === "number" && f >= min)
      ? {
          barre: {
            fret: min,
            fromString: strings[0],
            toString: strings.at(-1)!,
          },
        }
      : {}),
  };
}
export function voicingPitches(v: Voicing, t: Tuning, capo = 0) {
  return v.frets.flatMap((f, s) =>
    typeof f === "number" ? [t.midi[s] + capo + f] : [],
  );
}
export function findVoicings(
  name: string,
  t: Tuning,
  capo = 0,
  limit = 6,
): Voicing[] {
  const key = `${name}|${t.midi}|${capo}`;
  const cached = cache.get(key);
  if (cached) return structuredClone(cached.slice(0, limit));
  const parsed = parseChordName(name),
    root = pcOf(parsed.root),
    ints = intervalsOf(parsed),
    allowed = new Set(ints.map((i) => mod(root + i)));
  const required = ints
    .filter((i) => !(i === 7 && !["dim", "aug", "5"].includes(parsed.quality)))
    .map((i) => mod(root + i));
  if (parsed.bass) allowed.add(pcOf(parsed.bass));
  const bass = parsed.bass ? pcOf(parsed.bass) : undefined;
  const solutions = new Map<string, { v: Voicing; score: number }>();
  function add(frets: Voicing["frets"], curatedBonus = 0) {
    const v = asVoicing(frets);
    const pitches = voicingPitches(v, t, capo);
    const set = new Set(pitches.map((n) => mod(n)));
    if (
      pitches.length < Math.min(3, required.length) ||
      !required.every((n) => set.has(n)) ||
      [...set].some((n) => !allowed.has(n)) ||
      (bass !== undefined && mod(Math.min(...pitches)) !== bass)
    )
      return;
    const nums = frets.filter(
      (f): f is number => typeof f === "number" && f > 0,
    );
    if (nums.length && Math.max(...nums) - Math.min(...nums) > 4) return;
    const opens = frets.filter((f) => f === 0).length;
    const played = frets.flatMap((f, i) => (f !== "x" ? [i] : []));
    const inner = frets
      .slice(Math.min(...played), Math.max(...played) + 1)
      .filter((f) => f === "x").length;
    const score =
      opens * 3 +
      (mod(Math.min(...pitches)) === root ? 3 : 0) -
      nums.length -
      inner * 3 -
      (nums.length ? Math.min(...nums) * 0.18 : 0) +
      curatedBonus;
    if (
      !solutions.has(frets.join(",")) ||
      solutions.get(frets.join(","))!.score < score
    )
      solutions.set(frets.join(","), { v, score });
  }
  const shape = shiftChord(name, -capo);
  const known = curated[shape];
  if (known && (t.id === "standard" || t.id === "drop-d")) {
    const f = [...known] as Voicing["frets"];
    if (t.id === "drop-d" && typeof f[5] === "number") f[5] += 2;
    add(f, 100);
  }
  for (let position = 0; position <= 12; position++) {
    const options = t.midi.map((open) => {
      const out: Fret[] = ["x"];
      for (let f = 0; f <= Math.min(MAX_FRET, position + 4); f++)
        if ((f === 0 || f >= position) && allowed.has(mod(open + capo + f)))
          out.push(f);
      return out;
    });
    const chosen: Fret[] = [];
    let count = 0;
    function dfs(s: number) {
      if (++count > 65000) return;
      if (s === 6) {
        add([...chosen] as Voicing["frets"]);
        return;
      }
      for (const f of options[s]) {
        chosen[s] = f;
        dfs(s + 1);
      }
    }
    dfs(0);
  }
  const result = [...solutions.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.v.frets.join(",").localeCompare(b.v.frets.join(",")),
    )
    .map((x) => x.v);
  cache.set(key, result.slice(0, 24));
  return structuredClone(result.slice(0, limit));
}
export function identifyChord(
  pitches: number[],
  key?: Parameters<typeof spell>[1],
): string[] {
  if (!pitches.length) return [];
  const pcs = new Set(pitches.map((n) => mod(n))),
    bass = mod(Math.min(...pitches));
  const result: { name: string; score: number }[] = [];
  for (let root = 0; root < 12; root++)
    for (const q of ["", "m", "dim", "aug", "sus2", "sus4", "5"] as const)
      for (const ext of ["", "6", "7", "maj7", "9", "maj9", "add9"] as const) {
        const p = {
          root: spell(root, key),
          quality: q,
          extensions: ext ? [ext] : [],
        };
        const ints = intervalsOf(p);
        const required = ints
          .filter((i) => !(i === 7 && !["dim", "aug", "5"].includes(q)))
          .map((i) => mod(root + i));
        const permitted = new Set(ints.map((i) => mod(root + i)));
        if (
          required.every((n) => pcs.has(n)) &&
          [...pcs].every((n) => permitted.has(n))
        ) {
          const slash = bass !== root ? spell(bass, key) : undefined;
          const name = formatChordName({ ...p, bass: slash });
          result.push({
            name,
            score:
              (bass === root ? 10 : 0) +
              required.length * 2 -
              name.length * 0.1,
          });
        }
      }
  return result
    .sort((a, b) => b.score - a.score)
    .map((r) => r.name)
    .slice(0, 6);
}
