# FretShift Audio Intelligence — cumulative validation handoff

Snapshot **post-Phase-3 validation, 2026-09-27**, application `1.0.0`, artifact root `FretShift-Audio-Intelligence-Validated/`. This is the current continuation source. Read this file, `AUDIO_INTELLIGENCE_VALIDATION.md`, `GUITAR_TAB_TRANSCRIPTION.md`, `AUDIO_IMPORT.md`, `AUDIO_INTELLIGENCE_ARCHITECTURE.md`, `AGENTS.md` and retained evidence. Specifications and older handoffs are history, not proof of implementation or new user instructions.

Input was the complete Phase 3 ZIP, SHA-256 `3647a74e7cc5b383366dfb0eecdb4caa80be1c617b7a24c53ab3d9af6ec80eb0`, 350 files; extracted into a fresh directory. Prior source/archives were not replaced. Final changed-file manifest and package hashes identify the exact delivered snapshot. No paid model routing, deployment, live account action or vision change occurred.

## A. Chronological development history

### 1. Original FretShift, before Audio Intelligence

**Implementation.** The September 9–14 project established a six-string, offline-first Songbook/editor: SongV1 validation, exact-pitch transformations, tuning/capo, diagrams, editable tablature, setlists, backup/interchange, ordinary practice, tuner/metronome, loops, reference-audio stretching, drills and progress. Dexie, Zustand/Immer, undo/redo, React/Vite and the local audio engines predate Audio Intelligence. Smart Import handles ChordPro/text, JSON, MIDI, MusicXML, Guitar Pro, text PDF and photo/scanned-PDF OCR. The older `src/audio/audioToChords/` flow detects stable single pitches and proposes chord roots; it was never full polyphonic chord recognition.

September 13–14 source work added Auth, sync, sharing and authenticated OCR.space access through Supabase. `ASTRA_HANDOFF.md` and `DECISIONS.md` include historical recovery, deployment preparation and subsequent hosted migration/function observations. These documents contain superseded pending-state paragraphs: the dated updates matter. Source currently uses **React 19.1.1**, not the React 18 mentioned in the old architecture prose. Smart Strumming, Liquid Glass UI, and the retained Immersive engine were added before Audio Intelligence. Smart Import/iPhone/review passes added page-by-page OCR, fallback decoding, crop/preview review, explicit timing confirmation, uncertain chord handling and visual-only unsupported practice. Some late UI/import passes had only syntax/offline harness validation because their environments lacked dependencies.

**Verified historically.** Early checkpoints recorded 88 offline unit tests/19 Chrome tests, then September 13's 123 unit and 51 browser tests with mocked cloud/vision services. Smart Strumming recorded 222 full units plus a focused final case (223 total), 8 rhythm browser cases, an offline production check and 30 Chromium/unconfigured browser cases. Original Immersive recorded 252 full units, 10 controlled WebKit cases and 4 targeted Chromium checks, plus a WebKit offline production test. The local code contains the corresponding schemas, parsers, DSP, persistence and tests. These numbers describe historical snapshots, not cumulative tests performed in Phase 3.

**Measured historical result.** The Immersive synthetic benchmark identified 18/18 harmonic plucks, with stable identity available about 132–135 ms after synthetic onset; that is not live guitar accuracy or hardware latency. Pitch scoring was deliberately limited to clear single notes, MIDI 40–88, with no chord/voicing score and no speaker guide in scored mode.

**Failures/unverified/unresolved.** Earlier packaging builds had PDF.js/type/lint failures later corrected; later UI-only snapshots sometimes could not run a full build. A Chrome AudioWorklet startup issue on that host prevented a full scored-input certification; the app times out and cleans up. Physical iPhone/PWA, broad guitar accuracy, cross-device/live cloud isolation, long-file memory and full production acceptance were not established. Supabase deployment entries are historical observations; remote `vision-import` v7 was user-reported in the audio handoffs, not independently verified by the audio phases. The pre-audio “Coming Soon” beta gate was deliberately retained for ordinary songs.

