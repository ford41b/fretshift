# Immersive Practice release gate

**2026-10-02: the hard "Coming soon" gate has been replaced by criteria-based release flags.** Details, evidence and the iPhone checklist are in [IMMERSIVE_RELEASE_HANDOFF.md](../handoffs/IMMERSIVE_RELEASE_HANDOFF.md).

## How the gate works now

- `src/audio/immersive/release.ts` defines one flag per feature. Each flag has criteria; a feature is **on only when every criterion is met**. Each criterion names its evidence kind: synthetic, local, emulated or physical.
- Two criteria are computed from committed evidence files rather than hand-set:
  - **Chord scoring** follows `src/audio/immersive/evidence/chord-evaluation.json`. The thresholds in `chordEvaluation.ts` are recomputed from the outcome counts. Only `evidence: "physical"` can pass; synthetic data never qualifies.
  - **BETA badge** follows `src/audio/immersive/evidence/physical-acceptance.json`. The badge stays until `complete` is true and `failedSteps` is empty.
- `/immersive` and `/immersive/:id` render `ImmersiveRoute`. It mounts the room when `canOpenImmersive()` allows it. Reviewed audio songs always could; every other song can while the room flag is on. `ImmersiveBeta` ("Coming soon") is kept only as the fallback for an unreleased room. It never starts the microphone, the audio clock or the scorer.
- The library page and the room's Technical details show **What's on in this beta**: each feature, on or off, and why.

## Current flags

| Feature | State | Reason |
| --- | --- | --- |
| Room for every song (setup, guided lane, quiet visual) | on | Emulated Chromium + WebKit tests pass |
| Scored single notes, ordinary songs | on | Same compiler and safeguards as audio-review songs; passages with chords, muted attacks or overlaps stay guided/visual |
| Scored confirmed notes, audio-review songs | on | Unchanged confirmation, staleness and overlap rules |
| Guided timing calibration | on | Unit and emulated E2E evidence; physical latency not yet measured |
| Chord scoring (required-tone coverage) | **off** | No real labeled recordings; thresholds unmet |
| BETA badge | **shown** | Physical iPhone checklist not yet run |

## Unchanged safeguards

- Microphone audio stays on the device. The capture worklet outputs silence, and analysis runs in a local worker.
- Scored practice plays no guide audio or click. Calibration clicks play only during setup calibration, which scores nothing.
- Quiet visual mode never requests the microphone and never awards performance credit.
- Early, late, wrong, missed, uncertain, unsupported, skipped and unassessed results stay distinct.
- Confirmation gates are kept: confirmed audio notes, imported-timing review before Rhythm, and stale-chart rejection.

## Verification

`node scripts/verify-immersive-beta-gate.mjs` checks:

- the routing and the badge wiring
- that the room honours each flag
- the safety rules (no guide audio in the room, a silent worklet, no network calls in Immersive audio code)
- flags equal to the criteria recomputed from the evidence files
- that the handoff and checklist docs exist

CI runs it on every push.

## History

- Before 2026-10-02, `/immersive` and ordinary songs at `/immersive/:id` rendered `ImmersiveBeta`. Only songs with `provenance.audioReview` mounted the room.
- Phase 3 added scoring for confirmed single notes in audio-review songs.
- Two redundant `mode === "visual"` expressions in the then-unmounted room had been corrected for strict TypeScript. No Supabase or backend change was ever needed for the gate.
