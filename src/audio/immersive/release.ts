import chordReport from "./evidence/chord-evaluation.json";
import physicalAcceptance from "./evidence/physical-acceptance.json";
import {
  chordThresholdFailures,
  type ChordEvaluationReport,
} from "./chordEvaluation";

/**
 * Criteria-based release flags for Immersive Practice. A feature is on only
 * when every criterion is met. Each criterion names the kind of evidence it
 * rests on, so nothing emulated is presented as physical:
 * - synthetic: generated signals, not recordings
 * - local: unit tests / scripts on a development host
 * - emulated: headless Chromium or WebKit with a controlled Web Audio microphone
 * - physical: a real phone, microphone and guitar
 * Automated criteria are re-checked by CI on every push; the chord and
 * physical criteria are computed from committed evidence files.
 */
export type EvidenceKind = "synthetic" | "local" | "emulated" | "physical";
export type Criterion = { text: string; evidence: EvidenceKind; met: boolean };
export type ReleaseFeature = {
  id: "room" | "ordinarySingleNotes" | "audioReviewSingleNotes" | "latencyCalibration" | "chordScoring";
  label: string;
  enabled: boolean;
  why: string;
  criteria: Criterion[];
};

export const chordReleaseFailures = chordThresholdFailures(chordReport as ChordEvaluationReport);
const physicalComplete =
  physicalAcceptance.complete === true && physicalAcceptance.failedSteps.length === 0;

function feature(
  id: ReleaseFeature["id"],
  label: string,
  criteria: Criterion[],
  on: string,
  off: string,
): ReleaseFeature {
  const enabled = criteria.every((c) => c.met);
  return { id, label, enabled, why: enabled ? on : off, criteria };
}

const emulatedMic: Criterion = {
  text: "Controlled-microphone browser tests pass in Chromium and WebKit (capture worklet, analysis worker, pause, background, disconnect, cleanup)",
  evidence: "emulated",
  met: true,
};

export const IMMERSIVE_FEATURES: Record<ReleaseFeature["id"], ReleaseFeature> = {
  room: feature(
    "room",
    "Immersive practice room for every song",
    [
      emulatedMic,
      { text: "Quiet visual mode never requests the microphone or awards performance credit", evidence: "emulated", met: true },
    ],
    "Setup, guided targets and quiet visual practice work for any chart.",
    "Only reviewed audio songs open the room.",
  ),
  ordinarySingleNotes: feature(
    "ordinarySingleNotes",
    "Scored single notes on ordinary songs",
    [
      { text: "Uses the same target compiler and safeguards as audio-review songs: one sounding note, MIDI 40–88, holds and chords unscored, timing review for imported charts", evidence: "local", met: true },
      { ...emulatedMic, text: "Ordinary-song single-note passage scored through the controlled microphone in Chromium and WebKit" },
    ],
    "Passages whose every target is a supported single note can use Learn and Rhythm. Passages with chords stay guided/visual.",
    "Ordinary songs are visual-only.",
  ),
  audioReviewSingleNotes: feature(
    "audioReviewSingleNotes",
    "Scored confirmed notes on audio-review songs",
    [
      { text: "Only confirmed, non-overlapping, playable notes are targets; stale charts are rejected", evidence: "local", met: true },
      emulatedMic,
    ],
    "Confirmed audio notes can be scored by sounding pitch.",
    "Audio-review songs are visual-only.",
  ),
  latencyCalibration: feature(
    "latencyCalibration",
    "Guided timing calibration",
    [
      { text: "Median, outlier rejection, plausibility, click-leak and per-device storage logic unit-tested", evidence: "local", met: true },
      { text: "Guided calibration completes against an emulated microphone in Chromium and WebKit", evidence: "emulated", met: true },
    ],
    "Measures the input-side offset on this device and uses it as the timing default; the manual override stays.",
    "Timing uses the manual adjustment only.",
  ),
  chordScoring: feature(
    "chordScoring",
    "Chord scoring (required-tone coverage)",
    [
      { text: "Required-tone coverage judge with an explicit uncertain outcome and evaluation harness", evidence: "synthetic", met: true },
      { text: "Harness thresholds met on real labeled guitar recordings", evidence: "physical", met: chordReleaseFailures.length === 0 },
    ],
    "Chords are scored by required-tone coverage.",
    "Off until real labeled recordings meet the release thresholds. Chords stay guided and unscored.",
  ),
};

/** The beta badge stays until the physical-device checklist is recorded as passed. */
export const IMMERSIVE_BETA = !physicalComplete;
export const PHYSICAL_ACCEPTANCE = physicalAcceptance;

/** Ordinary songs open the room only when it is released; reviewed audio songs always could. */
export function canOpenImmersive(isAudioReviewSong: boolean) {
  return isAudioReviewSong || IMMERSIVE_FEATURES.room.enabled;
}
export function scoringEnabledFor(song: { provenance?: { audioReview?: unknown } }) {
  return song.provenance?.audioReview
    ? IMMERSIVE_FEATURES.audioReviewSingleNotes.enabled
    : IMMERSIVE_FEATURES.ordinarySingleNotes.enabled;
}
