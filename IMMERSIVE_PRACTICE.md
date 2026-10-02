# FretShift Immersive Practice

> **Status 2026-10-02: released behind criteria-based flags, still BETA.**
>
> - **On:** the room for every song, scored single notes on ordinary and audio-review songs, and guided timing calibration.
> - **Off:** chord scoring. It is built and harnessed, but no real recordings exist yet.
> - **BETA** stays until the physical checklist at the end of this file passes.
>
> Evidence for every claim is labelled synthetic, local, emulated or physical. **No physical (real phone and guitar) evidence exists yet.** Details: [IMMERSIVE_RELEASE_HANDOFF.md](IMMERSIVE_RELEASE_HANDOFF.md). Gate: [IMMERSIVE_BETA_GATE.md](IMMERSIVE_BETA_GATE.md).

No deployment, external inference, paid API, new production dependency or audio upload was added. Microphone audio never leaves the device.

## Try it

Use Node 22 (`.nvmrc`) and pnpm 10.15.1 with the lockfile:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `/immersive` and choose a song, or choose **Immersive practice** from a song or practice screen. The selected measure range carries into setup.

For a ready-made test chart, import [docs/immersive/iphone-acceptance-song.json](docs/immersive/iphone-acceptance-song.json) via **Import → JSON**. Measures 1–4 are single notes and can be scored. Measure 5 is a chord and measure 6 is a held overlap; both stay guided.

## What works

- **Every song opens the room.** Scored **Learn** and **Rhythm** are available when every target in the selected passage is a supported single note: one sounding note, MIDI 40–88, no muted (x) attack, no note sounding over a held string. This uses the same `compileTargets` for ordinary and audio-review songs.
  - Passages with chords, muted attacks or overlaps stay guided and **Quiet visual**.
  - Setup lists the song's **Scored single-note passages** as shortcuts.
  - Audio-review songs keep their stricter rules: confirmed, non-overlapping, playable notes and a current chart signature.
- **Lane and layout.** A six-string lane with a fixed play line, fret/chord targets, and text and icon feedback. Portrait and landscape, safe-area padding, a mirrored left-handed view, reduced-motion stepping and an optional fullscreen fallback.
- **Microphone handling.** Permission and cancellation, a one-second quiet-room check, a live level meter and a tuner.
- **Guided timing calibration** (new; see below). The measured per-device value is the timing default; the manual slider stays as an override.
- **Learn mode** waits for a stable matching note. Wrong or uncertain input doesn't advance. Skip awards nothing. Repeated notes need a fresh attack. Timing is not graded.
- **Rhythm mode** uses the audio clock, a visual count-in and beat, 25/50/60/75/100% speed, selected passages and looping with a fresh count-in. Note match and onset timing are separate. Early, late, wrong, missed, uncertain, unsupported and extra attacks remain distinct.
- **Results.** Pitch matches, assessed coverage, timing coverage, on-time counts, mean signed offset, the timing adjustment applied (and whether it was calibrated, manual or none), and the uncertain, unsupported, skipped and unassessed counts. Results suggest troublesome measures and let you retry a passage or measure.
- **Session summaries** are local and backup-only. They are never uploaded by sync. Two new optional fields, `timingOffsetMs` and `timingOffsetSource`, keep older records valid.
- **Lifecycle.** Tracks, worker, worklet port, audio context and listeners are cleaned up. Backgrounding, suspended, disconnected or noisy input, an analysis backlog and a stalled startup each pause or fail explicitly. No background time is scored.
- **Offline.** The production build works offline after the first visit. The service worker now matches cached assets with `ignoreVary`, so hosts that send `Vary: Origin` still load offline in Chromium.

## Supported conditions and limits

**Scored scope.**

- Clean, monophonic acoustic or clean electric guitar, sounding MIDI 40–88 (E2–E6).
- Clear attacks in a quiet room.
- Rhythm needs at least **320 ms between written attacks**; slow down denser passages. Learn can wait indefinitely.
- Distortion, legato without a new attack, vibrato, very soft playing and noisy rooms are not validated.

**Chords.** Chords are **not scored in this build.** Chord scoring by **required-tone coverage** is implemented behind the `chordScoring` flag, which is off. Every written pitch class must be heard at an octave the voicing places it. Harmonics of other chord tones don't count. A strong foreign note counts as wrong. Anything unclear is *uncertain*.

The flag turns on only when the evaluation harness shows the release thresholds on **real labeled recordings**: false accepts on wrong chords ≤ 2% with a Wilson 95% upper bound ≤ 5%, plus the other thresholds in the handoff. See the [recording checklist](docs/immersive/chord-recording-checklist.md).

Until then:

- chords, muted attacks and notes over held strings stay guided targets
- C, Am, Fmaj7, incomplete strums and root-only signals cannot earn credit
- individual-string correctness is never claimed

**Compiler.** The compiler reads the actual tablature and voicings, tuning, capo, meter and per-measure tempos. Rests and holds are not new attacks. Chord-only charts use their written change positions. Imported or generated timing (ChordPro, audio, PDF, photo) needs review before Rhythm.

