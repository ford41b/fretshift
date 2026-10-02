import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../persistence/dexie";
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "./drafts";
import { createAudioReview, type AudioReview } from "./review";

const review: AudioReview = createAudioReview({
  version: 1, duration: 4, notes: null, stemProviderId: null, warnings: [], measures: [],
  beats: { providerId: "test-beat", tempoBpm: 120, beats: [0, .5, 1, 1.5],
    downbeats: [0], meter: 4, status: "estimated", evidence: .3, warnings: [] },
  chords: { providerId: "test-chord", vocabulary: ["C", "G"], warnings: [],
    segments: [{ start: 0, end: 2, label: "C", status: "estimated", alternatives: [] }] },
}, "take.wav", [0, .5, 1]);

beforeEach(async () => { await db.meta.clear(); });

describe("audio review drafts", () => {
  it("round-trips per song and keeps new-analysis drafts separate", async () => {
    await saveReviewDraft(null, { review, title: "New take", providerId: "p", firstBeat: 0, baseUpdatedAt: null });
    await saveReviewDraft("song-1", { review, title: "Edited", providerId: "p", firstBeat: 0.5, baseUpdatedAt: "2026-10-01T00:00:00.000Z" });
    expect(await loadReviewDraft(null)).toMatchObject({ title: "New take", review: { fileName: "take.wav" } });
    expect(await loadReviewDraft("song-1")).toMatchObject({ title: "Edited", firstBeat: 0.5 });
    await clearReviewDraft("song-1");
    expect(await loadReviewDraft("song-1")).toBeNull();
    expect(await loadReviewDraft(null)).not.toBeNull();
  });

  it("discards a corrupt draft instead of restoring it", async () => {
    await db.meta.put({ id: "audio-review-draft:song-2", value: { version: 1, review: { fileName: 3 } } });
    expect(await loadReviewDraft("song-2")).toBeNull();
    expect(await db.meta.get("audio-review-draft:song-2")).toBeUndefined();
  });
});
