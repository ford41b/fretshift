// Chord-scoring evaluation harness. Runs locally; recordings never leave this machine.
//
//   pnpm eval:chords --checklist [outDir]   write the recording checklist + manifest.json template
//   pnpm eval:chords <folder>               evaluate <folder>/manifest.json + WAV files
//   pnpm eval:chords <folder> --write-release-evidence
//                                           also update src/audio/immersive/evidence/chord-evaluation.json
//                                           (only for evidence "physical"); this is what turns the flag on
//   pnpm eval:chords --synthetic [outDir]   generate a synthetic WAV corpus from the plan and evaluate it
//                                           (pipeline check only; synthetic evidence never qualifies)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { wavBytes } from "../test-fixtures/audio-notes/synthetic.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const positional = args.filter((a) => !a.startsWith("--"));

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const harness = await server.ssrLoadModule("/src/audio/immersive/chordHarness.ts");
  const evaluation = await server.ssrLoadModule("/src/audio/immersive/chordEvaluation.ts");

  if (flag("--checklist")) {
    const out = resolve(positional[0] ?? "docs/immersive");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "chord-recording-checklist.md"), harness.checklistMarkdown());
    writeFileSync(join(out, "chord-recording-manifest.template.json"), JSON.stringify(harness.manifestTemplate(), null, 2) + "\n");
    console.log(`Wrote ${join(out, "chord-recording-checklist.md")} and chord-recording-manifest.template.json`);
  } else {
    let folder = positional[0];
    if (flag("--synthetic")) {
      const { syntheticRecording } = await server.ssrLoadModule("/src/audio/immersive/fixtures.ts");
      folder = resolve(folder ?? "test-results/chord-synthetic");
      mkdirSync(folder, { recursive: true });
      const manifest = harness.manifestTemplate("generated signals (no device)", "generated harmonic plucks (no guitar)");
      manifest.evidence = "synthetic";
      for (const entry of manifest.recordings)
        writeFileSync(join(folder, entry.file), wavBytes({ samples: syntheticRecording(48000, entry), sampleRate: 48000 }));
      writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    }
    if (!folder) throw new Error("Usage: pnpm eval:chords <folder> | --checklist [outDir] | --synthetic [outDir]");
    folder = resolve(folder);
    const manifest = harness.ChordManifestSchema.parse(JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")));
    const results = [],
      missingFiles = [];
    for (const entry of manifest.recordings) {
      const path = join(folder, entry.file);
      if (!existsSync(path)) {
        missingFiles.push(entry.file);
        continue;
      }
      const { samples, sampleRate } = readWav(readFileSync(path), entry.file);
      results.push(harness.evaluateRecording(samples, sampleRate, entry, manifest.a4));
    }
    const report = harness.buildReport(manifest, results);
    const failures = evaluation.chordThresholdFailures(report);
    const rates = evaluation.chordRates(report);
    const full = { report, rates, thresholds: evaluation.CHORD_THRESHOLDS, releaseFailures: failures, missingFiles, results };
    writeFileSync(join(folder, "chord-evaluation-report.json"), JSON.stringify(full, null, 2) + "\n");
    console.log(`Evidence: ${report.evidence} · ${report.recordings} files evaluated · ${missingFiles.length} planned files missing`);
    for (const [label, c] of Object.entries(report.counts))
      console.log(`  ${label.padEnd(13)} n=${String(c.n).padStart(3)}  hit=${c.hit}  wrong=${c.wrong}  uncertain=${c.uncertain}  missed=${c.missed}`);
    const pct = (v) => (v === null ? "n/a" : `${(100 * v).toFixed(1)}%`);
    console.log(`  false accept ${pct(rates.falseAccept)} (95% upper ${pct(rates.falseAcceptUpper95)}) · correct hit ${pct(rates.correctHitRate)} · correct called wrong ${pct(rates.correctWrongRate)} · missing-tone accept upper ${pct(rates.missingToneAcceptUpper95)}`);
    console.log(failures.length ? `Release thresholds NOT met:\n  - ${failures.join("\n  - ")}` : "Release thresholds met.");
    console.log(`Full report: ${join(folder, "chord-evaluation-report.json")}`);
    if (flag("--write-release-evidence")) {
      if (report.evidence !== "physical") throw new Error("Only physical recordings can be written as release evidence.");
      writeFileSync("src/audio/immersive/evidence/chord-evaluation.json", JSON.stringify(report, null, 2) + "\n");
      console.log("Updated src/audio/immersive/evidence/chord-evaluation.json. Rebuild; the flag follows the thresholds.");
    }
  }
} finally {
  await server.close();
}

/** PCM 16/24/32-bit integer or 32-bit float WAV, any channel count, mixed to mono. */
function readWav(bytes, name) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${name}: not a WAV file`);
  let format, channels, rate, bits, data;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      format = bytes.readUInt16LE(offset + 8);
      channels = bytes.readUInt16LE(offset + 10);
      rate = bytes.readUInt32LE(offset + 12);
      bits = bytes.readUInt16LE(offset + 22);
      if (format === 0xfffe) format = bytes.readUInt16LE(offset + 32); // WAVE_FORMAT_EXTENSIBLE sub-format
    }
    if (id === "data") data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  if (!data || !rate) throw new Error(`${name}: missing fmt or data chunk`);
  const width = bits / 8,
    frames = Math.floor(data.length / (width * channels));
  const read =
    format === 3 && bits === 32 ? (o) => data.readFloatLE(o)
    : format === 1 && bits === 16 ? (o) => data.readInt16LE(o) / 32768
    : format === 1 && bits === 24 ? (o) => data.readIntLE(o, 3) / 8388608
    : format === 1 && bits === 32 ? (o) => data.readInt32LE(o) / 2147483648
    : null;
  if (!read) throw new Error(`${name}: unsupported WAV (format ${format}, ${bits}-bit). Convert with afconvert -f WAVE -d LEI16.`);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += read((i * channels + c) * width);
    samples[i] = sum / channels;
  }
  return { samples, sampleRate: rate };
}
