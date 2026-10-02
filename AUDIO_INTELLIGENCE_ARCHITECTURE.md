# FretShift Audio Intelligence — Phase 1 architecture

> Historical Phase 1 design record. Phase 2 connected this local pipeline to Import, review, SongV1, and practice. See `AUDIO_IMPORT.md` and `FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_2_HANDOFF.md` for the current implementation. The limits below describe Phase 1; Phase 2 lowered the upload cap to 30 MB and decoded duration cap to five minutes.

## Decision and evidence boundary

This phase adds an **experimental, local-first analysis baseline** alongside the older single-string audio-to-chord draft. It does not replace that user flow or automatically save analyzed audio as a Song. Local WAV, MP3, and M4A files are the input contract; M4A works only where the browser's Web Audio decoder supports its codec. The actual browser-to-Worker path passed with generated WAV, MP3, and M4A fixtures in local Chromium and WebKit.

The baseline estimates tempo, beats, possible downbeats/meter, chord segments, and provisional measure boundaries. All barlines and chord labels require human review. Guitar-note transcription, tablature, a trained chord model, and production stem separation are **not implemented**. There is no LLM transcription, video ingestion, YouTube downloading, audio upload, or new server endpoint.

## Data flow

```text
Local File (.wav/.mp3/.m4a)
  → LocalFileIngestor → BrowserAudioDecoder (validation, Web Audio, mono PCM)
  → analyze.worker.ts → extractAudioFeatures (existing FFT, 11.025 kHz analysis rate)
      ├─ OnsetBeatAnalyzer → tempo, beat grid, provisional accent-based downbeats
      └─ ChromaChordAnalyzer → explicit chord vocabulary, alternatives, unknown regions
  → reconstructProvisionalMeasures (timingConfirmed=false)
  → Phase 2 timeline review
  → reviewedAnalysisToSong (explicit beat phase and chord labels)
  → existing SongV1 / song store / Dexie → existing Immersive Practice
```

`src/audio/intelligence/types.ts` defines separate `AudioDecoder`, `AudioIngestor`, `BeatAnalyzer`, `ChordAnalyzer`, `StemSeparator`, `NoteTranscriber`, and `AnalysisOrchestrator` interfaces. `LocalAnalysisOrchestrator` accepts provider replacements. An optional separator can supply a `guitar` or `other` stem, while beats remain based on the original mix. No separator or note provider is installed by default. `LocalFileIngestor` rejects the future `licensed-url` input explicitly; it is a contract for an authorized provider, not a downloader.

The audio byte limit is 150 MB and decoded duration limit is 15 minutes. The full file is decoded in memory before analysis; long recordings may exceed mobile memory even inside those limits. Decoding is on the main thread because Web Audio owns it; FFT, beat, and chord analysis run in a Worker. Abort terminates the analysis Worker, but cannot interrupt a browser decode already underway. The worker receives a transferred PCM buffer; this implementation makes no network request and has no new API keys.

## Baseline methods and limitations

- **Features:** mono PCM is box-averaged to at most 11,025 Hz; FretShift's existing `spectrum()` FFT produces short-window spectral onset flux and longer-window chroma. Local spectral peaks, pitch-class normalization, flatness, and a harmonic-overlap heuristic reduce some octave and noise errors. This is a simplified chroma/HPCP-style baseline, not a reference implementation of HPCP or NNLS.
- **Beats:** autocorrelation of onset strength selects a global pulse, with a half-time check. A phase grid aligns to attack peaks. Three- or four-beat accent contrast proposes downbeats only with enough evidence. There is no local tempo-change tracker or reliable meter inference. Half/double time and weak or syncopated attacks need review.
- **Chords:** 192 templates (12 roots × 16 documented suffixes) use FretShift's own `parseChordName()` and `intervalsOf()`. The suffixes are `""`, `m`, `5`, `dim`, `aug`, `sus2`, `sus4`, `6`, `m6`, `7`, `maj7`, `m7`, `m7b5`, `add9`, `9`, `maj9`. Similarity and runner-up margin determine whether a frame may be labeled. Short unstable labels remain ambiguous. A score is **not** accuracy or a calibrated probability. Slash bass, altered dominants beyond this list, voicing, and instrument identity cannot be reliably inferred from 12-bin chroma.
- **Integrity:** alternatives are retained when a label is ambiguous. Unsupported chord spellings are rejected at the reviewed-song bridge; `Cadd9`, `Fmaj7`, and `Bm7b5` are preserved exactly in the Song schema. No inferred guitar fingering or tablature is emitted. The bridge requires explicit labels, beat times, first downbeat, meter, and timing-confirmation state. It sets `provenance.source="audio"` and unconfirmed measure timing unless the caller records actual user confirmation.

