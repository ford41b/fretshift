import { SongV1, BUILT_IN_TUNINGS, type Song } from "./song.v1";
export const migrations: Record<number, (old: unknown) => unknown> = {
  0: (old) => {
    const o = old as Record<string, unknown>;
    let tuningId = o.tuningId ?? o.tuning ?? "standard";
    if (typeof tuningId === "object" && tuningId) {
      const old = tuningId as { id?: string; midi?: number[] };
      const match = BUILT_IN_TUNINGS.find(
        (t) =>
          t.id === old.id ||
          JSON.stringify(t.midi) === JSON.stringify(old.midi),
      );
      if (!match)
        throw new Error(
          "Unknown v0 tuning object; specify a registered tuning.",
        );
      tuningId = match.id;
    }
    if (typeof tuningId === "string")
      tuningId =
        BUILT_IN_TUNINGS.find((t) => t.label === tuningId)?.id ?? tuningId;
    return { ...o, schemaVersion: 1, tuningId };
  },
};
export function loadSong(raw: unknown): Song {
  let data = raw;
  if (!data || typeof data !== "object")
    throw new Error("Song must be a JSON object.");
  let version = (data as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number")
    throw new Error("Song is missing schemaVersion.");
  if (version < 0 || version > 1)
    throw new Error(
      `Unsupported song schema version ${version}. This app supports version 1.`,
    );
  while (version < 1) {
    if (!migrations[version])
      throw new Error(`No migration for schema version ${version}.`);
    data = migrations[version](data);
    version++;
  }
  const result = SongV1.safeParse(data);
  if (!result.success)
    throw new Error(
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n"),
    );
  return result.data;
}
