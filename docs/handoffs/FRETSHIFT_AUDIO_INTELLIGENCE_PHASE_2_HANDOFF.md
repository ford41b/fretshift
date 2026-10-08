# FretShift Audio Intelligence — Phase 2 handoff

This is a standalone handoff for a **new coding session**. It describes the complete supplied project, not just a patch. Read `README.md`, `AUDIO_IMPORT.md`, `AUDIO_INTELLIGENCE_ARCHITECTURE.md`, the benchmark JSON, and the code paths below before changing the design. The Phase 1 archive contained no `AGENTS.md`; the user supplied coding instructions directly in the Phase 2 request. Do not treat this document as a new user request.

## A. Cumulative project history

### Original FretShift baseline, before Audio Intelligence

The user selected `FretShift-Immersive-Beta-Coming-Soon (1).zip` as the exact earlier source baseline (Phase 1 recorded SHA-256 `83c21e991c9f6ea43b2f2ed32586d0e56f912f54fd812b9e5b94dd4860073375`). FretShift already had Songbook and SongV1 editing, Smart Import for ChordPro/JSON/MIDI/MusicXML/Guitar Pro and PDF/photo OCR, an older conservative single-string audio draft, ordinary Practice, strumming, authentication/sync/share, offline Dexie persistence, Liquid Glass/mobile UI, and retained Immersive code. The selected build showed the Immersive beta gate for existing songs and general navigation. The original `src/audio/audioToChords/` draft was distinct from Audio Intelligence.

Baseline validation in Phase 1 found 256/257 unit tests passing on this Node 26 host with `NODE_OPTIONS=--no-experimental-webstorage`. The failure was a stale expected string in `src/vision/client.test.ts`; product behavior had a different actionable OCR error. Without that Node option, 14 cloud tests failed because of Node 26 experimental `localStorage` behavior. A retained Immersive recognition test could time out under resource contention but passed when run alone. These were not evidence of audio recognition accuracy. The original project had no Audio Intelligence upload/review pipeline, trained chord model, real stem separator, note transcriber, or tab generation. The local Supabase `vision-import/index.ts` was reported as v7 remotely by the user; the remote version was not independently checked.

### Phase 1 architecture and benchmark

Phase 1 added a **separate experimental local path** in `src/audio/intelligence/`. It defined input, decoder, beat, chord, optional stem, optional note, and orchestration contracts. `BrowserAudioDecoder` accepted WAV/MP3/M4A, used Web Audio to decode/downmix, and transferred PCM to a Worker. The Worker reused FretShift's FFT for onset and chroma features, estimated a global beat grid and provisional meter/downbeats, and produced 192 chord templates with alternatives and unlabeled regions. `reconstructProvisionalMeasures()` marked all timing unconfirmed. `reviewedAnalysisToSong()` provided a reviewed-song bridge but had no UI caller. The older import tool, Songbook, Smart Import, sync, strumming, and practice flows remained in place. There was no Audio Intelligence server or model key.

Phase 1 chose this local path because it could be integrated and measured without sending private files to an unselected provider. Essentia/Chordino, librosa, BTC/autochord, Demucs/MDX, Basic Pitch, GuitarSet, and Guitar-TECHS were researched, **not installed or evaluated**. Autochord's documented 25-label output would lose extensions; the original Demucs repository is archived. The architecture document records the primary sources and candidate tradeoffs. No full tab or note transcription was attempted.

Phase 1 tested five new focused unit cases, a real browser decode/Worker path in Chromium and WebKit for generated WAV/MP3/M4A, lint/build, and 11 deterministic **synthesized** benchmark clips. Its full unit run passed 261/262 with only the pre-existing vision string mismatch. Its saved benchmark: mean tempo error 2.0775 BPM on fixed-tempo cases, exact time-weighted chord-label accuracy 0.678 across eight chorded cases, segment IoU 0.5582, and seven missed/zero false transitions at 250 ms. Mean core runtime was 114.4757 ms for short clips. Synthetic vocal-like and full-band-like mixes scored 0.0000 and 0.1812 chord accuracy; generator-provided oracle guitar channels scored 0.9086 and 0.9250. Those oracle results are **not** a deployable separator result. Silence/noise returned no reliable beats/chords, the monophonic fixture no chord labels, and the tempo-ramp fixture had poor beat/downbeat recall. No real recording, mobile hardware, GPU cost, or note accuracy was measured. Phase 1 left the entire import → review → save → practice journey unfinished, plus real-audio accuracy and a reliable timing model. Its original recorded results are retained in `AUDIO_INTELLIGENCE_PHASE_1_BENCHMARK_RESULTS.json`.

