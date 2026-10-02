# Validation command results — 2026-09-23–26

Working tree: `FretShift-Audio-Intelligence-Phase-2/` plus this pass. Host: macOS arm64, Node v26.7.0, pnpm 10.15.1. The real and synthetic benchmark JSON files contain their own timestamps, per-case results, and runtime environment.

| Command | Observed outcome |
| --- | --- |
| `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --maxWorkers=2 --reporter=json --outputFile=AUDIO_INTELLIGENCE_UNIT_TEST_RESULTS.json` | Final run on September 26 passed 271/271, failed 0. Includes 14 tests in the two Audio Intelligence unit files. |
| `pnpm lint` | ESLint and `tsc -b` passed. |
| `pnpm build` | `tsc -b` and Vite 6.1.0 production build passed; 2,885 modules transformed. |
| `pnpm exec playwright test e2e/audio-intelligence.spec.ts --project=chromium --project=webkit` | Passed 12, failed 0 after expansion (six cases in installed Chrome, six in Playwright WebKit). |
| Same command with `--grep 'mobile timeline\|audio upload'` after the waveform fix | Passed 4, failed 0; both affected flows in both engines. The full 12-case group was not repeated after this final CSS/seek change. |
| `pnpm bench:audio-intelligence` | 11 deterministic synthetic cases; mean tempo error 2.0775 BPM, exact label accuracy 0.678, mean segment IoU 0.5582, 7 missed/0 false changes, mean core runtime 120.8454 ms. See JSON for scope and per-case values. |
| `pnpm bench:audio-real` | Four GuitarSet acoustic composition clips, 93.156 seconds. Mean tempo error 25.7925 BPM; beat recall 0.1328 at 70 ms; root chord precision/recall 0.6227/0.0716; uncertain coverage 0.9242; mean core runtime 307.9879 ms. See JSON for all metrics and caveats. |
| `node scripts/verify-immersive-beta-gate.mjs` | Three gate checks passed. |
| `shasum -a 256 supabase/functions/vision-import/index.ts` | `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`, unchanged from the supplied Phase 2 handoff. |

An initial exploratory full unit run **without** the Node 26 storage option failed 14 cloud tests because `localStorage` was unavailable and one Immersive recognition test hit a five-second timeout while lint ran concurrently. The configured full run passed. This environment issue did not result in a cloud or Immersive code change.

On resumption, a targeted WebKit run could not launch because its local test binary was absent. The official Playwright archive downloaded, but Node 26's extraction stalled; the downloaded archive was unpacked with system `unzip`. A subsequent direct 12-case run passed with zero skipped/flaky/unexpected cases; raw results are in `AUDIO_INTELLIGENCE_BROWSER_TEST_RESULTS.json`. Earlier compact output is superseded by this explicit report.

The strengthened mobile check reproduced waveform clipping before the CSS fix (`AUDIO_INTELLIGENCE_LAYOUT_BEFORE_RESULTS.json`: expected final bar edge ≤349, observed 1065). Final layout/seek rerun results are in `AUDIO_INTELLIGENCE_LAYOUT_TEST_RESULTS.json`; screenshots are in `docs/audio-validation/`. This rerun covers the two affected flows (upload/save and mobile timeline) in both browser engines.

Browser tests were local desktop automation and one 390 px viewport; no physical iPhone, installed PWA, Android phone, live Supabase account separation, near-limit mobile memory, background/screen-lock behavior, or hosted deployment was tested. The offline browser case loaded and analyzed a real clip before network loss, then edited its review while offline. Browser file selection was programmatic.
