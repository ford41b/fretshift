import { describe, expect, it } from "vitest";
import { compileTargets } from "../immersive/score";
import { practiceTimeline } from "../playback/timeline";
import { loadSong } from "../../schema/migrations";
import { SongV1 } from "../../schema/song.v1";
import { LocalAnalysisOrchestrator } from "./index";
import { audioReviewToSong, createAudioReview, gridAtBpm, mergeRegion, moveBoundary,
  splitRegion } from "./review";
import type { AudioIntelligenceResult, BeatAnalyzer } from "./types";
import { manifest, renderFixture } from "../../../test-fixtures/audio-intelligence/fixtures.mjs";

const result: AudioIntelligenceResult = {
  version: 1, duration: 4, notes: null, stemProviderId: null, warnings: [], measures: [],
  beats: { providerId: "test-beat", tempoBpm: 120, beats: [0,.5,1,1.5,2,2.5,3,3.5],
    downbeats: [], meter: null, status: "estimated", evidence: .3, warnings: [] },
  chords: { providerId: "test-chord", vocabulary: ["C", "Dsus4", "D/F#"], warnings: [],
    segments: [
      { start: 0, end: 1, label: "C", status: "estimated", alternatives: [] },
      { start: 1, end: 2, label: "C", status: "estimated", alternatives: [] },
      { start: 2, end: 3, label: null, status: "ambiguous", alternatives: [{ label: "Dsus4", score: .42 }] },
      { start: 3, end: 4, label: "D/F#", status: "estimated", alternatives: [] },
    ] },
};

