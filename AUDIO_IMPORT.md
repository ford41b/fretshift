> **Post-Phase-3 hardening:** Worker analysis has a two-minute deadline and cleanup on every completion/error/cancel path. Already-cancelled requests skip decode; cancellation during browser decoding skips subsequent downmix/analysis after decode returns. Reopened corrections preserve unrelated Song metadata and the first reviewed beat. Chord-only saves now validate timing and region integrity too. See `AUDIO_INTELLIGENCE_VALIDATION.md` for current measurements and limits.

> Phase 3 update: this chord/rhythm guide remains applicable. Optional single-note transcription, editable tab, fingering and practice are documented in `GUITAR_TAB_TRANSCRIPTION.md`; current cumulative state is in `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_3_HANDOFF.md`. Statements below about Phase 2 not producing tab describe the chord-only mode.

# Audio Intelligence import

## Use the feature

1. Open **Import → Audio recording → Choose WAV, MP3, or M4A**. Files must be nonempty, at most 30 MB, and at most five decoded minutes. The browser must support the file's codec; an `.m4a` extension alone does not guarantee that it will decode.
2. Wait through the named stages. They report completed processing steps, not invented percentages. **Cancel analysis** stops the Worker. During Web Audio decoding, cancellation is requested immediately but cleanup completes when the browser decoder returns. **Retry analysis** becomes available after cleanup or a provider error.
3. Play the recording and inspect the waveform, chord blocks, beat lines, and heavier measure lines. Striped regions are unlabeled or unreviewed. Click a region to audition, replace its chord, choose an alternative, mark Unknown or No chord, confirm a label, split, merge, or move the shared boundary with the next region. Different chord decisions cannot be merged silently. For recordings with many unlabeled regions, **Mark all uncertain regions Unknown** records an explicit review decision without guessing chords. Adjust the loop times and zoom as needed.
4. Check the tempo, beat grid, meter, and first downbeat against the recording. Change BPM and choose **Apply BPM and rebuild beats** to regenerate a grid; individual beat times can also be edited. The detector's meter suggestion is provisional. Use the timing checkbox only after listening and correcting these values. Until then the interface says **Timing needs review**.
5. Save as a FretShift song. At least one valid chord, a usable beat grid, and explicit decisions for unlabeled regions are required. Unknown and No chord spans remain in the saved audio timeline and are not converted into named chart chords. The generated chart contains no tablature or strumming pattern. Use **Practice**, **Immersive Practice**, or **Reopen transcription** after saving. The Song page also offers **Edit audio timeline**.

The older single-string draft remains available under **Older single-string draft**. Text-layer PDF import and visual photo/scanned-PDF OCR remain separate Import entries.

## What is saved

The SongV1 record stores the detected beat/chord data, original similarity evidence and warnings, a small derived waveform, reviewed region boundaries and labels, confirmation flags, and exact chord attack times in seconds. The normal FretShift chart has grid-aligned chord positions. For confirmed audio timing, Practice metronome clicks and Immersive chord guidance use the reviewed source timestamps. Pickup chords before the selected downbeat appear at chart beat 1; their exact source times remain in the timeline.

Raw audio is **not** written to IndexedDB or cloud storage by Audio Intelligence. A temporary object URL and decoded PCM exist in browser memory during the session. The URL is revoked on replacement or when the review component unmounts; the analysis Worker is terminated on completion/cancellation. Reopening a song shows its derived waveform and edits, but auditioning requires reattaching the original file. New transcriptions save a SHA-256 fingerprint and reject a different file with the same name. Older Phase 2 songs lack the fingerprint and still require listening to verify the source. Hashing reads the file again in browser memory, so peak device memory remains unmeasured.

Analysis uses only browser Web Audio and the local FretShift Worker. It makes no Audio Intelligence network request and needs no new secret or server. Derived Song data, including the source filename and waveform, follows the app's existing account sync rules if the player uses sync. Existing authentication and record ownership handle that data; Phase 2 introduces no separate audio service, server retention, or external provider bill. One UI analysis runs at a time. The unrelated Supabase vision-import function is untouched.