**Selected Audio Intelligence baseline.** Phase 1's user-selected Coming Soon ZIP had SHA-256 `83c21e991c9f6ea43b2f2ed32586d0e56f912f54fd812b9e5b94dd4860073375`. The baseline unit run recorded 256/257, with a stale OCR error-copy assertion. Node 26 without the storage workaround failed 14 cloud tests; an Immersive test could time out under concurrent load. The user did not select an older similarly named Review Fixes archive.

Sources retained: `BUILD_SPEC.md`, `ASTRA_HANDOFF.md`, `DECISIONS.md`, `TODO.md`, `STRUMMING_ENGINE.md`, `IMMERSIVE_PRACTICE.md`, `IMMERSIVE_VISUAL_REFRESH.md`, `REVIEW_FIXES.md`, `SMART_IMPORT_UPGRADE.md`, `SMART_IMPORT_IPHONE_FIX.md`, `LIQUID_GLASS_MERGE.md`, `IMMERSIVE_BETA_GATE.md`, and deployment/integration notes. A specification or acceptance checklist is not proof that its features were completed.

### 2. Phase 1 — architecture and benchmarks

**Implementation.** Added separate provider contracts for ingestion, decode, beat/chord analysis, optional separation and optional note transcription; a local transferred-PCM Worker; onset/FFT/chroma features; global tempo/beat grid; tentative meter/downbeats; 192 chord templates with alternatives/unknown spans; provisional unconfirmed measures; and a reviewed Song bridge. There was no UI caller. Other imports, the older single-string draft and existing practice remained.

**Verified/tests.** Five new focused cases, lint/build and browser WAV/MP3/M4A decode/Worker in Chromium and WebKit. Full units 261/262 with the known OCR string assertion. No trained recognizer or external audio job was used.

**Measured.** Eleven deterministic **synthetic** fixtures: mean fixed-tempo error 2.0775 BPM; exact time-weighted chord accuracy 0.678 across eight chorded cases; segment IoU 0.5582; 7 missed/0 false transitions within 250 ms; mean core runtime 114.4757 ms. Synthetic vocal-like/full-band-like chord accuracy was 0/0.1812. Oracle generator-provided guitar channels performed better, but were not separator output. Noise/silence abstained; melody did not invent chords; tempo ramp was weak. Original output: `AUDIO_INTELLIGENCE_PHASE_1_BENCHMARK_RESULTS.json`.

**Unverified/failures/unresolved.** No real corpus, note transcriber, tab, deployed model/server, phone or GPU measurement. Essentia/Chordino, librosa, BTC/autochord, Demucs/MDX, Basic Pitch, GuitarSet and Guitar-TECHS were researched, not installed/run. Import/review/save was unfinished. Meter/downbeat reliability and mixed-audio recognition remained weak.

### 3. Phase 2 — chord/rhythm MVP

**Implementation.** Added Import entry, upload/progress/cancel/retry, waveform/player/loop/zoom, editable chord regions and beats, explicit Unknown/No chord decisions, BPM/meter/downbeat/timing review, Song provenance, exact chord attack seconds, Dexie save/reopen, confirmed exact-time ordinary Practice and chord-only visual Immersive access. The latter is an exception to the beta gate only for audio-review songs. Chord names do not generate tab, strums or scored chord targets. Limits reduced to 30 MB/five decoded minutes. Pickup conversion fixed; missing text-PDF entry and stale test selectors/assertions corrected without changing OCR production logic.

**Verified/tests.** Historical 269/269 units, lint/build, beta-gate script, 10/10 audio browser cases. A broader Chromium run initially passed 25/29; four stale/missing-entry failures passed targeted reruns, but the complete 29 was not rerun afterward.

**Measured.** Same unchanged 11 synthetic definitions: 2.0775 BPM, 0.678 chord accuracy, 0.5582 IoU, 7/0 transitions and mean core runtime 116.6206 ms. Algorithm accuracy had not improved; runtime change alone was run variation.

**Unverified/failures/unresolved.** No real corpus or notes/tab provider. Same-filename reattachment could accept wrong audio. Whole-file decode was not abortable mid-decode; unsaved review drafts lacked autosave. Chart quantization/pickups and general-editor/provenance reconciliation were limited. No physical device, production deployment, live sync isolation or peak-memory validation.

