import { unzipSync, strFromU8 } from "fflate";
import {
  type Song,
  type Key,
  type Tuning,
  type Measure,
  TimeSignatureSchema,
  registerTuning,
  BUILT_IN_TUNINGS,
  resolveTuning,
  emptySlot,
  SongV1,
  NoteNameSchema,
} from "../../schema/song.v1";
import {
  parseChordName,
  formatChordName,
  type ParsedChord,
  spell,
  pcOf,
  intervalsOf,
  extensions,
} from "../../theory/chordName";
import {
  materializeTab,
  placeImportedNotes,
  blankImported,
  TrackSelectionError,
  type ImportedNote,
} from "../timeline";
import { keyFifths, keyFromFifths } from "../keys";
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const children = (el: Element, tag: string) =>
  Array.from(el.children).filter((e) => e.localName === tag);
const one = (el: Element, tag: string) => children(el, tag)[0];
const text = (el: Element, tag: string, fallback = "") =>
  one(el, tag)?.textContent ?? fallback;
const number = (el: Element, tag: string, fallback?: number) => {
  const value = one(el, tag)?.textContent;
  if (value === undefined && fallback !== undefined) return fallback;
  const n = Number(value);
  if (value === undefined || !value.trim() || !Number.isFinite(n))
    throw new Error(`MusicXML: invalid ${tag}.`);
  return n;
};
const pitchParts = (midi: number) => {
  const names = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"],
    pc = ((midi % 12) + 12) % 12;
  return {
    step: names[pc],
    alter: [1, 3, 6, 8, 10].includes(pc) ? 1 : 0,
    octave: Math.floor(midi / 12) - 1,
  };
};
const pitchXml = (midi: number, prefix = "") => {
  const p = pitchParts(midi);
  return `<${prefix}step>${p.step}</${prefix}step>${p.alter ? `<${prefix}alter>${p.alter}</${prefix}alter>` : ""}<${prefix}octave>${p.octave}</${prefix}octave>`;
};
function midiPitch(el: Element, prefix = "") {
  const step = text(el, `${prefix}step`),
    map: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  if (map[step] === undefined) throw new Error("MusicXML: invalid pitch step.");
  const alter = number(el, `${prefix}alter`, 0),
    octave = number(el, `${prefix}octave`);
  if (!Number.isInteger(alter) || !Number.isInteger(octave))
    throw new Error("Microtonal pitches are unsupported.");
  return (octave + 1) * 12 + map[step] + alter;
}
const harmonyKinds: Record<string, string> = {
  major: "",
  minor: "m",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  "diminished-seventh": "dim7",
  diminished: "dim",
  augmented: "aug",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  power: "5",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "dominant-ninth": "9",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-11th": "11",
  "minor-11th": "m11",
  "dominant-13th": "13",
  "minor-13th": "m13",
  "major-minor": "mmaj7",
  "half-diminished": "m7b5",
};
const degreeFor: Record<number, [number, number]> = {
  0: [1, 0],
  1: [9, -1],
  2: [9, 0],
  3: [3, -1],
  4: [3, 0],
  5: [11, 0],
  6: [5, -1],
  7: [5, 0],
  8: [5, 1],
  9: [13, 0],
  10: [7, -1],
  11: [7, 0],
};
const noteNameXml = (name: string, prefix: string) =>
  `<${prefix}step>${name[0]}</${prefix}step>${name.length > 1 ? `<${prefix}alter>${name[1] === "b" ? -1 : 1}</${prefix}alter>` : ""}`;
