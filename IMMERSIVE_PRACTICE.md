# FretShift Immersive Practice — local implementation

Built from `FretShift-Defrosted-Liquid-Glass.zip`. The original attachment and the older workspace copy were left intact. No deployment, external inference, paid API, new production dependency, or audio upload was added.

## Try it

Use Node 24 LTS and the existing pnpm lockfile:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `/immersive`, or choose **Immersive practice** from a song or ordinary practice screen. The existing selected measure range carries into setup. Desktop navigation has a new entry; compact navigation includes it under More. `House of the Rising Sun` includes single-note targets; its initial muted target is guided/unscored and can be skipped. You can also import or edit your own tablature.

Local preview for this session: http://127.0.0.1:5187/immersive

## What works

- Six-string lane, fixed play line, fret/chord targets, text and icon feedback, familiar FretShift typography, purple accents and existing assets. Portrait and landscape layouts, safe-area padding, mirrored left-handed view, reduced-motion target stepping, and optional fullscreen with a useful fallback. No mandatory orientation lock.
- Microphone permission and cancellation, one-second quiet-room check, live level, tuner using the existing A4 setting, explicit manual timing adjustment, and visual-only practice.
- Learn mode waits for a sufficiently stable matching note. Wrong/uncertain input does not advance. Skip awards no hit and invalidates pending earlier attacks. Repeated notes need a fresh attack. Timing is not scored; completed-target results include retries rather than grading first attempts.
- Rhythm mode uses the audio clock, visual count-in and beat indicator, 25/50/60/75/100% speed, selected passages, and looping with a new count-in. Note match and onset timing are separate. Early, late, wrong, missed, uncertain, unsupported and extra attacks remain distinct.
- Results show pitch matches, assessed coverage, timing coverage, on-time attack counts, mean signed timing offset, uncertain/unsupported/skipped/unassessed counts and troublesome measures. Retry the passage or a troublesome measure. Exit from a running session leads to results and releases the microphone.
- Optional practice-session summary fields preserve old records and backup compatibility without changing IndexedDB stores. Summaries appear in Progress, are filtered by the account captured at session start, and remain local/backup-only. The existing cloud sync continues to handle ordinary sessions; immersive summaries are explicitly excluded from upload. Song/share schemas contain no practice-only data.
- Tracks, worker, worklet port, source nodes, audio context and listeners are cleaned up. Backgrounding, suspended/disconnected/noisy input, analysis backlog and stalled startup pause or fail explicitly. Returning requires a deliberate reconnect. No background time is scored.

## Supported conditions and limits

**Scored scope:** clean, monophonic acoustic or clean electric guitar, sounding MIDI 40–88 (E2–E6), sufficiently strong attacks in a quiet room. Start around 60–120 quarter-note BPM with at least **320 ms between written attacks**. Rhythm mode blocks denser passages until slowed down. Learn mode allows waiting indefinitely. Distortion, legato without a new attack, overlapping ringing strings, very soft playing, vibrato-induced envelope changes and noisy rooms are not validated.

**No chord quality or voicing is currently scored.** Chords, muted attacks and notes sounding over held strings are guided targets. Learn uses explicit Skip for them; Rhythm marks them unsupported. C, Am, Fmaj7, incomplete strums and root-only signals cannot earn chord hits. The existing two-candidate chroma matcher does not prove required-tone coverage, independent alternatives or complete strums. No labeled guitar corpus was supplied to establish an adequate unknown/rejection boundary. This is the exact blocker to enabling chord scoring. Chord similarity would still not establish individual-string correctness.

The compiler reads the actual tablature/voicings, tuning, capo, transformed frets, meter and per-measure tempos. Rests and holds are not new attacks. Held notes crossing the passage boundary do not get re-attacked. Simultaneous sounding notes form one unsupported polyphonic target. Chord-only charts use their written change positions and require explicit timing review; no strum pattern is invented. Imported/generated timing from ChordPro, audio or PDF/photo sources also requires review before Rhythm mode.

Scored practice emits **no guide instrument, click or accompaniment**. Quiet visual mode is visibly unscored. There is no scored speaker-playback option or automatic headphone detection. Use headphones for any external accompaniment; microphone audio cannot prove its source or establish which string/finger made an identical pitch.

## Recognition and timing design

`src/audio/immersive/score.ts` owns target compilation, one-to-one event matching and summaries. Attacks match within ±220 ms of written events, including offbeats; nearly equal adjacent candidates become uncertain. Timing is on time within ±80 ms. Wrong pitch and timing remain independent. Missed decisions wait for processed microphone evidence, not merely an animation frame. Interrupted event windows become uncertain; future events remain unassessed when a session ends early.

`capture.worklet.js` timestamps 1024-sample packets against the audio clock, outputs silence, and forwards input to `analyze.worker.ts`. The worker reuses YIN and the FFT, with a 4096-sample window, harmonic purity, energy rise, three stable frames and a refractory interval. Broad-spectrum noise is distinguished from unrecognized polyphony. It never receives the expected pitch or folds octaves toward the target. A stable identity is attached to the earlier attack timestamp. Pitch confidence is a heuristic evidence measure, never a performance percentage.

The main thread renders the timeline; it does not run pitch classification. This follows the browser's [AudioWorklet frame clock](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame). Capture block quantization, device input latency and visual/display delay remain relevant. The timing slider subtracts the chosen offset; it is **not a measured hardware-latency calibration**. There is no guide-audio output latency to compensate in scored mode.

