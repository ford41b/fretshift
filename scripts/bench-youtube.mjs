// YouTube import benchmark: chord precision/recall and change-time error for
// the accuracy options (a) hints, (b) windows, (c) close-up fps, (d) passes
// and (e) beat snapping.
//
// Evidence modes (always recorded in the results file):
//   simulated (default) – no network. A seeded noise model stands in for
//     Gemini so FretShift's own merge/vote/snap code can be measured. It says
//     nothing about Gemini's real accuracy.
//   replay – re-scores recorded live responses (YOUTUBE_BENCH_REPLAY=file).
//   live – PAID. Runs only with YOUTUBE_BENCH_LIVE=1 and either GEMINI_API_KEY
//     (direct, same request/validation code as the Edge Function) or
//     YOUTUBE_IMPORT_URL + FRETSHIFT_USER_ACCESS_TOKEN + SUPABASE_ANON_KEY.
//
// See test-fixtures/youtube/LABELING.md for the manifest format.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const env = process.env;
const live = env.YOUTUBE_BENCH_LIVE === "1";
const replayFile = env.YOUTUBE_BENCH_REPLAY;
const mode = replayFile ? "replay" : live ? "live" : "simulated";
const manifestPath = env.YOUTUBE_BENCH_MANIFEST ??
  (mode === "simulated" ? "test-fixtures/youtube/simulated-manifest.json" : "test-fixtures/youtube/manifest.json");
const resultsPath = env.YOUTUBE_BENCH_RESULTS ??
  (mode === "simulated" ? "docs/results/YOUTUBE_IMPORT_SIMULATED_BENCHMARK_RESULTS.json" : `docs/results/YOUTUBE_IMPORT_${mode.toUpperCase()}_BENCHMARK_RESULTS.json`);
const maxRequests = Number(env.YOUTUBE_BENCH_MAX_REQUESTS ?? 60);

if (live) {
  const direct = !!env.GEMINI_API_KEY;
  const viaFunction = env.YOUTUBE_IMPORT_URL && env.FRETSHIFT_USER_ACCESS_TOKEN && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY);
  if (!direct && !viaFunction) {
    console.log("Live YouTube benchmark needs GEMINI_API_KEY, or YOUTUBE_IMPORT_URL + FRETSHIFT_USER_ACCESS_TOKEN + SUPABASE_ANON_KEY. No paid request was made.");
    process.exit(1);
  }
}
if (!existsSync(manifestPath)) {
  console.log(`Manifest ${manifestPath} not found. Copy test-fixtures/youtube/manifest.example.json, label your videos (see LABELING.md), and retry. No request was made.`);
  process.exit(1);
}

const vite = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let accuracy, review, types, chordName, core;
try {
  accuracy = await vite.ssrLoadModule("/src/youtube/accuracy.ts");
  review = await vite.ssrLoadModule("/src/youtube/review.ts");
  types = await vite.ssrLoadModule("/src/youtube/types.ts");
  chordName = await vite.ssrLoadModule("/src/theory/chordName.ts");
  core = await vite.ssrLoadModule("/supabase/functions/youtube-import/core.ts");
} finally {
  await vite.close();
}
const { planRequests, snapToGrid, chordKey, normalizeChordSymbol } = accuracy;
const { combineResponses, LOW_CONFIDENCE } = review;
const { YouTubeWireSchema, CLOSE_UP_FPS, DEFAULT_FPS } = types;

// ---------------------------------------------------------------- manifest
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== 1 || !Array.isArray(manifest.cases) || !manifest.cases.length)
  throw new Error(`${manifestPath}: expected { "version": 1, "cases": [...] }.`);
// Simulated mode repeats each case with different random streams to average out noise.
const seeds = mode === "simulated" ? Math.max(1, Number(env.YOUTUBE_BENCH_SIM_SEEDS ?? 5)) : 1;
const expanded = manifest.cases.flatMap((item) => Array.from({ length: seeds }, (_, k) =>
  seeds === 1 ? item : { ...item, id: `${item.id}#seed${k + 1}` }));
