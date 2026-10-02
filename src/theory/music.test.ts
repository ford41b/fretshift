import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseChordName,
  formatChordName,
  qualities,
  extensions,
  NOTE_NAMES,
  mod,
  spell,
} from "./chordName";
import {
  newSong,
  BUILT_IN_TUNINGS,
  SongV1,
  type Song,
  type Slot,
  resolveTuning,
} from "../schema/song.v1";
import { loadSong } from "../schema/migrations";
import {
  findVoicings,
  identifyChord,
  voicingPitches,
  curated,
} from "./voicingSearch";
import {
  transposeKey,
  transposeTuning,
  scoreDifficulty,
  chordToTab,
  tabToChord,
  scaleDifficulty,
  suggestCapo,
  setlistTransitions,
  planSetlistCapos,
} from "../transforms";
import {
  parseChordPro,
  serializeChordPro,
  applyChordProSource,
} from "../io/chordpro";
import { exportJSON, importJSON } from "../io/json";
import { frequencyOf } from "./pitch";
import { createSamples } from "../samples";
const standard = BUILT_IN_TUNINGS[0];
function chart(chord: string): Song {
  const s = newSong();
  s.measures[0].chords = [
    {
      id: "c",
      beat: 0,
      chordName: chord,
      voicing: findVoicings(chord, standard, 0, 1)[0],
    },
  ];
  return s;
}
describe("schema and chord grammar", () => {
  it("round-trips the full ordered grammar", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NOTE_NAMES),
        fc.constantFrom(...qualities),
        fc.subarray([...extensions]),
        fc.option(fc.constantFrom(...NOTE_NAMES), { nil: undefined }),
        (root, quality, ext, bass) => {
          const parsed = { root, quality, extensions: ext, bass };
          expect(formatChordName(parseChordName(formatChordName(parsed)))).toBe(
            formatChordName(parsed),
          );
        },
      ),
    );
  });
  it("rejects malformed names and parses majors before minor quality", () => {
    for (const n of ["H7", "Cb", "C##", "C7/", "Cfoo", "C#11maj7"])
      expect(() => parseChordName(n)).toThrow();
    expect(parseChordName("F#m7b5/C#").quality).toBe("m");
    expect(parseChordName("Cmaj7").quality).toBe("");
    expect(parseChordName("B#11")).toMatchObject({
      root: "B",
      extensions: ["#11"],
    });
    expect(parseChordName("F#11")).toMatchObject({
      root: "F#",
      extensions: ["11"],
    });
  });
  it("validates holds, grid length, beat position, version and tuning", () => {
    const s = newSong();
    s.measures[0].tab!.slots[0][0] = "hold";
    expect(SongV1.safeParse(s).success).toBe(false);
    s.measures[0].tab!.slots[0][0] = 0;
    s.measures[0].tab!.slots[1][0] = "hold";
    expect(loadSong(s)).toEqual(s);
    s.measures[0].tab!.slots.pop();
    expect(() => loadSong(s)).toThrow("slots");
    expect(() => loadSong({ ...newSong(), schemaVersion: 8 })).toThrow(
      "Unsupported",
    );
    expect(() => loadSong({ ...newSong(), tuningId: "missing" })).toThrow(
      "tuning",
    );
    const bad = chart("C");
    bad.measures[0].chords[0].beat = 1.25;
    expect(() => loadSong(bad)).toThrow("grid");
  });
  it("migrates v0 and preserves JSON data", () => {
    const s = newSong();
    expect(
      loadSong({ ...s, schemaVersion: 0, tuningId: standard.label }),
    ).toEqual(s);
    expect(importJSON(exportJSON(s))).toEqual(s);
  });
  it("allows cross-measure holds only through continuous active notes", () => {
    const s = newSong();
    const m = structuredClone(s.measures[0]);
    m.id = "next";
    m.index = 1;
    s.measures.push(m);
    s.measures[0].tab!.slots[7][2] = 4;
    m.tab!.slots[0][2] = "hold";
    expect(loadSong(s)).toEqual(s);
    s.measures[0].tab!.slots[7][2] = null;
    expect(() => loadSong(s)).toThrow("Orphan");
  });
});
describe("pitch, voicings and transforms", () => {
  it("matches golden open string frequencies", () => {
    [329.63, 246.94, 196, 146.83, 110, 82.41].forEach((hz, i) =>
      expect(frequencyOf(standard.midi[i])).toBeCloseTo(hz, 1),
    );
  });
  it("curated shapes sound exactly their named intervals including C7 without fifth", () => {
    for (const [name, frets] of Object.entries(curated)) {
      const found = findVoicings(name, standard, 0, 1)[0];
      expect(found.frets).toEqual(frets);
    }
    expect(identifyChord([64, 60, 58, 52, 48])[0]).toBe("C7");
    const s = chart("C7");
    expect(
      tabToChord(chordToTab(s).song).song.measures[0].chords[0].chordName,
    ).toBe("C7");
  });
  it("spells in key and understands capo sounding names", () => {
    expect(spell(1, { root: "Db", mode: "major" })).toBe("Db");
    expect(spell(1, { root: "A", mode: "major" })).toBe("C#");
    const s = parseChordPro("{key: C}\n{capo: 2}\n[C]Hello");
    expect(s.currentKey.root).toBe("D");
    expect(s.measures[0].chords[0].chordName).toBe("D");
    expect(
      new Set(
        voicingPitches(findVoicings("D", standard, 2, 1)[0], standard, 2).map(
          (n) => mod(n),
        ),
      ),
    ).toEqual(new Set([2, 6, 9]));
  });
  it("transposes exact pitches whenever playable and retains failures visibly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 3, max: 18 }),
        fc.integer({ min: -3, max: 3 }),
        (string, fret, delta) => {
          const s = newSong();
          s.measures[0].tab!.slots[0][string] = fret;
          const r = transposeKey(s, delta);
          const after = r.song.measures[0].tab!.slots[0].flatMap((v, i) =>
            typeof v === "number" ? [standard.midi[i] + v] : [],
          );
          expect(after).toEqual([standard.midi[string] + fret + delta]);
          expect(r.song.capo).toBe(s.capo);
        },
      ),
    );
    const s = newSong();
    s.measures[0].tab!.slots[0][0] = 22;
    const r = transposeKey(s, 1);
    expect(r.song.measures[0].outOfRange).toBe(true);
    expect(r.song.measures[0].tab!.slots[0][0]).toBe(22);
  });
  it("keeps pinned voicings valid when a barre moves to the nut", () => {
    const s = chart("F");
    s.measures[0].chords[0].voicingPinned = true;
    s.measures[0].chords[0].voicing = {
      frets: [1, 1, 2, 3, 3, 1],
      barre: { fret: 1, fromString: 0, toString: 5 },
      fingering: [1, 1, 2, 3, 4, 1],
    };
    const moved = transposeKey(s, -1).song;
    expect(moved.measures[0].chords[0].voicing?.barre).toBeUndefined();
    expect(moved.measures[0].chords[0].voicing?.fingering).toBeUndefined();
    expect(SongV1.safeParse(moved).success).toBe(true);
  });
  it("preserves every playable pitch across all built-in tuning pairs", () => {
    for (const from of BUILT_IN_TUNINGS)
      for (const to of BUILT_IN_TUNINGS)
        fc.assert(
          fc.property(
            fc.integer({ min: 0, max: 5 }),
            fc.integer({ min: 0, max: 22 }),
            (string, fret) => {
              const s = newSong();
              s.tuningId = from.id;
              s.measures[0].tab!.slots[0][string] = fret;
              const r = transposeTuning(s, to);
              const m = r.song.measures[0];
              if (!m.outOfRange) {
                const notes = m.tab!.slots[0].flatMap((v, i) =>
                  typeof v === "number" ? [to.midi[i] + v] : [],
                );
                expect(notes).toEqual([from.midi[string] + fret]);
              } else expect(m.tab!.slots[0][string]).toBe(fret);
            },
          ),
          { numRuns: 15 },
        );
  });
  it("never overwrites simultaneous pitches or mute events", () => {
    const s = newSong();
    s.tuningId = "dadgad";
    s.measures[0].tab!.slots[0] = [0, "x", 0, null, null, null];
    const r = transposeTuning(s, standard);
    expect(r.song.measures[0].tab!.slots[0]).toContain("x");
    const pitches = (slot: Slot, t = standard) =>
      slot
        .flatMap((c, i) => (typeof c === "number" ? [t.midi[i] + c] : []))
        .sort();
    expect(pitches(r.song.measures[0].tab!.slots[0])).toEqual(
      pitches(s.measures[0].tab!.slots[0], resolveTuning("dadgad")),
    );
  });
  it("matches hand-computed difficulty scores", () => {
    for (const [name, score] of [
      ["C", 1],
      ["Em", 1],
      ["F", 6],
      ["C7", 4],
      ["Cmaj7", 2],
      ["Am7", 2],
    ] as const)
      expect(scoreDifficulty(chart(name)), name).toBe(score);
  });
  it("scaling is monotonic or explicitly unchanged, enrichment deterministic", () => {
    for (const name of ["C", "F", "C7", "G9"]) {
      const s = chart(name),
        low = scaleDifficulty(s, 2),
        high = scaleDifficulty(s, 9, 123);
      expect(
        low.changed
          ? scoreDifficulty(low.song) < scoreDifficulty(s)
          : low.song === s,
      ).toBe(true);
      expect(
        high.changed
          ? scoreDifficulty(high.song) > scoreDifficulty(s)
          : high.song === s,
      ).toBe(true);
      expect(scaleDifficulty(s, 9, 123)).toEqual(high);
    }
    const simple = chart("C");
    expect(suggestCapo(simple).song.capo).toBe(0);
  });
  it("samples are valid, deletable public-domain arrangements", () => {
    const s = createSamples();
    expect(s).toHaveLength(5);
    s.forEach((x) => expect(() => loadSong(x)).not.toThrow());
    expect(setlistTransitions([s[0], s[2]])[0].tuning).toBe(true);
  });
});
describe("ChordPro semantics", () => {
  it("round-trips sections, chord beats, lyrics, capo and key", () => {
    const s = parseChordPro(
      "{title: Fixture}\n{key: C}\n{capo: 2}\n{start_of_chorus: Refrain}\n[C]Amazing [F]grace [G7]today",
    );
    const r = parseChordPro(serializeChordPro(s, true));
    expect(r.title).toBe(s.title);
    expect(r.currentKey).toEqual(s.currentKey);
    expect(
      r.measures.map((m) => ({
        lyrics: m.lyrics,
        section: m.section,
        chords: m.chords.map((c) => ({ beat: c.beat, chordName: c.chordName })),
      })),
    ).toEqual(
      s.measures.map((m) => ({
        lyrics: m.lyrics,
        section: m.section,
        chords: m.chords.map((c) => ({ beat: c.beat, chordName: c.chordName })),
      })),
    );
  });
  it("preserves tab and per-measure settings when applying source edits", () => {
    const s = chart("C");
    s.measures[0].subdivision = 4;
    s.measures[0].tab = {
      slots: Array.from(
        { length: 16 },
        () => [null, null, null, null, null, null] as Slot,
      ),
    };
    s.measures[0].tab.slots[0][5] = 3;
    s.measures[0].tempoOverride = 90;
    const source = serializeChordPro(s, true).replace(
      "[C@0]",
      "[C@0.25]Edited",
    );
    const applied = applyChordProSource(s, source);
    expect(applied.measures[0].tab).toEqual(s.measures[0].tab);
    expect(applied.measures[0].tempoOverride).toBe(90);
    expect(applied.measures[0].chords[0].beat).toBe(0.25);
    expect(applied.measures[0].lyrics).toBe("Edited");
  });
  it("rejects malformed chart text without partial acceptance", () =>
    expect(() => parseChordPro("[Cbad]Oops")).toThrow());
});
it("plans a setlist as valid songs and keeps repeated-song capo ownership consistent", () => {
  const a = chart("C"),
    b = chart("G");
  b.id = "b";
  a.capo = 2;
  const plan = planSetlistCapos([a, b, a]);
  expect(plan.songs.find((song) => song.id === a.id)?.capo).toBe(2);
  expect(plan.warnings).toHaveLength(1);
  expect(plan.songs.every((song) => SongV1.safeParse(song).success)).toBe(true);
});
