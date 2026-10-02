import type { Song, Tuning } from "../../schema/song.v1";
import type {
  CasResult,
  PullOptions,
  ShareRecord,
  SyncAdapter,
  SyncRecord,
} from "../../sync/adapter";

/** Contract fake: instances are account-scoped and cannot observe another owner. */
export class FakeSyncService {
  private records = new Map<string, Map<string, SyncRecord>>();
  private shares = new Map<
    string,
    {
      owner: string;
      song: Song;
      tuning: Tuning;
      createdAt: string;
      revokedAt: string | null;
    }
  >();
  /** Number of records each pull() returned, in order (a bandwidth proxy). */
  readonly pullLog: number[] = [];
  adapter(owner: string): SyncAdapter {
    return new FakeSyncAdapter(this, owner);
  }
  recordsFor(owner: string) {
    return this.records.get(owner) ?? new Map();
  }
  put(owner: string, record: SyncRecord) {
    (
      this.records.get(owner) ?? this.records.set(owner, new Map()).get(owner)!
    ).set(`${record.kind}:${record.id}`, structuredClone(record));
  }
  getShare(token: string) {
    return this.shares.get(token);
  }
  setShare(
    token: string,
    value: {
      owner: string;
      song: Song;
      tuning: Tuning;
      createdAt: string;
      revokedAt: string | null;
    },
  ) {
    this.shares.set(token, value);
  }
  sharesFor(owner: string): ShareRecord[] {
    return [...this.shares]
      .filter(([, value]) => value.owner === owner)
      .map(([token, value]) => ({
        token,
        songId: value.song.id,
        createdAt: value.createdAt,
        revokedAt: value.revokedAt,
      }));
  }
  revokeShare(token: string) {
    const share = this.shares.get(token);
    if (share) share.revokedAt = new Date().toISOString();
  }
}
class FakeSyncAdapter implements SyncAdapter {
  constructor(
    private service: FakeSyncService,
    private owner: string,
  ) {}
  async pull(options: PullOptions = {}): Promise<SyncRecord[]> {
    // Mirrors the PostgREST filter `updated_at=gte.<since>`.
    const since = options.since ? Date.parse(options.since) : null;
    const records = [...this.service.recordsFor(this.owner).values()]
      .filter((record) => since === null || Date.parse(record.updatedAt) >= since)
      .map((record) => structuredClone(record));
    this.service.pullLog.push(records.length);
    return records;
  }
  async cas(
    input: Omit<SyncRecord, "updatedAt" | "revision"> & {
      revision: number | null;
    },
  ): Promise<CasResult> {
    const key = `${input.kind}:${input.id}`,
      current = this.service.recordsFor(this.owner).get(key);
    if ((current?.revision ?? null) !== input.revision)
      return { ok: false, record: current ? structuredClone(current) : null };
    const record: SyncRecord = {
      ...input,
      updatedAt: new Date().toISOString(),
      revision: (current?.revision ?? 0) + 1,
    };
    this.service.put(this.owner, record);
    return { ok: true, record: structuredClone(record) };
  }
  async createShare(song: Song, tuning: Tuning) {
    const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    this.service.setShare(token, {
      owner: this.owner,
      song: structuredClone(song),
      tuning: structuredClone(tuning),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    });
    return token;
  }
  async listShares() {
    return this.service.sharesFor(this.owner);
  }
  async readShare(token: string) {
    const v = this.service.getShare(token);
    return v && !v.revokedAt
      ? { song: structuredClone(v.song), tuning: structuredClone(v.tuning) }
      : null;
  }
  async revokeShare(token: string) {
    const v = this.service.getShare(token);
    if (v?.owner === this.owner) this.service.revokeShare(token);
  }
}
