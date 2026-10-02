import { type Key } from "../schema/song.v1";
import { pcOf } from "../theory/chordName";
const majors = [
  "B",
  "Gb",
  "Db",
  "Ab",
  "Eb",
  "Bb",
  "F",
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
] as const;
const minors = [
  "Ab",
  "Eb",
  "Bb",
  "F",
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "C#",
  "G#",
  "D#",
  "A#",
] as const;
export function keyFromFifths(fifths: number, minor: boolean): Key {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7)
    throw new Error("Unsupported key signature.");
  return {
    root: (minor ? minors : majors)[fifths + 7],
    mode: minor ? "minor" : "major",
  };
}
export function keyFifths(key: Key) {
  const roots = key.mode === "minor" ? minors : majors;
  const exact = roots
    .map((root, i) => ({ root, fifths: i - 7 }))
    .filter((v) => pcOf(v.root) === pcOf(key.root))
    .sort(
      (a, b) =>
        Number(b.root === key.root) - Number(a.root === key.root) ||
        Math.abs(a.fifths) - Math.abs(b.fifths),
    );
  return exact[0].fifths;
}
export function midiSignatureKey(root: string, minor: boolean) {
  const raw = [
    "Cb",
    "Gb",
    "Db",
    "Ab",
    "Eb",
    "Bb",
    "F",
    "C",
    "G",
    "D",
    "A",
    "E",
    "B",
    "F#",
    "C#",
  ];
  return keyFromFifths(raw.indexOf(root) - 7, minor);
}
