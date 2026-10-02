import { MAX_FRET, type Tuning } from "../schema/song.v1";
import { spell, mod } from "./chordName";
export function midiOf(t: Tuning, stringIdx: number, fret: number, capo = 0) {
  if (
    stringIdx < 0 ||
    stringIdx > 5 ||
    !Number.isInteger(stringIdx) ||
    fret < 0 ||
    fret > MAX_FRET
  )
    throw new Error("String or fret outside playable range.");
  return t.midi[stringIdx] + fret + capo;
}
export function fretsFor(t: Tuning, midi: number, capo = 0) {
  return t.midi.flatMap((open, stringIdx) => {
    const fret = midi - open - capo;
    return Number.isInteger(fret) && fret >= 0 && fret <= MAX_FRET
      ? [{ stringIdx, fret }]
      : [];
  });
}
export const frequencyOf = (midi: number, a4 = 440) =>
  a4 * 2 ** ((midi - 69) / 12);
export const midiFromFrequency = (hz: number, a4 = 440) =>
  69 + 12 * Math.log2(hz / a4);
export const noteLabel = (midi: number) =>
  `${spell(mod(midi))}${Math.floor(midi / 12) - 1}`;
