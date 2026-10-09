# FretShift Audio Intelligence — Phase 1 handoff

This document is for a **new Sol/Astra coding session with no access to the prior conversation**. Phase 1 is the **first Audio Intelligence phase**. Do not infer that the Phase 2 import/review flow already exists.

## A. Original project state

The user selected `/Users/gaultneyfamily/Downloads/FretShift-Immersive-Beta-Coming-Soon (1).zip` as the exact source baseline (SHA-256 `83c21e991c9f6ea43b2f2ed32586d0e56f912f54fd812b9e5b94dd4860073375`). It was unpacked to `/Users/gaultneyfamily/Documents/ChatGPT/Fretshift/FretShift-Video-Import`. The prompt's phrase “Immersive Practice & Smart Import Fixes” did **not** mean the similarly named older Review Fixes or Build Fix ZIP; the user explicitly confirmed the attached Coming Soon ZIP. No repository or archive `AGENTS.md` exists. The user's supplied AGENTS instructions were followed.

Protected existing systems: Songbook/editor and `SongV1`; Smart Import (ChordPro, JSON, MIDI, MusicXML, Guitar Pro, PDF/photo OCR); the original conservative single-string audio draft; ordinary and Immersive Practice; strumming; account/Auth/sync/share; offline Dexie storage; Liquid Glass/mobile UI. Relevant entry points are `src/ui/screens/Import.tsx`, `src/ui/components/AudioChordReview.tsx`, `src/audio/audioToChords/`, `src/schema/song.v1.ts`, `src/store/songStore.ts`, `src/persistence/dexie/index.ts`, `src/audio/playback/`, `src/audio/immersive/`, `src/sync/engine.ts`, and `src/cloud/`.

The existing Supabase `vision-import` function is **reported by the user as v7**. Its remote deployment version was not independently queried. The local `supabase/functions/vision-import/index.ts` is unchanged from the selected ZIP (SHA-256 `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`). No Supabase function, migration, or config file was edited or deployed.

Known pre-existing test issue: `src/vision/client.test.ts` expects `/Could not reach the vision service.*allowed web origin/`, while the unchanged implementation returns a different actionable message (“Could not reach the visual OCR service…”). On the untouched baseline, 256/257 tests passed with Node 26's experimental web storage disabled. Without `NODE_OPTIONS=--no-experimental-webstorage`, 14 cloud tests fail because `localStorage` is undefined on this host's Node 26 setup; this is an environment workaround, not a product-code fix. A pre-existing immersive recognition test exceeded Vitest's 5-second timeout only when run concurrently with a build and benchmark; it passed alone in 1.6 seconds of test work.

## B. What Phase 1 actually completed

### Architecture and code

`src/audio/intelligence/` is a separate experimental local analysis path. Its contracts split file ingestion, audio decoding, beat analysis, chord analysis, stem separation, note transcription, and orchestration. Browser decoding validates WAV/MP3/M4A filenames and size, decodes through Web Audio, downmixes to mono, and sends transferred PCM to a Worker. The local Worker reuses FretShift's FFT to extract onset and chroma features; deterministic providers estimate a global tempo/beat grid, possible accent-based downbeats, chord segments with alternatives/unknowns, and provisional measures with `timingConfirmed=false`. No audio or API key is uploaded. The `licensed-url` input contract rejects until a lawful provider exists.

The explicit vocabulary is 12 roots × 16 suffixes (192 labels), including `Cadd9`, `Fmaj7`, and `Bm7b5`. Low similarity, small winning margin, noise, monophonic evidence, and short unstable regions remain unlabeled with alternatives for review. Similarity scores are not probabilities or accuracy. `reviewedAnalysisToSong()` creates a valid existing Song only from an explicitly supplied reviewed timeline: beat times, first downbeat, meter, chord labels, and timing-confirmation state. Unsupported chord spelling is rejected; extensions are preserved. No automatic save or Immersive scoring was added.

The older audio-import UI and algorithm remain intact. **Phase 1 code is callable and browser-tested, but it is not yet surfaced in the import screen.** That UI integration is Phase 2.

### Providers researched, not run

Essentia/Chordino chroma and beat-conditioned chord methods, librosa beat tracking, Demucs/MDX separation, a BTC chord model, autochord, Basic Pitch, GuitarSet, and Guitar-TECHS were reviewed. See `AUDIO_INTELLIGENCE_ARCHITECTURE.md` for primary links and decisions. No pretrained model, GPU worker, stem separator, or note transcriber was installed or evaluated. In particular, autochord's documented 25 labels cannot preserve extended chords, and the original Demucs repository is archived. The Phase 1 code uses no paid provider.

### Benchmarks and verification

`pnpm bench:audio-intelligence` generates and scores 11 deterministic **synthetic** PCM cases (8–16 seconds) with ground-truth chords, beats, downbeats, and melody notes supplied independently by the fixture generator. Cases represent acoustic-like, clean-electric-like, distorted, vocal-like mix, full-band-like mix, repeated progression, extended chords, silence, noise, single-note melody, and tempo ramp. These are not real instrument or vocal recordings. The recorded `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json` run on this Mac/Node 26 reports:

