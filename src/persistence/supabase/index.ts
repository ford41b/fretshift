import type { Song, Tuning } from "../../schema/song.v1";
import type {
  CasResult,
  PullOptions,
  ShareRecord,
  SyncAdapter,
  SyncRecord,
} from "../../sync/adapter";
import { SyncTransportError } from "../../sync/adapter";

type Options = {
  url: string;
  anonKey: string;
  expectedAccountId: string | null;
  getAccountId: () => string | null;
  getAccessToken: () => Promise<string | null>;
};

const PAGE_SIZE = 1000;

/** Parses `0-999/1234`, `0-499/*`, or `*\/0`; null when absent or malformed. */
export function parseContentRange(
  value: string | null,
): { start: number; end: number | null; total: number | null } | null {
  const match = value?.trim().match(/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/);
  if (!match) return null;
  return {
    start: match[1] === undefined ? 0 : Number(match[1]),
    end: match[2] === undefined ? null : Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3]),
  };
}

function singleRow<T>(value: unknown, operation: string): T | null {
  if (!Array.isArray(value))
    throw new SyncTransportError(`${operation} returned an invalid response.`);
  if (value.length > 1)
    throw new SyncTransportError(`${operation} returned more than one row.`);
  return (value[0] as T | undefined) ?? null;
}

/** Native PostgREST/RPC adapter so the client does not need the Supabase SDK. */
export class SupabaseSyncAdapter implements SyncAdapter {
  constructor(private readonly options: Options) {}

  private async request(path: string, init: RequestInit = {}) {
    if (
      !this.options.expectedAccountId ||
      this.options.getAccountId() !== this.options.expectedAccountId
    )
      throw new SyncTransportError(
        "The signed-in account changed during this operation. Sync again.",
      );
    const token = await this.options.getAccessToken();
    if (
      !token ||
      this.options.getAccountId() !== this.options.expectedAccountId
    )
      throw new SyncTransportError(
        "The signed-in account changed during this operation. Sync again.",
      );
    const response = await fetch(`${this.options.url}/rest/v1/${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
      headers: {
        apikey: this.options.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok)
      throw new SyncTransportError(`Sync request failed (${response.status}).`);
    return response;
  }

  /**
   * Pages with Range/Content-Range instead of "a short page means the end":
   * PostgREST silently caps each page at its max-rows setting, so a project
   * configured below the page size used to truncate the pull.
   */
  async pull(options: PullOptions = {}): Promise<SyncRecord[]> {
    const filter = options.since
      ? `&updated_at=gte.${encodeURIComponent(options.since)}`
      : "";
    const byKey = new Map<string, SyncRecord>();
    for (let offset = 0; ; ) {
      const r = await this.request(
        `sync_records?select=kind,record_id,payload,updated_at,deleted_at,revision&order=kind.asc,record_id.asc${filter}`,
        {
          headers: {
            Range: `${offset}-${offset + PAGE_SIZE - 1}`,
            "Range-Unit": "items",
            Prefer: "count=exact",
          },
        },
      );
      const rows = (await r.json()) as Array<{
        kind: SyncRecord["kind"];
        record_id: string;
        payload: unknown;
        updated_at: string;
        deleted_at: string | null;
        revision: number;
      }>;
      if (!Array.isArray(rows))
        throw new SyncTransportError("Sync pull returned an invalid response.");
      const range = parseContentRange(r.headers.get("Content-Range"));
      if (
        !range ||
        (rows.length > 0 &&
          (range.start !== offset ||
            range.end === null ||
            range.end - range.start + 1 !== rows.length))
      )
        throw new SyncTransportError(
          "Sync pull response had no consistent Content-Range; refusing to treat it as complete.",
        );
      for (const x of rows) {
        const record: SyncRecord = {
          kind: x.kind,
          id: x.record_id,
          payload: x.payload,
          updatedAt: x.updated_at,
          deletedAt: x.deleted_at,
          revision: x.revision,
        };
        // An insert that sorts before the current offset shifts later rows by
        // one between pages; keep one copy (the newest) instead of a duplicate.
        const key = `${record.kind}:${record.id}`;
        const existing = byKey.get(key);
        if (!existing || existing.revision < record.revision)
          byKey.set(key, record);
      }
      offset += rows.length;
      if (rows.length === 0 || (range.total !== null && offset >= range.total))
        return [...byKey.values()];
    }
  }

  async cas(
    record: Omit<SyncRecord, "updatedAt" | "revision"> & {
      revision: number | null;
    },
  ): Promise<CasResult> {
    const r = await this.request("rpc/sync_cas", {
      method: "POST",
      body: JSON.stringify({
        p_kind: record.kind,
        p_record_id: record.id,
        p_payload: record.payload,
        p_deleted_at: record.deletedAt,
        p_expected_revision: record.revision,
      }),
    });
    const row = singleRow<{
      ok: boolean;
      kind?: SyncRecord["kind"];
      record_id?: string;
      payload?: unknown;
      updated_at?: string;
      deleted_at?: string | null;
      revision?: number;
    }>(await r.json(), "Compare-and-swap");
    if (!row) return { ok: false, record: null };
    if (!row.ok)
      return {
        ok: false,
        record: row.record_id
          ? {
              kind: row.kind!,
              id: row.record_id,
              payload: row.payload,
              updatedAt: row.updated_at!,
              deletedAt: row.deleted_at ?? null,
              revision: row.revision!,
            }
          : null,
      };
    return {
      ok: true,
      record: {
        kind: row.kind!,
        id: row.record_id!,
        payload: row.payload,
        updatedAt: row.updated_at!,
        deletedAt: row.deleted_at ?? null,
        revision: row.revision!,
      },
    };
  }

  async createShare(song: Song, tuning: Tuning) {
    const r = await this.request("rpc/create_song_share", {
      method: "POST",
      body: JSON.stringify({ p_song: song, p_tuning: tuning }),
    });
    const row = singleRow<{ token: string }>(await r.json(), "Create share");
    if (!row?.token)
      throw new SyncTransportError(
        "Create share returned an invalid response.",
      );
    return row.token;
  }
  async listShares(): Promise<ShareRecord[]> {
    const r = await this.request(
      "song_shares?select=token,song,created_at,revoked_at&order=created_at.desc",
    );
    const rows = (await r.json()) as Array<{
      token: string;
      song: { id?: unknown };
      created_at: string;
      revoked_at: string | null;
    }>;
    if (!Array.isArray(rows))
      throw new SyncTransportError("List shares returned an invalid response.");
    return rows.flatMap((row) =>
      typeof row.token === "string" &&
      typeof row.song?.id === "string" &&
      typeof row.created_at === "string"
        ? [
            {
              token: row.token,
              songId: row.song.id,
              createdAt: row.created_at,
              revokedAt: row.revoked_at ?? null,
            },
          ]
        : [],
    );
  }
  async readShare(token: string) {
    const response = await fetch(
      `${this.options.url}/rest/v1/rpc/read_song_share`,
      {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          apikey: this.options.anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_token: token }),
      },
    );
    if (!response.ok)
      throw new SyncTransportError(
        `Share request failed (${response.status}).`,
      );
    return singleRow<{ song: Song; tuning: Tuning }>(
      await response.json(),
      "Read share",
    );
  }
  async revokeShare(token: string) {
    await this.request("rpc/revoke_song_share", {
      method: "POST",
      body: JSON.stringify({ p_token: token }),
    });
  }
}
