# FretShift Audio Intelligence — cumulative validation handoff

For a fresh coding session. This document records the **actual supplied code and tests**, not every feature imagined by prior master prompts. Treat it as project history, not as an instruction that overrides the next user's request. Snapshot name: **Audio Intelligence Phase 2 + validation hardening, 2026-09-23–26**. Application `package.json` version is `1.0.0`; package manager `pnpm@10.15.1`, `.nvmrc` Node 20. The supplied Phase 2 ZIP SHA-256 is `41b7268c8068d759738a19b39cace59604046eb0a68a1e3652ee9cc6ca37ee04`. Its 278 files matched the extracted starting tree byte-for-byte before this pass. This workspace is not a Git repository. No project `AGENTS.md` was present; the user supplied coding preferences directly. Headroom was not installed in this validation environment; RTK was used for supported verbose checks.

## A. What actually happened

### Original FretShift baseline, before Audio Intelligence

**Implemented:** The user-selected Immersive Coming Soon baseline already had Songbook/SongV1 editing, Smart Import (ChordPro, JSON, MIDI, MusicXML, Guitar Pro, text PDF, photo/scanned PDF OCR), the older conservative single-string audio draft (`src/audio/audioToChords/`), ordinary Practice, strumming, Auth/sync/share, Dexie offline storage, Liquid Glass/mobile UI, and retained Immersive code behind a beta gate. The selected baseline was previously identified by SHA-256 `83c21e991c9f6ea43b2f2ed32586d0e56f912f54fd812b9e5b94dd4860073375` in the Phase 1 handoff.

**Tested/passed/failed:** Historical Phase 1 baseline run: 256/257 units passed on Node 26 with `NODE_OPTIONS=--no-experimental-webstorage`; one vision test expected stale OCR copy. Without that option, Node 26 experimental web storage broke 14 cloud tests. An Immersive recognition test could time out under concurrent load and passed alone. These are historical results, not this pass's runs.

**Experimental/never implemented:** The older audio draft was not full chord recognition or tab. Baseline had no Audio Intelligence import/review, trained chord model, stem separator, note transcriber, or GPU/server audio job. The user's report that remote Supabase `vision-import` was v7 was not independently verified. The selected local vision function is protected and remained unchanged in Phases 1, 2, and this pass.

### Phase 1 architecture and benchmark

**Implemented:** Separate `src/audio/intelligence/` contracts (`AudioIngestor`, `AudioDecoder`, `BeatAnalyzer`, `ChordAnalyzer`, optional `StemSeparator`/`NoteTranscriber`, orchestrator), local Web Audio WAV/MP3/M4A decode, mono PCM Worker transfer, onset/chroma features, global tempo/beat grid, provisional accent-based meter/downbeats, 192 chord templates with alternatives/unknown spans, provisional unconfirmed measures, and a reviewed Song bridge. No UI caller existed yet. Existing older audio draft and unrelated FretShift flows were retained.

**Tested/passed:** Five focused tests; real browser decode/Worker path on generated WAV/MP3/M4A in Chromium and WebKit; lint/build. Full unit run 261/262 with the known stale vision assertion. The original 11 **synthetic** benchmark cases yielded mean fixed-tempo error 2.0775 BPM, exact time-weighted chord accuracy 0.678 on eight chorded cases, segment IoU 0.5582, 7 missed/0 false chord transitions within 250 ms, and mean core runtime 114.4757 ms. Synthetic vocal-like and full-band-like cases were poor (0 and 0.1812 chord accuracy); generator oracle guitar channels were better (0.9086/0.9250) but are not a separator result. Silence/noise were not mislabeled; a melody got no chord labels. Tempo ramp was weak.

**Failed/experimental/never implemented:** No real-audio corpus or true guitar/ensemble accuracy. Meter and downbeats were tentative. Essentia/Chordino, librosa, BTC/autochord, Demucs/MDX, Basic Pitch, GuitarSet, and Guitar-TECHS were researched, not installed or run. No Import UI, note transcription, tab, server, or deployment was added. Original results: `AUDIO_INTELLIGENCE_PHASE_1_BENCHMARK_RESULTS.json`.

