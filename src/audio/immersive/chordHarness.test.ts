import { describe, expect, it } from "vitest";
import {
  buildReport,
  checklistMarkdown,
  ChordManifestSchema,
  evaluateRecording,
  manifestTemplate,
  recordingPlan,
  voicingToMidi,
} from "./chordHarness";
import { chordThresholdFailures, wilsonUpper } from "./chordEvaluation";
import { syntheticRecording } from "./fixtures";

describe("labeled recording format", () => {
  it("parses voicings low E → high E, including frets ≥ 10", () => {
    expect(voicingToMidi("x32010")).toEqual([48, 52, 55, 60, 64]);
    expect(voicingToMidi("10-12-12-11-10-10")).toEqual([50, 57, 62, 66, 69, 74]);
    expect(() => voicingToMidi("x3201")).toThrow(/six strings/);
  });
  it("plan covers every label with the minimum counts the thresholds need", () => {
    const plan = recordingPlan();
    const strums = (label: string) => plan.filter((r) => r.label === label).reduce((s, r) => s + r.strums, 0);
    expect(plan).toHaveLength(78);
    expect(new Set(plan.map((r) => r.file)).size).toBe(78);
    expect(strums("correct")).toBe(150);
    expect(strums("wrong-chord")).toBe(100);
    expect(strums("missing-tone")).toBe(50);
    expect(ChordManifestSchema.parse(manifestTemplate()).evidence).toBe("physical");
    expect(checklistMarkdown()).toContain("`04-C-wrong-Am.wav`");
  });
  it("rejects unsafe or malformed manifests", () => {
    const bad = { ...manifestTemplate(), recordings: [{ ...recordingPlan()[0], file: "../x.wav" }] };
    expect(ChordManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("evaluation (synthetic signals: pipeline behaviour, not accuracy)", () => {
  const plan = recordingPlan();
  // Two strums per file keeps the recognizer pass short.
  const pick = (prefix: string) => ({ ...plan.find((r) => r.file.startsWith(prefix))!, strums: 2 });
  it("runs each file through the live recognizer and judge", { timeout: 30000 }, () => {
    const correct = evaluateRecording(syntheticRecording(48000, pick("01-")), 48000, pick("01-"));
    expect(correct.strums.map((s) => s.outcome)).toEqual(["hit", "hit"]);
    const wrong = evaluateRecording(syntheticRecording(48000, pick("04-")), 48000, pick("04-"));
    expect(wrong.strums.every((s) => s.outcome !== "hit")).toBe(true);
    const silence = { ...plan.find((r) => r.label === "silence")!, strums: 0 };
    expect(evaluateRecording(syntheticRecording(44100, silence), 44100, silence)).toMatchObject({ attacks: 0, extraHits: 0 });
  });
  it("counts undetected strums as missed and surplus hits against non-correct files", () => {
    const manifest = { ...manifestTemplate(), evidence: "synthetic" as const };
    const report = buildReport(manifest, [
      { file: "a.wav", label: "correct", target: "C", strums: [{ outcome: "hit" }, { outcome: "missed" }], attacks: 1, extraHits: 0 },
      { file: "b.wav", label: "wrong-chord", target: "C", strums: [{ outcome: "wrong" }], attacks: 2, extraHits: 1 },
      { file: "c.wav", label: "silence", target: "C", strums: [], attacks: 0, extraHits: 0 },
    ]);
    expect(report.counts.correct).toMatchObject({ n: 2, hit: 1, missed: 1 });
    expect(report.counts["wrong-chord"]).toMatchObject({ n: 2, hit: 1, wrong: 1 });
    expect(report.counts.silence).toMatchObject({ n: 1, missed: 1 });
    const failures = chordThresholdFailures(report);
    expect(failures[0]).toMatch(/only real labeled guitar recordings qualify/);
  });
  it("a perfect physical corpus of sufficient size passes; one extra false accept in 100 fails", () => {
    const counts = (n: number, hit: number, wrong = 0) => ({ n, hit, wrong, uncertain: n - hit - wrong, missed: 0 });
    const report = {
      version: 1 as const, generatedAt: null, evidence: "physical" as const, recordings: 78, chordShapes: 10,
      devices: ["phone"], guitars: ["guitar"],
      counts: {
        correct: counts(150, 135, 2), "wrong-chord": counts(100, 0, 90), "missing-tone": counts(50, 0, 10),
        "single-note": counts(30, 0, 30), muted: counts(20, 0), silence: counts(4, 0),
      },
    };
    expect(chordThresholdFailures(report)).toEqual([]);
    report.counts["wrong-chord"] = counts(100, 1, 90);
    expect(chordThresholdFailures(report).join(" ")).toMatch(/95% upper bound 5\.4%/);
    expect(wilsonUpper(0, 100)).toBeCloseTo(0.037, 3);
  });
});
