import { describe, expect, it } from "vitest";
import { newSong, SongV1 } from "../schema/song.v1";
import {
  analyzeSong,
  recommend,
  ensureRecommendations,
  editEvent,
  fingerprint,
  complexity,
} from "./engine";
import { PatternSchema, type Pattern } from "./schema";
import { RHYTHM_LIBRARY } from "./library";
import { exportJSON, importJSON } from "../io/json";
import { songsRepo, db } from "../persistence/dexie";

it("all curated templates have complete grids and valid accents", () => {
  for (const template of RHYTHM_LIBRARY)
    expect(PatternSchema.safeParse(template).success, template.id).toBe(true);
});
describe.each([
  [4, 4],
  [3, 4],
  [6, 8],
  [2, 4],
  [5, 4],
  [7, 8],
  [9, 8],
  [12, 8],
  [2, 2],
  [3, 2],
])("meter %i/%i", (n, d) => {
  it.each([20, 45, 90, 120, 180, 260, 400])(
    "produces distinct valid measures at %i quarter BPM",
    (bpm) => {
      const analysis = analyzeSong({
        tempo: bpm,
        timeSignature: [n, d] as Pattern["meter"],
      });
      const options = recommend(analysis);
      expect(options.map((r) => r.role)).toEqual([
        "Simple",
        "Recommended",
        "Expressive",
      ]);
      expect(
        new Set(
          options.map((r) =>
            JSON.stringify(
              r.pattern.events
                .filter((e) => e.stroke !== "rest")
                .map((e) => [e.position, e.stroke]),
            ),
          ),
        ).size,
      ).toBe(3);
      for (const { pattern } of options) {
        expect(PatternSchema.safeParse(pattern).success).toBe(true);
        expect(
          pattern.events.reduce((sum, e) => sum + e.duration, 0),
        ).toBeCloseTo(n);
        expect(pattern.meter).toEqual([n, d]);
      }
    },
  );
});
it("labels absent metadata and never infers genre from titles", () => {
  const analysis = analyzeSong({ title: "Funky country blues" });
  expect(analysis.bpm).toBe(90);
  expect(analysis.meter).toEqual([4, 4]);
  expect(analysis.styles).toEqual([]);
  expect(analysis.chords).toEqual([]);
  expect(analysis.notes.join(" ")).toMatch(/provisional/);
});
it("reports unsupported meters without replacing them silently", () => {
  const a = analyzeSong({ timeSignature: [17, 16] });
  expect(a.notes.join(" ")).toContain("not supported");
  expect(() => recommend(a)).toThrow(/No distinct/);
});
it("aligns verified changes and leaves unverified timing unclaimed", () => {
  const s = newSong();
  s.measures[0].chords = [
    { id: "a", beat: 0, chordName: "C" },
    { id: "b", beat: 2, chordName: "G" },
  ];
  const unverified = recommend(analyzeSong(s));
  expect(unverified.every((r) => r.pattern.events.every((e) => !e.chord))).toBe(
    true,
  );
  const verified = recommend(
    analyzeSong(s, s.measures[0].id, { chordTimingConfirmed: true }),
  );
  for (const r of verified.slice(1)) {
    const event = r.pattern.events.find((e) => e.position === 2)!;
    expect(event.chord).toBe("G");
    expect(event.accent).toBeGreaterThanOrEqual(0.8);
    expect(event.stroke).not.toBe("rest");
  }
});
it("never rounds off-grid changes into invented chord positions", () => {
  const s = newSong();
  s.measures[0].chords = [{ id: "a", beat: 0.25, chordName: "C" }];
  const options = recommend(
    analyzeSong(s, s.measures[0].id, { chordTimingConfirmed: true }),
  );
  expect(options[0].pattern.events[0].chord).toBeUndefined();
  expect(options[0].explanation).not.toContain("Emphasizes 1");
});
it("uses measure overrides and inherited section labels", () => {
  const s = newSong();
  s.measures[0].section = { kind: "chorus" };
  s.measures.push({
    ...s.measures[0],
    id: "b",
    index: 1,
    section: undefined,
    timeSignature: [6, 8],
    tempoOverride: 75,
  });
  const a = analyzeSong(s, "b");
  expect(a.section).toBe("chorus");
  expect(a.bpm).toBe(75);
  expect(a.meter).toEqual([6, 8]);
});
it("supplied style and level affect selection; faster tempos discourage dense strokes", () => {
  const funk = recommend(
    analyzeSong({ tempo: 80, tags: ["funk"] }, undefined, {
      difficulty: "advanced",
    }),
  );
  expect(funk[1].pattern.name).toBe("Sixteenth pocket");
  const slow = recommend(
    analyzeSong({ tempo: 80 }, undefined, { difficulty: "advanced" }),
  );
  const fast = recommend(
    analyzeSong({ tempo: 240 }, undefined, { difficulty: "advanced" }),
  );
  expect(complexity(fast[1].pattern)).toBeLessThanOrEqual(
    complexity(slow[1].pattern),
  );
  for (const level of ["beginner", "intermediate", "advanced"] as const) {
    const options = recommend(
      analyzeSong({ tempo: 100 }, undefined, { difficulty: level }),
    );
    expect(options[0].pattern.difficulty).toBe("beginner");
    expect(options[1].pattern.difficulty).toBe(level);
  }
});
it("generation and regeneration are deterministic and cached", () => {
  const s = newSong(),
    id = s.measures[0].id;
  expect(recommend(analyzeSong(s))).toEqual(recommend(analyzeSong(s)));
  const state = ensureRecommendations(s, id);
  s.strumming = state;
  expect(ensureRecommendations(s, id)).toBe(state);
  expect(ensureRecommendations(s, id, true)).toEqual(
    ensureRecommendations(s, id, true),
  );
  const key = fingerprint(s, id);
  s.title = "Rename";
  expect(fingerprint(s, id)).toBe(key);
  s.tempo = 75;
  expect(fingerprint(s, id)).not.toBe(key);
  expect(ensureRecommendations(s, id)).not.toBe(state);
});
it("edits exactly one stroke without moving timing and rejects invalid rhythms", () => {
  const p = recommend(analyzeSong({}))[1].pattern;
  const changed = editEvent(p, 0, { stroke: "rest" });
  expect(
    changed.events.filter(
      (e, i) => JSON.stringify(e) !== JSON.stringify(p.events[i]),
    ),
  ).toHaveLength(1);
  expect(changed.events[0].accent).toBe(0);
  expect(
    editEvent(changed, 0, { stroke: "up" }).events[0].accent,
  ).toBeGreaterThan(0);
  expect(() => editEvent(p, 999, { stroke: "up" })).toThrow();
  expect(() => editEvent(p, 1, { accent: 2 })).toThrow();
  for (const bad of [
    { ...p, events: p.events.slice(1) },
    { ...p, events: [...p.events, p.events[0]] },
    { ...p, events: p.events.map((e, i) => (i ? e : { ...e, position: 0.1 })) },
    { ...p, events: p.events.map((e, i) => (i ? e : { ...e, duration: 10 })) },
  ])
    expect(PatternSchema.safeParse(bad).success).toBe(false);
});
it("custom patterns survive metadata refresh, schema/JSON and IndexedDB round trips", async () => {
  const s = newSong(),
    id = s.measures[0].id;
  s.strumming = ensureRecommendations(s, id);
  const p = editEvent(s.strumming.contexts[id].recommendations[1].pattern, 1, {
    stroke: "mute",
  });
  s.strumming.customs.push({
    id: "custom",
    contextId: id,
    sourceId: p.id,
    fingerprint: fingerprint(s, id),
    tempo: 100,
    pattern: { ...p, id: "custom" },
    savedAt: s.createdAt,
  });
  s.strumming.contexts[id].selectedId = "custom";
  const before = structuredClone(s.strumming.customs);
  s.tempo = 180;
  s.strumming = ensureRecommendations(s, id);
  expect(s.strumming.customs).toEqual(before);
  expect(s.strumming.contexts[id].selectedId).toBe("custom");
  expect(SongV1.parse(s).strumming).toEqual(s.strumming);
  expect(importJSON(exportJSON(s)).strumming).toEqual(s.strumming);
  await songsRepo.put(s);
  expect((await db.songs.get(s.id))?.strumming).toEqual(s.strumming);
  await db.songs.delete(s.id);
});

it("invalid in-progress score metadata falls back without crashing the editor", () => {
  const analysis = analyzeSong({ tempo: 0, timeSignature: [0, 4] });
  expect(analysis.bpm).toBe(90);
  expect(analysis.meter).toEqual([4, 4]);
  expect(analysis.notes.join(" ")).toMatch(/invalid/);
  expect(recommend(analysis)).toHaveLength(3);
});