### Phase 2 chords/rhythm implementation

**Implemented:** Import entry, upload/progress/cancel/retry, 30 MB and five decoded-minute caps, player/waveform/loop/zoom, editable chord regions and beat timestamps, meter/downbeat choices, explicit timing confirmation, reviewed SongV1 provenance and exact chord attack seconds, Dexie save/reopen route, ordinary Practice exact clicks for confirmed audio, visual chord-only Immersive guidance, and no synthesized notes/strumming/tab from chord names. Older single-string draft and non-audio Immersive beta gate retained. A pickup conversion bug was fixed. A missing PDF source button was restored; stale browser selectors and vision assertion were updated without changing OCR production code.

**Tested/passed:** Historical Phase 2 full 269/269 unit tests on Node 26 with storage option, lint/build, beta-gate script, and 10/10 Audio Intelligence Playwright cases across Chromium/WebKit, including save/reload, codec decode, cancellation/retry, 390 px URL cleanup, and unconfirmed timing guard. The unchanged 11 synthetic fixtures were rerun: 2.0775 BPM, 0.678 exact label accuracy, 0.5582 IoU, 7/0 transitions, mean core runtime 116.6206 ms. A broader Chromium regression run initially passed 25/29, then each of four stale/missing-entry failures passed targeted reruns; the entire 29 was not rerun after those fixes.

**Failed/experimental/never implemented:** No licensed real recording scored, trained chord provider, real separator, note/tab transcription, physical phone, production deployment, cross-device audio metadata sync, or peak memory study. Filename-only reattachment could accept wrong audio. Whole-file browser decode was not interruptible; no unsaved draft autosave. Chart beat quantization and pickup compromise remained. `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_2_HANDOFF.md` is retained as a historical document; its statements about no fingerprint and no real corpus describe the state **before this pass**. `AUDIO_IMPORT.md` has been updated for the current implementation.

### Optional earlier hardening and Phase 3

No separate post-Phase-2 hardening pass or Phase 3 implementation was found in the supplied ZIP. `GUITAR_TAB_TRANSCRIPTION.md` is absent. `NoteTranscriber` and `NoteEvent` are contracts only; local orchestrator receives no installed note provider and returns `notes: null`. Audio-derived Song measures have no tab. Do not infer Phase 3 from a prompt or a file name.

### Current validation pass

**Implemented:** Four real CC BY 4.0 GuitarSet mono-mic acoustic composition excerpts (93.156 seconds) plus untouched chord/beat annotations and fixture hashes, a reproducible real benchmark, explicit bulk Unknown review, same-file SHA-256 verification for new saved Songs, rejection of different-decision region merges, rejection of a late chord that would otherwise be silently dropped, simpler user copy with technical explanations under Advanced, and this validation documentation. No model/provider change was claimed.

**Tested/passed:** Full Vitest suite passed 271/271 with Node 26 storage option; 14 audio-specific tests within the full suite; lint/TypeScript, Vite build, beta-gate script; 12/12 Playwright audio cases across installed Chrome and Playwright WebKit. The browser checks include a real acoustic clip edited after network loss, oversized file, file fingerprint mismatch/correct reattachment, synthetic upload/review/save/reopen, codec path, pre-aborted retry, 390 px viewport, URL cleanup, and unconfirmed timing guard. The vision-import local hash is still `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`.

**Measured failure:** Real acoustic mean tempo absolute error 25.7925 BPM; beat recall within 70 ms 0.1328; chord root time precision/recall 0.6227/0.0716; exact eligible chord time precision/recall 0.1291/0.0287 over mean 47.42% reference eligibility; root-segment IoU 0.0533; 27 missed/7 false chord changes; 92.42% uncertain coverage. Mean core runtime 307.9879 ms per 14–34 s clip. The provider remains experimental. These numbers cannot justify automatic charts or timing. Full definitions and per-case output are in `AUDIO_INTELLIGENCE_VALIDATION.md` and `AUDIO_INTELLIGENCE_REAL_BENCHMARK_RESULTS.json`.

