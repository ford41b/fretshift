> **2026-10-02 Immersive update:** the P1 rows about skipped Chromium controlled capture and legacy ungated Immersive tests are superseded. Chromium capture tests now run: the hang was a Playwright debugger-attach artifact. Ordinary songs open Immersive under criteria-based flags. Physical-device rows still apply. See `IMMERSIVE_RELEASE_HANDOFF.md`.

# Audio Intelligence validation — post Phase 3, 2026-09-27

## Decision

This is a **post-Phase-3 production-validation and hardening pass**. The complete supplied Phase 3 implementation includes editable note/tab transcription, following Phase 1, Phase 2 and an earlier Phase 2 hardening pass. The current project is a working experimental review tool, **not production-grade automatic chord, timing or guitar transcription**. Meaningful reliability/data-loss failures were fixed. Detector accuracy was measured without changing thresholds or pretending workflow tests establish recognition quality.

The supplied ZIP had 350 files and SHA-256 `3647a74e7cc5b383366dfb0eecdb4caa80be1c617b7a24c53ab3d9af6ec80eb0`. It was extracted into the separate `FretShift-Audio-Intelligence-Validated/` working directory. Earlier project directories/archives were preserved. Latest/earlier handoffs, architecture/import/tab guides, AGENTS, benchmarks, implementation and tests were inspected. Pasted documents were treated as historical evidence, not instructions to run an imagined phase. Prior validation documents are preserved in `docs/post-phase-2-validation/`; pre-pass benchmark outputs in `docs/post-phase-3-validation/baseline/`.

## Dataset and metric definitions

