import { z } from "zod";
import { judgeChord, type ChordOutcome } from "./chord";
import {
  emptyCounts,
  type ChordEvaluationReport,
  type ChordLabel,
} from "./chordEvaluation";
import { NoteRecognizer } from "./recognition";

/**
 * Labeled-recording format and evaluation for chord scoring. One WAV per row:
 * ~1 s of silence, then `strums` strums about 2 s apart. Each file is run
 * through the same NoteRecognizer (1024-sample packets, room floor from the
 * leading silence) and chord judge the live app would use.
 */
export const LABELS = ["correct", "wrong-chord", "missing-tone", "single-note", "muted", "silence"] as const;
const Recording = z.object({
  file: z.string().regex(/^[\w.-]+\.wav$/i, "Use a .wav file name without folders or spaces"),
  /** The chord the app asks for. */
  target: z.object({ chord: z.string(), voicing: z.string() }),
  label: z.enum(LABELS),
  /** What was actually played, in words (e.g. "Am x02210", "strings 5–4 of C"). */
  played: z.string(),
  strum: z.enum(["down", "up", "pick", "none"]),
  strums: z.number().int().min(0).max(20),
  dynamics: z.enum(["normal", "soft"]).default("normal"),
  notes: z.string().optional(),
});
export const ChordManifestSchema = z.object({
  version: z.literal(1),
  /** "physical" for real guitar recordings; generated corpora must say "synthetic". */
  evidence: z.enum(["synthetic", "physical"]),
  device: z.string().min(1),
  guitar: z.string().min(1),
  tuning: z.literal("standard"),
  a4: z.number().min(415).max(466).default(440),
  recordings: z.array(Recording).min(1),
});
export type ChordManifest = z.infer<typeof ChordManifestSchema>;
export type ChordRecording = z.infer<typeof Recording>;

const STANDARD = [40, 45, 50, 55, 59, 64];
/** Voicing low E → high E: "x32010", or dash-separated for frets ≥ 10 ("10-12-12-11-10-10"). */
export function voicingToMidi(voicing: string) {
  const frets = voicing.includes("-") ? voicing.split("-") : [...voicing];
  if (frets.length !== 6 || frets.some((f) => f !== "x" && !/^\d{1,2}$/.test(f)))
    throw new Error(`Voicing "${voicing}" needs six strings, low E to high E, using digits or x.`);
  return frets.flatMap((f, i) => (f === "x" ? [] : [STANDARD[i] + Number(f)]));
}

export type StrumResult = {
  outcome: ChordOutcome | "missed";
  timeSeconds?: number;
  missing?: number[];
  extraHz?: number[];
  coverage?: number;
  explained?: number;
};
export type RecordingResult = {
  file: string;
  label: ChordLabel;
  target: string;
  strums: StrumResult[];
  attacks: number;
  /** Attacks beyond the labeled strum count; a hit among them is counted against the file. */
  extraHits: number;
};

export function evaluateRecording(samples: Float32Array, rate: number, entry: ChordRecording, a4 = 440): RecordingResult {
  const packet = 1024;
  // Room floor from the leading silence: 80th percentile packet RMS, as in the live quiet check.
  const lead = Math.min(samples.length, Math.round(rate * 0.8));
  const levels: number[] = [];
  for (let i = 0; i + packet <= lead; i += packet) {
    const p = samples.subarray(i, i + packet);
    levels.push(Math.sqrt(p.reduce((s, v) => s + v * v, 0) / packet));
  }
  levels.sort((a, b) => a - b);
  const floor = Math.max(0.003, levels[Math.floor(levels.length * 0.8)] ?? 0.007);
  const recognizer = new NoteRecognizer(rate, a4, floor, true);
  const expected = voicingToMidi(entry.target.voicing);
  const judged: StrumResult[] = [];
  for (let i = 0; i + packet <= samples.length; i += packet) {
    const e = recognizer.process(samples.slice(i, i + packet), (i + packet) / rate);
    if (!e.attack) continue;
    const j = judgeChord(e.attack.peaks ?? [], expected, a4);
    judged.push({
      outcome: j.outcome,
      timeSeconds: Math.round(e.attack.time * 1000) / 1000,
      missing: j.missing,
      extraHz: j.extraHz,
      coverage: Math.round(j.coverage * 100) / 100,
      explained: Math.round(j.explained * 100) / 100,
    });
  }
  const strums = Array.from({ length: entry.strums }, (_, i) => judged[i] ?? { outcome: "missed" as const });
  return {
    file: entry.file,
    label: entry.label,
    target: `${entry.target.chord} ${entry.target.voicing}`,
    strums,
    attacks: judged.length,
    extraHits: judged.slice(entry.strums).filter((s) => s.outcome === "hit").length,
  };
}