**Not tested/never implemented:** Real electric or distorted guitar, vocals, bass, drums, full band, two real guitars, tempo change/modulation/triplets, note/polyphonic accuracy, physical iPhone/PWA/Android, low-memory/background/screen-lock behavior, near-limit duration, production deployment, or live two-account isolation. Desktop Playwright WebKit is not physical Safari. Existing cloud tests are mocked/local, not a new live isolation audit.

## B. Current working project and pipeline

User opens **Import → Audio recording**, chooses WAV/MP3/M4A, and gets local Worker-generated chord/time suggestions. They listen and edit chord labels/boundaries, mark Unknown or No chord, optionally bulk-mark unlabeled regions Unknown, edit BPM/beat times/meter/downbeat, then explicitly confirm timing. Saving requires at least one chord, a usable beat grid, and a decision for every unlabeled region. Unknown remains unknown, inferred timing stays unconfirmed until a player checks it, and similarity is not accuracy. The saved Song chart has quantized positions and exact `audioTimeSeconds` plus original/reviewed provenance. Ordinary Practice can use confirmed exact beat clicks; unconfirmed rhythm is not graded. Chord-only Immersive targets are visual and unsupported for note scoring. On reopen, waveform/review data are available without raw audio; reattach the original recording for playback. New saves validate its SHA-256, older songs warn that no fingerprint exists.

Pipeline and ownership:

```text
File → BrowserAudioDecoder (Web Audio, mono PCM) → transferred Worker
  → features.ts (FFT/onset/chroma) → beat.ts + chord.ts
  → provisional unconfirmed measures → AudioIntelligenceReview editor
  → review.ts + song.ts → SongV1 provenance.audioReview and chart events
  → useSongStore → Dexie; optional existing authenticated Song sync
  → Practice/visual Immersive adapters
```

Key modules: `src/audio/intelligence/{types,index,analyze.worker,features,beat,chord,measures,review,song}.ts`; `src/ui/components/AudioIntelligenceReview.tsx`; `src/ui/screens/{Import,AudioReviewScreen,SongDetail,Practice}.tsx`; `src/ui/audio-intelligence.css`; `src/schema/song.v1.ts`/`migrations.ts`; `src/store/songStore.ts`; `src/persistence/dexie/index.ts`; `src/audio/playback/{index,timeline}.ts`; `src/audio/immersive/score.ts`; `src/ui/App.tsx`. Existing cloud/Auth/sync ownership is in `src/cloud/`, `src/sync/`, and `src/persistence/supabase/`; the audio feature adds no new server route, model key, migration, or database table. Other imports, the original audio draft, and strumming remain in place. `supabase/functions/vision-import/index.ts` is unrelated and protected.

Data distinctions: detector `alternatives.score` is template similarity, not probability; `status`/unlabeled coverage describes abstention; real-corpus accuracy is measured offline in benchmark output; `timingConfirmed` is a player's explicit action; `decision`/`reviewed` track correction. A note pitch would not identify a guitar string or fret. Do not collapse any of these states.

## C. Exact changes in this pass

| Bug/root cause | Fix and files | Regression check |
| --- | --- | --- |
| Merging unlike segments kept only first label | `review.ts` rejects unequal labels or different null decisions; review UI surfaces the error | `review.test.ts` |
| Song bridge used `continue` when a chord mapped beyond available measures | `song.ts` raises an actionable beat-grid error | `intelligence.test.ts` |
| Same filename could be wrong recording | `song.v1.ts` optional validated SHA-256, `review.ts` creation argument, `AudioIntelligenceReview.tsx` hash/reattach check with older-song warning | `review.test.ts`, `e2e/audio-intelligence.spec.ts` |
| Hundreds of unlabeled regions made explicit review onerous | Count and bulk Unknown action in `AudioIntelligenceReview.tsx`, without inventing labels | Real-clip offline browser case |
| Prior data only synthetic | Four attributed WAVs/ground truth/`LICENSE` and `README.md`; `scripts/bench-audio-real.mjs`; `package.json` command; real results JSON | Hash verification and repeat benchmark |
| Technical first-run text obscured musical decisions | Primary copy simplified; Worker/classifier details moved under Advanced | 12 browser cases plus code inspection |
| Waveform bars overflowed a narrow track, and child-relative click offsets could seek near the beginning | `src/ui/audio-intelligence.css` allows all bars to shrink; review component uses track-relative pointer coordinates | Narrow-viewport test reproduced x=1065 versus track end x≈348; final Chrome/WebKit checks cover full waveform and 75% seeking |