### 4. Intermediate validation/hardening — September 23–26

This pass **did occur**, after Phase 2 and before Phase 3. It is not hypothetical work copied from a prompt.

**Implementation.** Added four real CC BY 4.0 GuitarSet acoustic comping clips, independent labels/hashes and real benchmark. Fixed silent loss when merging unlike chord regions and when late chords mapped outside the grid. Added explicit bulk Unknown, same-file SHA-256 verification, stale async reattachment guards, simpler normal-user copy, full-width mobile waveform bars and track-relative seeking. No new trained provider, separator, note transcriber or backend.

**Verified/tests.** 271/271 units, lint/build and gate checks; 12/12 Chrome/WebKit audio browser cases. After the final waveform fix, 4/4 affected flows were rerun; the entire 12 had not been rerun after that final fix. Screenshots and raw JSON are included. These were desktop/simulated-width checks, not physical Safari.

**Measured failures.** Four real comping clips, 93.156 seconds, one player: mean tempo absolute error 25.7925 BPM; beat recall at 70 ms 0.1328; chord-root precision/recall 0.6227/0.0716; exact eligible chord precision/recall 0.1291/0.0287 over mean 47.42% reference eligibility; root-segment IoU 0.0533; 27 missed/7 false chord changes; 92.42% uncertain coverage. Mean core runtime 307.9879 ms. Synthetic rerun kept the same musical scores, mean runtime 120.8454 ms. No real downbeat ground truth in that extract. These results require preserving review/confirmation gates.

**Unverified/unresolved.** Electric/distorted/multiple guitars, vocals/full band, variable tempo/triplets, physical devices, maximum-duration memory, PWA lifecycle, live cloud ownership and production deployment. No notes/tab existed. `NoteTranscriber` was only a contract and the default result was `notes: null`.

**Phase 3 input verification.** All 299 files in `FretShift-Audio-Intelligence-Validation-Complete.zip` matched the existing extracted Phase 2 tree before changes. All 15 entries in the separate evidence ZIP match the preserved reports/screenshots. Complete-input SHA-256: `c471baefe505d6d9af84b4144c195538fe13aa2a0b1b1bfe2a76e216c8e26779`; evidence-input SHA-256: `e729d849f621ce758e865a4855ae9315e1a8713bce962339c895a4d23676372a`. Phase 3 was extracted into its own directory; original archives/trees were not replaced. No on-disk project AGENTS.md existed; the user's session-supplied coding policy was followed and is included as `AGENTS.md` now.

### 5. Phase 3 — notes and editable tablature

**Implementation.** Opt-in `YinNoteTranscriber` runs inside the existing Worker using existing YIN/FFT harmonic classification. Every raw output frame and detected note remains separate from reviewed note pitch/timing, uncertainty, deletion, confirmation, articulation (unknown), fingering and quantized musical timing. A dynamic program suggests constrained single-note fingering paths; manual placements anchor neighbors. The source-aligned six-string UI offers note selection, alternatives, fret/pitch edits, onset/duration edits, add/delete, uncertainty/confirmation, guitar setup, waveform cursor, playback, pitch-preserving slow playback and loops. Notes-only conversion works without inventing chords. Confirmed notes become Song tab; drafts persist in provenance. Exact-source practice adapters handle speed, passage boundaries and holds without using rounded chart attacks. Stale general-chart edits invalidate support. Ordinary guided Practice does not collect microphone evidence for these note transcriptions; silent Immersive scores only supported confirmed single notes.

**Verified/tests.** Final full suite **283/283 units** under Node 24.19.0, including 12 new focused cases. Final audio browser matrix **19 passed, 1 deliberately skipped**: all 12 pre-existing chord cases plus six note editor/Worker cases across Chrome/WebKit and one WebKit controlled microphone case. Chrome's controlled microphone counterpart is skipped pending a separate capture gate. Checks cover save/reload/fingerprint, codec/Worker, offline chord edits, cancellation/retry, mobile width, keyboard selection, light/dark note-editor accessibility, exact-time practice, wrong pitch, pause/reconnect and cleanup. ESLint/TypeScript, production build and beta-gate script pass. Desktop/tab/dark/mobile screenshots in `docs/phase-3/` were inspected. No physical hardware claim follows.

