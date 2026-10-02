import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";
import { manifest, renderFixture } from "../test-fixtures/audio-intelligence/fixtures.mjs";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { LocalAnalysisOrchestrator } = await server.ssrLoadModule("/src/audio/intelligence/index.ts");
const analyzer = new LocalAnalysisOrchestrator();
const nearest = (time, values) => values.length ? Math.min(...values.map((value) => Math.abs(time - value))) : Infinity;
const round = (value) => Number.isFinite(value) ? Number(value.toFixed(4)) : null;
const timing = (actual, predicted) => !actual.length ? null : {
  maeMs: round(actual.reduce((sum, time) => sum + nearest(time, predicted), 0) / actual.length * 1000),
  recall70ms: round(actual.filter((time) => nearest(time, predicted) <= 0.07).length / actual.length),
  precision70ms: predicted.length ? round(predicted.filter((time) => nearest(time, actual) <= 0.07).length / predicted.length) : 0,
};
const labelAt = (time, segments) => segments.find((segment) => segment.start <= time && time < segment.end)?.label ?? null;
const transitions = (segments) => {
  const labeled = segments.filter((segment) => segment.label);
  return labeled.slice(1).flatMap((segment, i) =>
    segment.label !== labeled[i].label ? [segment.start] : []);
};
const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

const cases = [];
try {
  for (const definition of manifest.cases) {
    const fixture = renderFixture(definition);
    const rssBefore = process.memoryUsage().rss;
    const start = performance.now();
    const result = await analyzer.analyze(fixture);
    const runtimeMs = performance.now() - start;
    const rssAfter = process.memoryUsage().rss;
    const predicted = result.chords.segments;
    const actual = fixture.truth.chords;
    let oracleStemComparison = null;
    if (["vocal-like-mix", "full-band-like"].includes(fixture.id)) {
      const oracle = new LocalAnalysisOrchestrator(undefined, undefined, {
        id: "fixture-oracle-guitar-only",
        async separate() { return { stems: { guitar: fixture.oracleGuitarStem } }; },
      });
      const oracleStart = performance.now();
      const separated = await oracle.analyze(fixture);
      let oracleCorrect = 0, oracleSamples = 0;
      for (let time = 0.025; time < fixture.duration; time += 0.05) {
        const ground = labelAt(time, actual);
        if (ground) {
          oracleSamples++;
          if (ground === labelAt(time, separated.chords.segments)) oracleCorrect++;
        }
      }
      oracleStemComparison = { kind: "synthetic oracle, not a separation model",
        chordLabelAccuracy: oracleSamples ? round(oracleCorrect / oracleSamples) : null,
        runtimeMs: round(performance.now() - oracleStart) };
    }
    let correct = 0, samples = 0, falseChordSeconds = 0;
    for (let time = 0.025; time < fixture.duration; time += 0.05) {
      const ground = labelAt(time, actual);
      const label = labelAt(time, predicted);
      if (ground) { samples++; if (ground === label) correct++; }
      else if (label) falseChordSeconds += 0.05;
    }
    const actualTransitions = transitions(actual);
    const predictedTransitions = transitions(predicted);
    cases.push({ id: fixture.id, style: fixture.style, durationSec: round(fixture.duration),
      groundTruth: "deterministic synthetic annotations",
      tempoErrorBpm: fixture.truth.tempoBpm === null || result.beats.tempoBpm === null ? null :
        round(Math.abs(result.beats.tempoBpm - fixture.truth.tempoBpm)),
      estimatedTempoBpm: result.beats.tempoBpm,
      beatTiming: timing(fixture.truth.beats, result.beats.beats),
      downbeatTiming: timing(fixture.truth.downbeats, result.beats.downbeats),
      estimatedMeter: result.beats.meter,
      chordLabelAccuracy: samples ? round(correct / samples) : null,
      chordSegmentIoU: actual.length ? round(actual.reduce((sum, segment) => {
        const best = predicted.filter((item) => item.label === segment.label)
          .reduce((max, item) => Math.max(max, overlap(segment, item) /
            (segment.end - segment.start + item.end - item.start - overlap(segment, item))), 0);
        return sum + best;
      }, 0) / actual.length) : null,
      missedTransitions: actualTransitions.filter((time) => nearest(time, predictedTransitions) > 0.25).length,
      falseTransitions: predictedTransitions.filter((time) => nearest(time, actualTransitions) > 0.25).length,
      falseChordSeconds: round(falseChordSeconds),
      ambiguousSeconds: round(predicted.filter((item) => item.status === "ambiguous")
        .reduce((sum, item) => sum + item.end - item.start, 0)),
      noteAccuracy: null, noteAccuracyReason: "This chord-only benchmark does not invoke the optional note transcriber.",
      runtimeMs: round(runtimeMs),
      rssBeforeMb: round(rssBefore / 1048576), rssAfterMb: round(rssAfter / 1048576),
      processRssDeltaMb: round((rssAfter - rssBefore) / 1048576),
      externalProviderCostUsd: 0,
      oracleStemComparison,
    });
  }
} finally { await server.close(); }
const numeric = (key) => cases.map((row) => row[key]).filter((value) => value !== null);
const mean = (values) => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
const report = {
  generatedAt: new Date().toISOString(), fixtureVersion: manifest.version,
  fixtureProvenance: manifest.provenance,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  implementation: { beat: "fretshift-onset-grid-v1", chord: "fretshift-chroma-templates-v1",
    stem: null, note: null, execution: "Node/Vite SSR on deterministic PCM" },
  caveats: ["Synthetic fixtures do not establish real-guitar, vocal, full-band, or device accuracy.",
    "RSS is process-level before/after, not peak algorithm memory.",
    "External provider cost is zero; local CPU, power, and hosting are not priced."],
  stemComparison: { status: "synthetic-oracle-only", reason:
    "Guitar-only generator channels were compared on two mixes; no Demucs/MDX model was run." },
  summary: { cases: cases.length, meanTempoErrorBpm: mean(numeric("tempoErrorBpm")),
    meanChordLabelAccuracy: mean(numeric("chordLabelAccuracy")),
    meanChordSegmentIoU: mean(numeric("chordSegmentIoU")),
    meanRuntimeMs: mean(numeric("runtimeMs")),
    totalMissedTransitions: cases.reduce((sum, row) => sum + row.missedTransitions, 0),
    totalFalseTransitions: cases.reduce((sum, row) => sum + row.falseTransitions, 0) },
  cases,
};
const output = new URL("../AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json", import.meta.url);
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary: report.summary, output: output.pathname }, null, 2));
