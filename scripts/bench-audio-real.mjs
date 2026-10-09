import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const fixtureDir = new URL(process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + "/").href : "../test-fixtures/audio-intelligence/guitarset/", import.meta.url);
const source = JSON.parse(readFileSync(new URL("ground-truth.json", fixtureDir), "utf8"));
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { LocalAnalysisOrchestrator } = await server.ssrLoadModule("/src/audio/intelligence/index.ts");
const analyzer = new LocalAnalysisOrchestrator();
const round = (value) => Number.isFinite(value) ? Number(value.toFixed(4)) : null;
const mean = (values) => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
const pitchClass = (label) => {
  const match = /^([A-G])([#b]?)/.exec(label ?? "");
  if (!match) return null;
  return (({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[match[1]] +
    (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
};
const simpleSuffix = { maj: "", min: "m", "7": "7", maj7: "maj7", min7: "m7",
  maj6: "6", min6: "m6", sus2: "sus2", sus4: "sus4", "9": "9" };
const exactLabel = (label) => {
  const match = /^([A-G][#b]?):([^/]+)\/1$/.exec(label);
  if (!match || !(match[2] in simpleSuffix)) return null;
  return match[1] + simpleSuffix[match[2]];
};
function wavPcm(file) {
  const bytes = readFileSync(file);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`Not a WAV file: ${file}`);
  let offset = 12, format, data;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") format = { encoding: bytes.readUInt16LE(offset + 8),
      channels: bytes.readUInt16LE(offset + 10), rate: bytes.readUInt32LE(offset + 12),
      bits: bytes.readUInt16LE(offset + 22) };
    if (id === "data") data = { offset: offset + 8, length };
    offset += 8 + length + length % 2;
  }
  if (!format || !data || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16)
    throw new Error(`Expected mono 16-bit PCM WAV: ${file}`);
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(data.offset + i * 2) / 32768;
  return { samples, sampleRate: format.rate };
}
function matchEvents(actual, predicted, tolerance) {
  const pairs = [];
  const candidates = actual.flatMap((a, i) => predicted.map((p, j) => ({ i, j, error: Math.abs(a - p) })))
    .filter((pair) => pair.error <= tolerance).sort((a, b) => a.error - b.error);
  const usedActual = new Set(), usedPredicted = new Set();
  for (const pair of candidates) if (!usedActual.has(pair.i) && !usedPredicted.has(pair.j)) {
    pairs.push(pair); usedActual.add(pair.i); usedPredicted.add(pair.j);
  }
  return { matched: pairs.length, missed: actual.length - pairs.length,
    false: predicted.length - pairs.length,
    precision: predicted.length ? round(pairs.length / predicted.length) : 0,
    recall: actual.length ? round(pairs.length / actual.length) : null,
    matchedMaeMs: pairs.length ? round(mean(pairs.map((pair) => pair.error)) * 1000) : null };
}
const at = (time, segments, start, end) => segments.find((segment) =>
  segment[start] <= time && time < segment[end]);
const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const rows = [];
try {
  for (const item of source.cases) {
    const file = new URL(`${encodeURIComponent(item.trackId)}.wav`, fixtureDir);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (digest !== item.audioSha256) throw new Error(`Fixture checksum mismatch: ${item.trackId}`);
    if (item.jamsSha256 && createHash("sha256").update(readFileSync(new URL(`${encodeURIComponent(item.trackId)}.jams`,fixtureDir))).digest("hex") !== item.jamsSha256)
      throw new Error(`Annotation checksum mismatch: ${item.trackId}`);
    const audio = wavPcm(file);
    const rssBefore = process.memoryUsage().rss;
    const cpuBefore = process.cpuUsage();
    const start = performance.now();
    const result = await analyzer.analyze(audio);
    const coreRuntimeMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    const predicted = result.chords.segments;
    const truth = item.chords.map((chord) => ({ start: chord.onset_s, end: chord.offset_s,
      label: chord.label, root: pitchClass(chord.label), exact: exactLabel(chord.label) }));
    const root = { correct: 0, predicted: 0, actual: 0 };
    const exact = { correct: 0, predicted: 0, actual: 0 };
    let unknown = 0, scored = 0;
    for (let time = .025; time < item.durationSec; time += .05) {
      const ground = at(time, truth, "start", "end");
      const guess = at(time, predicted, "start", "end");
      if (!ground) continue;
      scored++;
      if (!guess?.label) unknown++;
      if (ground.root !== null) {
        root.actual++;
        if (guess?.label) root.predicted++;
        if (guess?.label && pitchClass(guess.label) === ground.root) root.correct++;
      }
      if (ground.exact !== null) {
        exact.actual++;
        if (guess?.label) exact.predicted++;
        if (guess?.label === ground.exact) exact.correct++;
      }
    }
    const changes = (segments, label) => segments.slice(1).flatMap((segment, i) =>
      label(segment) !== label(segments[i]) ? [segment.start] : []);
    const trueChanges = changes(truth, (segment) => segment.label);
    // Abstention is coverage evidence, not a newly recognized chord identity.
    const predictedChanges = changes(predicted.filter((segment) => segment.label !== null),
      (segment) => segment.label);
    const chordChanges = matchEvents(trueChanges, predictedChanges, .25);
    const beatTiming = matchEvents(item.beats, result.beats.beats, .07);
    const segmentIoU = mean(truth.map((segment) => {
      const best = predicted.filter((guess) => guess.label && pitchClass(guess.label) === segment.root)
        .reduce((max, guess) => Math.max(max, overlap(segment, guess) /
          (segment.end - segment.start + guess.end - guess.start - overlap(segment, guess))), 0);
      return best;
    }));
    rows.push({ trackId: item.trackId, durationSec: round(item.durationSec),
      tempoReferenceBpm: item.tempoBpm, tempoEstimatedBpm: result.beats.tempoBpm,
      tempoAbsoluteErrorBpm: result.beats.tempoBpm === null ? null :
        round(Math.abs(item.tempoBpm - result.beats.tempoBpm)),
      beatTiming70ms: beatTiming,
      downbeatAccuracy: item.downbeats ? matchEvents(item.downbeats, result.beats.downbeats, .07) : null,
      downbeatReason: item.downbeats ? "Original JAMS beat_position annotations, position 1; not independently listening-audited." : "This extracted subset contains beats but no downbeat annotations.",
      chordRootTimePrecision: root.predicted ? round(root.correct / root.predicted) : 0,
      chordRootTimeRecall: root.actual ? round(root.correct / root.actual) : null,
      exactEligibleTimePrecision: exact.predicted ? round(exact.correct / exact.predicted) : 0,
      exactEligibleTimeRecall: exact.actual ? round(exact.correct / exact.actual) : null,
      exactEligibleReferenceFraction: scored ? round(exact.actual / scored) : 0,
      rootSegmentMeanIoU: segmentIoU, chordChanges250ms: chordChanges,
      uncertainCoverageFraction: scored ? round(unknown / scored) : null,
      noteAccuracy: null, noteOnsetDurationError: null,
      coreRuntimeMs: round(coreRuntimeMs), cpuTimeMs: round((cpu.user + cpu.system) / 1000),
      rssBeforeMb: round(rssBefore / 1048576), rssAfterMb: round(process.memoryUsage().rss / 1048576),
      trainedModelRuntimeMs: null, serverComputeCostUsd: 0 });
  }
} finally { await server.close(); }
const report = { generatedAt: new Date().toISOString(),
  dataset: "GuitarSet v1.1.0, acoustic mono-mic composition excerpts, CC BY 4.0",
  source: "https://zenodo.org/records/3371780",
  mirror: "https://huggingface.co/datasets/jhartquist/guitarset",
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  limitations: ["Only the selected acoustic clips were tested; per-case track IDs identify the cohort.",
    "GuitarSet complex chord labels are not silently simplified. Exact-label metrics apply only to simple root-position labels; see eligibility fraction.",
    "Root precision/recall use 50 ms time samples; beat and change matches are one-to-one within stated tolerances.",
    "Chord changes compare successive recognized labels; entering or leaving an unlabeled region is measured as coverage, not a false chord change.",
    "RSS is process-wide before/after, not peak browser memory. Decode, UI, and network latency are excluded.",
    "No note transcriber is invoked by this chord benchmark. No trained model, separator, GPU or server audio job runs."],
  summary: { cases: rows.length, seconds: round(rows.reduce((sum, row) => sum + row.durationSec, 0)),
    meanTempoAbsoluteErrorBpm: mean(rows.map((row) => row.tempoAbsoluteErrorBpm).filter((x) => x !== null)),
    meanBeatRecall70ms: mean(rows.map((row) => row.beatTiming70ms.recall).filter((x) => x !== null)),
    meanChordRootTimePrecision: mean(rows.map((row) => row.chordRootTimePrecision)),
    meanChordRootTimeRecall: mean(rows.map((row) => row.chordRootTimeRecall)),
    meanExactEligibleTimePrecision: mean(rows.map((row) => row.exactEligibleTimePrecision)),
    meanExactEligibleTimeRecall: mean(rows.map((row) => row.exactEligibleTimeRecall)),
    meanRootSegmentIoU: mean(rows.map((row) => row.rootSegmentMeanIoU)),
    missedChanges: rows.reduce((sum, row) => sum + row.chordChanges250ms.missed, 0),
    falseChanges: rows.reduce((sum, row) => sum + row.chordChanges250ms.false, 0),
    meanUncertainCoverage: mean(rows.map((row) => row.uncertainCoverageFraction)),
    meanCoreRuntimeMs: mean(rows.map((row) => row.coreRuntimeMs)) }, cases: rows };
writeFileSync(new URL(process.argv[3] ? pathToFileURL(resolve(process.argv[3])).href : "../docs/results/AUDIO_INTELLIGENCE_REAL_BENCHMARK_RESULTS.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary, null, 2));