This baseline is useful as a local review aid on isolated, regular strumming. It is not sufficiently accurate to auto-publish a chord chart, especially for vocals, a full band, or expressive tempo.

## Research and provider selection

The following were reviewed from their project documentation or papers. **No pretrained model listed here was installed or benchmarked in Phase 1.**

| Candidate | Evidence and Phase 1 decision |
| --- | --- |
| Chroma/HPCP and beat-conditioned chords | [Essentia's chord tutorial](https://essentia.upf.edu/tutorial_tonal_chords.html) documents frame and beat-conditioned HPCP chord methods. [Chordino/NNLS documentation](https://isophonics.net/nnls-chroma) describes tuning, whitening, and harmonic-note dictionaries. Our small browser baseline tests the integration contract first; Essentia.js or NNLS is a Phase 2 comparison candidate. |
| Beat/downbeat tracking | [librosa's beat tracker](https://librosa.org/doc/0.10.2/generated/librosa.beat.beat_track.html) uses onset strength, tempo estimation, and dynamic programming. A stronger beat/downbeat provider should be evaluated against real annotated guitar recordings before use in practice scoring. |
| Demucs/MDX-style separation | [Demucs v4](https://github.com/facebookresearch/demucs) supports music stems; its original repository is archived and its maintainer says only important fixes continue in a fork. Standard vocals/drums/bass/other outputs are not guaranteed guitar isolation. Use separation conditionally after an actual with/without benchmark, with server/GPU cost and privacy controls measured. |
| Chord-recognition model | [autochord](https://github.com/cjbayron/autochord) provides a pretrained Bi-LSTM-CRF, but its documented output is 12 major, 12 minor, and no-chord. That cannot satisfy the extension-integrity requirement. The [BTC chord paper](https://arxiv.org/abs/1907.02698) is a model research lead, not evidence that a particular available checkpoint supports FretShift's vocabulary or real-guitar accuracy. No model is selected for production. |
| Note transcription | [Spotify Basic Pitch](https://github.com/spotify/basic-pitch) is an open-source polyphonic note model, but its own documentation says it works best on one instrument at a time. Evaluate it later on isolated guitar against note annotations. A note event must not be treated as a string/fret assignment. |
| Real evaluation data | [GuitarSet](https://zenodo.org/records/3371780) has acoustic mic audio plus chord, beat, downbeat, and note annotations. [Guitar-TECHS](https://guitar-techs.github.io/) offers licensed electric-guitar recordings and annotations. Acquire verified subsets and follow attribution/licensing before claiming real-world performance. Neither dataset was downloaded or scored in this phase. |

For future fingering, use the existing tuning/capo and `src/io/timeline.ts` machinery as constraints, then compare candidate string/fret sequences by playability and hand motion. Chroma alone cannot decide fingering.

## Benchmark design and recorded scope

`test-fixtures/audio-intelligence/manifest.json` and `fixtures.mjs` generate 11 deterministic 8–16 second cases: acoustic-like, clean-electric-like, distorted, vocal-like mix, full-band-like mix, repeated progression, extensions, silence, noise, monophonic melody, and a tempo ramp. These are **synthesized stand-ins**, not recordings of those instruments. Ground-truth notes, chords, beats, and bar positions come from the independent generator, never from the analyzer. The tempo ramp has no single true BPM, so global tempo error is null.

Run `pnpm bench:audio-intelligence`. The harness writes `AUDIO_INTELLIGENCE_BENCHMARK_RESULTS.json` with per-case tempo error, beat and downbeat timing, exact time-weighted chord labels, chord-segment IoU, missed/false transitions, ambiguity duration, false-chord duration, runtime, and process RSS before/after. Note accuracy is null because no note transcriber exists. Provider cost is $0 for this local run; device energy and cloud compute are not priced. Similarity scores are never substituted for accuracy.

The two vocal/full-band cases also compare the mixture with a **synthetic oracle guitar channel** from the generator. This is an upper-bound diagnostic, not Demucs/MDX or a deployable separator. No real-stem comparison is claimed.

## Phase 2 gate

Use `analyzeAudioIntelligenceFile()` for local upload/analysis, then build a timeline UI that exposes audio playback, beat/downbeat edits, alternatives, unknown spans, and chord-change timestamps. Do not call `reviewedAnalysisToSong()` until the user has made or confirmed choices. Save through `useSongStore`, preserving existing IndexedDB and cloud-sync rules. Require timing confirmation before graded Immersive Rhythm mode. Keep raw audio local unless a separate, authenticated, consented server path is designed and evaluated; never place model secrets in browser code. Do not touch `supabase/functions/vision-import` for this work.