**Measured.** Five synthetic signal cases and five actual labeled acoustic clips. Synthetic separated/repeated melody: 5/5 note pitch+onset matches; silence/noise/triad: zero output notes. An octave mixture still returns a lower note, demonstrating the inability to certify a single part. Four real solo clips: 91/325 pitch+onset matches (±0.5 semitone, ±70 ms), 142 predictions, 51 unmatched predictions and 234 missed notes; event precision 64.1%, recall 28.0%. Per-clip matched-note duration MAE about 121–363 ms. Conditional monophonic-frame pitch precision 88.7–97.1%, recall 18.9–54.1%; high precision with low coverage is not robust transcription. Comping probe: 12/133 matches, 28 predictions, 16 unmatched, 121 missed. `GUITAR_TAB_BENCHMARK_RESULTS.json` gives exact runtime/RSS, onset/duration, polyphonic strata and mechanical fingering-path metrics. No measurements were fabricated.

**Failures and resolutions during this pass.** A benchmark filename containing `#` was initially treated as a URL fragment; percent-encoding fixed the harness. First browser selectors had ambiguous implicit names (select option text included); explicit accessible labels fixed them. Node 26 reproduced the historical missing-webstorage tests and a concurrent recognition timeout; partial trace archives also impeded failure teardown. Final gates use Node 24, sequential execution and browser trace-off. Initial-run evidence is retained separately. A shared `.measure` CSS rule thickened waveform beat bars; local marker geometry was reset and final browser checks passed.

**Unverified/incomplete/unresolved.** Recognition coverage and duration quality are not production-ready. Articulation detection, polyphonic notes, instrument separation, exact voicing, bend/slide/hammer-on/pull-off notation, custom tuning creation inside this editor, human-rated fingering quality, sustain-duration performance grading, autosave before first Song save, full bidirectional chart reconciliation, physical-device peak memory, maximum-length stress and live production/cloud validation remain incomplete or unmeasured. No trained Basic Pitch comparison was run. No new backend/dependency or deployment was made.


### 6. Current post-Phase-3 validation — September 26–27

Implemented decoder cancellation boundaries, bounded Worker lifecycle/cleanup, preserved Song metadata and saved beat phase, stronger persisted audio/note integrity checks, note-name pitch editing/Advanced details, and an additional-player acoustic benchmark with original downbeat annotations. No detection thresholds or musical provider were replaced. See section C for root causes and exact fixes.

Actual passing checks: 304 unit tests; lint/types/build; beta gate; 23 final short audio browser cases plus two earlier five-minute desktop cases; 2 production-offline engine runs; broader browser report with 58 passes and 1 unresolved failure. Chrome controlled microphone remains intentionally skipped. Initial 15 regression failures and browser failures/resolutions are preserved in evidence, not erased. Full ungated legacy Immersive browser suite/remote CI was not certified.

Original recognition scores reproduced unchanged. Additional two-player BN1 solo clips matched 93/118 reference notes with 115 predictions (80.87% precision, 78.81% recall), compared with original 91/325 (64.08%, 28.00%). Different cohorts explain the difference; no improvement/generalization claim. New comping chord results remain weak: 91.93% uncertain time, exact eligible matching zero, mean tempo error 53.635 BPM and only 2/24 reference downbeats matched. This still blocks production automatic-transcription claims. Current validation contains all separate metrics.

Five-minute desktop decoding, analysis, save/reopen worked; raw evidence produced roughly 4.2 MB per Song. Node peak process RSS was 320.47 MiB. Physical mobile peak memory/energy, real electric/ensemble data, actual hardware practice, live sync isolation, pre-save autosave, stronger learned models, articulation and polyphony remain unimplemented or unverified. Do not repeat completed Phase 3 as the next task.

## B. Current capabilities — precise scope