const cases = expanded.map((item, index) => {
  const where = `${manifestPath} case ${index + 1} (${item.id ?? "no id"})`;
  if (!/^[A-Za-z0-9_-]{11}$/.test(item.videoId ?? "") || (mode !== "simulated" && /^X+$/.test(item.videoId)))
    throw new Error(`${where}: videoId must be a real 11-character YouTube ID.`);
  const startSeconds = item.startSeconds ?? 0, endSeconds = item.endSeconds;
  if (!(endSeconds > startSeconds)) throw new Error(`${where}: endSeconds must be after startSeconds.`);
  if (!Array.isArray(item.chords) || item.chords.length < 2) throw new Error(`${where}: label at least two chord changes.`);
  const chords = [...item.chords].sort((a, b) => a.start - b.start).map((chord, i, list) => {
    const label = chord.label === "N.C." ? "N.C." : normalizeChordSymbol(chord.label);
    if (!label) throw new Error(`${where}: "${chord.label}" is not a FretShift chord symbol (or "N.C.").`);
    return { start: Math.max(startSeconds, chord.start), end: Math.min(endSeconds, list[i + 1]?.start ?? endSeconds), label };
  }).filter((chord) => chord.end > chord.start);
  const grid = item.beats ?? (item.grid ? gridBeats(item.grid, startSeconds, endSeconds) : null);
  return { ...item, startSeconds, endSeconds, chords, beats: grid };
});

function gridBeats({ tempoBpm, firstDownbeatSeconds }, start, end) {
  const beats = [];
  const period = 60 / tempoBpm;
  let time = firstDownbeatSeconds;
  while (time - period >= start) time -= period;
  for (; time < end; time += period) beats.push(Number(time.toFixed(4)));
  return beats;
}

// ---------------------------------------------------------------- variants
const base = { useHints: false, windowSeconds: null, overlapSeconds: 10, closeUp: false, passes: 1, snapToBeats: false };
const allVariants = {
  baseline: base,
  "a-hints": { ...base, useHints: true },
  "b-windows-60s": { ...base, windowSeconds: 60 },
  "c-close-up-fps": { ...base, closeUp: true },
  "d-passes-2": { ...base, passes: 2 },
  "d-passes-3": { ...base, passes: 3 },
  "e-snap-to-grid": { ...base, snapToBeats: true },
  "e-snap-whole-beats": { ...base, snapToBeats: true, snapSubdivision: 1 },
  "all-a-c-d3-e": { ...base, useHints: true, closeUp: true, passes: 3, snapToBeats: true },
  "recommended-a-e": { ...base, useHints: true, snapToBeats: true },
};
const chosen = env.YOUTUBE_BENCH_VARIANTS ? env.YOUTUBE_BENCH_VARIANTS.split(",").map((name) => name.trim()) : Object.keys(allVariants);
for (const name of chosen) if (!allVariants[name]) throw new Error(`Unknown variant ${name}. Choose from ${Object.keys(allVariants).join(", ")}.`);

const hintsFor = (item, options) => options.useHints
  ? Object.fromEntries(Object.entries({ title: item.title, artist: item.artist, tuning: item.tuning, capo: item.capo })
    .filter(([, value]) => value !== undefined && value !== ""))
  : {};
const requestKey = (item, planned, hints) =>
  JSON.stringify([item.id, item.videoId, planned.segment.startSeconds, planned.segment.endSeconds, planned.fps, planned.pass, hints]);

// Every distinct request across variants is made once (e reuses baseline; d reuses pass 1).
const plans = [];
for (const item of cases)
  for (const name of chosen) {
    const options = { ...allVariants[name], closeUp: allVariants[name].closeUp && item.closeUp !== false };
    const hints = hintsFor(item, options);
    plans.push({ item, name, options, hints,
      planned: planRequests({ startSeconds: item.startSeconds, endSeconds: item.endSeconds }, options) });
  }
const unique = new Map();
for (const plan of plans) for (const planned of plan.planned) unique.set(requestKey(plan.item, planned, plan.hints), { plan, planned });
console.log(`${mode} benchmark: ${cases.length} cases${seeds > 1 ? ` (${manifest.cases.length} × ${seeds} seeds)` : ""} × ${chosen.length} variants → ${unique.size} distinct requests.`);
if (mode === "live" && unique.size > maxRequests) {
  console.log(`That exceeds YOUTUBE_BENCH_MAX_REQUESTS=${maxRequests}. Narrow YOUTUBE_BENCH_VARIANTS or raise the cap. No paid request was made.`);
  process.exit(1);
}

