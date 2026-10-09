> **2026-09-27 validation update:** Phase 3 remains implemented and experimental. Current results, including a separate additional-player corpus, five-minute desktop stress and production offline checks, are in `AUDIO_INTELLIGENCE_VALIDATION.md`. Raw note identities/times, frame order/source bounds and quantized intervals are now validated on load. Older Phase 3 measurements below remain historical, not the current validation summary.

# Guitar notes and tablature — Phase 3

Phase 3 extends the existing Audio Intelligence project. This is a working **experimental single-note review and editing workflow**, not production-grade automatic guitar transcription. Existing chord/beat analysis remains unchanged and opt-in note analysis is off by default. No trained model, separator, audio upload, backend job, new dependency or deployment was added.

## Use

1. Open **Import → Audio recording**. Check **Also transcribe a single-note guitar passage (experimental)** before choosing a WAV, MP3 or M4A. Use an isolated melody, one note at a time. Limits remain 30 MB/five decoded minutes; browser codec support varies.
2. Listen against the waveform and six-string tab. Playback supports 50%, 75% and 100% with the browser's pitch-preservation flag, zoom, source-time seeking and loops. Select a tab note by pointer, keyboard, or the note list. **Loop selected note** auditions its reviewed interval.
3. Set tuning, capo, available strings, fret range and preferred playing position. String 1 is the highest string (internal index 0); frets are capo-relative and constrained to physical fret 22. Pitch stays unchanged when choosing a different fingering or guitar setup. Unreachable pitches remain unplaced. Fingering is always a suggestion or your choice, never an observed string identity.
4. Edit sounding MIDI pitch, onset seconds, duration seconds, or fret. Numeric note edits apply on blur. Editing a fret changes the reviewed sounding pitch and pins that placement. Choosing another equal-pitch fingering anchors the optimizer, which can update neighboring suggestions. Changes clear the affected confirmation; setup changes clear all note confirmations. Add at the playhead or delete a note; deleted events remain in provenance.
5. Check uncertainty, then **Confirm note** after listening. This records your judgment, not model correctness. Original pitch/timing/evidence remains under Advanced and in saved data. Articulation remains unknown.
6. Review chord regions independently. Keep Unknown and No chord distinct; use the explicit bulk Unknown action when appropriate. No chord voicing or strum pattern is generated. **Voicing needs confirmation** appears in review. A note-only song needs no invented chord label, but unresolved chord regions still need explicit decisions.
7. Review/rebuild/edit the beat grid, meter and first downbeat. Confirm timing only after checking the recording. Source seconds remain independent of the sixteenth-note chart grid. Save the draft to the Songbook. Confirmed, playable notes become normal Song tab; unconfirmed notes and their corrections stay in the audio editor/provenance. Two confirmed attacks in one quantized slot are rejected with an error, not silently merged. Same-string overlap is also rejected.
8. Reopen the transcription from the song. Its waveform, evidence and edits persist; reattach the original audio for audition. SHA-256 verification rejects a different file with the same name. For scored single-note practice, use **Immersive Practice**. Ordinary Practice plays confirmed guide notes but collects no microphone performance evidence for these note transcriptions.

## Detection and evidence

`YinNoteTranscriber` reuses FretShift's existing YIN + FFT harmonic-purity classifier (`audio/pitch`, `audio/immersive/recognition`). The offline adapter downsamples to at most 22,050 Hz using box averaging, analyzes centered 2,048-sample windows with approximately 10 ms hops, gates on energy/purity/cents, then forms stable same-pitch runs of at least five frames. Strong envelope rises can split repeated notes. This is an implemented signal-processing baseline, not a trained guitar model and not a reference librosa implementation.