**Sound sources.** Scored practice plays **no guide instrument, click or accompaniment**. Quiet visual mode is visibly unscored and never requests the microphone. Microphone audio cannot prove its source: a speaker playing the notes is indistinguishable from a guitar. Use headphones for any external accompaniment.

## Recognition and timing design

**Scoring.** `src/audio/immersive/score.ts` owns target compilation, scorable-passage discovery, one-to-one event matching and summaries.

- Attacks match within ±220 ms of written events, and nearly equal adjacent candidates become uncertain.
- Timing is on time within ±80 ms.
- Missed decisions wait for processed microphone evidence.
- Interrupted windows become uncertain. Future events stay unassessed if the session ends early.

**Capture and analysis.** `capture.worklet.js` timestamps 1024-sample packets on the audio clock and outputs silence. `analyze.worker.ts` runs YIN and an FFT with a 4096-sample window, harmonic purity, an energy rise, three stable frames and a refractory interval.

- **Onset rule (changed 2026-10-02).** An onset must rise 1.65× above the **louder of the previous two packets**. Before, it compared against only the last packet, and beating between ringing strings could fake an onset.
- **No target hints.** The classifier never receives the expected pitch and never folds octaves toward it. Pitch confidence is a heuristic, not a percentage score.

**Timing calibration** (`calibration.ts`, `ImmersiveCalibration.tsx`).

- **Phases.** A still check plays 3 clicks while the strings are kept still; a click heard by the microphone stops calibration. Then a 4-cue count-in and 12 tap cues (clicks for wired headphones, or a visual pulse).
- **Measurement.** It uses the scoring pipeline's own attack timestamps. Only pitched taps count. The median is taken after outlier rejection.
- **Refusals.** Too few taps (< 8), inconsistency (robust SD > 35 ms) or implausible values (outside −100…+250 ms).
- **Storage.** Saved per microphone in this browser's `localStorage`; never synced or backed up.
- **Scope.** It measures input-side delay plus the player's habit around a cue, after subtracting the browser-reported click output latency. It **does not measure display latency**. Bluetooth output latency may be unreported in Safari, so use wired headphones or the visual pulse. The manual slider remains for overrides.

## Validation

**Current (2026-10-02)**: see [IMMERSIVE_RELEASE_HANDOFF.md](IMMERSIVE_RELEASE_HANDOFF.md) for full counts and the CI run.

- Local:
  - `pnpm lint` and `pnpm build` pass.
  - Vitest: **383 tests in 35 files**.
  - The beta-gate script passes.
  - Immersive E2E on Chromium: **15 passed, 0 skipped**. That includes the 5 controlled-microphone tests, re-enabled after root-causing the Chromium AudioWorklet hang as a Playwright debugger-attach artifact, plus 2 calibration tests and the ordinary-song tests.
  - The audio-notes microphone test passes on Chromium.
  - The production offline check passes on Chromium.
- CI (GitHub Actions): the full E2E suites in Chromium and WebKit, plus the offline check in both.
- All of this is **emulated or local**, not physical.

**Historical (earlier builds, retained for context).**

- 18 generated plucks, E2–E6 at 44.1 and 48 kHz, gave 18/18 stable identities, available 132.2–134.7 ms after generated onset. There were no extra detections in 2 s of silence or quiet noise. Analysis cost was a median of 1.67 ms (p95 1.86 ms) per window on that host. See the [benchmark JSON](docs/immersive/synthetic-benchmark.json).
- These are deterministic fixtures, not real-guitar accuracy.
- Earlier WebKit passes (10 tests) and the Chromium startup observation from the previous host are superseded by the current counts.

## Physical iPhone / guitar acceptance checklist: pending

The step-by-step version, with expected results, is in **[IMMERSIVE_RELEASE_HANDOFF.md → iPhone acceptance checklist](IMMERSIVE_RELEASE_HANDOFF.md#iphone-acceptance-checklist)**. In summary:

1. Safari **and** the installed PWA over HTTPS: allow and deny the microphone, cancel and retry, lock or background and return, disconnect, exit. Tracks stop and no background credit appears.
2. Timing calibration with wired headphones (three runs agree within about ±15 ms), through the phone speaker (refused or unchanged), and with Bluetooth plus the visual pulse. The manual override works.
3. With clean acoustic and clean electric guitar, play E2–E6 single notes in Learn and Rhythm at 60–100%. Include wrong semitones and octaves, repeated sustained notes (no advance without re-picking), early and late notes, silence, extra plucks, two loops, and pause near an attack. Log against what you played.
4. Chords and overlaps stay unscored in this build. With chord scoring on (future), only correct chords may earn ✓. Speaker playback and quiet visual mode are documented as never proof of playing.
5. Both orientations, left-handed, VoiceOver, Larger Text, reduced motion, visible Pause and Exit, offline reload, and saved results after reopening.

When it passes, record it in `src/audio/immersive/evidence/physical-acceptance.json` (`complete: true`, devices, date, empty `failedSteps`) and rebuild. That removes the BETA badge.

Screenshots from the earlier build: [portrait](docs/immersive/portrait.png), [landscape](docs/immersive/landscape.png).