### Phase 2 implementation and decisions

Phase 2 started from the **complete supplied Phase 1 ZIP**, extracted to `FretShift-Audio-Intelligence-Phase-2/`. It kept the local provider architecture and existing older draft. It added Import's Audio Intelligence entry, browser playback/waveform, the editable timeline, explicit beat/meter/downbeat confirmation, derived Song persistence, a reopen route, and practice integration. The local limits were reduced from Phase 1's 150 MB/15 minutes to **30 MB/five decoded minutes** to moderate whole-file browser memory use. Only one UI analysis is allowed at a time; cancellation waits for an in-flight browser decode to finish cleanup, then permits retry. Named stages are emitted at actual orchestration steps. There are no invented percentages.

The new review state preserves original detector beat evidence/warnings, provider IDs, vocabulary, chord alternatives/similarity, original segment boundaries, and separate corrected boundaries/labels/decisions. Unknown and No chord are distinct. A save requires a labeled chord, an explicit decision for each unlabeled region, and a usable beat grid. Detected beats and meter never silently become confirmed. A blank/silent result is an error. The chart conversion quantizes displayed chord positions to SongV1's 16th-beat grid, while `audioTimeSeconds` and provenance retain the exact attacks. A pickup before the chosen first downbeat is displayed at chart beat 1 because SongV1 has no pickup measure; its source time stays in the audio review. Chord changes never determine barlines.

The audio Song has no generated tab or strumming state. For confirmed audio timing, ordinary Practice uses the reviewed beat timestamps for metronome/position, and Immersive chord guidance uses exact chord attacks. Playback no longer generates synthetic note events from audio chord names. Chord-only Immersive targets remain visual/unsupported for note or rhythm grading. The general and non-audio song Immersive routes retain the existing beta gate; only songs with `provenance.audioReview` open the retained room. `IMMERSIVE_BETA_GATE.md` and its verification script describe that deliberate exception to the earlier gate. No change was made to `supabase/functions/vision-import/index.ts`; its SHA-256 remains `2290ede345a50dc10b291c9519aee484f5d597050156790dd3f0883c82cb01dc`.

Phase 2 found and fixed a real pickup conversion failure during browser testing. It also restored an existing local text-layer PDF parser's missing Import source button and updated browser tests that still expected older source names and a one-step OCR UI. The OCR production code and vision Edge Function were not changed. The stale vision unit assertion was updated to the actual actionable error string; no OCR behavior was changed.

## B. Current working implementation

### Pipeline and ownership

```text
Import Audio file (.wav/.mp3/.m4a, 30 MB max)
  → BrowserAudioDecoder (Web Audio, <=5 decoded minutes, downmix to mono)
  → 512-bin derived waveform + temporary browser playback URL
  → transferred PCM in analyze.worker.ts
  → extractAudioFeatures (onset/chroma)
  → OnsetBeatAnalyzer (tempo, beats, possible downbeats/meter, evidence)
  → ChromaChordAnalyzer (192-label vocabulary, alternatives, unknowns)
  → provisional measures (unconfirmed)
  → AudioIntelligenceReview (listen, edit, confirm timing)
  → audioReviewToSong / reviewedAnalysisToSong
  → SongV1 provenance.audioReview + chart events.audioTimeSeconds
  → useSongStore → Dexie; existing account sync may sync derived Song data
  → Practice or conditional Immersive room
```