export function buildReport(manifest: ChordManifest, results: RecordingResult[]): ChordEvaluationReport {
  const counts = emptyCounts();
  for (const r of results) {
    const c = counts[r.label];
    if (r.label === "silence") {
      // One sample per clip: any credit at all is a failure.
      c.n++;
      if (r.extraHits) c.hit++;
      else if (r.attacks) c.uncertain++;
      else c.missed++;
      continue;
    }
    for (const s of r.strums) {
      c.n++;
      c[s.outcome]++;
    }
    // Credit on a surplus attack is still credit the player could have received.
    if (r.label !== "correct" && r.extraHits) {
      c.n += r.extraHits;
      c.hit += r.extraHits;
    }
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    evidence: manifest.evidence,
    recordings: results.length,
    chordShapes: new Set(manifest.recordings.filter((r) => r.label === "correct").map((r) => r.target.voicing)).size,
    devices: [manifest.device],
    guitars: [manifest.guitar],
    counts,
  };
}

/** Planned shapes: common open chords plus the confusions most likely to fool a chroma matcher. */
const SHAPES: Record<string, string> = {
  C: "x32010", G: "320003", D: "xx0232", A: "x02220", E: "022100",
  Am: "x02210", Em: "022000", Dm: "xx0231", F: "133211", Fmaj7: "xx3210",
};
const CONFUSERS: Record<string, [string, string]> = {
  C: ["Am", "Em"], G: ["Em", "C"], D: ["Dm", "G"], A: ["Am", "D"], E: ["Em", "Am"],
  Am: ["C", "E"], Em: ["G", "E"], Dm: ["D", "F"], F: ["Fmaj7", "Dm"], Fmaj7: ["F", "Am"],
};
/** Two adjacent strings (6 = low E) that omit at least one written chord tone. */
const PARTIAL: Record<string, { strings: [number, number]; missing: string }> = {
  C: { strings: [5, 4], missing: "G" }, G: { strings: [6, 5], missing: "D" }, D: { strings: [4, 3], missing: "F♯" },
  A: { strings: [5, 4], missing: "C♯" }, E: { strings: [6, 5], missing: "G♯" }, Am: { strings: [5, 4], missing: "C" },
  Em: { strings: [6, 5], missing: "G" }, Dm: { strings: [4, 3], missing: "F" }, F: { strings: [6, 5], missing: "A" },
  Fmaj7: { strings: [4, 3], missing: "C and E" },
};
/** Lowest string carrying the root in the written shape. */
const ROOT: Record<string, string> = {
  C: "string 5, fret 3 (C3)", G: "string 6, fret 3 (G2)", D: "string 4 open (D3)", A: "string 5 open (A2)",
  E: "string 6 open (E2)", Am: "string 5 open (A2)", Em: "string 6 open (E2)", Dm: "string 4 open (D3)",
  F: "string 6, fret 1 (F2)", Fmaj7: "string 4, fret 3 (F3)",
};

