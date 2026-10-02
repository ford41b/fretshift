# Immersive Practice — release handoff (2026-10-02)

Branch `claude/beautiful-volta-6mohgx`. Immersive Practice moves from a hard "Coming soon" gate to criteria-based release flags. Single-note scoring now works on ordinary songs as well as audio-review songs. Timing calibration is new. Chord scoring is built but **off**. The **BETA** badge stays until you complete the iPhone checklist below.

**Evidence labels.** Every claim below names its evidence:

- **synthetic**: generated signals, not recordings.
- **local**: unit tests or scripts on this development container.
- **emulated**: headless Chromium or WebKit driven by Playwright, with a controlled Web Audio "microphone".
- **physical**: a real phone, microphone and guitar. **No physical evidence exists yet.**

## Status

| Feature | Flag | Why | Strongest evidence |
| --- | --- | --- | --- |
| Immersive room for every song (setup, guided lane, quiet visual) | **on** | Criteria met | emulated (Chromium + WebKit) |
| Scored single notes, ordinary songs | **on** | Same compiler and safeguards as audio-review songs; mic E2E passes | emulated |
| Scored confirmed notes, audio-review songs | **on** | Unchanged rules; mic E2E passes | emulated |
| Guided timing calibration | **on** | Logic unit-tested; guided run passes against an emulated mic | local + emulated |
| Chord scoring (required-tone coverage) | **off** | No real labeled recordings; release needs the thresholds below on a *physical* corpus | synthetic only |
| BETA badge | **shown** | Physical checklist not done (`physical-acceptance.json` → `complete: false`) | none |

The flags live in `src/audio/immersive/release.ts`. A feature turns on only when every one of its criteria is met. The chord flag is computed from the outcome counts in `src/audio/immersive/evidence/chord-evaluation.json`, not from a stored pass/fail boolean. The badge is computed from `src/audio/immersive/evidence/physical-acceptance.json`. The library page shows the same list under **What's on in this beta**. `node scripts/verify-immersive-beta-gate.mjs` recomputes the flags from the evidence files and fails if they disagree. CI runs it on every push.

## What changed

### 1. Latency calibration

**Flow.** Setup panel 02 → **Calibrate timing** (about 15 s, available once the microphone is ready):

1. **Still check.** Three clicks play while the strings are kept still. Any onset aligned with a click means the microphone hears the speaker, so calibration stops ("use wired headphones or the visual cue"). Any other sound also stops it.
2. **Count-in.** Four cues.
3. **Taps.** Twelve cues; the player plucks one open string on each.

There are two cue options:

- **Clicks · wired headphones** (the default)
- **Visual pulse · no audio**, for Bluetooth-only setups

**Measurement.** It uses the same capture worklet, analysis worker and attack timestamps as scoring:

- **Offset per tap.** The offset is the detected attack time minus the cue's output time. For clicks, the output time is the scheduled time plus `baseLatency + outputLatency`, where the browser reports them.
- **Pitched taps only.** Only attacks with a stable pitch count, so a leaked click (an unpitched noise burst) can never be a tap.
- **Outlier rejection.** The median is taken, then taps more than max(30 ms, 3 × robust SD) from it are rejected, then the median is retaken.
- **Refusals.** Calibration refuses fewer than 8 usable taps, a robust spread above 35 ms, a result outside −100…+250 ms, and noisy or clipping input. A refusal saves nothing.

**Storage.** Results are stored per microphone label in this browser's `localStorage` (`fretshift:immersive-calibration:v1`). They are never synced or backed up. The stored value replaces the 0 ms default when that microphone connects. The **manual slider stays** under Advanced (−200…+250 ms, 1 ms steps) and is labelled *calibrated*, *manual override* or *not calibrated*. A **Use calibrated value** button returns to the measurement. Each saved session records `timingOffsetMs` and `timingOffsetSource`.

**Limits.**

- **What it measures.** It captures input-side delay plus your habit around a cue. It does **not** measure screen delay, and scored practice follows a visual lane.
- **Bluetooth.** Safari may not report Bluetooth output latency. That is the reason for the plausibility limit, the visual-cue option and the headphone advice.
- **No physical measurement yet.**