| Area | Current behavior and boundary |
| --- | --- |
| Audio import | Local WAV/MP3/M4A, 30 MB/five minutes, Web Audio decode, transferred PCM Worker, progress/cancel/retry. Decode cannot be interrupted mid-call. Codec fixture path passes both engines. |
| Beats | Global onset-based grid, suggested meter/downbeats. User can rebuild/edit/confirm. Real results remain weak; no automatic timing confirmation. |
| Chords | Original chroma/templates, alternatives and abstention unchanged. Editable labels/regions; Unknown distinct from No chord; voicing needs confirmation. No separator or exact voicing. |
| Measures | Reviewed beat map plus selected downbeat/meter; ordinary Song grid is quantized. Source times stay separate. Pickup chart representation is limited. |
| Notes | Opt-in monophonic YIN, original frame/event evidence retained; editable pitch/onset/end, all initial events uncertain/unconfirmed. Not a polyphonic or multi-guitar transcriber. |
| Tab/fingering | Six source-aligned strings, alternate placements, user anchor influence, built-in tuning/capo/available strings/fret range/position preferences, unplaced notes preserved. No observed string claim. |
| Song conversion | Explicit save through validated SongV1/Dexie, optional existing sync. Confirmed playable notes project into tab. Quantization collisions/invalid fingering raise errors. Unconfirmed/deleted/raw note data persist. |
| Ordinary Practice | Exact-time confirmed guide notes and reviewed beat clicks. Note-transcription microphone evidence collection disabled because this mode outputs guide audio. Tuner remains available. |
| Immersive | Audio-review route; confirmed nonoverlapping MIDI 40–88 notes can score sounding pitch. Rhythm needs confirmed timing and supported spacing. Learn does not grade timing. Chord-only remains visual. No scored accompaniment. General non-audio beta gate retained. |
| Reopen | Source waveform, detector evidence and corrections restored from Song. Original file must be hash-verified for playback; no raw recording retention. |

### Technical architecture and operations

```text
File → BrowserAudioDecoder → mono PCM + display waveform + source SHA-256
  → analyze.worker.ts / LocalAnalysisOrchestrator
    → existing features/beat/chord/provisional measures (unchanged)
    → optional YinNoteTranscriber → raw frames + detected notes
  → createAudioReview + createNoteTranscription
  → AudioIntelligenceReview + AudioNoteEditor
    → reviewed seconds/pitch/confirmation + fingering dynamic program
  → audioReviewToSong → reviewedAnalysisToSong → applyNotesToSong
    → SongV1 with optional versioned noteTranscription and confirmed tab
  → useSongStore → flushPersistence → Dexie → optional existing Song sync
  → audioNotePlan → playback/practice/Immersive using exact source timing
```

### Ownership and source files

- `src/audio/intelligence/{types,index,analyze.worker}.ts`: contracts, opt-in flag (`AnalysisUpdates.transcribeNotes`), stage messages, decode/Worker lifecycle. Default chord invocation still returns `notes: null`.
- `src/audio/intelligence/notes.ts`: offline signal-processing provider and raw frame/note segmentation. `src/audio/pitch/index.ts`, `src/audio/immersive/recognition.ts`, `src/audio/onset/index.ts` are reused unchanged.
- `src/schema/audioNotes.ts`: optional versioned raw/reviewed notes, confidence, fingering and constraints. `src/schema/song.v1.ts`: attachment plus persisted-data cross-field validation. `src/schema/migrations.ts`: existing validation path, no new schema migration.
- `src/audio/intelligence/fingering.ts`: exact candidates and dynamic-program path, user anchors; no lowest-fret-only shortcut.
- `src/audio/intelligence/noteReview.ts`: source-beat interpolation, quantization, validation, confirmed tab projection, stale-chart signature. `review.ts`/`song.ts`: reuse chord bridge, accept notes-only charts and attach note projection without discarding chords.
- `src/ui/components/AudioNoteEditor.tsx`, `AudioIntelligenceReview.tsx`, `src/ui/audio-intelligence.css`: guitar configuration, aligned tab/editor, source player and cleanup; raw frames are not recopied on each UI edit. `src/ui/screens/Import.tsx`: entry copy; existing AudioReviewScreen/SongDetail routes reused.
- `src/audio/intelligence/notePractice.ts`: exact target/event timing, overlap/unconfirmed/stale rejection. `audio/immersive/score.ts`, `audio/playback/{index,timeline}.ts`: adapters. `ui/screens/{Immersive,Practice}.tsx`: scope explanations/guide-evidence guard. Capture/recognition/scorer matching logic remains intact.
- `src/audio/intelligence/notes.test.ts`: 18 focused provider/optimizer/schema/conversion/practice tests. Existing suites supply regression coverage for mic capture, loops and interruptions.
- `e2e/audio-notes.spec.ts`: browser journey, accessibility/layout, cancellation, controlled WebKit microphone. Existing `e2e/audio-intelligence.spec.ts` keeps its behavior assertions; current screenshots go under `docs/post-phase-3-validation/browser/` to preserve earlier evidence.
- `scripts/bench-audio-notes.mjs`, `test-fixtures/audio-notes/`: deterministic fixtures, real labeled clips/hashes/license, reproducible event/frame metrics and mechanical fingering comparison. Historical chord scripts/fixtures/reports remain included.

