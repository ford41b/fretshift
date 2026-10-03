import { beforeEach, describe, expect, it, vi } from "vitest";

const session = { current: { user: { id: "account-1" } } as { user: { id: string } } | null };
vi.mock("../cloud/client", () => ({
  cloudConfig: () => ({ url: "https://example.supabase.co", key: "public-key" }),
  getAccessToken: async () => (session.current ? "access-token" : null),
  getSession: () => session.current,
}));

import { SongV1, hasMediaTimeline } from "../schema/song.v1";
import {
  analysisToRegions,
  chordKey,
  mergeWindows,
  normalizeChordSymbol,
  planRequests,
  snapToGrid,
  votePasses,
  type Region,
} from "./accuracy";
import { YouTubeImportRequestError, analyzeYouTube } from "./client";
import { combineResponses, youtubeResultToReview, youtubeReviewToSong, youtubeSongMeta } from "./review";
import { DEFAULT_ACCURACY, YouTubeWireSchema, type AccuracyOptions, type YouTubeAnalysis, type YouTubeWire } from "./types";
import { parseTimecode, parseYouTubeVideoId } from "./url";

const ID = "dQw4w9WgXcQ";
const options = (overrides: Partial<AccuracyOptions> = {}): AccuracyOptions => ({
  ...DEFAULT_ACCURACY, useHints: true, windowSeconds: null, closeUp: false, passes: 1, snapToBeats: false, ...overrides,
});
type Change = [number, number, string];
function analysis(changes: Change[], extra: Partial<YouTubeAnalysis> = {}): YouTubeAnalysis {
  return {
    tempoBpm: 120, meter: 4, key: "G", capoGuess: 0, firstDownbeatSeconds: 0, sections: [],
    chords: changes.map(([startSeconds, endSeconds, chord]) => ({
      startSeconds, endSeconds,
      chord: chord === "N.C." || chord === "?" ? null : chord,
      kind: chord === "N.C." ? "no-chord" as const : chord === "?" ? "unknown" as const : "chord" as const,
      confidence: 0.9, evidence: "heard" as const,
    })),
    sanitized: { labels: 0, times: 0, outsideWindowSeconds: 0 }, timingSuspect: false, ...extra,
  };
}
function wire(segment: { startSeconds: number; endSeconds: number }, pass: number, data: YouTubeAnalysis): YouTubeWire {
  return YouTubeWireSchema.parse({
    videoId: ID, segment, fps: 1, pass, analysis: data, video: { title: "Lesson" },
    usage: { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 }, modelId: "gemini-3.8-flash",
    promptVersion: "youtube-chords-v1", processedAt: "2026-10-03T12:00:00.000Z",
  });
}
const labels = (regions: Region[]) => regions.map((r) => [r.start, r.end, r.label ?? (r.disagreement ? "≠" : r.kind)]);

describe("YouTube links and times", () => {
  it("accepts watch, youtu.be and shorts links only", () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=3`)).toBe(ID);
    expect(parseYouTubeVideoId(`youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeVideoId(`https://youtube.com/shorts/${ID}`)).toBe(ID);
    for (const url of [`https://www.youtube.com/embed/${ID}`, "https://www.youtube.com/playlist?list=PL1",
      `https://evil.example/watch?v=${ID}`, `https://youtu.be/${ID}/x`, "not a link"])
      expect(parseYouTubeVideoId(url)).toBeNull();
  });

  it("parses seconds and clock timecodes", () => {
    expect([parseTimecode("83"), parseTimecode("1:23"), parseTimecode("1:02:03"), parseTimecode("0:05.5")])
      .toEqual([83, 83, 3723, 5.5]);
    expect(parseTimecode("")).toBeUndefined();
    expect([parseTimecode("1:75"), parseTimecode("abc"), parseTimecode("-3")]).toEqual([null, null, null]);
  });
});