const degreeXml = (pc: number, type: "add" | "subtract") => {
  const [degree, alter] = degreeFor[pc];
  return `<degree><degree-value>${degree}</degree-value><degree-alter>${alter}</degree-alter><degree-type>${type}</degree-type></degree>`;
};
function harmonyXml(name: string, offset: number) {
  const p = parseChordName(name),
    suffix = p.quality + p.extensions.join(""),
    exact = Object.entries(harmonyKinds).find(([, s]) => s === suffix);
  const kind =
    exact?.[0] ??
    Object.entries(harmonyKinds).find(([, s]) => s === p.quality)![0];
  const base = intervalsOf(parseChordName("C" + harmonyKinds[kind])),
    desired = intervalsOf(p);
  const degrees =
    base
      .filter((pc) => !desired.includes(pc))
      .map((pc) => degreeXml(pc, "subtract"))
      .join("") +
    desired
      .filter((pc) => !base.includes(pc))
      .map((pc) => degreeXml(pc, "add"))
      .join("");
  return `<harmony><root>${noteNameXml(p.root, "root-")}</root><kind text="${escape(suffix)}">${kind}</kind>${p.bass ? `<bass>${noteNameXml(p.bass, "bass-")}</bass>` : ""}${degrees}<offset>${offset}</offset></harmony>`;
}
export function writeMusicXML(input: Song) {
  const song = materializeTab(input),
    tuning = resolveTuning(song.tuningId),
    divisions = 960,
    active: (number | null)[] = Array(6).fill(null);
  const bars = song.measures.map((m, mi) => {
    const [n, d] = m.timeSignature ?? song.timeSignature,
      duration = (divisions * 4) / d / m.subdivision,
      slots =
        m.tab?.slots ?? Array.from({ length: n * m.subdivision }, emptySlot);
    let body = `<attributes><divisions>${divisions}</divisions><key><fifths>${keyFifths(song.currentKey)}</fifths><mode>${song.currentKey.mode}</mode></key><time><beats>${n}</beats><beat-type>${d}</beat-type></time><clef><sign>TAB</sign><line>5</line></clef>${
      mi === 0
        ? `<staff-details><staff-lines>6</staff-lines>${[...tuning.midi]
            .reverse()
            .map(
              (midi, i) =>
                `<staff-tuning line="${i + 1}">${pitchXml(midi, "tuning-")}</staff-tuning>`,
            )
            .join("")}<capo>${song.capo}</capo></staff-details>`
        : ""
    }</attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${m.tempoOverride ?? song.tempo}</per-minute></metronome></direction-type><sound tempo="${m.tempoOverride ?? song.tempo}"/></direction>`;
    if (m.section)
      body += `<direction><direction-type><rehearsal id="fs-section-${m.section.kind}-${mi}">${escape(m.section.label ?? m.section.kind)}</rehearsal></direction-type></direction>`;
    body += m.chords
      .map((c) => harmonyXml(c.chordName, ((c.beat * 4) / d) * divisions))
      .join("");
    for (let i = 0; i < slots.length; i++) {
      let emitted = 0;
      for (let st = 0; st < 6; st++) {
        const c = slots[i][st];
        if (c === null) {
          active[st] = null;
          continue;
        }
        if (typeof c === "number") active[st] = c;
        const fret = c === "hold" ? active[st] : typeof c === "number" ? c : 0;
        if (fret === null) throw new Error("Cannot export an orphan hold.");
        const next = (slots[i + 1] ?? song.measures[mi + 1]?.tab?.slots[0])?.[
            st
          ],
          stop = c === "hold",
          start = next === "hold";
        const tie = `${stop ? '<tie type="stop"/>' : ""}${start ? '<tie type="start"/>' : ""}`;
        body += `<note>${emitted++ ? "<chord/>" : ""}${c === "x" ? "<unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched>" : `<pitch>${pitchXml(tuning.midi[st] + song.capo + fret)}</pitch>`}<duration>${duration}</duration>${tie}<voice>1</voice><type>${({ 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd", 64: "64th" } as Record<number, string>)[d * m.subdivision]}</type>${c === "x" ? "<notehead>x</notehead>" : ""}<notations>${stop ? '<tied type="stop"/>' : ""}${start ? '<tied type="start"/>' : ""}<technical><string>${st + 1}</string><fret>${fret}</fret></technical></notations>${i === 0 && emitted === 1 && m.lyrics ? `<lyric><text>${escape(m.lyrics)}</text></lyric>` : ""}</note>`;
        if (c === "x") active[st] = null;
      }
      if (!emitted)
        body += `<note><rest/><duration>${duration}</duration><voice>1</voice><type>${({ 2: "half", 4: "quarter", 8: "eighth", 16: "16th", 32: "32nd", 64: "64th" } as Record<number, string>)[d * m.subdivision]}</type>${i === 0 && m.lyrics ? `<lyric><text>${escape(m.lyrics)}</text></lyric>` : ""}</note>`;
    }
    return `<measure number="${mi + 1}" id="fs-m${mi}-s${m.subdivision}">${body}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${escape(song.title)}</work-title></work><identification><creator type="composer">${escape(song.artist)}</creator></identification><part-list><score-part id="P1"><part-name>Guitar</part-name><score-instrument id="I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>25</midi-program></midi-instrument></score-part></part-list><part id="P1">${bars.join("")}</part></score-partwise>`;
}
function parseDocument(xml: string) {
  if (/<!ENTITY/i.test(xml))
    throw new Error("MusicXML entity declarations are unsupported.");
  // Public MusicXML files commonly include a remote DTD. The score is
  // self-contained, so do not let an XML implementation resolve it.
  const selfContained = xml.replace(/<!DOCTYPE[\s\S]*?>/i, "");
  const doc = new DOMParser().parseFromString(selfContained, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "score-partwise"
  )
    throw new Error(
      "Malformed or unsupported MusicXML. Use a score-partwise document.",
    );
  return doc;
}
export function unpackMusicXML(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return new TextDecoder().decode(bytes);
  let zip: ReturnType<typeof unzipSync>;
  try {
    zip = unzipSync(bytes, {
      filter: (file) => {
        if (file.originalSize > 64 * 1024 * 1024)
          throw new Error(
            "Compressed MusicXML expands beyond the 64 MB safety limit.",
          );
        return true;
      },
    });
  } catch {
    throw new Error("Malformed compressed MusicXML archive.");
  }
  const container = zip["META-INF/container.xml"];
  if (!container)
    throw new Error("Compressed MusicXML is missing META-INF/container.xml.");
  const doc = new DOMParser().parseFromString(
    strFromU8(container),
    "application/xml",
  );
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "container"
  )
    throw new Error("Malformed compressed MusicXML container.");
  const rootfiles = Array.from(doc.getElementsByTagNameNS("*", "rootfile")),
    score =
      rootfiles.find(
        (el) =>
          el.getAttribute("media-type") ===
          "application/vnd.recordare.musicxml+xml",
      ) ?? rootfiles[0],
    name = score?.getAttribute("full-path");
  if (!name || !zip[name])
    throw new Error("Compressed MusicXML does not contain its declared score.");
  return strFromU8(zip[name]);
}
function harmonyPitch(el: Element, prefix: string, key: Key) {
  const step = NoteNameSchema.parse(text(el, `${prefix}step`)),
    alter = number(el, `${prefix}alter`, 0);
  if (step.length !== 1 || !Number.isInteger(alter))
    throw new Error(
      "MusicXML harmony requires a natural step and whole-semitone alteration.",
    );
  const written = step + (alter === -1 ? "b" : alter === 1 ? "#" : "");
  return Math.abs(alter) <= 1 && NoteNameSchema.safeParse(written).success
    ? NoteNameSchema.parse(written)
    : spell(pcOf(step) + alter, key);
}
function parseHarmony(h: Element, key: Key) {
  const root = one(h, "root");
  if (!root || children(h, "kind").length !== 1)
    throw new Error("MusicXML requires one rooted harmony per chord.");
  const name = harmonyPitch(root, "root-", key),
    kind = one(h, "kind")!,
    suffix = harmonyKinds[kind.textContent ?? ""];
  if (suffix === undefined)
    throw new Error(`Unsupported MusicXML harmony kind: ${kind.textContent}.`);
  const bass = one(h, "bass"),
    bassName = bass ? harmonyPitch(bass, "bass-", key) : undefined;
  const pcs = new Set(intervalsOf(parseChordName("C" + suffix)));
  for (const degree of children(h, "degree")) {
    const value = number(degree, "degree-value"),
      alter = number(degree, "degree-alter"),
      type = text(degree, "degree-type");
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      !Number.isInteger(alter) ||
      !["add", "alter", "subtract"].includes(type)
    )
      throw new Error("Unsupported MusicXML harmony degree.");
    const natural = [0, 2, 4, 5, 7, 9, 11][(value - 1) % 7],
      pc = (((natural + alter) % 12) + 12) % 12;
    if (type === "subtract") pcs.delete(pc);
    else {
      if (type === "alter") pcs.delete(natural);
      pcs.add(pc);
    }
  }
  const adjusted = parseChordName(name + suffix),
    degreeExtensions: Record<string, ParsedChord["extensions"][number]> = {
      "5:-1": "b5",
      "5:1": "#5",
      "6:0": "6",
      "7:-1": "7",
      "7:0": "maj7",
      "9:0": "add9",
      "9:-1": "b9",
      "9:1": "#9",
      "11:1": "#11",
      "13:-1": "b13",
    };
  for (const degree of children(h, "degree")) {
    const ext =
      degreeExtensions[
        `${number(degree, "degree-value")}:${number(degree, "degree-alter")}`
      ];
    if (
      ext &&
      text(degree, "degree-type") !== "subtract" &&
      !adjusted.extensions.includes(ext)
    )
      adjusted.extensions.push(ext);
  }
  adjusted.extensions.sort(
    (a, b) => extensions.indexOf(a) - extensions.indexOf(b),
  );
  const label = kind.getAttribute("text") ?? "",
    candidates = [
      name + label,
      label,
      name + suffix,
      formatChordName(adjusted),
    ];
  for (const candidate of candidates) {
    try {
      const parsed = parseChordName(candidate),
        intervals = intervalsOf(parsed);
      if (
        pcOf(parsed.root) !== pcOf(name) ||
        intervals.length !== pcs.size ||
        intervals.some((pc) => !pcs.has(pc))
      )
        continue;
      return formatChordName({
        ...parsed,
        root: name,
        bass: bassName ?? parsed.bass,
      });
    } catch {
      /* Display text may be descriptive rather than a chord suffix. */
    }
  }
  throw new Error(
    "MusicXML harmony degrees cannot be represented by a supported chord name.",
  );
}
function directionTempo(direction: Element) {
  const sound = one(direction, "sound"),
    explicit = sound?.getAttribute("tempo");
  if (explicit !== null && explicit !== undefined) return Number(explicit);
  const metronome = direction.querySelector("metronome");
  if (!metronome) return undefined;
  const unit: Record<string, number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    "16th": 0.25,
    "32nd": 0.125,
    "64th": 0.0625,
  };
  const factor = unit[text(metronome, "beat-unit")];
  if (
    factor === undefined ||
    children(metronome, "beat-unit").length !== 1 ||
    one(metronome, "beat-unit-tied")
  )
    throw new Error("Unsupported MusicXML metronome beat unit.");
  return (
    number(metronome, "per-minute") *
    factor *
    (2 - 2 ** -children(metronome, "beat-unit-dot").length)
  );
}
export function readMusicXML(xml: string, partIndex?: number): Song {
  const doc = parseDocument(xml),
    root = doc.documentElement,
    parts = children(root, "part");
  if (!parts.length) throw new Error("MusicXML has no instrument parts.");
  if (parts.length > 1 && partIndex === undefined) {
    const list = one(root, "part-list");
    throw new TrackSelectionError(
      parts.map((part, index) => ({
        index,
        name: list
          ? (children(list, "score-part")
              .find((p) => p.getAttribute("id") === part.getAttribute("id"))
              ?.querySelector("part-name")?.textContent ?? `Part ${index + 1}`)
          : `Part ${index + 1}`,
      })),
    );
  }
  const part = parts[partIndex ?? 0];
  if (!part) throw new Error("Invalid MusicXML part selection.");
  const forbidden = part.querySelector(
    "time-modification,grace,bend,slide,hammer-on,pull-off,glissando,repeat,ending,transpose,articulations,ornaments,fermata,arpeggiate",
  );
  if (forbidden)
    throw new Error(
      `MusicXML ${forbidden.localName} is outside the supported guitar grid. Expand or remove it in a notation editor first.`,
    );
  const song = blankImported(
    root.querySelector("work-title")?.textContent ||
      text(root, "movement-title") ||
      "Imported MusicXML",
    "musicxml",
  );
  song.artist =
    root.querySelector('creator[type="composer"]')?.textContent ??
    root.querySelector("creator")?.textContent ??
    "";
  let divisions = 1,
    meter = song.timeSignature,
    tempo = song.tempo,
    start = 0,
    firstKey: Key | undefined;
  const notes: ImportedNote[] = [],
    ties = new Map<string, ImportedNote>();
  for (const [mi, bar] of children(part, "measure").entries()) {
    let cursor = 0,
      lastStart = 0,
      lastDuration = 0,
      maxEnd = 0;
    const m: Measure = {
      id: crypto.randomUUID(),
      index: mi,
      subdivision: Number(bar.id.match(/-s([124])$/)?.[1] ?? 4) as 1 | 2 | 4,
      chords: [],
    };
    const lyrics = new Map<string, { words: string; joined: boolean }>();
    for (const child of Array.from(bar.children)) {
      switch (child.localName) {
        case "attributes": {
          const div = one(child, "divisions");
          if (div) divisions = number(child, "divisions");
          if (divisions <= 0)
            throw new Error("MusicXML divisions must be positive.");
          if (cursor !== 0)
            throw new Error(
              "MusicXML attribute changes inside a measure are unsupported.",
            );
          if (number(child, "staves", 1) !== 1)
            throw new Error(
              "Choose a single-staff guitar part before importing.",
            );
          const time = one(child, "time");
          if (time)
            meter = TimeSignatureSchema.parse([
              number(time, "beats"),
              number(time, "beat-type"),
            ]);
          const key = one(child, "key");
          if (key) {
            const mode = text(key, "mode", "major");
            if (!["major", "minor"].includes(mode))
              throw new Error(
                "Only major and minor MusicXML keys are supported.",
              );
            const parsed = keyFromFifths(
              number(key, "fifths"),
              mode === "minor",
            );
            if (firstKey && JSON.stringify(firstKey) !== JSON.stringify(parsed))
              throw new Error(
                "Split songs at MusicXML key changes before importing.",
              );
            firstKey = parsed;
            song.currentKey = parsed;
            song.originalKey = { ...parsed };
          }
          const staff = one(child, "staff-details");
          if (staff) {
            const tuningElements = children(staff, "staff-tuning");
            if (tuningElements.length) {
              if (
                tuningElements.length !== 6 ||
                new Set(tuningElements.map((e) => e.getAttribute("line")))
                  .size !== 6 ||
                tuningElements.some(
                  (e) => !/^[1-6]$/.test(e.getAttribute("line") ?? ""),
                )
              )
                throw new Error(
                  "Only six-string guitar tunings are supported.",
                );
              const midi = [...tuningElements]
                .sort(
                  (a, b) =>
                    Number(b.getAttribute("line")) -
                    Number(a.getAttribute("line")),
                )
                .map((e) => midiPitch(e, "tuning-")) as Tuning["midi"];
              const built = BUILT_IN_TUNINGS.find(
                (t) => JSON.stringify(t.midi) === JSON.stringify(midi),
              );
              const tuning =
                built ??
                registerTuning({
                  id: `imported-${midi.join("-")}`,
                  label: "Imported guitar tuning",
                  midi,
                  builtIn: false,
                });
              if (mi && song.tuningId !== tuning.id)
                throw new Error(
                  "Split songs at tuning changes before importing.",
                );
              song.tuningId = tuning.id;
            }
            const capo = number(staff, "capo", song.capo);
            if (mi && capo !== song.capo)
              throw new Error("Split songs at capo changes before importing.");
            song.capo = capo;
          }
          break;
        }
        case "direction": {
          const explicit = directionTempo(child);
          if (explicit !== undefined) {
            if (cursor !== 0 || number(child, "offset", 0) !== 0)
              throw new Error(
                "A tempo change inside a measure is unsupported.",
              );
            tempo = explicit;
            if (!Number.isFinite(tempo) || tempo < 20 || tempo > 400)
              throw new Error(
                "MusicXML tempo must be between 20 and 400 quarter notes per minute.",
              );
          }
          const section = child.querySelector("rehearsal");
          if (section) {
            const kind = section.id.match(
              /^fs-section-(intro|verse|prechorus|chorus|bridge|solo|outro|custom)-/,
            )?.[1] as NonNullable<Measure["section"]>["kind"] | undefined;
            const label = section.textContent ?? "Section";
            m.section = {
              kind: kind ?? "custom",
              ...(label !== kind ? { label } : {}),
            };
          }
          break;
        }
        case "harmony":
          m.chords.push({
            id: crypto.randomUUID(),
            beat:
              ((cursor + number(child, "offset", 0) / divisions) * meter[1]) /
              4,
            chordName: parseHarmony(child, song.currentKey),
          });
          break;
        case "sound": {
          const explicit = child.getAttribute("tempo");
          if (explicit !== null) {
            if (cursor !== 0)
              throw new Error(
                "A tempo change inside a measure is unsupported.",
              );
            tempo = Number(explicit);
            if (!Number.isFinite(tempo) || tempo < 20 || tempo > 400)
              throw new Error(
                "MusicXML tempo must be between 20 and 400 quarter notes per minute.",
              );
          }
          break;
        }
        case "backup":
        case "forward": {
          const shift = number(child, "duration") / divisions;
          if (shift <= 0)
            throw new Error("MusicXML cursor duration must be positive.");
          cursor += child.localName === "backup" ? -shift : shift;
          if (cursor < -1e-6)
            throw new Error("MusicXML backup crosses the measure start.");
          maxEnd = Math.max(maxEnd, cursor);
          lastDuration = 0;
          break;
        }
        case "note": {
          const duration = number(child, "duration") / divisions;
          if (duration <= 0)
            throw new Error("MusicXML note duration must be positive.");
          const at = one(child, "chord") ? lastStart : cursor;
          if (one(child, "chord")) {
            if (!lastDuration || duration > lastDuration + 1e-6)
              throw new Error(
                "MusicXML chord duration exceeds its preceding note.",
              );
          } else {
            lastStart = cursor;
            lastDuration = duration;
            cursor += duration;
          }
          maxEnd = Math.max(maxEnd, at + duration);
          for (const lyric of children(child, "lyric")) {
            const words = Array.from(lyric.children)
              .filter(
                (e) => e.localName === "text" || e.localName === "elision",
              )
              .map(
                (e) => e.textContent || (e.localName === "elision" ? " " : ""),
              )
              .join("");
            if (words) {
              const verse = lyric.getAttribute("number") ?? "1",
                line = lyrics.get(verse),
                syllabic = text(lyric, "syllabic", "single");
              lyrics.set(verse, {
                words:
                  (line?.words ?? "") +
                  (line && !line.joined ? " " : "") +
                  words,
                joined: syllabic === "begin" || syllabic === "middle",
              });
            }
          }
          if (one(child, "rest")) break;
          const technical = child.querySelector("technical"),
            string =
              technical && one(technical, "string")
                ? number(technical, "string") - 1
                : undefined;
          const fret =
            technical && one(technical, "fret")
              ? number(technical, "fret")
              : undefined;
          const muted =
            text(child, "notehead") === "x" || !!one(child, "unpitched");
          const pitch = one(child, "pitch");
          if (!pitch && !muted)
            throw new Error("A MusicXML note is missing its pitch.");
          if (muted && (string === undefined || fret === undefined))
            throw new Error("Muted notes need a guitar string and fret.");
          const tuning = resolveTuning(song.tuningId),
            midi = muted
              ? tuning.midi[string!] + song.capo + fret!
              : midiPitch(pitch!);
          if (
            string !== undefined &&
            (!Number.isInteger(string) ||
              string < 0 ||
              string > 5 ||
              fret === undefined ||
              !Number.isInteger(fret) ||
              fret < 0 ||
              fret > 22 ||
              tuning.midi[string] + song.capo + fret !== midi)
          )
            throw new Error(
              "MusicXML technical string/fret does not match the sounding pitch and capo.",
            );
          const voice = text(child, "voice", "1"),
            tieKey = `${voice}:${string ?? midi}`,
            tieTypes = children(child, "tie").map((t) =>
              t.getAttribute("type"),
            );
          let note: ImportedNote;
          if (tieTypes.includes("stop")) {
            const previous = ties.get(tieKey);
            if (
              !previous ||
              previous.midi !== midi ||
              Math.abs(previous.start + previous.duration - (start + at)) > 1e-6
            )
              throw new Error("MusicXML contains a broken tie.");
            previous.duration += duration;
            note = previous;
          } else {
            if (ties.has(tieKey))
              throw new Error(
                "MusicXML contains a broken tie: the continuation is missing.",
              );
            note = { start: start + at, duration, midi, string, muted };
            notes.push(note);
          }
          if (tieTypes.includes("start")) ties.set(tieKey, note);
          else ties.delete(tieKey);
          break;
        }
      }
    }
    if (mi === 0) {
      song.timeSignature = [...meter];
      song.tempo = tempo;
    }
    m.timeSignature = [...meter];
    if (tempo !== song.tempo) m.tempoOverride = tempo;
    if (lyrics.size)
      m.lyrics = Array.from(lyrics.values())
        .map((line) => line.words)
        .join("\n");
    song.measures.push(m);
    start += (meter[0] * 4) / meter[1];
    if (
      bar.getAttribute("implicit") === "yes" &&
      Math.abs(maxEnd - (meter[0] * 4) / meter[1]) > 1e-6
    )
      throw new Error(
        "MusicXML pickup measures need an explicit time signature matching their duration.",
      );
    if (maxEnd > (meter[0] * 4) / meter[1] + 1e-6)
      throw new Error(`Measure ${mi + 1} overflows its time signature.`);
  }
  if (ties.size) throw new Error("MusicXML ends with an unfinished tie.");
  if (!song.measures.length) throw new Error("MusicXML has no measures.");
  return SongV1.parse(placeImportedNotes(song, notes));
}