// ---------------------------------------------------------------- sources of answers
const recorded = replayFile ? JSON.parse(readFileSync(replayFile, "utf8")).responses : {};
const recording = {};

async function answer(item, planned, hints) {
  const key = requestKey(item, planned, hints);
  if (mode === "replay") {
    if (!recorded[key]) throw new Error(`No recorded response for ${key}. Re-run live for this variant.`);
    return YouTubeWireSchema.parse(recorded[key]);
  }
  if (mode === "simulated") return YouTubeWireSchema.parse(simulate(item, planned, hints));
  const wire = env.GEMINI_API_KEY ? await direct(item, planned, hints) : await viaFunction(item, planned, hints);
  recording[key] = wire;
  return YouTubeWireSchema.parse(wire);
}

async function direct(item, planned, hints) {
  const input = core.validateImportRequest({ url: `https://www.youtube.com/watch?v=${item.videoId}`, segment: planned.segment,
    fps: planned.fps, pass: planned.pass, hints, ...(item.durationSeconds ? { videoDurationSeconds: item.durationSeconds } : {}) });
  const model = env.GEMINI_MODEL || core.DEFAULT_MODEL;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(core.buildGeminiRequest(input)), signal: AbortSignal.timeout(140_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw core.classifyGeminiError(response.status, body);
  return { videoId: item.videoId, segment: input.segment, fps: input.fps, pass: input.pass,
    analysis: core.validateGeminiResponse(body, input.segment), video: {}, usage: core.usageFrom(body), modelId: model,
    promptVersion: core.PROMPT_VERSION, processedAt: new Date().toISOString() };
}

async function viaFunction(item, planned, hints) {
  const response = await fetch(env.YOUTUBE_IMPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.FRETSHIFT_USER_ACCESS_TOKEN}` },
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${item.videoId}`, segment: planned.segment, fps: planned.fps,
      pass: planned.pass, hints, ...(item.durationSeconds ? { videoDurationSeconds: item.durationSeconds } : {}) }),
    signal: AbortSignal.timeout(155_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body?.error ?? "request failed"}`);
  return body;
}

// ---------------------------------------------------------------- simulation (assumptions, not Gemini)
const ASSUMPTIONS = {
  note: "Invented noise model. It exercises FretShift's merge, vote and snap code under stated assumptions; it is not a measurement of Gemini.",
  baseLabelErrorRate: 0.2,
  hintsLabelErrorReduction: 0.05,
  closeUpLabelErrorReduction: 0.06,
  longRequestPenaltyOver180s: 0.06,
  windowEdgePenaltyWithin4s: 0.15,
  errorCorrelationAcrossPasses: 0.5,
  unknownRate: 0.06,
  boundaryJitterSigmaSeconds: { fps1: 0.45, closeUpFps4: 0.25 },
  windowTimestampRegressionRate: 0.1,
  tokenModel: "per request: frames × 70 tokens (default video media resolution) + 32 tokens/s audio for the WHOLE video (reported YouTube clipping regression), + 300 output",
};
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const CONFUSE = { "": "m", m: "" };
function confusable(label, r) {
  const chord = chordName.parseChordName(label);
  const choice = r();
  if (choice < 0.45 && chord.quality in CONFUSE) // relative major/minor
    return chordName.formatChordName({ ...chord, root: chordName.spell(chordName.pcOf(chord.root) + (chord.quality === "m" ? 3 : 9)),
      quality: CONFUSE[chord.quality], extensions: [], bass: undefined });
  if (choice < 0.7) return chordName.formatChordName({ ...chord, extensions: chord.extensions.length ? [] : ["7"] });
  return chordName.formatChordName({ ...chord, root: chordName.spell(chordName.pcOf(chord.root) + 7), extensions: [], bass: undefined });
}
function simulate(item, planned, hints) {
  const { startSeconds: low, endSeconds: high } = planned.segment;
  const windowed = low > item.startSeconds + 0.01 || high < item.endSeconds - 0.01;
  const shared = (salt) => rng(hash(`${item.id}|${salt}|${planned.fps}|${Object.keys(hints).length > 0}`));
  const own = rng(hash(`${item.id}|${low}|${high}|${planned.fps}|${planned.pass}|${JSON.stringify(hints)}`));
  const sigma = planned.fps >= CLOSE_UP_FPS ? ASSUMPTIONS.boundaryJitterSigmaSeconds.closeUpFps4 : ASSUMPTIONS.boundaryJitterSigmaSeconds.fps1;
  let errorRate = ASSUMPTIONS.baseLabelErrorRate - (Object.keys(hints).length ? ASSUMPTIONS.hintsLabelErrorReduction : 0)
    - (planned.fps >= CLOSE_UP_FPS && item.closeUp ? ASSUMPTIONS.closeUpLabelErrorReduction : 0)
    + (high - low > 180 ? ASSUMPTIONS.longRequestPenaltyOver180s : 0);
  const chords = [];
  item.chords.forEach((truth, index) => {
    if (truth.end <= low || truth.start >= high) return;
    const sys = shared(`chord${index}`), r = own;
    const nearEdge = windowed && Math.min(Math.abs((truth.start + truth.end) / 2 - low), Math.abs(high - (truth.start + truth.end) / 2)) < 4;
    const p = errorRate + (nearEdge ? ASSUMPTIONS.windowEdgePenaltyWithin4s : 0);
    const rho = ASSUMPTIONS.errorCorrelationAcrossPasses;
    const systematicWrong = sys() < p * rho, independentWrong = r() < p * (1 - rho);
    const unknown = r() < ASSUMPTIONS.unknownRate;
    let chord = truth.label, kind = truth.label === "N.C." ? "no-chord" : "chord", confidence = 0.7 + 0.25 * r();
    if (kind === "chord" && (systematicWrong || independentWrong)) {
      chord = confusable(truth.label, systematicWrong ? sys : r);
      confidence = 0.45 + 0.35 * r();
    }
    if (unknown) { kind = "unknown"; confidence = 0.2; }
    const jitter = (seedRandom) => (gauss(seedRandom) * sigma) / Math.SQRT2;
    const start = index === 0 ? truth.start : truth.start + jitter(sys) + jitter(r);
    chords.push({ startSeconds: Math.max(low, start), chord: kind === "chord" ? chord : null, kind, confidence: Number(confidence.toFixed(3)),
      evidence: planned.fps >= CLOSE_UP_FPS && item.closeUp ? "heard_and_seen" : "heard" });
  });
  chords.sort((a, b) => a.startSeconds - b.startSeconds);
  const list = chords.map((chord, i) => ({ ...chord, startSeconds: Number(chord.startSeconds.toFixed(3)),
    endSeconds: Number(Math.min(high, chords[i + 1]?.startSeconds ?? high).toFixed(3)) }))
    .filter((chord) => chord.endSeconds - chord.startSeconds >= 0.05);
  const suspect = windowed && own() < ASSUMPTIONS.windowTimestampRegressionRate;
  const tempo = item.grid ? item.grid.tempoBpm * (1 + 0.02 * gauss(own)) * (own() < 0.1 ? 0.5 : 1) : null;
  const frames = (high - low) * planned.fps;
  return {
    videoId: item.videoId, segment: planned.segment, fps: planned.fps, pass: planned.pass,
    analysis: { tempoBpm: tempo && tempo >= 20 ? Number(tempo.toFixed(2)) : null, meter: item.grid?.meter ?? 4, key: null, capoGuess: null,
      firstDownbeatSeconds: item.grid ? Math.max(low, Number((item.grid.firstDownbeatSeconds + 0.15 * gauss(own)).toFixed(3))) : null,
      sections: [], chords: list, sanitized: { labels: 0, times: 0, outsideWindowSeconds: suspect ? high - low : 0 }, timingSuspect: suspect },
    video: {}, usage: { promptTokens: Math.round(frames * 70 + (item.durationSeconds ?? item.endSeconds) * 32), outputTokens: 300,
      totalTokens: Math.round(frames * 70 + (item.durationSeconds ?? item.endSeconds) * 32 + 300) },
    modelId: "simulated", promptVersion: core.PROMPT_VERSION, processedAt: "2026-10-03T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------- scoring
const majmin = (label) => {
  try {
    const chord = chordName.parseChordName(label);
    return `${chordName.pcOf(chord.root)}:${chord.quality === "m" || chord.quality === "dim" ? "min" : chord.quality === "5" ? "5" : "maj"}`;
  } catch { return `raw:${label}`; }
};
const same = (a, b, reduce) => reduce === "exact" ? chordKey(a) === chordKey(b) :
  majmin(a) === majmin(b) || (majmin(a).endsWith(":5") && majmin(a).split(":")[0] === majmin(b).split(":")[0]);

function displayed(result) {
  return result.regions.map((region) => ({ start: region.start, end: region.end,
    label: region.kind === "no-chord" && !region.disagreement ? "N.C." :
      region.kind === "chord" && region.label && region.confidence >= LOW_CONFIDENCE ? region.label : null }));
}
function changes(segments) {
  const times = [];
  segments.forEach((segment, i) => { if (i && (segment.label ?? "?") !== (segments[i - 1].label ?? "?")) times.push(segment.start); });
  return times;
}
function score(item, predicted) {
  const step = 0.05, at = (list, time) => list.find((segment) => segment.start <= time && time < segment.end)?.label;
  const totals = { exact: 0, majmin: 0, predicted: 0, truth: 0, unknown: 0, seconds: 0 };
  for (let time = item.startSeconds + step / 2; time < item.endSeconds; time += step) {
    const truth = at(item.chords, time), guess = at(predicted, time);
    totals.seconds += step;
    if (guess === null || guess === undefined) totals.unknown += step;
    const truthChord = truth && truth !== "N.C.", guessChord = guess && guess !== "N.C.";
    if (truthChord) totals.truth += step;
    if (guessChord) {
      totals.predicted += step;
      if (truthChord && same(guess, truth, "exact")) totals.exact += step;
      if (truthChord && same(guess, truth, "majmin")) totals.majmin += step;
    }
  }
  const truthChanges = changes(item.chords), predictedChanges = changes(predicted);
  const pairs = [];
  for (const t of truthChanges) for (const p of predictedChanges) if (Math.abs(t - p) <= 1) pairs.push([Math.abs(t - p), t, p]);
  pairs.sort((a, b) => a[0] - b[0]);
  const usedT = new Set(), usedP = new Set(), errors = [];
  for (const [error, t, p] of pairs) if (!usedT.has(t) && !usedP.has(p)) { usedT.add(t); usedP.add(p); errors.push(error); }
  const within = errors.filter((error) => error <= 0.5).length;
  return { ...totals, truthChanges: truthChanges.length, predictedChanges: predictedChanges.length, matched05: within, errors };
}
const ratio = (a, b) => (b ? Number((a / b).toFixed(4)) : null);
const median = (values) => { const list = [...values].sort((a, b) => a - b); if (!list.length) return null;
  const m = Math.floor(list.length / 2); return list.length % 2 ? list[m] : (list[m - 1] + list[m]) / 2; };

// ---------------------------------------------------------------- run
const answers = new Map();
let failures = 0;
for (const [key, { plan, planned }] of unique) {
  try { answers.set(key, await answer(plan.item, planned, plan.hints)); }
  catch (error) { failures++; answers.set(key, error); console.log(`  request failed (${plan.item.id}, ${plan.name}): ${error.message}`); }
}
const byVariant = {};
for (const plan of plans) {
  const responses = plan.planned.map((planned) => ({ planned, wire: answers.get(requestKey(plan.item, planned, plan.hints)) }));
  const entry = byVariant[plan.name] ??= { options: allVariants[plan.name], cases: [] };
  const failed = responses.find((response) => response.wire instanceof Error);
  if (failed) { entry.cases.push({ id: plan.item.id, error: failed.wire.message }); continue; }
  let predicted;
  try {
    const result = combineResponses(plan.item.videoId, { startSeconds: plan.item.startSeconds, endSeconds: plan.item.endSeconds },
      plan.options, responses);
    predicted = displayed(result);
    // (e) uses the labeled grid, standing in for the grid the player confirms by tapping along.
    if (plan.options.snapToBeats && plan.item.beats)
      predicted = snapToGrid(predicted, plan.item.beats, plan.options.snapSubdivision ? { subdivision: plan.options.snapSubdivision } : {}).segments;
    const s = score(plan.item, predicted);
    entry.cases.push({ id: plan.item.id, requests: responses.length,
      tokens: responses.reduce((sum, response) => sum + (response.wire.usage?.totalTokens ?? 0), 0), ...s });
  } catch (error) {
    entry.cases.push({ id: plan.item.id, error: error.message });
  }
}

const summary = Object.fromEntries(Object.entries(byVariant).map(([name, { options, cases: rows }]) => {
  const ok = rows.filter((row) => !row.error), sum = (field) => ok.reduce((total, row) => total + row[field], 0);
  const errors = ok.flatMap((row) => row.errors);
  return [name, {
    options, casesScored: ok.length, casesFailed: rows.length - ok.length,
    chordPrecision: ratio(sum("exact"), sum("predicted")), chordRecall: ratio(sum("exact"), sum("truth")),
    majMinPrecision: ratio(sum("majmin"), sum("predicted")), majMinRecall: ratio(sum("majmin"), sum("truth")),
    unknownShare: ratio(sum("unknown"), sum("seconds")),
    changeRecallAt500ms: ratio(sum("matched05"), sum("truthChanges")),
    changePrecisionAt500ms: ratio(sum("matched05"), sum("predictedChanges")),
    medianChangeErrorMs: errors.length ? Math.round(median(errors) * 1000) : null,
    meanChangeErrorMs: errors.length ? Math.round((errors.reduce((a, b) => a + b, 0) / errors.length) * 1000) : null,
    requestsPerCase: ok.length ? Number((sum("requests") / ok.length).toFixed(2)) : null,
    tokensPerCase: ok.length ? Math.round(sum("tokens") / ok.length) : null,
    perCase: rows.map(({ errors: _errors, ...row }) => row),
  }];
}));

const output = {
  evidence: mode,
  warning: mode === "simulated" ? ASSUMPTIONS.note : mode === "replay" ? `Re-scored recorded responses from ${replayFile}.` : "Live Gemini responses.",
  generatedAt: new Date().toISOString(), manifest: manifestPath, promptVersion: core.PROMPT_VERSION,
  fps: { default: DEFAULT_FPS, closeUp: CLOSE_UP_FPS }, lowConfidenceThreshold: LOW_CONFIDENCE,
  ...(mode === "simulated" ? { simulationAssumptions: ASSUMPTIONS } : {}), failedRequests: failures, summary,
};
writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
if (mode === "live") {
  mkdirSync("test-fixtures/youtube/recordings", { recursive: true });
  const file = `test-fixtures/youtube/recordings/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, `${JSON.stringify({ manifest: manifestPath, responses: recording }, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(recording).length} responses to ${file}; re-score with YOUTUBE_BENCH_REPLAY=${file}.`);
}
const pad = (value, width) => String(value ?? "–").padEnd(width);
console.log(`\n[${mode.toUpperCase()}] ${pad("variant", 19)}${pad("prec", 8)}${pad("recall", 8)}${pad("unknown", 9)}${pad("chg@0.5", 9)}${pad("med ms", 8)}${pad("req/case", 9)}tokens/case`);
for (const [name, row] of Object.entries(summary))
  console.log(`${" ".repeat(mode.length + 3)}${pad(name, 19)}${pad(row.chordPrecision, 8)}${pad(row.chordRecall, 8)}${pad(row.unknownShare, 9)}${pad(row.changeRecallAt500ms, 9)}${pad(row.medianChangeErrorMs, 8)}${pad(row.requestsPerCase, 9)}${row.tokensPerCase}`);
console.log(`\nWrote ${resultsPath}.${mode === "simulated" ? " SIMULATED: no Gemini call was made; these numbers are not Gemini accuracy." : ""}`);
