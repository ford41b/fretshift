import { z } from "zod";
import { db } from "../../persistence/dexie";
import { ProvenanceSchema } from "../../schema/song.v1";
import type { AudioReview } from "./review";
import { YouTubeSongMetaSchema } from "../../youtube/review";

/**
 * Local autosave for unsaved Audio Intelligence review edits.
 *
 * Drafts live in IndexedDB (the Dexie `meta` table), never localStorage:
 * reviews with note evidence can be several MB. They are device-local, are
 * not synced, and never contain raw audio. One draft per song (or one for a
 * new, not-yet-saved analysis).
 */
export const REVIEW_DRAFT_PREFIX = "audio-review-draft:";
export const NEW_REVIEW_DRAFT = "new";
/** Separate slot for a new, unsaved YouTube review so it never replaces an audio draft. */
export const NEW_YOUTUBE_DRAFT = "youtube-new";

const AudioReviewSchema = ProvenanceSchema.shape.audioReview.unwrap();

const DraftSchema = z.object({
  version: z.literal(1),
  review: AudioReviewSchema,
  title: z.string(),
  providerId: z.string(),
  firstBeat: z.number().finite(),
  savedAt: z.string(),
  /** updatedAt of the song the draft was based on (edit mode only). */
  baseUpdatedAt: z.string().nullable(),
  /** YouTube source details; the video itself is never stored. */
  youtube: YouTubeSongMetaSchema.optional(),
});
export type ReviewDraft = Omit<z.infer<typeof DraftSchema>, "review" | "version"> & {
  review: AudioReview;
};

const draftId = (songId: string | null) =>
  `${REVIEW_DRAFT_PREFIX}${songId ?? NEW_REVIEW_DRAFT}`;

export async function saveReviewDraft(
  songId: string | null,
  draft: Omit<ReviewDraft, "savedAt">,
): Promise<void> {
  await db.meta.put({
    id: draftId(songId),
    value: { version: 1, ...draft, savedAt: new Date().toISOString() },
  });
}

/** Returns a valid draft or null; an unreadable draft is discarded. */
export async function loadReviewDraft(
  songId: string | null,
): Promise<ReviewDraft | null> {
  const row = await db.meta.get(draftId(songId));
  if (!row) return null;
  const parsed = DraftSchema.safeParse(row.value);
  if (parsed.success) {
    const { version: _version, ...draft } = parsed.data;
    return draft as ReviewDraft;
  }
  await db.meta.delete(draftId(songId));
  return null;
}

export async function clearReviewDraft(songId: string | null): Promise<void> {
  await db.meta.delete(draftId(songId));
}