### Schemas, persistence and uncertainty

`SongV1` remains schema version 1. Optional `provenance.audioReview.noteTranscription` has independent `version: 1`, `scope: single-note-user-selected`, `detected`, `notes`, `options`, `chartSignature`. Raw note pitch/onset/offset/confidence and frame evidence do not change when a user edits a note. Reviewed seconds and the separately saved `quantized.startBeat/endBeat` cannot be confused. Articulation stays `unknown`; no inferred technique is fabricated. Fingering `source` is `suggested` or `user`, never observed. Deletion is a tombstone, so source evidence is not erased. Confirmation is explicit and is cleared when relevant suggestions/setup change.

Song storage/sync/share/JSON keeps the new metadata through the existing schema and repositories. No new table, migration, account policy or blob upload. Before first save, the editor is still an in-memory draft. Raw frames increase derived Song size; large authenticated sync payload behavior was not tested. Existing local/cloud ownership code is reused, not newly certified. SHA-256 reattachment and raw-audio release are inherited from hardening, with explicit playback pause on review unmount added here.


### Current operational changes

The decoder checks AbortSignal before file work and after native decoding. Worker execution has a 120-second timer; all paths clear handlers/listeners/timer and terminate it. Browser suspension may delay timers; native decode still has no mid-call abort/deadline. Rejected/cancelled analysis no longer creates a playback object URL. Session File retention permits explicit retry; raw audio is not persisted.

All saved audio timelines, not only note timelines, validate tempo/grid/region constraints at SongV1 load. Invalid incoming JSON is rejected/quarantined by existing consumers; valid prior chord/note saves remain supported. New checks reject malformed raw note/frame evidence and reversed quantization; no silent repair is performed. Artist/tags/difficulty override and unrelated metadata survive transcription correction saves. Note editing uses named pitches while saved MIDI remains exact; technical chart quantization is under Advanced.

## C. Changes, bugs, proof and build

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


Final unit count 304; lint/types/build passed. Current measured benchmark and browser results are in `AUDIO_INTELLIGENCE_VALIDATION.md` and `AUDIO_INTELLIGENCE_VALIDATION_TEST_RESULTS.md`. `docs/post-phase-3-validation/` holds raw before/after/final JSON, logs, screenshots, stress and offline measurements. `VALIDATION_SOURCE_CHANGES.json` lists new/modified delivered files relative to the exact supplied ZIP (excluding the two self-describing manifest files). Source and lockfile are complete; installed dependencies/build caches are not included.

## D. Outstanding work, severity and next actions

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


## E. Next development step