[YIN's maintained librosa documentation](https://librosa.org/doc/main/api/generated/librosa.yin.html) describes fundamental-frequency estimation. [Spotify Basic Pitch](https://github.com/spotify/basic-pitch-ts/blob/main/README.md) offers a browser-capable multipitch alternative whose documentation recommends one instrument at a time. Basic Pitch was researched, **not installed, run, benchmarked or selected**. The existing local approach was selected for the initial monophonic scope and empirically evaluated below; stronger recognition is a next-phase gate.

Each transcription stores:

- `detected`: provider ID, every raw frame (source timestamp, RMS, nullable MIDI, cents, harmonic confidence and flatness), raw note intervals/pitches, analysis hop/window sizes, warnings and `inferredArticulation: "unknown"`.
- `notes`: separate reviewed start/end seconds and MIDI, detector linkage (or null for manual additions), deleted state, uncertainty, explicit confirmation, separately suggested/user-selected fingering and musical quantization.
- `options`: tuning/capo/string/fret/position constraints; `chartSignature`: a snapshot of musical chart fields used to invalidate stale practice targets after unrelated song edits.

Confidence is harmonic evidence, **not a calibrated probability or measured accuracy**. Raw frames include abstentions. No raw waveform PCM or audio file is stored in the Song; the small display waveform and pitch evidence are derived data and may sync with the existing account system. Derived metadata is larger than Phase 2; long-file sync/peak memory has not been validated.

The schema is optional within `SongV1.provenance.audioReview.noteTranscription` and versioned independently at 1. Legacy songs remain valid; no IndexedDB migration is necessary. Finite times, identities, tuning/fret constraints, confirmation state and source bounds are validated. Schema validation rejects malformed persisted/JSON data. Raw/reviewed states are copied separately and chart projection never rounds source seconds.

## Fingering

Candidate generation enforces exact sounding MIDI = open-string MIDI + capo + relative fret, available strings, chosen fret range and physical fret limit. A dynamic program chooses a whole path using fret movement, a penalty for shifts wider than four frets, string crossings, distance from the requested position and open-string preference. It resets continuity after a gap longer than one second or an unplayable note. User fingering choices are hard anchors; invalidated anchors are cleared visibly when setup changes. Alternative candidates remain selectable.

This is a monophonic ergonomic heuristic. It does not model finger identity, chord hand shapes, simultaneous multi-note spans, left-hand anatomy, advanced technique or stylistic preference. Candidate validity, mechanical movement and an anchored-path regression are measured; human-rated musical quality is **not measured**. It does not simply select the lowest fret.

## Practice and safety

`audioNotePlan` uses reviewed exact onset/end seconds, sounding MIDI and the selected source-time passage. Playback speed scales source times, events are clipped at the end boundary, and notes carried into a later passage are not reattacked. The first passage includes pickup audio from source time zero; its chart display may place pickups at beat zero. Loop scheduling and pause/reconnect use the existing practice engine.

Only explicitly confirmed, non-uncertain, playable MIDI 40–88 notes can be supported practice targets. Overlapping live note intervals are unsupported, even when the other note is unconfirmed. The room permits scored practice only when every target in the selected passage is supported. Unconfirmed timing blocks Rhythm; Learn checks pitch without a timing grade. Dense attacks require slowing to the existing 320 ms spacing limit. Durations determine intervals/overlaps and passage clipping; **sustain-duration performance is not scored**.

Changing the ordinary chart, tuning, capo, tempo or tab after conversion invalidates the stored chart signature. Reopen the audio transcription, review and save to regenerate the chart. This is conservative stale-data protection, not bidirectional reconciliation. Title/artist edits do not invalidate musical targets. Existing chord-only visual practice remains available.

Scored Immersive mode emits no guide notes, click or accompaniment. The capture worklet outputs silence. Navigating out of audio review explicitly pauses its player. Noise/clipping, permission failure, backgrounding and paused sessions retain the existing microphone safeguards. The microphone can assess sounding pitch, not fingering; external loudspeaker audio cannot be automatically distinguished from a player.

## Evaluation and reproducibility

Run `pnpm bench:audio-notes`. `GUITAR_TAB_BENCHMARK_RESULTS.json` contains actual per-case results and metric definitions. `GUITAR_TAB_TEST_RESULTS.md` records current unit/browser/build outcomes. The benchmark is local Node/Vite SSR core analysis, excluding decode, rendering, network and user review. RSS is process-wide before/after, **not peak algorithm/browser/mobile memory**.

Five generated signal cases include a five-note melody with repetition, silence, noise, triad and octave mixture. They are development fixtures, not recorded guitars. The melody matches 5/5 pitches/onsets within 70 ms; silence/noise/triad return no events. The octave mixture returns one lower pitch: evidence that monophonic filtering cannot prove isolation.

Five real, labeled [GuitarSet](https://zenodo.org/records/3371780) microphone recordings were acquired: four solo clips and one comping clip, all player 0, CC BY 4.0. Exact audio hashes and unaltered source note labels are included in `test-fixtures/audio-notes/guitarset/`. They were obtained from the documented public mirror; labels were not independently audited by listening. Solo recordings include ringing overlaps. They are a small evaluation slice, not a broad held-out generalization study.

Real solo total: **91 matched / 325 reference notes**, **142 predictions**, **51 unmatched predictions**, **234 missed reference notes** at pitch ±0.5 semitone plus onset ±70 ms. Event precision is 64.1%; recall is 28.0%. Conditional matched-note duration MAE varies substantially by clip (about 121–363 ms). Frame pitch precision is 88.7–97.1% where the reference contains exactly one sounding note and the provider returns a pitch; corresponding pitch recall is only 18.9–54.1%. Neither high conditional frame precision nor harmonic confidence establishes good transcription coverage.

The comping limitation probe matches 12/133 reference notes with 28 predictions (16 unmatched, 121 missed). Full polyphonic note transcription, multi-guitar separation and exact voicing are unsupported. No real electric/distorted/vocal/full-band corpus, physical iPhone/Android, maximum-duration stress or production deployment is claimed.

## Next work

First improve onsets, soft tails, repeated notes and fragmentation against a wider independently labeled corpus; compare a licensed stronger provider under the existing contract. Keep abstention and frame/event metrics separate. Then evaluate human fingering preference, device peak memory, long-file cancellation, offline/PWA lifecycle and authenticated metadata sync. Do not remove confirmation gates based on these results.