- Mean absolute tempo error: **2.0775 BPM** on cases with one ground-truth tempo. The tempo ramp is excluded from this number; its beat error is measured separately.
- Mean exact time-weighted chord-label accuracy: **0.678** across the eight chorded cases. Mean per-chord segment IoU: **0.5582**. Total missed/false transitions: **7 / 0** at a 250 ms matching window. These are synthetic-case metrics, not expected production accuracy.
- Mixture chord-label accuracy: vocal-like **0.0000**, full-band-like **0.1812**. On generator-provided **oracle guitar channels**, the same analyzer reaches **0.9086** and **0.9250**. This is an upper-bound synthetic diagnostic, **not** a Demucs/MDX benchmark or deployable separator.
- Silence and noise yielded no estimated beats or chord labels; the monophonic melody yielded no estimated chord labels. Ambiguous regions remain visible. On the tempo ramp, global tempo error is null by design; beat recall within 70 ms is 0.50 and downbeat recall is 0.25 in the recorded case.
- Mean local core analysis runtime: **114.4757 ms** across the 11 short synthetic clips when benchmarked alone. The report records per-case process RSS before/after; it is **not peak algorithm memory**. External provider cost is $0; local power and hosting cost were not priced. Note accuracy is null because no note provider ran.

Validation: `pnpm lint` passed; `pnpm build` passed; new focused Vitest suite **5/5** passed. Full Vitest under `NODE_OPTIONS=--no-experimental-webstorage` passed **261/262**, with only the pre-existing vision message test failing. The existing immersive recognition suite passed **8/8** when rerun alone after a resource-contention timeout. The real browser decode + Worker check passed **2/2** (Chromium and WebKit); generated 44.1 kHz WAV, MP3, and M4A all completed in both engines. Browser codec checks prove this fixture path, not arbitrary codec/profile support. No mobile hardware or real-guitar test was performed.

### Exact project files changed from the selected ZIP

Modified: `README.md`, `package.json`.

Added: `AUDIO_INTELLIGENCE_ARCHITECTURE.md`, `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json`, `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_1_HANDOFF.md`, `scripts/bench-audio-intelligence.mjs`, `e2e/audio-intelligence.spec.ts`, `src/audio/intelligence/analyze.worker.ts`, `src/audio/intelligence/beat.ts`, `src/audio/intelligence/chord.ts`, `src/audio/intelligence/features.ts`, `src/audio/intelligence/index.ts`, `src/audio/intelligence/intelligence.test.ts`, `src/audio/intelligence/measures.ts`, `src/audio/intelligence/song.ts`, `src/audio/intelligence/types.ts`, `test-fixtures/audio-intelligence/README.md`, `test-fixtures/audio-intelligence/fixtures.mjs`, `test-fixtures/audio-intelligence/manifest.json`, `test-fixtures/audio-intelligence/codec-c-major.wav`, `test-fixtures/audio-intelligence/codec-c-major.mp3`, `test-fixtures/audio-intelligence/codec-c-major.m4a`.

No production or development dependency was added. FFmpeg 9.0.1 was used once to encode the checked-in codec test fixtures; FFmpeg is not required to install, run, benchmark, or build FretShift.

## C. Unfinished work and limitations

- The upload → analysis → editable timeline → confirmed Song flow is **not yet built**. The existing audio import still runs the older conservative algorithm.
- No trained chord model or measured real-recording accuracy. The local chroma baseline performs badly on the synthetic vocal/full-band mixtures. It cannot infer inversion, unsupported extension, instrument identity, strings/frets, or guitar technique. Estimated 3/4 on some synthetic 4/4 cases and has only a global beat grid; all downbeats/meter must be confirmed.
- No real Demucs/MDX separator, with/without model comparison, GPU/server cost, upload/retention policy, or Basic Pitch note output. The oracle stem result cannot be used as a production prediction.
- No real acoustic/electric/full-band corpus was acquired. GuitarSet and Guitar-TECHS are candidates for the next evidence gate; verify licensing, sample identity, annotations, and splits before scoring. Do not present current synthetic results as real-world accuracy.
- Whole-file Web Audio decode can consume substantial memory for large files despite the 150 MB file and 15-minute duration caps. Abort stops the analysis Worker but not an in-progress browser decode. Mobile Safari and long recordings remain unverified.
- The one existing vision-client test mismatch remains. Supabase v7 remote status is user-reported, not independently verified. No remote deployment or live Supabase check was done.

## D. Technical continuation context