Continue **post-Phase-3 accuracy, performance and release-readiness work**. Do not rebuild the chord review or note/tab editor. First freeze a wider licensed corpus and predeclare per-condition targets, compare stronger beat/chord/note providers within the existing contracts, and independently audit annotation conventions. Keep manual correction/confirmation gates while those results are inadequate. Then resolve physical mobile/Chromium capture, peak-memory and live sync gates with authorized accounts/devices. Restore full CI by updating legacy browser fixtures to the deliberate beta-gate design; do not remove safeguards to make tests pass. A new server/GPU provider is a separate architecture/privacy/cost decision with authenticated bounded jobs, not an implied requirement of this local hardening pass.

## F. Continuation environment and commands

Use `FretShift-Audio-Intelligence-Validated/` from the delivered ZIP. `package.json` is 1.0.0; pnpm 10.15.1 and its frozen lockfile are included. `.nvmrc` pins Node 20; current verification used Node 24.19.0/macOS arm64. Node 20 was not retested. Ambient Node 26 requires the historical `NODE_OPTIONS=--no-experimental-webstorage` workaround for cloud tests. Prefer serial CPU-heavy gates for stable results. Install dependencies normally; this delivery has no node_modules symlink requirement.

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

Optional test controls: `E2E_PORT` chooses dev ports (base and base+1), `PLAYWRIGHT_JSON_OUTPUT_FILE` saves raw results, `CI=1` selects downloaded Chromium instead of installed Chrome. `verify-audio-offline.mjs` starts/stops a localhost production preview on 5396. Chrome uses offline emulation; WebKit is tested with the origin stopped due to its recorded offline-emulation error. The report retains local-preview analytics errors; only that exact unrelated telemetry URL is excluded from audio assertions. The explicit broader regression command is recorded in `browser-regressions.log`; full `pnpm test:e2e` also contains the legacy ungated Immersive suite and is not claimed green. Keep source frozen during browser tests: Vite development reloads can invalidate injected microphone fixtures.

Audio Intelligence needs **no environment variables**. Existing optional client integrations: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`. Existing server integration: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`, `OCR_SPACE_API_KEY`, `ALLOWED_ORIGINS`. Existing verification/vision tooling: `VISION_IMPORT_URL`, `FRETSHIFT_USER_ACCESS_TOKEN`, `FRETSHIFT_APP_ORIGIN`. Names only; no credentials are supplied or needed for local audio checks.

Static Vite build outputs `dist/`; included Vercel/Netlify configuration is historical. This validation source was not deployed. All Supabase files remain byte-identical to the Phase 3 input. The vision function's local SHA-256 is `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`; remote v7 remains earlier user-reported state, not newly checked. No migration/function/config deploy is needed for these changes.

Headroom was unavailable; RTK handled supported verbose commands. Regex-sensitive checks used safe subprocess argument arrays with full log capture after an RTK wrapper quoting failure. Existing Playwright was used because agent-browser CLI was absent. No external paid coding/model route was configured. This workspace was treated as an extracted snapshot, not a newly published repository.

## G. Separate delivery artifacts

Files beside one another in `Audio-Intelligence-Validation-2026-09-27/`:

1. `FretShift-Audio-Intelligence-Validation-Complete.zip` — entire current project (source/config/lockfile/tests/licensed recordings/all histories and evidence), not a patch.
2. `FRETSHIFT_AUDIO_INTELLIGENCE_VALIDATION_HANDOFF.md` — this cumulative standalone handoff; identical copy in project.
3. `AUDIO_INTELLIGENCE_VALIDATION.md` — current validation and limitations; identical copy in project.
4. `AUDIO_INTELLIGENCE_VALIDATION_TEST_RESULTS.md` — test summary and failures/reruns.
5. `FretShift-Audio-Intelligence-Validation-Evidence.zip` — standalone current test/benchmark outputs and screenshots, plus directly accessible benchmark JSON files.
6. `FRETSHIFT_VALIDATION_SHA256SUMS.txt` — final artifact integrity hashes.

Earlier Phase 1/2/3 handoffs, original baseline `ASTRA_HANDOFF.md`, phase guides and previous benchmark evidence remain included. Earlier post-Phase-2 validation documents are preserved under `docs/post-phase-2-validation/`; their statements that Phase 3 is absent are historical only. Continue from this current source without needing the prior conversation.
