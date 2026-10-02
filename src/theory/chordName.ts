import { z } from "zod";
export const NOTE_NAMES = [
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
  "A",
  "A#",
  "Bb",
  "B",
] as const;
export const NoteNameSchema = z.enum(NOTE_NAMES);
export type NoteName = z.infer<typeof NoteNameSchema>;
export const qualities = ["", "m", "dim", "aug", "sus2", "sus4", "5"] as const;
export const extensions = [
  "6",
  "7",
  "maj7",
  "9",
  "maj9",
  "11",
  "13",
  "add9",
  "b5",
  "#5",
  "b9",
  "#9",
  "#11",
  "b13",
] as const;
export const ParsedChordSchema = z.object({
  root: NoteNameSchema,
  quality: z.enum(qualities),
  extensions: z.array(z.enum(extensions)),
  bass: NoteNameSchema.optional(),
});
export type ParsedChord = z.infer<typeof ParsedChordSchema>;
const pcs: Record<NoteName, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
export const pcOf = (name: NoteName) => pcs[name];
export const mod = (n: number, m = 12) => ((n % m) + m) % m;
export function spell(
  pc: number,
  key?: { root: NoteName; mode: "major" | "minor" },
): NoteName {
  const flatKeys =
    key?.mode === "minor"
      ? ["D", "G", "C", "F", "Bb", "Eb"]
      : ["F", "Bb", "Eb", "Ab", "Db", "Gb"];
  return (
    flatKeys.includes(key?.root ?? "C")
      ? ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
      : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  )[mod(pc)] as NoteName;
}
export function parseChordName(input: string): ParsedChord {
  const [head, bass, extra] = input.split("/");
  if (
    extra !== undefined ||
    (bass !== undefined && !NoteNameSchema.safeParse(bass).success)
  )
    throw new Error(`Invalid bass in chord “${input}”.`);
  const matchedRoot = head.match(/^([A-G](?:#|b)?)/)?.[0];
  const root = NoteNameSchema.safeParse(matchedRoot).success
    ? matchedRoot
    : head[0];
  if (!root || !NoteNameSchema.safeParse(root).success)
    throw new Error(
      `Invalid chord “${input}”. Use a root A–G and a supported quality.`,
    );
  let rest = head.slice(root.length);
  let quality: ParsedChord["quality"] = "";
  for (const q of ["sus2", "sus4", "dim", "aug", "m", "5"] as const)
    if (rest.startsWith(q) && !(q === "m" && rest.startsWith("maj"))) {
      quality = q;
      rest = rest.slice(q.length);
      break;
    }
  const found: ParsedChord["extensions"] = [];
  let previous = -1;
  while (rest) {
    const ext = [...extensions]
      .sort((a, b) => b.length - a.length)
      .find((e) => rest.startsWith(e));
    if (!ext || extensions.indexOf(ext) <= previous)
      throw new Error(`Unsupported or out-of-order extension in “${input}”.`);
    previous = extensions.indexOf(ext);
    found.push(ext);
    rest = rest.slice(ext.length);
  }
  return ParsedChordSchema.parse({
    root,
    quality,
    extensions: found,
    ...(bass ? { bass } : {}),
  });
}
export function formatChordName(c: ParsedChord) {
  return `${c.root}${c.quality}${c.extensions.join("")}${c.bass ? "/" + c.bass : ""}`;
}
export function shiftChord(
  name: string,
  semitones: number,
  key?: { root: NoteName; mode: "major" | "minor" },
) {
  const p = parseChordName(name);
  return formatChordName({
    ...p,
    root: spell(pcOf(p.root) + semitones, key),
    bass: p.bass ? spell(pcOf(p.bass) + semitones, key) : undefined,
  });
}
export function intervalsOf(c: ParsedChord): number[] {
  const base: Record<ParsedChord["quality"], number[]> = {
    "": [0, 4, 7],
    m: [0, 3, 7],
    dim: [0, 3, 6],
    aug: [0, 4, 8],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    "5": [0, 7],
  };
  let values = [...base[c.quality]];
  for (const e of c.extensions) {
    if (e === "6") values.push(9);
    if (["7", "9", "11", "13"].includes(e))
      values.push(c.quality === "dim" ? 9 : 10);
    if (e === "maj7" || e === "maj9") values.push(11);
    if (["9", "maj9", "11", "13", "add9"].includes(e)) values.push(2);
    if (e === "11" || e === "13") values.push(5);
    if (e === "13") values.push(9);
    if (e === "b5" || e === "#5")
      values = values.filter((v) => v !== 7).concat(e === "b5" ? 6 : 8);
    const altered: Record<string, number> = {
      b9: 1,
      "#9": 3,
      "#11": 6,
      b13: 8,
    };
    if (e in altered) {
      const natural = e === "b9" || e === "#9" ? 2 : e === "#11" ? 5 : 9;
      values = values.filter((v) => v !== natural);
      values.push(altered[e]);
    }
  }
  return [...new Set(values)];
}