export function recordingPlan(): ChordRecording[] {
  const rows: ChordRecording[] = [];
  let n = 0;
  const add = (row: Omit<ChordRecording, "file" | "dynamics"> & { dynamics?: "normal" | "soft" }, slug: string) =>
    rows.push({ dynamics: "normal", ...row, file: `${String(++n).padStart(2, "0")}-${row.target.chord}-${slug}.wav` });
  for (const [chord, voicing] of Object.entries(SHAPES)) {
    const target = { chord, voicing };
    add({ target, label: "correct", played: `${chord} ${voicing}`, strum: "down", strums: 5 }, "correct-down");
    add({ target, label: "correct", played: `${chord} ${voicing}`, strum: "up", strums: 5 }, "correct-up");
    add({ target, label: "correct", played: `${chord} ${voicing}, softly`, strum: "down", strums: 5, dynamics: "soft" }, "correct-soft");
    for (const other of CONFUSERS[chord])
      add({ target, label: "wrong-chord", played: `${other} ${SHAPES[other]}`, strum: "down", strums: 5 }, `wrong-${other}`);
    const p = PARTIAL[chord];
    add(
      { target, label: "missing-tone", played: `${chord} shape, strings ${p.strings[0]} and ${p.strings[1]} only (no ${p.missing})`, strum: "down", strums: 5 },
      `missing-strings-${p.strings.join("")}`,
    );
    add({ target, label: "single-note", played: `root only: ${ROOT[chord]}`, strum: "pick", strums: 3 }, "single-root");
  }
  for (const chord of ["C", "G", "D", "Am"])
    add({ target: { chord, voicing: SHAPES[chord] }, label: "muted", played: `${chord} shape with the strings fully damped (percussive chuck)`, strum: "down", strums: 5 }, "muted");
  for (const chord of ["C", "G", "Em", "F"])
    add({ target: { chord, voicing: SHAPES[chord] }, label: "silence", played: "room tone, guitar silent and still", strum: "none", strums: 0 }, "silence");
  return rows;
}

export function manifestTemplate(device = "FILL IN: e.g. iPhone 15, iOS 26.0, Voice Memos (Lossless)", guitar = "FILL IN: e.g. steel-string acoustic, light gauge"): ChordManifest {
  return { version: 1, evidence: "physical", device, guitar, tuning: "standard", a4: 440, recordings: recordingPlan() };
}

export function checklistMarkdown(plan = recordingPlan()) {
  const lines = [
    "# Chord recording checklist",
    "",
    "Generated by `pnpm eval:chords --checklist`. Record each row as its own file with the exact file name. These recordings stay on your devices; the harness runs locally.",
    "",
    "## Before you start",
    "",
    "1. Tune to standard tuning at A4 = 440 Hz with the FretShift tuner. Use the guitar you will practise with.",
    "2. iPhone: Settings → Apps → Voice Memos → Audio Quality → **Lossless**. In each memo, leave **Enhance Recording** off.",
    "3. Put the phone where it sits during practice (on a stand, about 30–50 cm from the sound hole or amp). Quiet room, no music playing.",
    "4. For every file: start recording, wait **1 second in silence**, play the strums about **2 seconds apart**, letting each ring, then wait 2 seconds and stop.",
    "5. Rename each memo to the file name below (without extension). AirDrop them to your Mac into one folder, then convert: `for f in *.m4a; do afconvert -f WAVE -d LEI16 \"$f\" \"${f%.m4a}.wav\"; done`",
    "6. Copy `manifest.json` from `pnpm eval:chords --checklist` into that folder, fill in `device` and `guitar`, and remove rows you did not record. Run `pnpm eval:chords <folder>`.",
    "",
    "Labels: **correct** = the target chord as written. **wrong-chord** = a different chord shape while the app asks for the target. **missing-tone** = only the listed strings, omitting a chord tone. **single-note** = the root alone. **muted** = strings fully damped. **silence** = guitar still.",
    "",
    "| # | File | Target | Label | Play | Strum | Count |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  plan.forEach((r, i) =>
    lines.push(
      `| ${i + 1} | \`${r.file}\` | ${r.target.chord} \`${r.target.voicing}\` | ${r.label} | ${r.played}${r.dynamics === "soft" ? " (soft)" : ""} | ${r.strum} | ${r.strums || "8 s room tone"} |`,
    ),
  );
  const strums = (label: ChordLabel) => plan.filter((r) => r.label === label).reduce((s, r) => s + (r.strums || 1), 0);
  lines.push(
    "",
    `Totals: ${plan.length} files · ${strums("correct")} correct strums · ${strums("wrong-chord")} wrong-chord strums · ${strums("missing-tone")} missing-tone strums · ${strums("single-note")} single notes · ${strums("muted")} muted strums · ${strums("silence")} silent clips. About 25 minutes including renaming.`,
  );
  return lines.join("\n") + "\n";
}