describe("audio transcription review and persistence", () => {
  it("keeps uncertain meter unconfirmed and rejects a blank/untouched uncertain result", () => {
    const review = createAudioReview(result, "test.wav", [0,.5,1]);
    expect(review.detected.meter).toBeNull();
    expect(review.reviewed.timingConfirmed).toBe(false);
    expect(() => audioReviewToSong("Test", "test-chord", review)).toThrow(/uncertain region/);
    review.reviewed.segments[2].decision = "unknown";
    expect(audioReviewToSong("Test", "test-chord", review).provenance?.timingNeedsConfirmation).toBe(true);
    review.reviewed.segments.forEach((segment) => {segment.label=null;segment.decision="no-chord";});
    expect(() => audioReviewToSong("Test", "test-chord", review)).toThrow(/No chord/);
  });

  it("saves exact offbeat and slash-chord times, repeated chords, and unknowns across reload", () => {
    const review = createAudioReview(result, "test.wav", [0,.5,1]);
    review.reviewed.segments[2].decision="unknown";
    review.reviewed.segments[3].start=3.13;
    review.reviewed.segments[3].decision="corrected";
    review.reviewed.segments[3].reviewed=true;
    review.reviewed.timingConfirmed=true;
    const song = loadSong(JSON.parse(JSON.stringify(audioReviewToSong("Offbeat", "test-chord", review))));
    expect(SongV1.safeParse(song).success).toBe(true);
    expect(song.measures.flatMap((measure) => measure.chords.map((chord) => chord.chordName)))
      .toEqual(["C","C","D/F#"]);
    expect(song.provenance?.audioReview?.reviewed.segments[2].decision).toBe("unknown");
    expect(song.provenance?.audioReview?.detected.segments[2].alternatives[0].score).toBe(.42);
    expect(song.provenance?.audioReview?.reviewed.segments[3].start).toBe(3.13);
    expect(compileTargets(song).targets.at(-1)?.time).toBeCloseTo(3.13);
    expect(compileTargets(song).needsTimingConfirmation).toBe(false);
    const practice = practiceTimeline(song, 1);
    expect(practice.events).toHaveLength(0);
    expect(practice.clicks.map((click) => click.time)).toEqual(review.reviewed.beats);
  });

  it("uses explicit BPM correction and boundary edits without changing detector evidence", () => {
    const review = createAudioReview(result, "test.wav", []);
    review.reviewed.beats=gridAtBpm(4,100,.1);
    expect(review.reviewed.beats.slice(0,3)).toEqual([.1,.7,1.3]);
    expect(review.detected.beats[1]).toBe(.5);
    const moved=moveBoundary(review.reviewed.segments,0,1.2);
    expect(moved[0].end).toBe(1.2);
    expect(moved[1].start).toBe(1.2);
    const split=splitRegion(moved,1,1.6);
    expect(split).toHaveLength(5);
    expect(mergeRegion(split,1)).toHaveLength(4);
    expect(() => mergeRegion(review.reviewed.segments, 1)).toThrow(/different chord decisions/);
    expect(review.detected.segments[0].end).toBe(1);
    expect(() => moveBoundary(moved,0,3)).toThrow();
  });

  it("accepts corrected suspended and extended chords without inventing strumming or tab", () => {
    const review=createAudioReview(result,"test.wav",[]);
    review.reviewed.segments[2].label="Dsus4";
    review.reviewed.segments[2].decision="corrected";
    review.reviewed.segments[0].label="Cadd9";
    review.reviewed.segments[0].decision="corrected";
    const song=audioReviewToSong("Extensions","test-chord",review);
    expect(song.measures.flatMap((m)=>m.chords.map((c)=>c.chordName))).toContain("Cadd9");
    expect(song.measures.flatMap((m)=>m.chords.map((c)=>c.chordName))).toContain("Dsus4");
    expect(song.measures.every((m)=>!m.tab)).toBe(true);
    expect(song.strumming).toBeUndefined();
  });

  it("keeps major/minor ambiguity unresolved until the user chooses", () => {
    const ambiguous=structuredClone(result);
    ambiguous.chords.segments[0]={start:0,end:1,label:null,status:"ambiguous",
      alternatives:[{label:"C",score:.61},{label:"Cm",score:.59}]};
    const review=createAudioReview(ambiguous,"ambiguous.wav",[]);
    review.reviewed.segments[2].decision="unknown";
    expect(() => audioReviewToSong("Ambiguous","test",review)).toThrow(/uncertain region/);
    review.reviewed.segments[0].label="Cm";
    review.reviewed.segments[0].decision="corrected";
    expect(audioReviewToSong("Ambiguous","test",review).measures[0].chords[0].chordName).toBe("Cm");
    expect(review.detected.segments[0].alternatives).toHaveLength(2);
  });

  it("keeps a source fingerprint across save and reload", () => {
    const review = createAudioReview(result, "test.wav", [], "a".repeat(64));
    review.reviewed.segments[2].decision = "unknown";
    const song = loadSong(JSON.parse(JSON.stringify(audioReviewToSong("Fingerprint", "test", review))));
    expect(song.provenance?.audioReview?.fileSha256).toBe("a".repeat(64));
  });

  it("preserves Unknown, No chord, and unresolved states when merging matching regions", () => {
    for (const decision of ["unknown", "no-chord", "detected"] as const) {
      const review = createAudioReview(result, "test.wav", []);
      const regions = review.reviewed.segments.slice(0, 2).map((region) => ({
        ...region, label: null, decision, reviewed: decision !== "detected",
      }));
      const merged = mergeRegion(regions, 0);
      expect(merged[0].decision).toBe(decision);
      expect(merged[0].reviewed).toBe(decision !== "detected");
    }
  });

  it("processes a deterministic two-guitar-like mix without claiming its labels are correct", async () => {
    const first=renderFixture(manifest.cases.find((item:{id:string})=>item.id==="acoustic-simple")!);
    const second=renderFixture(manifest.cases.find((item:{id:string})=>item.id==="clean-electric")!);
    const samples=new Float32Array(Math.min(first.samples.length,second.samples.length));
    for(let i=0;i<samples.length;i++) samples[i]=(first.samples[i]+second.samples[i])*.5;
    const analyzed=await new LocalAnalysisOrchestrator().analyze({samples,sampleRate:first.sampleRate});
    expect(analyzed.version).toBe(1);
    expect(analyzed.chords.segments.length).toBeGreaterThan(0);
  });

  it("surfaces provider failure and a fresh local retry can complete", async () => {
    const fixture=renderFixture(manifest.cases.find((item:{id:string})=>item.id==="acoustic-simple")!);
    const failed:BeatAnalyzer={id:"failed",analyze:()=>{throw new Error("provider unavailable");}};
    await expect(new LocalAnalysisOrchestrator(failed).analyze(fixture)).rejects.toThrow(/provider unavailable/);
    const retried=await new LocalAnalysisOrchestrator().analyze(fixture);
    expect(retried.beats.beats.length).toBeGreaterThan(0);
  });
});


describe("saved audio timeline integrity", () => {
  function saved() {
    const review = createAudioReview(result, "test.wav", []);
    review.reviewed.segments[2].decision = "unknown";
    review.reviewed.timingConfirmed = true;
    return audioReviewToSong("Valid", "fixture", review);
  }
  it.each(["duplicate beat", "beat outside source", "invalid tempo", "overlapping regions", "conflicting unknown", "duplicate region id", "infinite duration"])("rejects %s in chord-only JSON", (kind) => {
    const song = saved(), r = song.provenance!.audioReview!;
    if (kind === "duplicate beat") r.reviewed.beats[1] = 0;
    if (kind === "beat outside source") r.reviewed.beats[7] = 5;
    if (kind === "invalid tempo") r.reviewed.tempoBpm = 0;
    if (kind === "overlapping regions") r.reviewed.segments[1].start = .2;
    if (kind === "conflicting unknown") r.reviewed.segments[0].decision = "unknown";
    if (kind === "duplicate region id") r.reviewed.segments[1].id = r.reviewed.segments[0].id;
    if (kind === "infinite duration") r.duration = Infinity;
    expect(() => loadSong(song)).toThrow();
  });
  it("accepts legacy chord review without optional fingerprint or notes", () => {
    expect(loadSong(saved()).provenance!.audioReview!.fileSha256).toBeUndefined();
  });
});
