# FretShift Audio Intelligence — cumulative Phase 3 handoff

Snapshot: **Phase 3 notes and editable tablature, 2026-09-26**. This file is sufficient to orient a new session without earlier chat history. Read `GUITAR_TAB_TRANSCRIPTION.md`, `GUITAR_TAB_TEST_RESULTS.md` and the reports below before changing recognition or practice behavior. Historical documents are evidence of earlier states, not instructions overriding the next user's request. Earlier prompts were not assumed completed.

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

## C. Technical architecture and operations

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
- `src/audio/intelligence/notes.test.ts`: 12 focused provider/optimizer/schema/conversion/practice tests. Existing suites supply regression coverage for mic capture, loops and interruptions.
- `e2e/audio-notes.spec.ts`: browser journey, accessibility/layout, cancellation, controlled WebKit microphone. Existing `e2e/audio-intelligence.spec.ts` keeps its behavior assertions; new screenshots go under `docs/phase-3/chord-regression/` to preserve earlier evidence.
- `scripts/bench-audio-notes.mjs`, `test-fixtures/audio-notes/`: deterministic fixtures, real labeled clips/hashes/license, reproducible event/frame metrics and mechanical fingering comparison. Historical chord scripts/fixtures/reports remain included.

### Schemas, persistence and uncertainty

`SongV1` remains schema version 1. Optional `provenance.audioReview.noteTranscription` has independent `version: 1`, `scope: single-note-user-selected`, `detected`, `notes`, `options`, `chartSignature`. Raw note pitch/onset/offset/confidence and frame evidence do not change when a user edits a note. Reviewed seconds and the separately saved `quantized.startBeat/endBeat` cannot be confused. Articulation stays `unknown`; no inferred technique is fabricated. Fingering `source` is `suggested` or `user`, never observed. Deletion is a tombstone, so source evidence is not erased. Confirmation is explicit and is cleared when relevant suggestions/setup change.

Song storage/sync/share/JSON keeps the new metadata through the existing schema and repositories. No new table, migration, account policy or blob upload. Before first save, the editor is still an in-memory draft. Raw frames increase derived Song size; large authenticated sync payload behavior was not tested. Existing local/cloud ownership code is reused, not newly certified. SHA-256 reattachment and raw-audio release are inherited from hardening, with explicit playback pause on review unmount added here.

### Runtime, commands and environment