Matching Unknown/No chord merges also retain their original state, with an added unit test. Reattachment fingerprint completion is guarded against stale selections and unmounts. Final source includes 271 unit tests, with all passing. Final browser JSON reports and desktop/mobile screenshots are retained alongside the summarized evidence.

September 26 verification: full audio browser suite 12/12, followed by 4/4 targeted reruns of the two affected flows after the CSS/seek fix. The full 12-case group was not repeated after that last change. Chrome mobile and WebKit desktop screenshots were visually inspected. A missing WebKit binary and stalled Node 26 archive extraction were local setup issues; the official downloaded archive was unpacked with system `unzip` before the successful raw-report run. This is not a physical Safari/iPhone test.

Updated docs: `AUDIO_IMPORT.md`, `README.md`, `AUDIO_INTELLIGENCE_VALIDATION.md`, this handoff, and `AUDIO_INTELLIGENCE_VALIDATION_TEST_RESULTS.md`. Reran synthetic benchmark into `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json`; preserved Phase 1 original JSON. There were no new dependencies and no changes to the Supabase vision function. Build passed. The expanded Chrome/WebKit audio suite passed 12/12. No live deployment was performed.

## D. Outstanding issues in priority order

1. **P0, recognition:** The deterministic chroma provider leaves 92.42% of labeled real acoustic time uncertain and root recall is 7.16%. Files: `src/audio/intelligence/{features,chord}.ts`, `scripts/bench-audio-real.mjs`. Reproduce: `pnpm bench:audio-real`. Next: validate a stronger lawful chord provider on a wider held-out corpus, preserving complex symbols and abstention; do not ship automatic charts from this baseline.
2. **P0, beat/time:** Real beat recall within 70 ms is 13.28%; tempo error reaches 64 BPM. Files: `src/audio/intelligence/beat.ts`, review UI. Reproduce with real benchmark and inspect per-case beat matching. Next: evaluate better beat/downbeat tracking with labeled variable-tempo and meter data; maintain explicit timing confirmation.
3. **P1, breadth:** Current real set is four acoustic composition excerpts from one player. No measured electric/distortion/ensemble/vocal/multiple-guitar results. Files: `test-fixtures/audio-intelligence/`, benchmark script. Next: acquire licensed annotated strata, including electric, and report per-condition metrics without collapsing them.
4. **P1, memory/cancellation:** Web Audio decodes entire file before Worker transfer and cannot abort mid-decode; SHA-256 reattachment reads the file again. Files: `src/audio/intelligence/index.ts`, review UI. Reproduce on physical mobile with near-30-MB or five-minute files, cancel during decode, background/screen lock. Next: record peak memory/cleanup and set measured limits or a streaming architecture.
5. **P1, live lifecycle/isolation:** Account ownership of derived Song sync and offline/PWA transitions have no live two-account/device audit. Files: `src/cloud/`, `src/sync/`, Dexie, review UI. Next: test sign-in/account switch, interrupted sync, offline reopen, background/foreground, PWA launch and storage pressure with real accounts/devices.
6. **P2, representation:** SongV1 quantizes chart chords; pickup is shown at first chart beat, Unknown/No chord intervals lack ordinary chord events, and general editor changes do not reconcile audio provenance. Files: `src/audio/intelligence/song.ts`, SongV1/editor and practice adapters. Reproduce with pickup/unknown gaps, save, then edit in ordinary Song editor. Next: define reconciliation/explicit gap representation before treating chart events as verified targets.
7. **P2, legacy data/drafts:** Phase 2 songs have no fingerprint; unsaved corrections are lost on navigation. Files: schema/review UI. Next: preserve legacy compatibility with an explicit warning; add local draft recovery if user trials confirm impact.