`src/audio/intelligence/types.ts` defines replaceable `AudioIngestor`, `AudioDecoder`, `BeatAnalyzer`, `ChordAnalyzer`, `StemSeparator`, `NoteTranscriber`, and `AnalysisOrchestrator` interfaces. The installed local orchestrator uses `features.ts`, `beat.ts`, `chord.ts`, `measures.ts`, and `analyze.worker.ts`; no stem or note provider is installed. `src/audio/intelligence/index.ts` handles file validation, browser decoding, Worker lifecycle, stage messages, and waveform extraction. Browser Web Audio codec support determines whether a particular M4A decodes. The `licensed-url` contract rejects because no lawful provider was installed. Phase 2 added no external audio API and no secrets.

`src/audio/intelligence/review.ts` builds separate detected and reviewed state, regenerates an explicit BPM grid, moves/splits/merges regions, and validates a reviewed Song. `src/audio/intelligence/song.ts` converts that state to the normal SongV1 chart. `src/schema/song.v1.ts` adds optional `provenance.audioReview` and optional chord `audioTimeSeconds`. The metadata includes detector and edited seconds, uncertainty, user decisions, beat grid, meter, first downbeat, timing confirmation, source filename, duration, and small waveform. Existing SongV1 records remain valid. `loadSong()` validates the save/reopen path. The normal store calls `flushPersistence()` before the UI reports a completed save; Dexie persists the Song and existing sync handles account records. No raw blob is inserted by Audio Intelligence.

`src/ui/screens/Import.tsx` mounts `AudioIntelligenceReview.tsx` and keeps `AudioChordReview.tsx` under **Older single-string draft**. The new surface has audio controls, looping, zoom, scrollable waveform, playback cursor, beat and measure lines, selectable/striped regions, alternatives, chord replacement, Unknown/No chord, region split/merge/boundary control, BPM rebuild, individual beat timestamp editing, meter and first-downbeat controls, and an explicit timing checkbox. `src/ui/screens/AudioReviewScreen.tsx` reopens saved derived data at `/audio-review/:id`; `SongDetail.tsx` links to it. Reopened audio is not retained; the player can reattach a file with the same filename for audition, but Phase 2 does **not** hash-verify the file.

`src/audio/playback/timeline.ts` uses exact reviewed beat times for confirmed audio Songs with chord-only measures. `src/audio/playback/index.ts` avoids auto-converting their chord names into synthesized tab/note attacks. `src/ui/screens/Practice.tsx` suppresses microphone rhythm offsets and displays a warning for unconfirmed audio Songs. `src/audio/immersive/score.ts` uses exact `audioTimeSeconds` for confirmed audio chord guidance; its existing scoring safeguards still reject chord-only targets for note/rhythm scoring. `src/ui/App.tsx` routes reviewed audio Songs to the retained Immersive room and leaves all other existing beta-gated routes gated. No fictional strumming rhythm is stored or played.

### Retention, security, and deployment

Audio Intelligence processes locally. The temporary playback object URL is revoked on replacement/unmount; PCM is transferred to a Worker and the Worker terminates on completion/cancellation. Browser decoding itself is not interruptible. Raw audio is **not** retained in Audio Intelligence storage or uploaded. Derived Song metadata, including the filename and waveform, is retained in IndexedDB and may sync through the existing authenticated account system. The existing sync/ownership controls are reused; no live remote isolation audit was performed in Phase 2. There is no Audio Intelligence server rate limit because there is no audio server; the UI prevents simultaneous analyses. There are no new environment variables, migrations, Edge Functions, or deployments. The unrelated vision-import function was not modified.

### Commands

From the project root:

```sh
pnpm install --frozen-lockfile
pnpm lint
NODE_OPTIONS=--no-experimental-webstorage pnpm test  # Node 26 host workaround
pnpm build
pnpm bench:audio-intelligence
pnpm exec playwright test e2e/audio-intelligence.spec.ts --project=chromium --project=webkit
node scripts/verify-immersive-beta-gate.mjs
```

Use Node 20 from `.nvmrc` in ordinary development. The WebKit and Chromium browser binaries must be installed for Playwright. `pnpm dev` starts the local app. `AUDIO_IMPORT.md` gives the current player workflow and privacy rules. Phase 2 has not been deployed.