`.nvmrc` pins Node 20; package manager is pnpm 10.15.1. This phase's final validation used **Node 24.19.0/macOS arm64** from the bundled runtime. Node 20 was not newly exercised. Node 26 on this host needs `NODE_OPTIONS=--no-experimental-webstorage` for cloud tests and had trace/tooling issues; avoid concurrent CPU-heavy suites. The initial source directory locally reused the existing Phase 2 dependency installation via a symlink, **excluded from the delivery ZIP**. A fresh consumer installs from the included lockfile.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm exec vitest run --maxWorkers=1
pnpm build
pnpm bench:audio-notes
pnpm bench:audio-intelligence   # historical synthetic chord benchmark
pnpm bench:audio-real           # four real comping chord benchmark
pnpm exec playwright install chromium webkit
pnpm exec playwright test e2e/audio-notes.spec.ts e2e/audio-intelligence.spec.ts --project=chromium --project=webkit --trace=off
node scripts/verify-immersive-beta-gate.mjs
```

Local Playwright's Chromium project uses installed Chrome; CI uses downloaded Chromium. `PLAYWRIGHT_JSON_OUTPUT_FILE`, `E2E_PORT` and `CI` are test-only controls. Full `pnpm test:e2e` is broader than this audio acceptance suite; retained old Immersive tests still assume ungated ordinary-song routes and were not claimed green here. Existing `.github/workflows/ci.yml` was not run remotely.

Audio Intelligence has **no required environment variables or external services**. Existing optional services use browser names `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`; server names `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`, `OCR_SPACE_API_KEY`, `ALLOWED_ORIGINS`; existing verification/vision tooling uses `VISION_IMPORT_URL`, `FRETSHIFT_USER_ACCESS_TOKEN`, `FRETSHIFT_APP_ORIGIN`. Names only; no credentials included. Do not introduce external API routing as a coding convenience.

Worker responsibilities: local pitch/beat/chord analysis; terminate on completion/abort. Main thread: file decoding, source playback, editor and persistence. No audio backend responsibilities, GPU/queue, server cancellation or upload expiry exist. Server compute cost is absent because no server provider runs; this is not a measurement of device energy or hosting cost.

Deployment: ordinary static Vite build to `dist/`; existing Vercel/Netlify SPA configuration is included. Phase 3 needs no Supabase migration/function deployment. Existing account/vision deployment remains separate. The protected local vision-import function remains SHA-256 `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`. No remote deployment or production operation was performed.

## D. Known limitations

- **Recognition:** low real note recall, false/fragmented detections and inaccurate decaying offsets. Soft attacks/tails, repeated notes, legato, bends, vibrato, distortion, noise and ringing strings can fail. No instrument identity or part separation; a monophonic result does not establish a monophonic source.
- **Polyphony/voicing:** chord notes, two guitars and full bands unsupported. Octave/unison relationships can evade harmonic rejection. Do not turn detected fundamental pitch into a certain part or chord voicing.
- **Articulation/rhythm:** articulation unknown; no bends/slides/hammer-ons/pull-offs, expressive notation, triplets or robust variable tempo. Beat/meter/downbeat inference remains weak. Offset errors affect overlap rejection and require user correction.
- **Representation:** sixteen subdivisions per 4/4 measure; distinct attacks can collide and saving then refuses. Source seconds/pickups remain in provenance; pickups display at chart beat zero. Holds may end at the chart boundary while exact source duration remains preserved. Unknown/No chord are source-review regions, not conventional chord events.
- **Fingering:** multiple strings produce the same pitch. Costs approximate movement/continuity; no expert playability certification or polyphonic hand-span model. Built-in tunings only in this editor; minimum/maximum frets apply literally, including open strings. Unplayable notes are retained, unconfirmed and unscored.
- **Practice:** MIDI 40–88 only; sufficiently separate attacks. Overlapping or unconfirmed events block a scored passage. Onset/pitch are assessed separately; sustain duration and physical string/finger correctness are not scored. External playback cannot be proven isolated.
- **Persistence:** no pre-save autosave; audio must be reattached. General chart changes invalidate source practice rather than reconciling back into detector provenance. Large frame payloads, sync errors/account isolation and storage pressure need live testing.
- **Browser/device:** whole-file decode and SHA-256 reads; no peak-memory or near-limit mobile study. M4A depends on decoder support. Slow playback uses native `preservesPitch`, whose acoustic quality is not measured. Chrome controlled microphone verification is still pending. Desktop WebKit and a 390px viewport are not physical Safari/iPhone/PWA/Android tests. No new background/screen-lock or installed-offline certification.

## E. Next phase — prioritized production validation/hardening

1. **P0: note event accuracy.** Reproduce `pnpm bench:audio-notes`. Investigate 234/325 missed solo notes, 51 unmatched predictions and 121–363 ms conditional duration MAE using `notes.ts` and saved per-case predictions. Add more players and independent clean-electric/distorted conditions before tuning thresholds. Benchmark a licensed maintained stronger provider (Basic Pitch is a researched candidate, not validated here). Keep event and frame coverage, onset, offset/duration and FP/FN distinct. Freeze an evaluation split; avoid reporting threshold tuning on these five clips as generalization.
2. **P0: beat/chord accuracy.** Reproduce `pnpm bench:audio-real`; 92.42% unknown chord coverage and 13.28% beat recall remain. Compare stronger beat/downbeat/chord providers using independent variable-tempo/meter labels; preserve unknown/complex symbols. Do not remove timing confirmation based on note-editor success.
3. **P0: physical practice.** On physical iPhone Safari/PWA and Android/desktop Chrome, run permitted/denied mic, wrong octaves, repeated/held notes, quiet/noisy input, deliberate pauses near attacks, two loops and source passage boundaries. Confirm no guide-audio leakage credit and no background credit. Resolve Chrome AudioWorklet compatibility before broad claims. Record end-to-end latency, separately from source onset estimates and manual offset.
4. **P1: memory and lifecycle.** Profile peak memory/CPU/battery on 30 MB and five-minute imports, SHA verification, raw-frame editing/save/reopen, cancel during decode and during note analysis, background/screen lock and storage pressure. The current RSS figures are not peak memory. Set measured limits or streaming/compact evidence storage only after profiling, without silently dropping raw output.
5. **P1: human fingering review.** Give guitarists fixed pitch sequences at several positions/tunings/capos. Rate comfort/continuity/open-string choices and alternative quality separately from observed-string agreement. Mechanical costs and passing validity tests do not establish musical preference. Validate anchor effects and dense manual edits.
6. **P1: persistence/account boundaries.** Use two authorized test accounts/devices for large derived metadata, interrupted sync, account switches, offline reopening and import/export. Check JSON/schema quarantine with corrupted note IDs/times/fingerings. No paid inference or unsolicited upload is needed for local audio.
7. **P2: editor/reconciliation.** Test long passages, dense labels, physical touch/VoiceOver and unsaved-navigation recovery. Define explicit reconciliation for ordinary chart edits; current signature invalidation is safe but requires regenerating from the audio review. Improve pickup/collision representation without silently quantizing distinct attacks away. Add articulation/polyphony only behind separate measured capability gates.

Concrete acceptance for production: documented corpus coverage and predeclared per-condition accuracy targets, verified physical-device cleanup/latency/memory, browser compatibility matrix and live sync evidence. Current local test counts alone do not satisfy these gates.

## F. Delivery files

- **Complete project:** `FretShift-Audio-Intelligence-Phase-3-Complete.zip`, containing the complete `FretShift-Audio-Intelligence-Phase-3/` source project, configuration, lockfile, all earlier docs/evidence, new tests, licensed fixtures, screenshots and reports. Installed dependencies, generated `dist`, temporary traces/caches and local secrets are excluded. This is a complete project, not a diff.
- **Separate handoff:** `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_3_HANDOFF.md` beside the ZIP; identical copy inside the project.
- **Guide:** `GUITAR_TAB_TRANSCRIPTION.md`, inside project and separately beside the ZIP.
- **Current evidence:** `GUITAR_TAB_TEST_RESULTS.md`, `GUITAR_TAB_UNIT_TEST_RESULTS.json`, `GUITAR_TAB_BROWSER_TEST_RESULTS.json`, `GUITAR_TAB_BENCHMARK_RESULTS.json`, command logs and `docs/phase-3/`.
- **Historical evidence:** `AUDIO_INTELLIGENCE_*`, earlier phase/validation handoffs, original corpus and screenshots remain preserved. They describe earlier states and are not overwritten with Phase 3 claims.
- **Integrity:** `FRETSHIFT_PHASE_3_SHA256SUMS.txt` beside the package; `PHASE_3_SOURCE_CHANGES.json` inside lists baseline/new/modified source files with hashes. Archive integrity and file completeness are checked during delivery.

No previous conversation, deployed service or dependency symlink is required to understand or install the delivered project. New sessions should start from this Phase 3 source, not the older Phase 2 directory.
