import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
import {
  syntheticNotes,
  wavBytes,
} from "../test-fixtures/audio-notes/synthetic.mjs";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});
const { YinNoteTranscriber } = await server.ssrLoadModule(
  "/src/audio/intelligence/notes.ts",
);
const { createNoteTranscription } = await server.ssrLoadModule(
  "/src/audio/intelligence/noteReview.ts",
);
const { fingeringCandidates, suggestFingerings, defaultFingeringOptions } =
  await server.ssrLoadModule("/src/audio/intelligence/fingering.ts");
const round = (v) => (Number.isFinite(v) ? Number(v.toFixed(4)) : null);
const mean = (values) =>
  values.length
    ? round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
function wav(bytes) {
  let rate,
    data,
    offset = 12;
  while (offset + 8 <= bytes.length) {
    const len = bytes.readUInt32LE(offset + 4),
      id = bytes.toString("ascii", offset, offset + 4);
    if (id === "fmt ") {
      if (
        bytes.readUInt16LE(offset + 8) !== 1 ||
        bytes.readUInt16LE(offset + 10) !== 1 ||
        bytes.readUInt16LE(offset + 22) !== 16
      )
        throw Error("Expected mono PCM16");
      rate = bytes.readUInt32LE(offset + 12);
    }
    if (id === "data") data = bytes.subarray(offset + 8, offset + 8 + len);
    offset += 8 + len + (len % 2);
  }
  if (!rate || !data) throw Error("Invalid WAV");
  return {
    sampleRate: rate,
    samples: Float32Array.from(
      { length: data.length / 2 },
      (_, i) => data.readInt16LE(i * 2) / 32768,
    ),
  };
}
// Maximum cardinality one-to-one matching. Candidate edges prefer nearest onset.
function match(actual, predicted, pitch = true) {
  const owner = new Map();
  function augment(i, seen) {
    const candidates = predicted
      .map((p, j) => ({ p, j }))
      .filter(
        ({ p }) =>
          Math.abs(p.start - actual[i].start) <= 0.07 &&
          (!pitch || Math.abs(p.midi - actual[i].midi) <= 0.5),
      )
      .sort(
        (a, b) =>
          Math.abs(a.p.start - actual[i].start) -
          Math.abs(b.p.start - actual[i].start),
      );
    for (const { j } of candidates) {
      if (seen.has(j)) continue;
      seen.add(j);
      if (!owner.has(j) || augment(owner.get(j), seen)) {
        owner.set(j, i);
        return true;
      }
    }
    return false;
  }
  actual.forEach((_, i) => augment(i, new Set()));
  return [...owner].map(([p, a]) => ({ a: actual[a], p: predicted[p] }));
}
const cases = [];
async function score(id, kind, pcm, truth) {
  const before = process.memoryUsage().rss,
    started = performance.now();
  const output = await new YinNoteTranscriber().transcribe(pcm);
  const runtime = performance.now() - started,
    after = process.memoryUsage().rss;
  const pairs = match(truth, output.notes),
    onsets = match(truth, output.notes, false);
  let monoFrames = 0,
    covered = 0,
    correct = 0,
    polyFrames = 0,
    polyPredicted = 0;
  for (const frame of output.frames) {
    const active = truth.filter(
      (n) => n.start <= frame.time && n.end > frame.time,
    );
    if (active.length === 1) {
      monoFrames++;
      if (frame.midi !== null) {
        covered++;
        if (Math.abs(frame.midi - active[0].midi) <= 0.5) correct++;
      }
    }
    if (active.length > 1) {
      polyFrames++;
      if (frame.midi !== null) polyPredicted++;
    }
  }
  const t = createNoteTranscription(output);
  const valid = t.notes.filter(
    (n) =>
      n.fingering &&
      fingeringCandidates(n.midi, t.options).some(
        (c) => c.string === n.fingering.string && c.fret === n.fingering.fret,
      ),
  ).length;
  const result = {
    id,
    kind,
    seconds: round(pcm.samples.length / pcm.sampleRate),
    referenceNotes: truth.length,
    predictedNotes: output.notes.length,
    monophonicFramePitchPrecision: covered ? round(correct / covered) : null,
    monophonicFramePitchRecall: monoFrames ? round(correct / monoFrames) : null,
    monophonicFrameCoverage: monoFrames ? round(covered / monoFrames) : null,
    pitchAndOnset70ms: {
      matched: pairs.length,
      precision: output.notes.length
        ? round(pairs.length / output.notes.length)
        : null,
      recall: truth.length ? round(pairs.length / truth.length) : null,
      falsePositives: output.notes.length - pairs.length,
      missedNotes: truth.length - pairs.length,
    },
    onsetOnly70ms: {
      matched: onsets.length,
      maeMs: mean(onsets.map(({ a, p }) => Math.abs(a.start - p.start) * 1000)),
    },
    pitchMatchedOnsetMaeMs: mean(
      pairs.map(({ a, p }) => Math.abs(a.start - p.start) * 1000),
    ),
    pitchMatchedDurationMaeMs: mean(
      pairs.map(
        ({ a, p }) => Math.abs(a.end - a.start - (p.end - p.start)) * 1000,
      ),
    ),
    polyphonicReferenceFrames: polyFrames,
    polyphonicFramesWithSinglePitch: polyPredicted,
    fingering: {
      validCandidates: valid,
      suggestions: t.notes.length,
      expertPreferenceQuality: null,
    },
    runtimeMs: round(runtime),
    rssBeforeMb: round(before / 1048576),
    rssAfterMb: round(after / 1048576),
    predictions: output.notes,
  };
  cases.push(result);
  console.log(
    id,
    JSON.stringify({
      predicted: result.predictedNotes,
      matched: pairs.length,
      reference: truth.length,
      ms: result.runtimeMs,
    }),
  );
}
try {
  for (const kind of [
    "melody",
    "silence",
    "noise",
    "polyphonic",
    "octave-mixture",
  ]) {
    const fixture = syntheticNotes(kind);
    if (kind === "melody")
      writeFileSync(
        "test-fixtures/audio-notes/single-note-melody.wav",
        wavBytes(fixture),
      );
    await score(`synthetic-${kind}`, "synthetic", fixture, fixture.notes);
  }
  const dir = new URL(
    process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + "/").href : "../test-fixtures/audio-notes/guitarset/",
    import.meta.url,
  );
  for (const file of readdirSync(dir).filter((f) => /_(solo|comp)\.json$/.test(f))) {
    const label = JSON.parse(
      readFileSync(new URL(encodeURIComponent(file), dir), "utf8"),
    );
    const bytes = readFileSync(
      new URL(encodeURIComponent(label.track_id + ".wav"), dir),
    );
    if (createHash("sha256").update(bytes).digest("hex") !== label.sha256)
      throw Error("Fixture hash mismatch");
    await score(
      label.track_id,
      label.style === "solo" ? "real-solo" : "real-comp-polyphonic",
      wav(bytes),
      label.notes.map((n) => ({
        start: n.onset_s,
        end: n.offset_s,
        midi: n.midi,
      })),
    );
  }
} finally {
  await server.close();
}
const examplePitches = [64, 65, 67, 69, 67, 65, 64, 62, 60, 62, 64];
const pathNotes = examplePitches.map((midi, i) => ({
  id: String(i),
  detectedId: null,
  start: i * 0.5,
  end: i * 0.5 + 0.4,
  midi,
  uncertain: true,
  confirmed: false,
  deleted: false,
  fingering: null,
  quantized: null,
}));
const setup = { ...defaultFingeringOptions, position: 5, preferOpen: false };
const optimized = suggestFingerings(pathNotes, setup).map((n) => n.fingering);
const lowest = pathNotes.map(
  (n) => fingeringCandidates(n.midi, setup).sort((a, b) => a.fret - b.fret)[0],
);
function pathQuality(path) {
  return {
    totalFretMovement: path
      .slice(1)
      .reduce((sum, f, i) => sum + Math.abs(f.fret - path[i].fret), 0),
    totalStringCrossing: path
      .slice(1)
      .reduce((sum, f, i) => sum + Math.abs(f.string - path[i].string), 0),
    shiftsOverFourFrets: path
      .slice(1)
      .filter((f, i) => Math.abs(f.fret - path[i].fret) > 4).length,
    meanDistanceFromRequestedPosition: mean(
      path.map((f) => Math.abs(f.fret - setup.position)),
    ),
  };
}
const fingeringEvaluation = {
  fixture: "Constructed pitch sequence, playing position 5, preferOpen=false",
  pitches: examplePitches,
  optimized: pathQuality(optimized),
  lowestFretBaseline: pathQuality(lowest),
  optimizedPath: optimized,
  limitation:
    "Mechanical path costs on one constructed example; not an expert or user-rated measure of musical quality.",
};
const report = {
  fingeringEvaluation,
  generatedAt: new Date().toISOString(),
  provider: "fretshift-yin-monophonic-v1",
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  method:
    "Frame pitch: only reference time with exactly one active note. Event matches: maximum one-to-one, onset ≤70ms and pitch ≤0.5 semitone. Duration MAE is conditional on matched pitch/onsets. Onset-only ignores pitch. False/missed counts are event counts, including unsupported polyphony.",
  limitations: [
    "Selected acoustic GuitarSet recordings only; cohort is identified by per-case track IDs. Not representative of electric/distorted/multi-instrument guitar.",
    "Raw annotations from GuitarSet mirror; no manual listening audit. Solo recordings include ringing overlaps; frame mono and poly strata are reported separately.",
    "No trained model was run. DSP thresholds are experimental. Synthetic cases are development fixtures, real clips are an evaluation slice, not a generalization study.",
    "Fingering candidate validity is a constraint check, not human-rated playability. Expert preference and observed string agreement are unmeasured.",
    "RSS is process-wide before/after, not peak memory. Runtime excludes decode/UI/network. Physical devices not tested.",
  ],
  summary: Object.fromEntries(
    ["synthetic", "real-solo", "real-comp-polyphonic"].map((kind) => {
      const rows = cases.filter((c) => c.kind === kind);
      return [
        kind,
        {
          cases: rows.length,
          referenceNotes: rows.reduce((a, b) => a + b.referenceNotes, 0),
          predictedNotes: rows.reduce((a, b) => a + b.predictedNotes, 0),
          matchedNotes: rows.reduce(
            (a, b) => a + b.pitchAndOnset70ms.matched,
            0,
          ),
          falsePositives: rows.reduce(
            (a, b) => a + b.pitchAndOnset70ms.falsePositives,
            0,
          ),
          missedNotes: rows.reduce(
            (a, b) => a + b.pitchAndOnset70ms.missedNotes,
            0,
          ),
          meanRuntimeMs: mean(rows.map((c) => c.runtimeMs)),
        },
      ];
    }),
  ),
  cases,
};
writeFileSync(
  process.argv[3] ?? "docs/results/GUITAR_TAB_BENCHMARK_RESULTS.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report.summary, null, 2));