**Evidence.**

- **Unit tests** (local): 15 cases in `calibration.test.ts`.
- **E2E** (emulated): two tests in `e2e/immersive.spec.ts`:
  - Median and outlier rejection: two taps deliberately 200 ms late are rejected. The stored value becomes the default, a manual override can be reverted, no clicks play during scored practice, the session records `calibrated`, and the value persists after reload.
  - Leakage refusal: nothing is saved.
- **Emulated values.** These are the fake-microphone pipeline, **not hardware latency**:
  - Headless Chromium 141 (local): +2 to +36 ms across 11 runs, with 10 of 12 taps used. Robust spread was 8.6–12.1 ms; reported output delay was 42 ms.
  - CI Chromium 140: +4 ms, 10 of 12 taps used.
  - CI WebKit 26: +15 ms, 9 of 12 taps used (2 outliers, 1 unclear). Spread was 13.8 ms. WebKit reports no `outputLatency`; base latency was 3 ms.

### 2. Ordinary songs, single notes

- **Routing.** Every song opens the room. Scored Learn/Rhythm is available when every target in the selected passage is supported. The test uses the same `compileTargets` as audio-review songs:
  - one sounding note, MIDI 40–88
  - no muted (x) attack
  - no note sounding over a held string
- **Chords stay guided.** Passages with chords, muted attacks or overlaps stay guided and quiet-visual only.
- **Passage shortcuts.** The setup screen lists **Scored single-note passages in this song**: measure ranges found by the same compiler (`scorablePassages`).
- **Safeguards unchanged.** Imported ChordPro/PDF/photo/audio timing still needs review before Rhythm. Learn still needs a fresh attack. Skip awards nothing. Quiet visual never requests the microphone or awards credit. No guide audio or click plays in scored practice. The bundled "House of the Rising Sun" sample opens every measure with a muted-string target, so it correctly offers no scored passage.
- **Evidence.**
  - Unit (local): 7 cases in `passages.test.ts`.
  - E2E (emulated):
    - Learn through the controlled mic on an ordinary song and on an audio-review song.
    - A mixed song: the chord passage is visual with 0 microphone requests, and the single-note shortcut is scored 3/3.
    - All existing room tests, which now run on ordinary songs.

### 3. Chord scoring: designed, harnessed, flag off

**Judge** (`src/audio/immersive/chord.ts`).

- **Required-tone coverage.** Every pitch class in the written voicing must be heard at an octave the voicing places it: the fundamental, or its octave if that isn't a harmonic of another chord tone. So C's third harmonic can't stand in for a missing G.
- **Extra notes.** A strong peak that no chord tone explains, and that has its own 2nd or 3rd harmonic, counts as a wrong note.
- **Outcomes.**
  - **hit**: full coverage, no extra notes, ≥ 70% of peak energy explained.
  - **wrong**: coverage below 50%, or an extra note.
  - **uncertain**: everything else.
- **Not assessed.** Per-string correctness and strum completeness beyond pitch classes are not assessed. An incomplete strum that still sounds every chord tone can be accepted.
- **Live path.** It runs live only with the flag on. The recognizer keeps an 8192-sample window and attaches spectral peaks to each attack. Chord targets with known voicings become supported, and Learn advances only on a hit.

**Release thresholds** (`chordEvaluation.ts`), checked on a **physical** corpus only:

| Criterion | Threshold | Why |
| --- | --- | --- |
| Corpus size | ≥ 150 correct, ≥ 100 wrong-chord, ≥ 50 missing-tone strums, ≥ 20 muted or silent clips, ≥ 8 chord shapes | Bounds below are meaningless on small samples |
| False accept on wrong chords | ≤ 2% point **and** Wilson 95% upper bound ≤ 5% | A false ✓ teaches the mistake and costs trust. 0/100 → 3.7% passes. 1/100 → 5.4% fails, so you need about 150 wrong strums to tolerate one. |
| Missing-tone or root-only accepts | Wilson 95% upper bound ≤ 10% | Partial shapes must not earn credit; slightly looser than wrong chords |
| Muted or silent clips credited | 0 | Never |
| Correct strums accepted | ≥ 80% | Below this the feature frustrates; up to 20% may be *uncertain*, which is the safe outcome |
| Correct strums called *wrong* | ≤ 3% | Being told you're wrong when you're right is the most discouraging error |

