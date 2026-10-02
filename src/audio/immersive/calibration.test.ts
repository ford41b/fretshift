import { beforeEach, describe, expect, it } from "vitest";
import {
  BEAT_SECONDS,
  CalibrationRun,
  calibrationPlan,
  clearCalibration,
  inputKey,
  loadCalibration,
  MEASURED_CUES,
  median,
  saveCalibration,
  summarizeTaps,
  type CalibrationRecord,
} from "./calibration";
import type { Attack } from "./score";

let id = 0;
const attack = (time: number, midi: number | null = 45): Attack => ({
  id: ++id,
  time,
  resolvedAt: time + 0.15,
  midi,
  cents: 0,
  confidence: midi === null ? 0 : 0.95,
});

describe("summarizeTaps", () => {
  it("takes the median and rejects outlier taps", () => {
    const taps = [40, 42, 38, 41, 39, 43, 40, 44, 37, 41, 180, -90];
    const r = summarizeTaps(taps);
    expect(r).toMatchObject({ ok: true, offsetMs: 41, used: 10, rejected: 2 });
  });
  it("refuses too few clear taps", () => {
    expect(summarizeTaps([40, 41, 42, 43, 44, 45, 46])).toMatchObject({
      ok: false,
      reason: "too-few",
    });
  });
  it("refuses inconsistent playing instead of averaging it", () => {
    const spread = [0, 60, 10, 70, 20, 80, 30, 90, 40, 100, 50, 110];
    expect(summarizeTaps(spread)).toMatchObject({ ok: false, reason: "inconsistent" });
  });
  it("refuses implausible delays (for example unreported Bluetooth output)", () => {
    expect(summarizeTaps(Array(12).fill(310))).toMatchObject({
      ok: false,
      reason: "implausible",
    });
    expect(summarizeTaps(Array(12).fill(-140))).toMatchObject({
      ok: false,
      reason: "implausible",
    });
  });
  it("median handles even and odd counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("CalibrationRun", () => {
  it("measures attacks against the estimated click output time", () => {
    const plan = calibrationPlan(10, "click", 0.02);
    expect(plan.leak).toHaveLength(3);
    expect(plan.countIn[0]).toBeCloseTo(10 + 4 * BEAT_SECONDS);
    const run = new CalibrationRun(plan);
    // Player and pipeline: detected 60 ms after the click is heard.
    plan.measured.forEach((c) => run.frame(c + 0.4, attack(c + 0.02 + 0.06)));
    run.frame(plan.end + 1);
    expect(run.done).toBe(true);
    expect(run.result()).toMatchObject({ ok: true, offsetMs: 60, used: MEASURED_CUES });
  });
  it("detects click leakage while the strings are still and saves nothing", () => {
    const plan = calibrationPlan(0, "click", 0.01);
    const run = new CalibrationRun(plan);
    plan.leak.forEach((c) => run.attack(attack(c + 0.05, null)));
    plan.measured.forEach((c) => run.attack(attack(c + 0.05)));
    expect(run.result()).toMatchObject({ ok: false, reason: "leak" });
  });
  it("treats unaligned sound during the still check as noise", () => {
    const plan = calibrationPlan(0, "click");
    const run = new CalibrationRun(plan);
    run.attack(attack(plan.leak[1] + 0.45));
    plan.measured.forEach((c) => run.attack(attack(c + 0.05)));
    expect(run.result()).toMatchObject({ ok: false, reason: "noise" });
  });
  it("uses only pitched attacks; unpitched onsets are unclear, duplicates are extra", () => {
    const plan = calibrationPlan(0, "click");
    const run = new CalibrationRun(plan);
    plan.measured.forEach((c, i) => {
      run.attack(attack(c + 0.05, i < 3 ? null : 45));
      if (i === 5) run.attack(attack(c + 0.25));
    });
    expect(run.unclear).toBe(3);
    expect(run.extra).toBe(1);
    expect(run.tapsHeard).toBe(9);
    expect(run.result()).toMatchObject({ ok: true, used: 9, unclear: 3 });
  });
  it("ignores count-in attacks and attacks far from any cue", () => {
    const plan = calibrationPlan(0, "visual", 0.5);
    expect(plan.leak).toHaveLength(0);
    expect(plan.outputDelay).toBe(0);
    const run = new CalibrationRun(plan);
    plan.countIn.forEach((c) => run.attack(attack(c)));
    plan.measured.forEach((c) => run.attack(attack(c + 0.37)));
    expect(run.tapsHeard).toBe(0);
    expect(run.result()).toMatchObject({ ok: false, reason: "too-few" });
  });
  it("fails on unhealthy input even with good taps", () => {
    const plan = calibrationPlan(0, "visual");
    const run = new CalibrationRun(plan);
    plan.measured.forEach((c) => run.frame(c + 0.1, attack(c + 0.04), c > 5));
    expect(run.result()).toMatchObject({ ok: false, reason: "noise" });
  });
  it("reports the player's step from the audio clock", () => {
    const plan = calibrationPlan(0, "click");
    const run = new CalibrationRun(plan);
    expect(run.step(0.1).stage).toBe("still");
    expect(run.step(plan.countIn[1] + 0.1)).toEqual({ stage: "count-in", beat: 2 });
    expect(run.step(plan.measured[2] + 0.1)).toEqual({ stage: "play", beat: 3 });
    expect(run.step(plan.end + 0.1).stage).toBe("analyzing");
  });
});

describe("per-device storage", () => {
  const record: CalibrationRecord = {
    offsetMs: 42,
    spreadMs: 6.5,
    used: 11,
    rejected: 1,
    cue: "click",
    outputDelayMs: 12,
    outputLatencyReported: true,
    sampleRate: 48000,
    inputLabel: "iPhone Microphone",
    measuredAt: new Date().toISOString(),
  };
  beforeEach(() => localStorage.clear());
  it("round-trips per microphone and clears independently", () => {
    expect(saveCalibration(inputKey("iPhone Microphone"), record)).toBe(true);
    saveCalibration(inputKey("USB Interface"), { ...record, offsetMs: 8 });
    expect(loadCalibration("iPhone Microphone")?.offsetMs).toBe(42);
    expect(loadCalibration("USB Interface")?.offsetMs).toBe(8);
    clearCalibration("USB Interface");
    expect(loadCalibration("USB Interface")).toBeNull();
    expect(loadCalibration("iPhone Microphone")).not.toBeNull();
  });
  it("rejects corrupt or out-of-range stored values", () => {
    localStorage.setItem(
      "fretshift:immersive-calibration:v1",
      JSON.stringify({ a: { ...record, offsetMs: 900 }, b: "x" }),
    );
    expect(loadCalibration("a")).toBeNull();
    expect(loadCalibration("b")).toBeNull();
    localStorage.setItem("fretshift:immersive-calibration:v1", "{not json");
    expect(loadCalibration("a")).toBeNull();
  });
  it("labels unnamed inputs consistently", () => {
    expect(inputKey("")).toBe("Default microphone");
    expect(inputKey(undefined)).toBe("Default microphone");
  });
});
