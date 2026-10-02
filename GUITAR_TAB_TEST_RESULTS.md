# Phase 3 verification — 2026-09-26

Final runtime: Node **24.19.0**, macOS arm64, project pnpm 10.15.1, existing locked dependencies. No live external model/provider calls or deployment. `.nvmrc` still pins Node 20; that runtime was not revalidated in this pass.

| Gate | Actual result / evidence |
| --- | --- |
| Full unit suite, `pnpm exec vitest run --maxWorkers=1 --reporter=json --outputFile=GUITAR_TAB_UNIT_TEST_RESULTS.json` | **283/283 passed**, 0 failed. Includes 12 new note provider, fingering, validation, conversion and practice cases, plus all earlier tests. |
| ESLint + TypeScript, `pnpm lint` | Passed. `GUITAR_TAB_BUILD_LOG.txt`. |
| Production, `pnpm build` | Passed. Same log. |
| `node scripts/verify-immersive-beta-gate.mjs` | All three gate checks passed. General/non-audio gate remains; audio-review songs enter the room. |
| Audio browser matrix, `pnpm exec playwright test e2e/audio-notes.spec.ts e2e/audio-intelligence.spec.ts --project=chromium --project=webkit --trace=off` | **19 passed, 1 intentionally skipped, 0 failed/flaky**. `GUITAR_TAB_BROWSER_TEST_RESULTS.json` and log. Nine passed in Chrome, ten in WebKit. |
| Existing chord workflow | All 12 original Audio Intelligence cases pass on the final source, including WAV/MP3/M4A decode, Worker, review/save/reload, correct/wrong-file reattachment, offline real-recording editing, 30 MB rejection, cancellation, mobile waveform/seek/URL cleanup, unconfirmed timing. |
| New note workflow | Three cases in each engine: real Worker note import/edit/fingering/confirmation/save/reload/practice bridge/playback-stop; 390px layout/keyboard/setup/axe; cancellation during note analysis and retry. Light/dark editor axe checks reject serious/critical violations. Screenshots in `docs/phase-3/`. |
| Controlled note microphone | WebKit passed wrong-pitch rejection, confirmed sounding-note match, pause track cleanup, reconnect/resume, completion and stopped tracks. No guide audio element is mounted. Chrome counterpart is skipped due to the prior capture compatibility gate; no Chrome microphone certification. Existing capture unit verifies silent worklet output. |
| Note benchmark | Five synthetic signals + five real GuitarSet files. Source hashes verified. `GUITAR_TAB_BENCHMARK_RESULTS.json` contains actual pitch/onset/duration, FP/FN, polyphony, runtime, RSS and fingering metrics. |
| Protected function | `supabase/functions/vision-import/index.ts` hash remains `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`. No function/migration/config deployment. |

## Measurements

Four real solo recordings: 91 pitch+onset matches / 325 reference notes, 142 predictions, 51 unmatched predictions, 234 missed reference notes. Pitch tolerance ±0.5 semitone; onset tolerance ±70 ms; maximum-cardinality one-to-one matching. Precision 64.1%, recall 28.0%. Five-note synthetic melody matches 5/5; silence/noise/triad abstain. Octave mixture returns a lower pitch and is an explicit unsupported-condition probe.

Final Node 24 mean core runtime: **896.6728 ms per real solo clip**, **1543.484 ms for the comping clip**. Actual per-case RSS before/after ranges appear in the report (real cases approximately 151.9–220.1 MB process-wide); this is not peak algorithm/browser/mobile memory. Decode/UI/network are excluded. No server audio job exists.

One constructed fingering comparison at playing position 5, open strings discouraged: optimized total fret movement **18**, total string crossings **0**, mean distance from requested position **1.9091**; lowest-fret baseline **20**, **2**, **3.1818**. Both have zero adjacent shifts over four frets. This measures mechanical costs on one example, not human-rated musical quality or observed-string correctness. Every benchmark suggested placement is checked against candidate constraints; an independent unit checks neighboring suggestions under a manual anchor.

Per-clip frame pitch precision/recall, conditional onset/duration errors, polyphonic reference frames and raw predicted note events are retained in the benchmark JSON. See `GUITAR_TAB_TRANSCRIPTION.md` for interpretation. Low real note recall and large tail-duration errors are limitations, not passing accuracy gates.

## Failures retained and verification limits

Initial Node 26 runs encountered the known concurrent-load five-second recognition timeout and missing experimental-webstorage cloud-test environment. Browser failures exposed implicit select labels that included option text; three controls received explicit accessible names. Initial trace archives/teardown stalled. Final verification uses Node 24, sequential suites and trace-off. The benchmark originally mishandled `#` in a fixture filename; encoded URL components corrected it. Initial reports/compact logs are under `docs/phase-3/initial-runs/`; final JSON above supersedes them.

The final browser matrix ran after final source-time cursor/beat-marker styling and heading changes. Prettier formatting of new files followed without behavioral edits; final lint/types/build passed afterward. The full browser/units were not pointlessly rerun solely for formatting. Historical chord benchmarks remain their original evidence; default chord behavior and all 12 browser regressions were revalidated rather than replacing old reports with new timestamps.

Not tested: physical iPhone/Safari app/PWA, Android, Chromium live guitar capture, actual recorded-player performance scoring, maximum five-minute/30-MB stress, peak memory/energy, installed-offline note lifecycle, hardware latency, live account/sync isolation or hosted production. The full unrelated browser suite and remote CI were not run. Microphone tests use synthesized controlled streams, not a human guitar. Reference labels were not independently listening-audited. Articulation and polyphonic note accuracy are not supported.