**Harness.** `pnpm eval:chords`, in `scripts/eval-chord-recordings.mjs` and `chordHarness.ts`.

- `pnpm eval:chords --checklist` writes [docs/immersive/chord-recording-checklist.md](docs/immersive/chord-recording-checklist.md) and [the manifest template](docs/immersive/chord-recording-manifest.template.json).
- The checklist has 78 files: 10 shapes × (3 correct, 2 wrong-chord confusions, 1 missing-tone, 1 root-only), plus 4 muted and 4 silent files.
- **Recording format.** Each row has a file name, target chord, voicing (low E → high E, e.g. `x32010`), label (`correct` | `wrong-chord` | `missing-tone` | `single-note` | `muted` | `silence`), what was actually played, strum (`down` | `up` | `pick` | `none`), number of strums and dynamics. The manifest also records `evidence`, `device` and `guitar`.
- **Evaluation.** `pnpm eval:chords <folder>` reads 16/24/32-bit PCM or float WAVs, mono or stereo. It runs each file through the live recognizer, taking the room floor from the leading second and using 1024-sample packets, then through the judge. It writes `chord-evaluation-report.json`. Counting is conservative: an undetected strum is *missed* (no credit), and a hit on a surplus attack in a non-correct file counts against it.
- **Release evidence.** `pnpm eval:chords <folder> --write-release-evidence` updates the release evidence (physical corpora only). Rebuild, and the flag follows the thresholds.
- **Synthetic run.** `pnpm eval:chords --synthetic` generates the whole plan as WAVs and runs the full pipeline.

**Results (synthetic only).** Generated harmonic plucks give:

- correct 150/150 hit
- wrong-chord 0/100 hit (90 wrong, 10 uncertain)
- missing-tone 0/50 hit (all uncertain)
- root-only 0/30 hit (all wrong)
- muted 0/20 hit, silence 0/4 hit

The report refuses release because the evidence is synthetic ([report](docs/immersive/chord-synthetic-evaluation.json)). **This is a pipeline check, not guitar accuracy.**

**No real recordings were available, so the flag ships off.**

**Recognizer fix found by the harness.** Beating between two ringing low strings (for example G2 + B2, about 25 Hz) swung one 1024-sample packet's RMS by about 1.7×. That passed the 1.65× onset test and created spurious attacks: 3 attacks for 1 strum. The rise test now compares against the louder of the previous two packets. This also protects single-note practice from fake "fresh attacks" while strings ring. A regression test fails before the change and passes after it. All existing recognition and E2E tests still pass.

### 4. Chromium AudioWorklet: reproduced, root-caused, tests re-enabled

**Reproduced.** Here, Playwright 1.55 with Chromium 141.0.7390.37 (headless shell, aliased because the container has build 1194 rather than 1187) showed "Microphone processor did not start" in all 5 controlled-mic tests.

**Isolated (local).**

- Under Playwright, `audioWorklet.addModule()` stays pending in every variant tried:
  - realtime context, offline context, Blob-URL and served modules
  - new headless, `--disable-gpu`, with and without the sandbox, `AudioWorkletRealtimeThread` on and off, out-of-process audio off, `--disable-dev-shm-usage`
  - CSS `paintWorklet.addModule()` hangs too, while module Workers start
- The **same binary launched without Playwright** resolves realtime and offline `addModule()` immediately.

**Root cause.** Playwright's page session calls `Target.setAutoAttach({waitForDebuggerOnStart: true, filter: [iframe, worker, service_worker]})`. Chromium starts `worklet` targets paused for a debugger, but the filter excludes them, so nothing ever sends `Runtime.runIfWaitingForDebugger`. It is a test-harness artifact, not evidence that Chrome users can't start the worklet.