Key new files: `src/audio/intelligence/types.ts` (provider/result contracts), `index.ts` (local ingestor, browser decoder, orchestrator, Worker entry API), `analyze.worker.ts`, `features.ts`, `beat.ts`, `chord.ts`, `measures.ts`, `song.ts` (reviewed Song bridge). `scripts/bench-audio-intelligence.mjs` loads the core via existing Vite SSR; `test-fixtures/audio-intelligence/` holds the manifest, deterministic generator, and three codec fixtures. `e2e/audio-intelligence.spec.ts` tests browser decoding/Worker. The existing import UI is `src/ui/screens/Import.tsx` + `src/ui/components/AudioChordReview.tsx`; existing persistence is `useSongStore` → `songsRepo` → Dexie, and timing safety for Immersive is in `src/audio/immersive/score.ts` and `src/ui/screens/Immersive.tsx` / `ImmersiveBeta.tsx`.

Local responsibilities: file validation/decoding, waveform/playback, Worker analysis, alternatives, edits, and draft persistence. No Phase 1 server responsibility exists. A future authenticated server/GPU provider must be opt-in, protect user audio and model keys, define deletion/retention, and be benchmarked against the local path. Never put service-role or model secrets in Vite/browser variables. The existing vision Edge Function is separate and protected.

Environment variables **by name only**: Phase 1 Audio Intelligence requires **none**. Existing optional FretShift services use `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`), `OCR_SPACE_API_KEY`, and `ALLOWED_ORIGINS`; the vision benchmark also uses `VISION_IMPORT_URL`, `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`, and `FRETSHIFT_USER_ACCESS_TOKEN`. No new variable was introduced.

From the extracted project root: `pnpm install --frozen-lockfile`; `pnpm lint`; `NODE_OPTIONS=--no-experimental-webstorage pnpm test` on this Node 26 host (use the repository's `.nvmrc` Node 20 in normal development); `pnpm build`; `pnpm bench:audio-intelligence`; `pnpm exec playwright install chromium webkit`; `pnpm exec playwright test e2e/audio-intelligence.spec.ts --project=chromium --project=webkit`. A static deployment rebuild would include the Worker automatically; **Phase 1 requires no migration, new service, secret, or Supabase function deployment**. The project has not been deployed in this phase.

## E. Precise Phase 2 instructions

1. Keep the selected Coming Soon ZIP lineage and the existing UI/vision/Immersive systems. Reuse `AudioDecoder`, `BeatAnalyzer`, `ChordAnalyzer`, `StemSeparator`, `NoteTranscriber`, `LocalAnalysisOrchestrator`, `analyzeAudioIntelligenceFile()`, `ProvisionalMeasure`, and `reviewedAnalysisToSong()`. Do not replace the older audio draft until the new path meets a real-audio gate.
2. In Import, accept a user-chosen local WAV/MP3/M4A file; show size/codec errors and cancellation; provide waveform/audio playback. Run `analyzeAudioIntelligenceFile()` locally and display beat grid, downbeats, chord segments, timestamps, alternatives, and unknown spans on a timeline.
3. Let the user edit chord labels and starts/ends, tempo, beats, meter, and first downbeat. Preserve unsupported or ambiguous labels for explicit correction; do not coerce `Cadd9`→`C`, `Fmaj7`→`F`, or `Bm7b5`→`Bm7`. Make an explicit timing-confirmation action. Separate classifier similarity from measured correctness.
4. Only after review, call `reviewedAnalysisToSong()` with explicit labels and beat phase; persist with `useSongStore`/existing Dexie flow. Keep source audio local unless a separately consented, secured provider is designed. Avoid uploading local reference blobs through song sync.
5. Use existing Song timing/provenance safeguards in Immersive Practice. Unconfirmed imported measures must not be graded in Rhythm mode. Verify the full journey in Chromium/WebKit and on at least one real iPhone before claiming device support.
6. Expand the benchmark with licensed real audio and hand-audited annotations (acoustic, clean/distorted electric, vocals, full band, extensions, tempo variation), add real model/stem comparisons, measure runtime/peak memory/compute cost, and choose a provider only if it meets the evidence and chord-integrity standards. Basic Pitch or other note models are a later gated phase; fingering needs separate tuning/capo/playability optimization.

## F. Project history

Songbook/editor, Smart Import and PDF/photo OCR, the original single-string audio draft, Immersive Practice, strumming, Auth/sync, Dexie, and Liquid Glass UI all **predate** Audio Intelligence. Phase 1 added only the experimental local beat/chroma architecture, provider contracts, reviewed-Song bridge, fixtures, benchmark, codec browser test, and documentation. Phase 2 has not started in this project copy.

## G. Artifacts

- Complete source project ZIP: `FretShift-Audio-Intelligence-Phase-1.zip` (a separate file in the parent workspace directory; excludes installed dependencies, build output, and test traces).
- Separate handoff Markdown: `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_1_HANDOFF.md` (also copied beside the ZIP for direct access).
- Architecture document in the project: `AUDIO_INTELLIGENCE_ARCHITECTURE.md`.
- Recorded benchmark in the project: `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json`.

This handoff reports only implemented and observed work. Read the architecture and benchmark JSON for per-case details; do not rely on the previous conversation.