## Validation performed

- `pnpm lint` and `pnpm build`: passed.
- Full Vitest suite: **252 tests passed across 24 files**, using bundled Node 24. System Node 26 exposed a pre-existing jsdom/localStorage test-environment failure; no application workaround was added for that test-runner issue.
- New immersive suite: **10 WebKit tests passed**. Controlled Web Audio streams exercise the actual capture worklet and analysis worker, wrong notes, sustained/repeated notes, results/persistence, healthy silence, permission denial, pause/reconnect, disconnection, backgrounding, exit cleanup, unsupported chord gating, loop reset and bounded startup failure. Rhythm silence/loop checks were rerun after the final analysis-watermark change and passed.
- **4 Chromium checks passed**: permission-denial fallback, portrait, landscape, accessibility and stalled-processor cleanup. Full scored microphone validation is blocked on this host: both installed Chrome 153 and Playwright Chromium 140 leave `audioWorklet.addModule()` pending even for a minimal independent processor. The app times out and releases input rather than hanging. This host observation is not proof of a universal Chrome incompatibility; successful scored Chromium input still needs validation.
- Mobile viewport checks at **390×844 and 844×390**, including reduced motion and serious/critical axe accessibility checks. Pause remains entirely within the tested landscape viewport. These are browser emulations, **not physical iPhone tests**.
- Production offline test: **passed in WebKit** with the serving process stopped after the service worker installed. Reload, cached capture/analysis, controlled note recognition, track cleanup, navigation and persisted summary worked without the app server. The PWA manifest is now precached. Playwright WebKit's `setOffline(true)` produced an internal navigation error; the successful test used a stopped origin instead. The pre-existing Vercel analytics script is unavailable in local preview and excluded from runtime-error assertions; no audio is sent to it.
- Existing regression cases: **56 of 57 passed**, counting the isolated successful rerun of the MIDI import/export case. The remaining WebKit strumming desktop-width test (`strumming.spec.ts`, 1280 px, opening “Musical inputs & assumptions”) times out because existing elements intercept its click. It reproduces against a fresh extraction of the untouched supplied archive. It was not rewritten as part of this feature. Existing editing, ordinary practice, persistence, interchange and mocked account-sync checks otherwise passed.

Run focused checks with:

```sh
pnpm exec vitest run src/audio/immersive
pnpm exec playwright test -c playwright.immersive.config.ts --project=webkit
pnpm build
node scripts/verify-immersive-offline.mjs
```

`playwright.immersive.config.ts` defaults to Playwright's installed Chromium; `E2E_CHANNEL=chrome` selects installed Chrome. Browser binaries can be installed with the existing Playwright CLI. No new npm packages were added.

## Measurements and their limits

The two supplied screen recordings were reviewed as visual interaction references only. They were not used as a labeled audio dataset. No appropriate real-guitar recordings or physical instrument input were available.

Generated fixtures include harmonic plucks with evolving harmonic decay, short attacks, deterministic noise, repeated/sustained notes, transitions, chord mixtures and staggered partial strums. The retained [benchmark JSON](docs/immersive/synthetic-benchmark.json) contains all 18 single-pluck cases: nine pitches from E2 to E6 at 44.1 and 48 kHz.

| Fixture measurement | Observed |
| --- | --- |
| Correct stable identities | 18 / 18 generated plucks |
| False negatives / extra attacks in those fixtures | 0 / 0 |
| Stable identity availability after generated onset | 132.2–134.7 ms |
| Fixture recognition coverage | 18 / 18; not real-guitar coverage |
| Extra detections in 2 s silence / 2 s quiet noise | 0 / 0 |
| Analysis CPU cost, 100 E2 windows | median 1.67 ms; p95 1.86 ms on this host |
| Packet interval at 48 kHz | 21.33 ms |

CPU measurements vary with device/load. Recognition delay excludes real capture hardware, browser input buffering, main-thread delivery and display latency. These small deterministic fixtures do not establish field false-positive/negative rates, acoustic robustness, or parity with Simply Guitar. Live performance accuracy and real-device recognition coverage remain unmeasured.

## Physical iPhone / guitar acceptance checklist — pending

1. On the normal HTTPS test environment, test Safari and installed PWA: allow/deny permission, cancel/retry, disconnect/reconnect, lock/background and return. Confirm tracks stop and no background credit appears.
2. With clean acoustic and clean electric guitar, play E2–E6 notes at 60/90/120 BPM where spacing permits. Include silence, wrong semitones, wrong octaves, repeated sustained notes, softly re-picked notes and transitions. Log hits, wrongs, uncertain results, missed attacks and coverage against a labeled recording.
3. Check offbeats, tempo changes, tuning/capo, held notes, a selected passage, pause near an attack, two loop passes and several manual offsets. Measure onset-to-feedback delay separately from timing alignment; do not infer hardware latency from human playing.
4. Try C/Am/Fmaj7, root-only notes, partial/noisy strums and ringing overlaps. Confirm no chord hits or per-string correctness claims appear. Verify noisy/clipping input pauses safely.
5. Check both orientations, left-handed setting, VoiceOver/large text/reduced motion, visible Pause/Exit, offline reload after initial cache, and saved results after reopening. Confirm quiet visual mode and external playback alone never award performance credit.

Screenshots: [portrait](docs/immersive/portrait.png), [landscape](docs/immersive/landscape.png). Review the source patch alongside this note. Real-device acceptance remains open.