## C. Implementation status and actual verification

| Status | Item and evidence |
| --- | --- |
| Implemented and verified | Local WAV/MP3/M4A browser decode + Worker analysis; **10/10** Audio Intelligence Playwright cases passed across Chromium and WebKit, covering codec decode, upload/review/save/reopen/Immersive entry, pre-aborted cancellation/retry, 390 px URL cleanup, and the unconfirmed-timing guard in ordinary Practice. The end-to-end save test reloads from persisted data. |
| Implemented and verified | SongV1 metadata and exact-time practice bridge; focused unit tests cover silence, ambiguous/extended/repeated/offbeat/slash/suspended regions, wrong-BPM correction, uncertain meter, provider failure/retry, a deterministic two-guitar-like mix, no generated strumming/tab, saved reload, and Immersive target timestamps. These are synthetic or constructed cases. |
| Implemented and verified | `pnpm lint`, `pnpm build`, and the full unit suite passed: **269/269 tests in 26 files** with the Node 26 storage option. `verify-immersive-beta-gate.mjs` passed. The local vision-import function hash is unchanged from Phase 1. |
| Implemented and verified | Broader Chromium regression run initially passed 25/29 tests. Four stale/missing-entry cases failed; after restoring PDF entry and updating test selectors/workflow, each of those four passed on a targeted rerun. The entire 29-test group was not rerun after those fixes. |
| Implemented but not verified | Long-file/mobile Safari memory behavior, physical iPhone playback/editor gestures, authenticated cross-device sync of audio metadata, and real-world production deployment. |
| Experimental | The local onset/chroma analyzer and accent-based meter/downbeat proposals. No real-guitar or full-band accuracy was measured. |
| Planned | A real licensed corpus, stronger beat/chord provider comparison, optional separator only if measured helpful, and later single-note transcription/editable tab. |
| Blocked by evidence | Claims of robust real-recording accuracy, reliable automatic meter/downbeats, or note/tab accuracy. No annotated real recording corpus or suitable trained model has been validated here. |

The Phase 2 benchmark reran the **unchanged 11 synthetic fixture definitions**. `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json` records 2.0775 BPM mean fixed-tempo error, 0.678 mean exact time-weighted chord accuracy, 0.5582 mean segment IoU, 7 missed/0 false transitions at 250 ms, and 116.6206 ms mean local core runtime for short clips. This runtime changed from Phase 1's 114.4757 ms due to run variation; the detector algorithm was not improved by Phase 2. These are **not real-recording accuracy or peak memory measurements**. Cost of an external provider is $0 because none ran; local power/hosting costs were not priced.

## D. Known limitations and bugs

1. The local chord baseline is poor on synthetic vocal/full-band mixes and has no validated real-audio accuracy. Major/minor, sus/extended, slash bass, multiple guitars, distortion, and noisy mixes can all be wrong. Similarity scores are not probabilities. There is no guitar isolation, learned chord checkpoint, note model, or tab.
2. Tempo uses a global grid; meter/downbeats are tentative and half/double time or tempo ramps are weak. The editor can correct beat timestamps, but SongV1 remains measure-based. Explicit confirmation is required before exact-time practice; unconfirmed audio timing cannot become graded rhythm scoring. Chord-only Immersive guidance is visual and not scoreable by the existing note scorer.
3. SongV1 chart chords are quantized to 16th-beat slots. Source timestamps remain in provenance and `audioTimeSeconds`, but pickup attacks show at the first chart beat. The ordinary Song editor can change chart beats without automatically updating audio provenance; reopen the audio timeline for source-time corrections. Extra beats at a truncated final measure may require player review.
4. Raw audio is not retained. Reopened timelines can display the saved waveform and edits, but audio must be reattached to audition. Reattachment checks filename/limit only and cannot prove it is the same recording. The object URL is cleaned up on navigation; physical-device peak memory was not measured. Web Audio whole-file decode can still be costly at the 30 MB/five-minute caps and cannot be aborted mid-decode.
5. No local draft autosave exists before the user saves the Song. Leaving the review screen loses unsaved corrections. No server processing, cloud GPU, server cleanup/retention, or server rate-limit path exists; these would require separate privacy/security design if introduced.
6. The Immersive beta gate remains for non-audio songs. The retained old `e2e/immersive.spec.ts` expects the ungated room for those songs and was not run as a Phase 2 acceptance test. Phase 2 instead tested the reviewed-audio route plus `verify-immersive-beta-gate.mjs`. No live Supabase/OCR provider, real device, or production deployment was tested.