**Fix (tests only).** `e2e/support/worklets.ts` opens a test-owned CDP session and resumes `worklet` targets. It doesn't touch the page, the worklet or the audio path, and it is a no-op outside Chromium.

**Re-enabled.** 5 Immersive mic tests and the audio-notes mic test, with no Chromium skips left in those specs. They pass locally (Chromium 141) and in CI (Playwright's Chromium 140).

**Still unknown.** Real Chrome on a desktop or Android device with a real microphone.

**Offline fix found on the way.** Running the offline check in Chromium showed the custom service worker missing its cache for module scripts, CSS and fonts. The preview server sends `Vary: Origin`, and Chromium's CORS-mode requests then miss `caches.match`. The service worker now matches with `ignoreVary: true`; assets are same-origin and content-hashed. Before the fix the offline reload was blank; after it, the check passes. Production hosts may or may not send `Vary`.

### 5. Release gate

- **Routes.** `/immersive` and `/immersive/:id` use `ImmersiveRoute` → `canOpenImmersive()`. `ImmersiveBeta` ("Coming soon") remains only as the fallback if the room flag is ever off.
- **BETA badge.** Shown in navigation, the library and the room header while `IMMERSIVE_BETA` is true. Its CSS moved to a global stylesheet because the nav renders everywhere.
- **Gate script.** `scripts/verify-immersive-beta-gate.mjs` checks:
  - the routes, the badge wiring and that the room honours each flag
  - no oscillator or buffer source in the room, and a silent capture worklet
  - no `fetch`/XHR/beacon/WebSocket/Supabase calls in Immersive audio code
  - flags equal to criteria recomputed from the evidence files
- **CI.** Runs the gate script in the lint/unit/build job, and the production offline check in both E2E jobs (`BROWSER=chromium|webkit`).

## Verification

**Local (this container; Node 22.22.0, pnpm 10.15.1, frozen lockfile)**

| Check | Before | After |
| --- | --- | --- |
| `pnpm lint` (ESLint + `tsc -b`) | pass | pass |
| `pnpm test` | 326 tests / 31 files | **383 tests / 35 files**, all passed |
| `pnpm build` | pass | pass |
| `node scripts/verify-immersive-beta-gate.mjs` | pass (old gate) | pass (criteria gate) |
| Immersive E2E, Chromium (`-c playwright.immersive.config.ts --project=chromium`) | 6 passed, 5 skipped | **15 passed, 0 skipped** |
| Audio-notes controlled-mic test, Chromium | skipped | passed |
| `BROWSER=chromium node scripts/verify-immersive-offline.mjs` | not runnable (WebKit only; stale expectations) | pass |
| Full E2E, Chromium (`--project=chromium --project=chromium-unconfigured`) | 51 passed, 6 skipped (per CI record) | **61 passed, 0 skipped** |
| `pnpm eval:chords --synthetic` | n/a | runs; synthetic, release refused |

WebKit cannot run in this container: the egress policy blocks `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`. WebKit evidence comes from GitHub Actions.

**CI (GitHub Actions, ubuntu-latest, Playwright's Chromium 140 and WebKit 26.0).** See [CI record](#ci-record) at the end of this file.

## What is flagged off

1. **Chord scoring.** To turn it on:
   1. Record the checklist on your iPhone and guitar.
   2. Run `pnpm eval:chords <folder>` and fix anything it reports.
   3. Run `pnpm eval:chords <folder> --write-release-evidence`.
   4. Rebuild. The flag turns on only if every threshold passes.
   5. Then run section F2 below live before removing the beta badge.

   Recordings made with Voice Memos approximate, but don't equal, the app's raw `getUserMedia` path (echo cancellation, noise suppression and AGC off).
2. **Beta badge removal.** Complete the checklist below, then set `complete: true` with the device, iOS and Safari versions and the date in `src/audio/immersive/evidence/physical-acceptance.json`. Leave `failedSteps` empty and rebuild.

## iPhone acceptance checklist

Run this on the normal HTTPS deployment, in Safari **and** in the Home Screen PWA. The checklist is physical evidence: record the device, iOS version, date and pass/fail for each step. Note any failure in `failedSteps` with what you saw.

**Before you start**

0.1. Deploy this branch to your HTTPS test environment. Open it in Safari once while online so the service worker installs.
0.2. Tune the guitar (standard, A4 = 440) with the FretShift tuner. Quiet room. Wired headphones (USB-C or Lightning adapter) for calibration.
0.3. Put [docs/immersive/iphone-acceptance-song.json](docs/immersive/iphone-acceptance-song.json) on the phone (AirDrop or Files). In FretShift: **Import → JSON**, then choose it. You should see "FretShift iPhone check" with 6 measures:
- m1: E2 A2 D3 G3
- m2: B3 E4 G4 A4
- m3: E4 ×3
- m4: C5 D5 E5 G5
- m5: open C chord
- m6: a held low E under a new E4

**A. Entry and gate**

A1. The nav (or More menu) shows Immersive practice with **BETA**. `/immersive` shows the library and BETA. **What's on in this beta** lists chord scoring **off**. No "Coming soon" page appears.
A2. Open "FretShift iPhone check". The whole song (m1–m6) defaults to **Quiet visual**, and Learn/Rhythm are disabled. The page explains the guided chord. **Scored single-note passages** lists "Measures 1–4 · 15 notes".

**B. Permission and lifecycle**

B1. Choose the m1–4 shortcut → **Connect microphone** → **Deny**. You see "Microphone permission denied" and quiet visual still works. Allow access in Settings → Safari → Microphone and retry. "Microphone ready" appears after the 1 s still check.
B2. Start Learn, then lock the phone for 5 s and unlock. The room is paused ("in the background"), the mic indicator is gone and no credit appeared. **Reconnect** works.
B3. Start Learn, swipe to another app and back. Same as B2. Then **Exit**. The orange mic indicator disappears within a second or two.

**C. Calibration (physical latency)**

C1. With wired headphones: **Calibrate timing** → keep the strings still for 3 clicks → listen to the count-in → pluck the open A string on each of 12 clicks. It reports "Measured +N ms from K of 12 taps… Saved for this microphone". Record N and K.
C2. Repeat twice. The three results should agree within about ±15 ms. Record all three.
C3. Unplug the headphones and run calibration through the phone speaker. Expect "picked up the click itself… Nothing was saved", or, if the speaker is quiet enough not to trigger, a result close to C1. Record which.
C4. If you have Bluetooth headphones, run with **Clicks**. A result much higher than C1, or "outside the expected range", is expected. Then run **Visual pulse** without audio and record that result.
C5. Advanced shows "+N ms · calibrated". Move the slider: it shows "manual override". **Use calibrated value** restores it. Reload the page and reconnect: the calibrated value is the default again.

**D. Learn, ordinary song (single notes)**

D1. m1–4, Learn, 75%. Play each note cleanly. Every correct note shows ✓ and advances.
D2. Play a wrong semitone (F instead of E) and a wrong octave (E3 instead of E4). Each shows "× Wrong pitch" and doesn't advance.
D3. m3 (E4 ×3): let the first E4 ring without re-picking. It must **not** advance. Re-pick to advance.
D4. Use **Skip target** once. Results count it as skipped, not matched.
D5. Finish. Results show matched/assessed, coverage and uncertain/skipped counts. "Saved on this device" appears, and Progress lists the session.

**E. Rhythm (timing)**

E1. m1–4, Rhythm, 60% then 100%, with the calibrated offset. Play along with the play line. Results show on-time counts (±80 ms) and the mean signed offset. Record them. Results should say "Timing adjustment applied: +N ms · measured on this device".
E2. Play deliberately early on two notes and late on two notes (about 150 ms). They show early/late separately from pitch.
E3. Stay silent for one note: *missed*. Add an extra pluck between targets: an *extra attack* with no credit.
E4. Loop two passes. Pass 2 starts with a fresh count-in, and the results include both passes.
E5. Pause near an attack, then reconnect and resume. No stale credit appears.

**F. Chords and overlaps stay unscored**

F1. Select m5–6 manually. Learn and Rhythm are disabled with the guided-chord explanation. In quiet visual, strum C and play the m6 overlap. No ✓ or chord credit appears anywhere.
F2. *(Only once a build has chord scoring on.)* In Learn on m5, try a correct C, an Am, a root-only C, and a muted strum. Only the correct C may earn ✓; the others show wrong or uncertain. Note any ✓ for a non-C.

**G. No credit from playback or visual mode**

G1. In Learn on m1–4, play a recording or another device's speaker playing the notes (no guitar). Note any credit. Scored mode can't verify the sound source, so this documents the risk rather than a pass/fail of the app. The app itself must play **no** sound during scored practice: check that no click or guide audio plays.
G2. Quiet visual: play the guitar loudly through the passage. The summary says "unscored" with no pitch or timing scores, and no mic indicator appears.

**H. Offline PWA**

H1. Add to Home Screen. Open it once online, then turn on Airplane Mode and force-quit. Reopen from the Home Screen: the songbook and "FretShift iPhone check" load.
H2. Offline, connect the microphone (the permission may be asked again) and run D1 for 4 notes. The result saves and appears in Progress after reopening.

**I. Layout and accessibility**

I1. Portrait and landscape. Pause and Exit are visible without scrolling during practice. No horizontal scroll.
I2. Settings → left-handed: the lane mirrors.
I3. VoiceOver: setup controls, the calibration status and feedback are announced. Larger Text doesn't clip the setup buttons. With Reduce Motion, the lane steps instead of scrolling.

**J. Optional: chord corpus.** Record [the chord checklist](docs/immersive/chord-recording-checklist.md) and run `pnpm eval:chords <folder>`. Keep the report; it decides the chord flag.

When A–I pass, update `physical-acceptance.json` as described above. That removes the BETA badge.

## Known limits (unchanged unless noted)

- Scored scope: clean monophonic notes, MIDI 40–88, at least 320 ms between attacks in Rhythm, quiet room. Distortion, legato, vibrato and noisy rooms are not validated.
- Microphone evidence cannot identify the string or finger, nor whether sound came from a guitar or a speaker.
- Calibration does not measure display latency.
- The WebKit `cloud.spec.ts` dark-mode axe check, which was intermittent on `main` (a contrast reading of 1.01 caught mid-transition), now waits for animations to settle. That is a test-only change.

## CI record

[Run 14](https://github.com/ford41b/fretshift/actions/runs/37041063245) is on `8597f27`, the last commit that changes code or tests. **All three jobs are green.**

| Job | Result |
| --- | --- |
| Lint, unit tests, build | `pnpm lint`, `pnpm test` and `pnpm build` passed. `node scripts/verify-immersive-beta-gate.mjs` passed. |
| E2E (chromium) | **61 passed, 0 skipped**: 60 Chromium + 1 unconfigured. All 15 Immersive tests and the audio-notes mic test passed. Offline check (Chromium): PASS. |
| E2E (webkit) | **60 passed, 0 skipped**, including all 15 Immersive tests. Offline check (WebKit): PASS. |

**Failed runs before the fix**, all on the new calibration E2E in WebKit:

| Run | Commit | What happened |
| --- | --- | --- |
| [9](https://github.com/ford41b/fretshift/actions/runs/37033715246) | `f201f3a` | 8 of 12 taps used against an exact-count assertion. The `cloud.spec.ts` axe flake from `main` also hit this run. |
| [12](https://github.com/ford41b/fretshift/actions/runs/37037338352) | `12a0b45` | A leftover ≥ 9 bound. |
| [13](https://github.com/ford41b/fretshift/actions/runs/37039046343) | `fbcd1fa` | "Only 7 of 12 cues". |

The cause was the test's fake player. It scheduled all 12 taps up front on the fake microphone's separate AudioContext, and in CI WebKit that clock drifts from the app's. The player now reacts to each click on the app's clock, as a person would.

**The axe flake.** That `cloud.spec.ts` test switched to dark mode and then waited a fixed 250 ms. Button backgrounds animate over 150 ms while the text colour switches at once. The test now waits for running animations to finish before scanning.

Runs 10 and 11 were cancelled by newer pushes. Commits after `8597f27` change documentation only.