describe("accuracy options", () => {
  it("normalizes chord spellings into FretShift's vocabulary", () => {
    expect(["Cmaj", "Amin", "Dsus", "Bø", "F#°", "A7sus4", "Gadd2", "CM7", "E-", "Bbmaj7", "D/F#"].map(normalizeChordSymbol))
      .toEqual(["C", "Am", "Dsus4", "Bm7b5", "F#dim", "Asus47", "Gadd9", "Cmaj7", "Em", "Bbmaj7", "D/F#"]);
    expect(normalizeChordSymbol("H7")).toBeNull();
    expect(chordKey("A#m")).toBe(chordKey("Bbm"));
  });

  it("(b)/(c)/(d) plans evenly spaced overlapping windows × passes at the chosen fps", () => {
    expect(planRequests({ startSeconds: 0, endSeconds: 200 }, options())).toEqual([
      { window: 0, pass: 1, segment: { startSeconds: 0, endSeconds: 200 }, fps: 1 }]);
    const windows = planRequests({ startSeconds: 30, endSeconds: 230 }, options({ windowSeconds: 60, overlapSeconds: 10, passes: 2, closeUp: true }));
    const segments = [...new Map(windows.map((w) => [w.window, w.segment])).values()];
    expect(segments.length).toBe(4);
    expect(segments[0].startSeconds).toBe(30);
    expect(segments.at(-1)!.endSeconds).toBe(230);
    segments.slice(1).forEach((segment, i) => expect(segments[i].endSeconds - segment.startSeconds).toBeCloseTo(10, 3));
    expect(windows.every((w) => w.fps === 4)).toBe(true);
    expect(windows.filter((w) => w.window === 0).map((w) => w.pass)).toEqual([1, 2]);
    // Over ten minutes is always split, even with windows off.
    expect(new Set(planRequests({ startSeconds: 0, endSeconds: 900 }, options()).map((w) => w.window)).size).toBe(2);
  });

  it("(d) votes per region: agreement keeps the chord, disagreement becomes Unknown with suggestions", () => {
    const range = { startSeconds: 0, endSeconds: 12 };
    const a = analysisToRegions(analysis([[0, 4, "G"], [4, 8, "C"], [8, 12, "D"]]), range);
    const b = analysisToRegions(analysis([[0, 4.2, "G"], [4.2, 8, "C"], [8, 12, "Em"]]), range);
    const c = analysisToRegions(analysis([[0, 3.9, "G"], [3.9, 8, "Am"], [8, 12, "Em"]]), range);
    const two = votePasses([a, b], range);
    expect(labels(two)).toEqual([[0, 4.1, "G"], [4.1, 8, "C"], [8, 12, "≠"]]);
    expect(two[2].alternatives.map((alt) => alt.label).sort()).toEqual(["D", "Em"]);
    const three = votePasses([a, b, c], range);
    // No pass majority between 4.0 and 4.2 s, so the change lands mid-dispute.
    expect(labels(three)).toEqual([[0, 4.1, "G"], [4.1, 8, "C"], [8, 12, "Em"]]);
    expect(three[1].agreement).toBeCloseTo(2 / 3, 2);
    expect(three[1].confidence).toBeCloseTo(0.6, 2);
    expect(votePasses([a], range)).toEqual(a);
  });

  it("(b) merges windows at the overlap midpoint and joins equal chords across the cut", () => {
    const first = { startSeconds: 0, endSeconds: 60 }, second = { startSeconds: 50, endSeconds: 110 };
    const merged = mergeWindows([
      { segment: first, regions: analysisToRegions(analysis([[0, 40, "G"], [40, 60, "C"]]), first) },
      { segment: second, regions: analysisToRegions(analysis([[50, 58, "Am"], [58, 110, "D"]]), second) },
    ], { startSeconds: 0, endSeconds: 110 });
    expect(labels(merged)).toEqual([[0, 40, "G"], [40, 55, "C"], [55, 58, "Am"], [58, 110, "D"]]);
    const agreeing = mergeWindows([
      { segment: first, regions: analysisToRegions(analysis([[0, 30, "G"], [30, 60, "C"]]), first) },
      { segment: second, regions: analysisToRegions(analysis([[50, 80, "C"], [80, 110, "G"]]), second) },
    ], { startSeconds: 0, endSeconds: 110 });
    expect(labels(agreeing)).toEqual([[0, 30, "G"], [30, 80, "C"], [80, 110, "G"]]);
  });

  it("(e) snaps chord changes to the confirmed beat grid without reordering regions", () => {
    const beats = Array.from({ length: 13 }, (_, i) => i * 0.5); // 120 BPM
    const { segments, moved } = snapToGrid([
      { start: 0.1, end: 2.07 }, { start: 2.07, end: 3.9 }, { start: 3.9, end: 6 },
    ], beats, { subdivision: 1 });
    expect(segments).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }]);
    expect(moved).toBe(3);
    expect(snapToGrid([{ start: 0, end: 1 }], [], {}).moved).toBe(0);
  });
});

