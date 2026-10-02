import type { Song, Tuning } from "../schema/song.v1";

export type SyncKind =
  | "song"
  | "setlist"
  | "tuning"
  | "preference"
  | "session"
  | "heat"
  | "pair"
  | "strum";

export type SyncRecord = {
  kind: SyncKind;
  id: string;
  payload: unknown;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
};

export type CasResult =
  | { ok: true; record: SyncRecord }
  | { ok: false; record: SyncRecord | null };

export type ShareRecord = {
  token: string;
  songId: string;
  createdAt: string;
  revokedAt: string | null;
};

export type PullOptions = {
  /**
   * Only records whose server updatedAt is at or after this ISO time. Omitted
   * or null means a full pull. The engine already subtracts its overlap window.
   */
  since?: string | null;
};

/** A small backend seam; the engine deliberately has no Supabase dependency. */
export interface SyncAdapter {
  pull(options?: PullOptions): Promise<SyncRecord[]>;
  cas(
    record: Omit<SyncRecord, "updatedAt" | "revision"> & {
      revision: number | null;
    },
  ): Promise<CasResult>;
  createShare(song: Song, tuning: Tuning): Promise<string>;
  listShares(): Promise<ShareRecord[]>;
  readShare(token: string): Promise<{ song: Song; tuning: Tuning } | null>;
  revokeShare(token: string): Promise<void>;
}

export class SyncTransportError extends Error {}
