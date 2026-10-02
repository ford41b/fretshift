import { afterEach, describe, expect, it, vi } from "vitest";
import { newSong, resolveTuning } from "../../schema/song.v1";
import { SupabaseSyncAdapter } from ".";

const row = {
  ok: true,
  kind: "song",
  record_id: "song-1",
  payload: { id: "song-1", title: "Server" },
  updated_at: "2026-09-13T12:00:00.000Z",
  deleted_at: null,
  revision: 2,
};

function adapter(account = "account-1") {
  let current = account;
  return {
    value: new SupabaseSyncAdapter({
      url: "https://project.supabase.co",
      anonKey: "anon",
      expectedAccountId: account,
      getAccountId: () => current,
      getAccessToken: async () => "access",
    }),
    switchAccount: (next: string) => {
      current = next;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Supabase sync adapter", () => {
  it("parses PostgREST array rows for CAS and share RPCs", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([row]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ token: "share-token" }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { song: newSong("Shared"), tuning: resolveTuning("standard") },
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const { value } = adapter();

    await expect(
      value.cas({
        kind: "song",
        id: "song-1",
        payload: row.payload,
        deletedAt: null,
        revision: 1,
      }),
    ).resolves.toEqual({
      ok: true,
      record: {
        kind: "song",
        id: "song-1",
        payload: row.payload,
        updatedAt: row.updated_at,
        deletedAt: null,
        revision: 2,
      },
    });
    await expect(
      value.createShare(newSong("Shared"), resolveTuning("standard")),
    ).resolves.toBe("share-token");
    await expect(value.readShare("share-token")).resolves.toMatchObject({
      song: { title: "Shared" },
      tuning: { id: "standard" },
    });
  });

  it("treats empty CAS/read RPC arrays as missing records", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response("[]", { status: 200 })),
        ),
    );
    const { value } = adapter();
    await expect(
      value.cas({
        kind: "song",
        id: "missing",
        payload: { id: "missing" },
        deletedAt: null,
        revision: null,
      }),
    ).resolves.toEqual({ ok: false, record: null });
    await expect(value.readShare("missing")).resolves.toBeNull();
  });

  it("uses stable pagination and lists owner-managed shares", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("[]", {
          status: 200,
          headers: { "Content-Range": "*/0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              token: "token",
              song: { id: "song-1" },
              created_at: row.updated_at,
              revoked_at: null,
            },
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const { value } = adapter();
    await value.pull();
    await expect(value.listShares()).resolves.toEqual([
      {
        token: "token",
        songId: "song-1",
        createdAt: row.updated_at,
        revokedAt: null,
      },
    ]);
    expect(String(fetch.mock.calls[0][0])).toContain(
      "order=kind.asc,record_id.asc",
    );
  });

  it("stops protected requests when the active account changes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const scoped = adapter();
    scoped.switchAccount("account-2");
    await expect(scoped.value.pull()).rejects.toThrow(/account changed/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechecks account identity after an awaited token refresh", async () => {
    let current = "account-1";
    const value = new SupabaseSyncAdapter({
      url: "https://project.supabase.co",
      anonKey: "anon",
      expectedAccountId: "account-1",
      getAccountId: () => current,
      getAccessToken: async () => {
        current = "account-2";
        return "other-token";
      },
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(value.pull()).rejects.toThrow(/account changed/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows Content-Range so a lower PostgREST max-rows cannot truncate the pull", async () => {
    const MAX_ROWS = 500;
    const total = 1200;
    const rows = Array.from({ length: total }, (_, index) => ({
      kind: "song",
      record_id: `song-${String(index).padStart(4, "0")}`,
      payload: { id: `song-${String(index).padStart(4, "0")}` },
      updated_at: "2026-09-13T12:00:00.000Z",
      deleted_at: null,
      revision: 1,
    }));
    // Behaves like PostgREST with db-max-rows = 500: it silently caps the
    // requested Range and reports what it returned in Content-Range.
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      // jsdom's Headers class drops Range, so read the plain header object.
      const range = (init.headers as Record<string, string>).Range ?? "0-";
      const [from, to] = range.split("-").map(Number);
      const start = from;
      const end = Math.min(to, start + MAX_ROWS - 1, total - 1);
      const page = start < total ? rows.slice(start, end + 1) : [];
      return Promise.resolve(
        new Response(JSON.stringify(page), {
          status: 206,
          headers: {
            "Content-Range": page.length ? `${start}-${end}/${total}` : `*/${total}`,
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const pulled = await adapter().value.pull();
    expect(pulled).toHaveLength(total);
    expect(new Set(pulled.map((record) => record.id)).size).toBe(total);
    expect(fetch.mock.calls[0][1].headers.Prefer).toBe("count=exact");
  });

  it("adds the updated_at cursor filter and refuses a response without Content-Range", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), { headers: { "Content-Range": "*/0" } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([])));
    vi.stubGlobal("fetch", fetch);
    const { value } = adapter();
    await value.pull({ since: "2026-09-13T12:00:00.000Z" });
    expect(String(fetch.mock.calls[0][0])).toContain(
      "updated_at=gte.2026-09-13T12%3A00%3A00.000Z",
    );
    await expect(value.pull()).rejects.toThrow(/Content-Range/);
  });
});