describe("YouTube client transport", () => {
  beforeEach(() => { session.current = { user: { id: "account-1" } }; });
  const respond = (data: YouTubeAnalysis) => vi.fn(async (request: Request) => {
    const body = await request.clone().json();
    return { ...wire(body.segment, body.pass, data), pass: body.pass };
  });

  it("sends the canonical URL, hints and plan, then returns a combined result", async () => {
    const transport = respond(analysis([[0, 30, "G"], [30, 60, "C"]]));
    const progress: number[] = [];
    const result = await analyzeYouTube({ url: `https://youtu.be/${ID}?si=x`, range: { startSeconds: 0, endSeconds: 60 },
      options: options({ passes: 2 }), hints: { title: "Song", capo: 2 }, videoDurationSeconds: 61, transport,
      onProgress: ({ done }) => progress.push(done) });
    expect(transport).toHaveBeenCalledTimes(2);
    const request = transport.mock.calls[0][0] as Request;
    expect(request.headers.get("Authorization")).toBe("Bearer access-token");
    expect(await request.clone().json()).toMatchObject({ url: `https://www.youtube.com/watch?v=${ID}`, fps: 1,
      hints: { title: "Song", capo: 2 }, videoDurationSeconds: 61 });
    expect(labels(result.regions)).toEqual([[0, 30, "G"], [30, 60, "C"]]);
    expect(result.requests).toBe(2);
    expect(progress.at(-1)).toBe(2);
    const noHints = respond(analysis([[0, 60, "G"]]));
    await analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options({ useHints: false }), hints: { title: "Song" }, transport: noHints });
    expect((await (noHints.mock.calls[0][0] as Request).json()).hints).toEqual({});
  });

  it("retries a transient failure once and keeps completed parts for Retry", async () => {
    const good = respond(analysis([[0, 60, "G"]]));
    let calls = 0;
    const flaky = vi.fn(async (request: Request, signal: AbortSignal) => {
      calls++;
      if (calls === 1) throw new YouTubeImportRequestError("Gemini rejected", 502, "provider-rejected", true);
      return good(request, signal);
    });
    const result = await analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options(), transport: flaky });
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(result.regions[0].label).toBe("G");

    const cache = new Map<string, YouTubeWire>();
    const failing = vi.fn(async (request: Request, signal: AbortSignal) => {
      const body = await request.clone().json();
      if (body.pass === 2) throw new YouTubeImportRequestError("This video is private.", 422, "private-video", false);
      return good(request, signal);
    });
    await expect(analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options({ passes: 2 }), transport: failing, cache })).rejects.toThrow(/private.*part 2 of 2.*1 completed part is kept/);
    expect(failing).toHaveBeenCalledTimes(2); // not retried: not transient
    expect(cache.size).toBe(1);
    const retry = respond(analysis([[0, 60, "G"]]));
    await analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options({ passes: 2 }), transport: retry, cache });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched or invalid answers, account switches and sign-out", async () => {
    const wrongVideo = vi.fn(async (request: Request) => ({ ...(await respond(analysis([[0, 60, "G"]]))(request, new AbortController().signal)), videoId: "aaaaaaaaaaa" }));
    await expect(analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options(), transport: wrongVideo })).rejects.toThrow(/did not match/);
    expect(wrongVideo).toHaveBeenCalledTimes(2);
    const lyrics = vi.fn(async () => ({ lyrics: "never" }));
    await expect(analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options(), transport: lyrics })).rejects.toThrow(/could not verify/);
    const switching = vi.fn(async (request: Request) => {
      session.current = { user: { id: "account-2" } };
      return respond(analysis([[0, 60, "G"]]))(request, new AbortController().signal);
    });
    await expect(analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options(), transport: switching })).rejects.toThrow(/account changed/);
    session.current = null;
    await expect(analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options(), transport: lyrics })).rejects.toThrow(/Sign in/);
  });

  it("cancels in-flight work", async () => {
    const controller = new AbortController();
    const hanging = vi.fn((_request: Request, signal: AbortSignal) => new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const running = analyzeYouTube({ url: `https://youtu.be/${ID}`, range: { startSeconds: 0, endSeconds: 60 },
      options: options(), transport: hanging, signal: controller.signal });
    await vi.waitFor(() => expect(hanging).toHaveBeenCalled());
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("review draft and Song provenance", () => {
  const range = { startSeconds: 2, endSeconds: 14 };
  const result = () => combineResponses(ID, range, options({ passes: 1 }), [{
    planned: { window: 0, pass: 1, segment: range, fps: 1 },
    wire: wire(range, 1, analysis([[2, 6, "G"], [6, 8, "?"], [8, 10, "N.C."], [10, 14, "Cmaj"]],
      { firstDownbeatSeconds: 2, capoGuess: 3, key: "Em", sections: [{ label: "chorus", startSeconds: 6, endSeconds: 14 }] })),
  }]);

  it("reuses the Audio Intelligence review structure with everything unconfirmed", () => {
    const review = youtubeResultToReview(result());
    expect(review.fileName).toBe(`youtube:${ID}`);
    expect(review.duration).toBe(14);
    expect(review.waveform).toEqual([]);
    expect(review.reviewed.timingConfirmed).toBe(false);
    expect(review.reviewed.tempoBpm).toBe(120);
    expect(review.reviewed.beats[0]).toBe(2);
    expect(review.reviewed.segments.every((segment) => segment.decision === "detected" && !segment.reviewed)).toBe(true);
    expect(review.detected.segments.map((segment) => [segment.label, segment.status])).toEqual([
      ["G", "estimated"], [null, "ambiguous"], [null, "no-chord"], ["C", "estimated"]]);
    expect(review.detected.chordProviderId).toBe("gemini-3.8-flash");
  });

  it("marks low-confidence chords Unknown but keeps them as suggestions", () => {
    const low = combineResponses(ID, range, options(), [{ planned: { window: 0, pass: 1, segment: range, fps: 1 },
      wire: wire(range, 1, { ...analysis([[2, 14, "G"]]), chords: [{ startSeconds: 2, endSeconds: 14, chord: "G",
        kind: "chord", confidence: 0.3, evidence: "seen" }] }) }]);
    const segment = youtubeResultToReview(low).detected.segments[0];
    expect(segment).toMatchObject({ label: null, status: "ambiguous", alternatives: [{ label: "G", score: 0.3 }] });
  });

  it("discards windows whose timestamps ignored the request", () => {
    const suspect = { ...analysis([[2, 14, "G"]]), timingSuspect: true };
    expect(() => combineResponses(ID, range, options(), [{ planned: { window: 0, pass: 1, segment: range, fps: 1 },
      wire: wire(range, 1, suspect) }])).toThrow(/timestamps did not match/);
  });

  it("saves only after review, as a youtube-sourced Song with provenance and sections", () => {
    const data = result();
    const review = youtubeResultToReview(data);
    const meta = youtubeSongMeta(data, { artist: "Teacher", tuningId: "drop-d" });
    expect(() => youtubeReviewToSong("Lesson", data.modelId, review, meta)).toThrow(/Review each uncertain region/);
    review.reviewed.segments.forEach((segment) => {
      if (!segment.label) Object.assign(segment, { decision: "unknown", reviewed: true });
    });
    const song = youtubeReviewToSong("Lesson", data.modelId, review, meta);
    expect(SongV1.safeParse(song).success).toBe(true);
    expect(song.provenance).toMatchObject({ source: "youtube", modelId: "gemini-3.8-flash", promptVersion: "youtube-chords-v1",
      timingNeedsConfirmation: true, youtube: { videoId: ID, startSeconds: 2, endSeconds: 14, requests: 1, capoGuess: 3,
        keyGuess: "Em", options: { passes: 1, fps: 1 } } });
    expect([song.artist, song.tuningId, song.capo, song.currentKey]).toEqual(["Teacher", "drop-d", 3, { root: "E", mode: "minor" }]);
    expect(song.measures.flatMap((m) => m.chords.map((c) => [c.chordName, c.audioTimeSeconds]))).toEqual([["G", 2], ["C", 10]]);
    expect(song.measures.some((m) => m.section?.kind === "chorus")).toBe(true);
    expect(song.measures.every((m) => m.timingConfirmed === false)).toBe(true);
    expect(hasMediaTimeline(song.provenance?.source)).toBe(true);
    expect(JSON.stringify(song)).not.toMatch(/lyric/i);
    // A capo guess beyond FretShift's capo range is kept as provenance only.
    expect(youtubeSongMeta({ ...data, capoGuess: 9 }, {}).capo).toBeUndefined();
    expect(SongV1.safeParse({ ...song, provenance: { ...song.provenance, source: "audio" } }).success).toBe(false);
  });
});
