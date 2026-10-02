import { resolveTuning } from "../../schema/song.v1";
import {
  FingeringOptionsSchema,
  type Fingering,
  type FingeringOptions,
  type ReviewedNote,
} from "../../schema/audioNotes";

export const defaultFingeringOptions: FingeringOptions = {
  tuningId: "standard",
  capo: 0,
  availableStrings: [0, 1, 2, 3, 4, 5],
  minFret: 0,
  maxFret: 22,
  position: 3,
  preferOpen: true,
};

export function fingeringCandidates(
  midi: number,
  options: FingeringOptions,
): Fingering[] {
  FingeringOptionsSchema.parse(options);
  const tuning = resolveTuning(options.tuningId).midi;
  return options.availableStrings.flatMap((string) => {
    const fret = midi - tuning[string] - options.capo;
    return Number.isInteger(fret) &&
      fret >= options.minFret &&
      fret <= options.maxFret &&
      fret + options.capo <= 22
      ? [{ string, fret }]
      : [];
  });
}
const equal = (a: Fingering, b: Fingering) =>
  a.string === b.string && a.fret === b.fret;
/** Dynamic programming over a monophonic path; manual placements are hard anchors. */
export function suggestFingerings(
  notes: ReviewedNote[],
  options: FingeringOptions,
): ReviewedNote[] {
  FingeringOptionsSchema.parse(options);
  const next = structuredClone(notes);
  const live = next.filter((n) => !n.deleted).sort((a, b) => a.start - b.start);
  let group: ReviewedNote[] = [];
  const solve = () => {
    if (!group.length) return;
    const choices = group.map((n) =>
      n.fingering?.source === "user"
        ? [n.fingering]
        : fingeringCandidates(n.midi, options),
    );
    const local = (f: Fingering) =>
      f.fret === 0
        ? options.preferOpen
          ? 0.15
          : 3
        : Math.abs(f.fret - options.position) * 0.3;
    const costs: number[][] = [],
      parents: number[][] = [];
    choices.forEach((row, i) => {
      costs[i] = [];
      parents[i] = [];
      row.forEach((f, j) => {
        let best = local(f),
          parent = -1;
        if (i) {
          best = Infinity;
          choices[i - 1].forEach((p, k) => {
            const shift = f.fret && p.fret ? Math.abs(f.fret - p.fret) : 0;
            const crossing = Math.abs(f.string - p.string);
            const value =
              costs[i - 1][k] +
              local(f) +
              shift * 0.8 +
              Math.max(0, shift - 4) * 1.5 +
              crossing * 0.65;
            if (value < best) {
              best = value;
              parent = k;
            }
          });
        }
        costs[i][j] = best;
        parents[i][j] = parent;
      });
    });
    let at = costs.at(-1)!.indexOf(Math.min(...costs.at(-1)!));
    for (let i = group.length - 1; i >= 0; i--) {
      const n = group[i],
        chosen = choices[i][at];
      if (n.fingering?.source !== "user") {
        if (!n.fingering || !equal(n.fingering, chosen)) n.confirmed = false;
        n.fingering = { ...chosen, source: "suggested" };
      }
      at = parents[i][at];
    }
    group = [];
  };
  live.forEach((note, i) => {
    const candidates = fingeringCandidates(note.midi, options);
    if (
      note.fingering?.source === "user" &&
      !candidates.some((c) => equal(c, note.fingering!))
    ) {
      note.fingering = null;
      note.confirmed = false;
    }
    if (!candidates.length) {
      solve();
      note.fingering = null;
      note.confirmed = false;
      return;
    }
    if (i && note.start - live[i - 1].end > 1) solve();
    group.push(note);
  });
  solve();
  return next;
}