## Accuracy and timing limits

The chord and beat detector is a local chroma/onset baseline. Scores are template similarity, **not confidence probabilities**. It can label isolated regular guitar-like chords, but voices, drums, distortion, two guitars, inversions, unusual chords, syncopation, and tempo changes may cause errors. Leave uncertain spans Unknown instead of converting them to guesses. Meter and downbeats always need human confirmation. A silent or unusable result cannot be saved as a successful transcription.

SongV1 quantizes visible chart chord positions to 16th-beat slots. The exact reviewed seconds are preserved separately and are used in confirmed audio practice paths. Ordinary Practice warns and withholds microphone rhythm timing scores while audio timing is unconfirmed. Manual edits made later in the general Song editor do not automatically recalculate the audio timeline; reopen the transcription to correct source times. Immersive's chord-only guide is visual and does not claim note or rhythm scoring. No note transcription, tablature, stem separation, or real-world accuracy claim is included.

Whole-file Web Audio decoding can use substantial memory even under the 30 MB/five-minute limits. Browser decoding itself cannot be interrupted. The 390 px browser viewport and URL cleanup were tested in Chromium/WebKit, but no physical iPhone or long mobile recording was tested.

## Unsaved drafts and cancellation

- **Draft autosave.** Unsaved review edits (a fresh analysis, or changes to a
  saved transcription) are written to IndexedDB about 0.4 s after each change
  and again when the page is hidden or the screen closes. Returning to the same
  screen restores them with a notice; raw audio is never part of a draft, so
  reattach the original file to audition. Saving or **Discard unsaved changes**
  deletes the draft. Drafts are device-local and do not sync. One draft is kept
  per song plus one for a new, not-yet-saved analysis.
- **Cancel.** Cancel returns control immediately: the analysis Worker is
  terminated, the decoding `AudioContext` is closed, and the stage UI and file
  picker become available again.
- **What cancel cannot do.** Browsers give no way to interrupt
  `AudioContext.decodeAudioData()` once it has started. After a cancel during
  "Preparing audio", the browser may keep decoding that file in the background
  until it finishes (seconds for a long file on a phone), using CPU and memory
  meanwhile. FretShift stops waiting for it and discards the result unread. It
  never downmixes or analyzes a cancelled decode, but it cannot reclaim that
  work sooner.

## Developer entry points

- `src/ui/components/AudioIntelligenceReview.tsx`, `src/ui/screens/AudioReviewScreen.tsx`, `src/ui/audio-intelligence.css`: upload, stage display, player, review, timing, save and reopen.
- `src/audio/intelligence/index.ts`, `analyze.worker.ts`, `features.ts`, `beat.ts`, `chord.ts`, `measures.ts`: local pipeline and provider contracts in `types.ts`.
- `src/audio/intelligence/review.ts`, `song.ts`, `src/schema/song.v1.ts`: reviewed state, SongV1 metadata, exact attack seconds and chart bridge.
- `src/audio/playback/timeline.ts`, `src/audio/immersive/score.ts`: confirmed timing integration. `src/audio/playback/index.ts` avoids creating note/strum playback from audio chord labels.
- `src/store/songStore.ts` → Dexie persistence and the existing sync engine: derived Song storage. Raw audio is never passed to these layers.

Run from the project directory: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm test` (the test setup now shims Node 25/26's experimental global `localStorage`; no flag needed), `pnpm build`, `pnpm bench:audio-intelligence`, `pnpm bench:audio-real`, and `pnpm exec playwright test e2e/audio-intelligence.spec.ts --project=chromium --project=webkit`. Node 22 from `.nvmrc` is the intended ordinary runtime; unit tests were verified on Node 20, 22, 24, 25 and 26 (2026-10-02). The synthetic and four-clip real-acoustic benchmarks are separate; see `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json`, `AUDIO_INTELLIGENCE_REAL_BENCHMARK_RESULTS.json`, and `AUDIO_INTELLIGENCE_VALIDATION.md` for exact measured scope.