## E. Next phase: single-note guitar transcription and editable tablature

Reuse `AudioDecoder`, local Worker orchestration, `extractAudioFeatures`, the confirmed beat timeline, chord-region review UI, waveform/playback/loop controls, Song provenance, and the exact-time Practice/Immersive adapters. Preserve detector output separately from player corrections just as chords are preserved. The current `NoteTranscriber` interface and `NoteEvent` type (`start`, `end`, `midi`, optional evidence) are only contracts; no provider runs. The current audio data offers mono PCM during a session, onset/chroma features, detected/reviewed chord segments, exact beat times, tempo/meter/downbeats, and a 512-bin display waveform. The saved Song has no raw audio, so a later phase must request source reattachment or explicitly design consented retention.

Before mapping notes to tab, define a versioned note timeline with source start/end seconds, pitch or pitch candidates, calibrated model evidence/unknown state, onset identity, polyphony grouping, instrument/stem identity when known, detector provenance, user-edited pitch/timing, and per-note confirmation. Then add separate candidate string/fret assignments and user-selected string/fret, tuning/capo, bend/slide/technique where measured, and explicit unplayable/unknown states. A MIDI pitch is **not** a string/fret. Use existing `SongV1` tuning/capo constraints and `src/io/timeline.ts` for musical grid conversion, but keep raw seconds and uncertain notes alongside any quantized `Measure.tab` slots. Connect each note event to the chord timeline by source-time interval and reviewed beat/downbeat map; do not derive notes from chord names or overwrite chord uncertainty.

Immersive `compileTargets()` already scores confirmed single-note tab targets within supported pitch/timing ranges. Feed it only player-confirmed, playable note attacks; leave polyphonic or uncertain notes ungraded. Rhythm mode must still require confirmed timing. Ordinary Practice should play tab only after explicit note/string assignment, never from a chord label. Evaluate an actual note model (for example, Basic Pitch on isolated guitar) on licensed, annotated acoustic/electric/polyphonic data before selection. Benchmark pitch/onset/duration accuracy, string/fret playability, latency, peak device/server memory, and separated versus mixture audio. GuitarSet and Guitar-TECHS are candidate sources; verify license, annotations, recording identity, and train/test split first. Known obstacles are polyphonic overlap, bends and transients, vocal/drum masking, tunings/capo, multiple guitars, variable tempo, mobile memory, and mapping equal pitches across strings.

## F. Artifacts

- Complete current project-code ZIP: `FretShift-Audio-Intelligence-Phase-2.zip` beside the project directory. It contains the full source project, tests, fixtures, documents, lockfile, and configuration, excluding installed dependencies, generated build output, and Playwright traces.
- Separate handoff Markdown: `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_2_HANDOFF.md` beside the ZIP; the same file is included in the project.
- Player/developer guide: `FretShift-Audio-Intelligence-Phase-2/AUDIO_IMPORT.md`.
- Current recorded synthetic benchmark: `FretShift-Audio-Intelligence-Phase-2/AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json`.
- Original Phase 1 benchmark record: `FretShift-Audio-Intelligence-Phase-2/AUDIO_INTELLIGENCE_PHASE_1_BENCHMARK_RESULTS.json`.
- Historical Phase 1 architecture and handoff remain in the complete project as `AUDIO_INTELLIGENCE_ARCHITECTURE.md` and `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_1_HANDOFF.md`.

No deployment, production model accuracy, physical mobile compatibility, or full tablature completion is claimed.
