import { describe, expect, it } from "vitest";
import { analyzeAudioSamples, audioAnalysisToSong } from "./core";

function singleStringSequence(notes = [60, 65, 67, 60]) {
  const sampleRate = 22050,
    secondsPerNote = 1,
    samples = new Float32Array(sampleRate * secondsPerNote * notes.length);
  for (const [noteIndex, midi] of notes.entries())
    for (let index = 0; index < sampleRate * secondsPerNote; index++) {
      const time = index / sampleRate,
        envelope =
          Math.min(1, index / 220) *
          Math.min(1, (sampleRate * secondsPerNote - index) / 220),
        frequency = 440 * 2 ** ((midi - 69) / 12);
      samples[noteIndex * sampleRate * secondsPerNote + index] =
        envelope * Math.sin(2 * Math.PI * frequency * time);
    }
  return { samples, sampleRate };
}

describe("offline audio root drafting", () => {
  it("tracks a conservative single-string root sequence without over-segmenting", () => {
    const source = singleStringSequence(),
      analysis = analyzeAudioSamples(source.samples, source.sampleRate),
      observed = analysis.chords.map((chord) => chord.chordName);
    expect(observed).toEqual(["C", "F", "G", "C"]);
    expect(analysis.chords).toHaveLength(4);
    expect(analysis.assumption).toBe("single-string");
    expect(
      audioAnalysisToSong(analysis, "Single-string draft").provenance?.source,
    ).toBe("audio");
    expect(analysis.waveform.length).toBeGreaterThan(100);
  });

  it("merges a sustained note into one editable region", () => {
    const source = singleStringSequence([64, 64, 64]),
      analysis = analyzeAudioSamples(source.samples, source.sampleRate);
    expect(analysis.chords).toHaveLength(1);
    expect(analysis.chords[0].chordName).toBe("E");
    expect(analysis.chords[0].duration).toBeGreaterThan(2.5);
  });

  it("rejects empty, very short, and overlong input", () => {
    expect(() => analyzeAudioSamples(new Float32Array(), 44100)).toThrow();
    expect(() => analyzeAudioSamples(new Float32Array(1000), 44100)).toThrow(
      /one second/,
    );
    expect(() =>
      analyzeAudioSamples(new Float32Array(16000 * 60 * 16), 16000),
    ).toThrow(/15 minutes/);
  });
});