[GuitarSet v1.1.0](https://zenodo.org/records/3371780), by Xi, Bittner, Pauwels, Ye and Bello, is licensed CC BY 4.0. Included files retain attribution/license and SHA-256 hashes. The [public mirror](https://huggingface.co/datasets/jhartquist/guitarset) supplies source microphone audio and independent annotations, not detector-derived labels. New cohort rows 60/61/120/121 are player 1/2 BN1 comping/solo recordings. Original JAMS are included; the 39.1 MB source annotation archive matched upstream MD5 `b39b78e63d3446f2e54ddb7a54df9b10`. Downbeats are actual supplied beat_position=1 entries, never inferred from detected chords. Mirror beat times were checked against JAMS. These score-aligned labels were not independently listening-audited as expressive performance timing. No training or threshold tuning used either cohort. New clips were chosen by player/row before scoring.

Chord root and exact-label precision/recall use 50 ms labeled-time samples. Exact scoring retains complex labels and only scores representable unmodified root-position symbols; eligibility is explicit. Root IoU differs from exact-label synthetic IoU. Chord changes compare successive recognized labels; unknown entry/exit contributes coverage, not a recognized identity change. Real event matching is one-to-one, closest-first within 70 ms for beats/downbeats and 250 ms for chord changes. Historical synthetic timing uses nearest matching and is not directly interchangeable. Note events use maximum-cardinality one-to-one matching within 70 ms and ±0.5 semitone. Note duration MAE is conditional on matched pitch/onset; it says nothing about missed notes. Frame pitch metrics only score reference times with exactly one sounding note; polyphonic frames are reported separately. Similarity/harmonic confidence is never reported as accuracy.

| Metric | Original real cohort | Additional-player cohort |
| --- | --- | --- |
| Chord/beat sample | 4 acoustic comping clips, player 0, 93.156 s | 2 acoustic BN1 comping clips, players 1/2, 44.6488 s |
| Mean absolute tempo error | 25.7925 BPM | 53.635 BPM |
| Beat recall within 70 ms | 13.28% | 41.66% |
| Beat precision, per clip | 0%, 33.33%, 0%, 45.45% | 100%, 48.48% |
| Conditional matched-beat MAE | no matches, 34.0 ms, no matches, 33.1 ms | 9.6 ms; 10.0 ms |
| Downbeat matching within 70 ms | Not measured: original extract lacks downbeat labels | 0/12 and 2/12 reference downbeats; precision 0% and 18.18%, recall 0% and 16.67%; 12.9 ms MAE on only two matches |
| Chord root time precision / recall | 62.27% / 7.16% | 100% / 8.08% |
| Exact eligible chord time precision / recall | 12.91% / 2.87%, mean eligibility 47.42% | 0% / 0% on player 1 (100% eligible); player 2 has no eligible exact reference time (recall null), so no exact recognition claim there |
| Mean root-matched segment IoU | 0.0533 | 0.0499 |
| Missed / false chord changes, 250 ms | 27 / 7 | 10 / 0 |
| Mean uncertain chord coverage | 92.42% | 91.93% |
| Solo note sample | 4 clips / 325 reference notes | 2 clips / 118 reference notes |
| Pitch + onset matches, ±0.5 semitone / 70 ms | 91 matches, 142 predictions: precision 64.08%, recall 28.00% | 93 matches, 115 predictions: precision 80.87%, recall 78.81% |
| False / missed solo note events | 51 / 234 | 22 / 25 |
| Per-clip matched-note onset MAE | 33.76–44.77 ms | 41.30 / 35.93 ms |
| Per-clip matched-note duration MAE | 120.86–362.56 ms | 89.50 / 110.60 ms |
| Monophonic reference-frame coverage | 19.51–57.24%; pitch precision/recall separately in JSON | 71.06% / 75.18%; pitch precision/recall separately in JSON |
| Unsupported comping note probe | 12/133 matches, 28 predictions | 13/259 matches, 41 predictions; not supported polyphonic transcription |


The unchanged 11 synthetic chord cases still yield 2.0775 BPM mean tempo error, 0.678 exact-label time accuracy, 0.5582 exact-label IoU and 7 missed/0 false changes. They are generated signals, not recordings of electric guitar, singers or a band. Five synthetic note controls yield five correct melody events, abstention on silence/noise/triad, and a lower pitch from an octave mixture. The latter is an explicit limit: a returned fundamental does not prove an isolated guitar part. Synthetic oracle guitar channels remain generator ground truth, not a measured separator.

## Coverage matrix

| Condition | Actual evidence |
| --- | --- |
| Acoustic guitar, solo riffs and comping/polyphony | 12 unique actual GuitarSet recordings across 3 players; constant annotated tempo. Six solo clips scored for note events; comping note probes explicitly unsupported. |
| Extended / slash / repeated / offbeat chords | Complex real labels preserved and reference eligibility reported. Constructed review/conversion tests cover slash names, extensions, repeats and offbeat source seconds. This does not prove automatic recognition of each subtype. |
| Open/barre chord shapes; fingerpicking versus strumming | Not independently labeled/audited in this evaluation. Acoustic comping alone does not establish these strata. |
| Clean electric / distortion / vocals / bass / drums / full band / multiple guitars | Generated approximation/mixture fixtures or constructed cases only; no representative actual recordings tested. |
| Rests / noise / silence / repeated notes | Synthetic controls and note-review/practice unit checks. |
| Tempo changes | Synthetic tempo-ramp probe only; actual variable-tempo tracking not validated. |
| Triplets / syncopation / modulation | No dedicated labeled-condition validation. Style names are not a coverage claim. |
| String/fret correctness / playability | Exact-pitch constraints and existing mechanical fingering example; no observed-string accuracy or human preference evaluation. |

## Performance, memory and cost

All measurements use Node 24.19.0/macOS arm64 or local desktop browsers. Current mean core runtime: original real chords 935.75 ms/clip; original solo notes 1027.18 ms/clip; new chords 458.24 ms/clip; new solo notes 1782.76 ms/clip. These exclude browser decode/UI/network and vary with machine load; no speedup is claimed. Per-case process RSS before/after is included, not peak.

Five-minute Node stress: core analysis 22.10 s; conversion 187.35 ms; process CPU 21.05 s; process high-water RSS 320.47 MiB, including Node/Vite/fixture and conversion. This is not per-algorithm memory or mobile peak. Five-minute browser PCM16 file: 26,460,044 bytes at 44.1 kHz. Chrome decode+Worker completed in 29.03 s, WebKit 17.79 s; local persistence 342.4 / 417 ms. Each retained 29,933 frames, 300 notes and about 4.195 MB of derived Song JSON, and reopened in the UI. Synthetic stress events stayed unconfirmed. Tests injected browser files/programmatic PCM, not a native OS picker or physical guitar. Browser/device peak memory, energy and hardware latency remain unmeasured.

Trained-model runtime is not applicable: no trained model runs. Audio server compute cost is $0 because there is no audio server/GPU job. This does not price browser energy, static hosting or existing account sync.

## Fixes and safeguards

| Problem / root cause | Change | Regression evidence |
| --- | --- | --- |
| Already-aborted requests still decoded; cancellation after decode still copied PCM | `src/audio/intelligence/index.ts`: check cancellation before read/decode and after native decode, before downmix | `lifecycle.test.ts`: no decode for pre-abort, no channel reads after in-flight cancellation, context closes |
| Worker could wait indefinitely; transfer failures leaked abort listeners; unreadable results lacked a handler | Same file: two-minute Worker deadline, message-error rejection, one `finally` cleanup for timeout/listener/handlers/termination | Stalled Worker fake clock, postMessage failure, error/message-error, cancel/retry tests; browser navigation through intentionally stalled Worker |
| Reopened saves replaced entire Song with a fresh generated Song, clearing artist/tags/other metadata | `AudioIntelligenceReview.tsx`: retain existing Song metadata and replace reviewed musical fields; preserve existing tuning/capo for chord-only reviews | Browser sets artist/tags/difficulty override, saves two corrections, reloads, verifies one Song and unchanged metadata |
| Reopened first-beat field always began at zero | Same component: initialize from saved reviewed beat 0 | Browser verifies 0.1-second phase after reopen |
| Temporary playback URL existed even for rejected/cancelled files | Same component: revoke old URL immediately; create new URL only after successful analysis/fingerprint; final cancellation message permits retry | Existing cancellation/retry and URL-cleanup browser tests, lifecycle tests |
| Chord-only persisted audio lacked cross-field timing/region validation | `src/schema/song.v1.ts`: finite evidence/timing values, ordered in-source grid, valid tempo/first measure, unique nonoverlapping regions, explicit Unknown/No chord label consistency | Seven malformed chord-only records rejected; valid legacy chord record accepted |
| Raw note identity/time, frame order/bounds and quantized offsets could be malformed | Same schema + `src/schema/audioNotes.ts`: validate raw IDs/source bounds, increasing frames, finite hop/window and positive quantized intervals; use a Set for detector linkage | Six malformed detector/quantization cases rejected; full persistence/cloud/schema suite passes |
| Note editor required knowledge of MIDI numbers | `AudioNoteEditor.tsx`: native note-name selector; technical quantization/evidence under Advanced | Chrome/WebKit pitch-edit, keyboard and light/dark axe tests |
| Chord-only progress displayed a note stage that never ran | `AudioIntelligenceReview.tsx`: show only applicable stages | Existing chord import workflows |
| Real validation covered only player 0 and lacked extracted downbeat labels | Four additional attributed GuitarSet mic clips from players 1/2, original JAMS, raw labels/checksums. Existing benchmarks accept optional fixture/output paths; real chord benchmark scores supplied downbeats and verifies JAMS hashes | Independent cohort reports, unchanged historical-fixture recognition scores, source MD5/SHA verification |

Existing broader browser tests now wait for initial Smart Strumming persistence before asserting playback leaves a Song unchanged, and match the current unconfigured photo-import status. These are test corrections; ordinary playback and vision code remain untouched.

New validation tools are `scripts/bench-audio-stress.mjs`, `scripts/verify-audio-offline.mjs`, `e2e/audio-validation.spec.ts`, and `src/audio/intelligence/lifecycle.test.ts`. Existing review/note tests gained trust-boundary regressions. Existing audio browser screenshots now write under this pass's evidence directory; historical images remain intact. No recognition thresholds, provider, dependency, server, migration or vision function changed.


Recognition confidence, analysis coverage, measured transcription accuracy, timing confirmation and user corrections remain separate. Raw detected frames/events survive edits; a fingering is suggested or user-selected, never observed. Unknown/No chord and extended labels remain distinct. Unconfirmed/uncertain/overlapping/unsupported notes cannot earn practice credit. Inferred timing cannot become a verified rhythm grade. Raw recording retention remains session-only; derived metadata may follow existing authenticated Song sync.

## Browser, reliability and deployment scope

Desktop Chrome and Playwright WebKit were exercised at desktop and 390px widths, with keyboard/axe checks and inspected screenshots. Note pitch now uses musical names; quantization and raw classifier details are under Advanced. Desktop layout is readable; dense very short chord regions still need a better compact presentation. No Safari desktop application, physical iPhone Safari, installed iPhone PWA or Android Chrome was tested.

File-selection injection, codec fixtures, over-30-MB rejection, cancellation/retry, Worker timeout/error cleanup, navigation cancellation, saving/reopening, fingerprint rejection, offline review and the five-minute boundary were tested. Production offline checks exercise cached-shell reload, local analysis, edits/save/reopen and source reattachment/playback: Chrome uses offline emulation; WebKit uses an unreachable origin after stopping the preview server, because its offline-emulation navigation failed. Exact Vercel analytics script errors from the preview SPA fallback are retained and excluded from audio assertions; deployed analytics was not tested. See the test summary for diagnostics and the upstream WebKit issue. Simulated hidden/visible events check controlled WebKit microphone cleanup and reconnect; actual OS background suspension, screen lock, low-memory termination and battery behavior remain untested. Account isolation coverage is existing mocked/local tests, not a live two-account audit. There is no audio upload to interrupt; interrupted authenticated metadata sync remains untested live.

One UI analysis runs at a time; retry is manual and saves reuse the Song ID. Workers have a two-minute deadline and terminate on completion/cancel/error. Native decode cannot be interrupted mid-call; post-decode cancellation avoids downmix and Worker work. There is no model cold start, server queue, GPU, temporary upload, upload expiration, server rate limit or server job authentication path to certify. Future server inference must implement those controls before use. No deployments occurred. The entire Supabase subtree remains identical to the input ZIP; protected local vision-import SHA-256 is `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`.

See `AUDIO_INTELLIGENCE_VALIDATION_TEST_RESULTS.md` for exact run counts, failures and reruns. Full-repository browser CI remains limited by obsolete ungated Immersive tests and the unresolved existing WebKit desktop strumming click. The broader executed subset is 58 passed/1 unresolved across the original run and targeted reruns; it is not reported fully green.

## Outstanding work

| Priority | Problem and evidence | Affected files; reproduction; next action |
| --- | --- | --- |
| P0 release gate | Beat/chord recognition remains poor. Original real cohort: 92.42% uncertain chord time and 13.28% beat recall; additional cohort: 91.93% uncertain time, 53.635 BPM mean tempo error, and 2/24 downbeats matched. | `src/audio/intelligence/{features,beat,chord}.ts`, provider contracts. Run both real chord commands below. Evaluate a stronger licensed provider on an independently frozen corpus; retain manual timing/chord decisions. This requires provider research/evaluation, not a safe threshold-only patch. |
| P0 release gate | Real note coverage varies sharply: original solo recall 28.0%, additional two-player BN1 cohort 78.8%; matched duration errors remain material. These are small, different-condition cohorts, not evidence of a general accuracy improvement. | `notes.ts`, `noteReview.ts`, `scripts/bench-audio-notes.mjs`. Run both note commands, inspect stored predictions and false/missed events. Broaden instrument/style/player coverage and compare a stronger provider before releasing automatic transcription. Do not remove confirmations. |
| P1 | Physical iPhone Safari/PWA, Android, Safari desktop application and real-guitar microphone behavior are not verified; Chromium controlled capture remains skipped by the inherited compatibility gate. | `audio/immersive/{microphone,recognition}.ts`, `e2e/audio-notes.spec.ts`. On actual hardware check permission, repeated notes, noise, wrong octaves, interruption, lock/resume, cleanup and end-to-end latency. Desktop WebKit is not hardware evidence. |
| P1 | Whole-file native decode cannot be interrupted mid-call and has no native abort API/decode deadline. Cancelling now prevents subsequent downmix/Worker, but cleanup awaits browser resolution. Five-minute derived data is about 4.2 MB; 80-step undo and full-library cloning could amplify memory. | `audio/intelligence/index.ts`, `store/songStore.ts`, `schema/song.v1.ts`. Run five-minute stress and profile actual device peak memory, repeated edits and low-memory eviction. Consider compact raw-evidence storage or reduced measured limits only after profiling. Worker deadline is 120 seconds while browser timers run; OS suspension can delay timer delivery. |
| P1 | Live sync ownership, interrupted remote writes, account switching and large metadata payloads are unverified. Existing tests use local fakes/mocked service responses. Offline-first local library is device-scoped, not a separate library per account. | `cloud/`, `sync/`, `persistence/{dexie,supabase}/`. Use two authorized test accounts/devices; verify RLS and owner pins, interrupted sync and sign-out/account switch. No live credentials or remote mutation were used here. |
| P1 browser gate | Existing WebKit desktop strumming disclosure click fails after reload at 1280px in both broad and focused runs; surrounding card/select/main intercepts the click. Chrome desktop and the mobile test passed. Later diagnostic attempts timed out during local server/dependency loading, so the hit-test cause remains unresolved. | `e2e/strumming.spec.ts:49`, `src/ui/strumming.css`, `StrummingPattern.tsx`. Run the 1280px strumming case with WebKit; inspect disclosure bounds, scroll restoration, elementFromPoint and real Safari behavior. Evidence: `browser-regressions-rerun.json`, `strumming-follow-up.json`. No speculative CSS or forced-click workaround was applied. |
| P1 CI | Legacy `e2e/immersive.spec.ts` assumes ungated ordinary-song routes. The deliberate beta gate remains. Full repository `pnpm test:e2e` is not certified green. | `e2e/immersive.spec.ts`, `ui/App.tsx`, CI. Update the old test fixtures/entry expectations to current reviewed-audio routes while retaining explicit tests of the ordinary-song gate. Do not remove the beta gate to satisfy obsolete tests. |
| P2 | Unsaved transcription corrections still disappear on navigation; no pre-save draft recovery. | `AudioIntelligenceReview.tsx`. Edit without saving and navigate away. Add bounded local recovery only with explicit retention/cleanup semantics. Saved corrections now preserve artist/tags and beat phase. |
| P2 | General chart edits invalidate note practice instead of reconciling source data. Quantized pickups/dense attacks remain limited; collisions refuse save. Very short chord regions overlap visually in a dense timeline. | `noteReview.ts`, `notePractice.ts`, `song.ts`, editor/CSS. Reproduce with pickup or same-slot attacks, or alter ordinary tab after saving. Define reconciliation and a usable dense-region view without dropping source events. |
| P2 | No articulation recognition, polyphonic note support, exact voicing/observed string inference, human-rated fingering, or sustain-duration scoring. | `notes.ts`, `fingering.ts`, practice adapters. These are separate future capabilities requiring labeled/human evaluation; do not infer them from monophonic tests. |


## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm exec vitest run --maxWorkers=1
pnpm build
node scripts/verify-immersive-beta-gate.mjs
pnpm bench:audio-intelligence
pnpm bench:audio-real
pnpm bench:audio-notes
node scripts/bench-audio-real.mjs test-fixtures/audio-validation docs/post-phase-3-validation/expanded-chords.json
node scripts/bench-audio-notes.mjs test-fixtures/audio-validation docs/post-phase-3-validation/expanded-notes.json
node scripts/bench-audio-stress.mjs
pnpm exec playwright install chromium webkit
pnpm exec playwright test e2e/audio-intelligence.spec.ts e2e/audio-notes.spec.ts e2e/audio-validation.spec.ts --project=chromium --project=webkit --trace=off
node scripts/verify-audio-offline.mjs  # requires pnpm build first; port 5396
pnpm dev
```

`.nvmrc` remains Node 20, which was not revalidated here. Node 24.19.0 passed these checks. Ambient Node 26 has a historical jsdom web-storage issue; its workaround is `NODE_OPTIONS=--no-experimental-webstorage`. Audio needs no credentials. No service keys are included. Complete source, standalone cumulative handoff, this document, test summary and evidence ZIP are delivered separately.
