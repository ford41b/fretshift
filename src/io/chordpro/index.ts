import {
  newSong,
  type Song,
  type Section,
  emptySlot,
} from "../../schema/song.v1";
import { loadSong } from "../../schema/migrations";
import {
  parseChordName,
  shiftChord,
  pcOf,
  spell,
  NoteNameSchema,
} from "../../theory/chordName";
import { scoreDifficulty } from "../../transforms";
export function parseChordPro(text: string): Song {
  const song = newSong();
  song.measures = [];
  song.provenance = {
    source: "chordpro",
    processedAt: new Date().toISOString(),
  };
  let pending: Section | undefined;
  let key = { ...song.currentKey };
  for (const match of text.matchAll(/\{([^:{}]+):?([^{}]*)\}/g)) {
    const name = match[1].trim().toLowerCase(),
      value = match[2].trim();
    if (["title", "t"].includes(name)) song.title = value || song.title;
    else if (["artist", "a"].includes(name)) song.artist = value;
    else if (name === "capo") {
      if (!/^\d+$/.test(value)) throw new Error("Capo must be an integer 0–7.");
      song.capo = Number(value);
    } else if (name === "tempo") song.tempo = Number(value);
    else if (name === "time") {
      const [a, b] = value.split("/").map(Number);
      song.timeSignature = [a, b as 2 | 4 | 8 | 16];
    } else if (name === "key") {
      const minor = value.endsWith("m");
      key = {
        root: NoteNameSchema.parse(minor ? value.slice(0, -1) : value),
        mode: minor ? "minor" : "major",
      };
    } else if (name === "tuning") song.tuningId = value;
  }
  song.currentKey = { ...key, root: spell(pcOf(key.root) + song.capo, key) };
  song.originalKey = { ...song.currentKey };
  for (const [lineIndex, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const directive = line.match(/^\{([^:{}]+):?([^{}]*)\}$/);
    if (directive) {
      const n = directive[1].trim().toLowerCase(),
        v = directive[2].trim();
      const kinds: Record<string, Section["kind"]> = {
        start_of_chorus: "chorus",
        soc: "chorus",
        start_of_verse: "verse",
        sov: "verse",
        start_of_bridge: "bridge",
        sob: "bridge",
        start_of_intro: "intro",
        start_of_outro: "outro",
        start_of_solo: "solo",
        start_of_prechorus: "prechorus",
      };
      if (kinds[n]) pending = { kind: kinds[n], ...(v ? { label: v } : {}) };
      else if (n === "section" || n === "comment" || n === "c")
        pending = { kind: "custom", label: v };
      else if (
        ![
          "title",
          "t",
          "artist",
          "a",
          "key",
          "capo",
          "tempo",
          "time",
          "tuning",
          "end_of_chorus",
          "eoc",
          "end_of_verse",
          "eov",
          "end_of_bridge",
          "eob",
          "end_of_intro",
          "end_of_outro",
          "end_of_solo",
          "end_of_prechorus",
        ].includes(n)
      )
        throw new Error(`Line ${lineIndex + 1}: unsupported directive ${n}.`);
      continue;
    }
    for (const part of raw.split("|")) {
      if (!part.trim()) continue;
      const matches = [...part.matchAll(/\[([^\]]+)\]/g)];
      const plain = part.replace(/\[[^\]]+\]/g, "");
      if (plain.includes("[") || plain.includes("]"))
        throw new Error(`Line ${lineIndex + 1}: unmatched chord brackets.`);
      const beats = song.timeSignature[0];
      if (matches.length > beats * 4)
        throw new Error(
          `Line ${lineIndex + 1}: too many chord events for a supported measure.`,
        );
      const tokens = matches.map((c) => c[1].match(/^(.*?)(?:@([\d.]+))?$/)!);
      const subdivision =
        tokens.some(
          (t) =>
            t[2] !== undefined &&
            Math.abs(Number(t[2]) * 2 - Math.round(Number(t[2]) * 2)) > 1e-8,
        ) || matches.length > beats
          ? 4
          : 2;
      const chords = tokens.map((token, i) => {
        parseChordName(token[1]);
        const beat =
          token[2] !== undefined
            ? Number(token[2])
            : Math.floor((i * beats * subdivision) / matches.length) /
              subdivision;
        return {
          id: crypto.randomUUID(),
          beat,
          chordName: shiftChord(token[1], song.capo, song.currentKey),
        };
      });
      song.measures.push({
        id: crypto.randomUUID(),
        index: song.measures.length,
        subdivision,
        lyrics: plain.trim(),
        chords,
        ...(pending ? { section: pending } : {}),
      });
      pending = undefined;
    }
  }
  if (!song.measures.length)
    song.measures = [
      {
        id: crypto.randomUUID(),
        index: 0,
        subdivision: 2,
        chords: [],
        tab: {
          slots: Array.from({ length: song.timeSignature[0] * 2 }, emptySlot),
        },
      },
    ];
  const valid = loadSong(song);
  valid.difficulty = scoreDifficulty(valid);
  return valid;
}
export function serializeChordPro(song: Song, precise = false): string {
  loadSong(song);
  const shapeKey = spell(
    pcOf(song.currentKey.root) - song.capo,
    song.currentKey,
  );
  const rows = [
    `{title: ${song.title}}`,
    `{artist: ${song.artist}}`,
    `{key: ${shapeKey}${song.currentKey.mode === "minor" ? "m" : ""}}`,
    `{capo: ${song.capo}}`,
    `{tempo: ${song.tempo}}`,
    `{time: ${song.timeSignature.join("/")}}`,
    `{tuning: ${song.tuningId}}`,
    "",
  ];
  for (const m of song.measures) {
    if (m.section)
      rows.push(
        m.section.kind === "custom"
          ? `{section: ${m.section.label ?? "Section"}}`
          : `{start_of_${m.section.kind}${m.section.label ? ": " + m.section.label : ""}}`,
      );
    const words = (m.lyrics ?? "").split(" ");
    const buckets = Array.from(
      { length: Math.max(words.length, 1) },
      () => [] as string[],
    );
    for (const c of m.chords) {
      const i = Math.min(
        buckets.length - 1,
        Math.floor(
          (c.beat / (m.timeSignature ?? song.timeSignature)[0]) *
            buckets.length,
        ),
      );
      buckets[i].push(
        `[${shiftChord(c.chordName, -song.capo, song.currentKey)}${precise ? "@" + c.beat : ""}]`,
      );
    }
    rows.push(words.map((w, i) => buckets[i].join("") + w).join(" ") || " ");
  }
  return rows.join("\n");
}
export function applyChordProSource(existing: Song, text: string): Song {
  const parsed = parseChordPro(text),
    song: Song = {
      ...parsed,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      tags: existing.tags,
      ownerId: existing.ownerId,
      deletedAt: existing.deletedAt,
      referenceAudio: existing.referenceAudio,
    };
  song.measures = parsed.measures.map((measure, index) => {
    const prior = existing.measures[index];
    if (!prior) return measure;
    const [beats] = prior.timeSignature ?? song.timeSignature,
      subdivision = Math.max(prior.subdivision, measure.subdivision) as
        | 1
        | 2
        | 4;
    const tab =
      prior.tab?.slots.length === beats * subdivision ? prior.tab : undefined;
    return {
      ...measure,
      id: prior.id,
      index,
      subdivision,
      timeSignature: prior.timeSignature,
      tempoOverride: prior.tempoOverride,
      tab,
      outOfRange: prior.outOfRange,
    };
  });
  return loadSong(song);
}