No server audio job exists, so GPU cancellation, server idempotency/retries/timeouts, temporary upload expiry, server rate limiting/cold-start, and GPU concurrency are **not currently applicable**. The local UI allows one analysis, manual retry, Worker termination, and object-URL cleanup. If a server provider is added, design those controls before accepting uploads.

## E. Next development step: Phase 3 preparation

This is the **post-Phase-2** hardening pass. The next session can begin Phase 3 note and editable tab work without rebuilding chord import/review. First decide how to keep the current weak chord/beat suggestions clearly provisional and measure a stronger provider on more real data. Then reuse the decoder, Worker contract, waveform/review controls, Song provenance, and exact-time adapters to create a versioned note timeline: detected source onset/end seconds and pitch candidates, uncertainty, note-level corrections/confirmation, and separately suggested versus player-chosen string/fret under tuning/capo/playability constraints. Never equate MIDI pitch with observed fingering, never synthesize tab from a chord name, and never score uncertain notes or unconfirmed rhythm as verified hits. A note model such as Basic Pitch remains a candidate only; no model has been evaluated or installed. Saved Songs contain no raw audio, so later sessions need source reattachment or a separately consented retention design.

## F. Continuation commands, environment, deployment, artifacts

From `FretShift-Audio-Intelligence-Phase-2/` (the validation package keeps that source root):

```sh
pnpm install --frozen-lockfile
pnpm lint
NODE_OPTIONS=--no-experimental-webstorage pnpm test  # workaround for this Node 26 host
pnpm build
pnpm bench:audio-intelligence
pnpm bench:audio-real
pnpm exec playwright test e2e/audio-intelligence.spec.ts --project=chromium --project=webkit
node scripts/verify-immersive-beta-gate.mjs
pnpm dev
```

Prefer Node 20 from `.nvmrc` in normal development. Playwright requires installed browser binaries. `pnpm bench:audio-real` reads the four included GuitarSet WAVs/ground truth and writes `AUDIO_INTELLIGENCE_REAL_BENCHMARK_RESULTS.json`; `pnpm bench:audio-intelligence` writes the separate synthetic JSON. Whole-file desktop/browser/hardware metrics are not supplied by the Node benchmark. `AUDIO_INTELLIGENCE_VALIDATION_TEST_RESULTS.md` records this pass's command outcomes.

Audio Intelligence itself has **no environment variables**. Existing optional account and vision integration uses client `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` or legacy `VITE_SUPABASE_ANON_KEY`; server-only `OCR_SPACE_API_KEY`, `ALLOWED_ORIGINS`; vision benchmark `VISION_IMPORT_URL`, `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`, and `FRETSHIFT_USER_ACCESS_TOKEN`. See `.env.example` and `LIVE_INTEGRATION.md`; do not package live credentials. No migration or function deploy is needed for this validation source. Prior FretShift hosted integrations may exist, but this Phase 2 + validation source was **not deployed or production-tested**. Remote `vision-import` v7 status remains user-reported; this pass checked only the unchanged local function hash.

Artifacts to keep together: complete source `FretShift-Audio-Intelligence-Validation-Complete.zip`; separate `FRETSHIFT_AUDIO_INTELLIGENCE_VALIDATION_HANDOFF.md`; separate `AUDIO_INTELLIGENCE_VALIDATION.md`; `AUDIO_INTELLIGENCE_REAL_BENCHMARK_RESULTS.json`; `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json`; `AUDIO_INTELLIGENCE_PHASE_1_BENCHMARK_RESULTS.json`; `AUDIO_INTELLIGENCE_VALIDATION_TEST_RESULTS.md`; raw `AUDIO_INTELLIGENCE_UNIT_TEST_RESULTS.json`, `AUDIO_INTELLIGENCE_BROWSER_TEST_RESULTS.json`, and `AUDIO_INTELLIGENCE_LAYOUT_TEST_RESULTS.json`. The handoff and validation docs are also inside the complete project ZIP, but remain separate files beside it for direct access.
