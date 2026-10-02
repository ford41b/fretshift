import { exporter, importer, model, Settings } from "@coderline/alphatab";
import { unzipSync } from "fflate";
import {
  BUILT_IN_TUNINGS,
  SectionSchema,
  SongV1,
  TimeSignatureSchema,
  TuningSchema,
  emptySlot,
  registerTuning,
  resolveTuning,
  type Measure,
  type Song,
} from "../../schema/song.v1";
import { formatChordName, parseChordName } from "../../theory/chordName";
import { keyFifths, keyFromFifths } from "../keys";
import {
  TrackSelectionError,
  blankImported,
  materializeTab,
  placeImportedNotes,
  type ImportedNote,
} from "../timeline";

const TICKS = 960;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const unsupported = (what: string): never => {
  throw new Error(
    `Guitar Pro ${what} is outside the supported guitar grid. Expand or remove it in a notation editor first.`,
  );
};

function loadScore(bytes: Uint8Array) {
  // ScoreLoader also accepts MIDI, XML and alphaTex: keep this entry point GP-only.
  const header = new TextDecoder().decode(bytes.subarray(0, 32));
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const entries = unzipSync(bytes, {
        filter: (file) => {
          if (file.originalSize > 64 * 1024 * 1024)
            throw new Error(
              "The Guitar Pro score expands beyond the 64 MB safety limit.",
            );
          return file.name.endsWith("score.gpif");
        },
      });
      if (!Object.keys(entries).length)
        throw new Error("The archive has no score.gpif.");
    } else if (
      !/^.(?:FICHIER GUITAR PRO )v[345]\./s.test(header) &&
      !/^BCF[ZS]/.test(header)
    ) {
      throw new Error("Expected a .gp3, .gp4, .gp5, .gpx or .gp file.");
    }
    return importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings());
  } catch (error) {
    throw new Error(
      `Invalid Guitar Pro file: ${error instanceof Error ? error.message : "The score could not be read."}`,
    );
  }
}

function checkBeat(beat: model.Beat) {
  if (beat.hasTuplet) unsupported("tuplets");
  if (beat.graceType !== model.GraceType.None) unsupported("grace notes");
  if (
    beat.hasWhammyBar ||
    beat.vibrato ||
    beat.isTremolo ||
    beat.ottava !== model.Ottavia.Regular
  )
    unsupported("pitch effects");
  if (
    beat.fermata ||
    beat.brushType ||
    beat.hasRasgueado ||
    beat.deadSlapped ||
    beat.slashed
  )
    unsupported("rhythmic effects");
  if (
    beat.fade ||
    beat.crescendo ||
    beat.pop ||
    beat.slap ||
    beat.tap ||
    beat.golpe ||
    beat.isLegatoOrigin
  )
    unsupported("articulations");
  for (const note of beat.notes) {
    if (
      note.hasBend ||
      note.isHarmonic ||
      note.vibrato ||
      note.slideInType ||
      note.slideOutType ||
      note.isTrill ||
      note.ornament
    )
      unsupported("note pitch effects");
    if (
      note.isLetRing ||
      note.isPalmMute ||
      note.isStaccato ||
      note.isGhost ||
      note.isHammerPullOrigin ||
      note.isSlurDestination ||
      note.isLeftHandTapped ||
      note.accentuated ||
      !near(note.durationPercent, 1)
    )
      unsupported("note articulations");
    if (
      !note.isStringed ||
      !Number.isInteger(note.string) ||
      note.string < 1 ||
      note.string > 6 ||
      !Number.isInteger(note.fret) ||
      note.fret < 0 ||
      note.fret > 22
    ) {
      throw new Error(
        "Guitar Pro notes must use six guitar strings at frets 0–22.",
      );
    }
  }
}

/** Imports one GP track without silently approximating unsupported musical constructs. */
export function readGuitarPro(bytes: Uint8Array, trackIndex?: number): Song {
  const score = loadScore(bytes);
  if (!score.tracks.length || !score.masterBars.length)
    throw new Error("Guitar Pro has no tracks or measures.");
  if (trackIndex === undefined && score.tracks.length > 1) {
    throw new TrackSelectionError(
      score.tracks.map((track, index) => ({
        index,
        name: track.name || `Track ${index + 1}`,
        notes: track.staves.reduce(
          (n, staff) =>
            n +
            staff.bars.reduce(
              (n, bar) =>
                n +
                bar.voices.reduce(
                  (n, voice) =>
                    n +
                    voice.beats.reduce((n, beat) => n + beat.notes.length, 0),
                  0,
                ),
              0,
            ),
          0,
        ),
      })),
    );
  }
  if (
    trackIndex !== undefined &&
    (!Number.isInteger(trackIndex) || trackIndex < 0)
  )
    throw new Error("Invalid Guitar Pro track selection.");
  const track = score.tracks[trackIndex ?? 0];
  if (!track) throw new Error("Invalid Guitar Pro track selection.");
  if (track.staves.length !== 1) unsupported("tracks with multiple staves");
  const staff = track.staves[0];
  if (staff.isPercussion || staff.tuning.length !== 6)
    throw new Error("Choose a six-string guitar track.");
  if (staff.transpositionPitch !== 0) unsupported("transposed tracks");
  if (staff.bars.length !== score.masterBars.length)
    throw new Error("Guitar Pro track is missing measures.");
  const parsedTuning = TuningSchema.parse({
    id: `imported-${staff.tuning.join("-")}`,
    label: staff.tuningName || "Imported guitar tuning",
    midi: staff.tuning,
    builtIn: false,
  });
  const tuning =
    BUILT_IN_TUNINGS.find((t) =>
      t.midi.every((pitch, i) => pitch === staff.tuning[i]),
    ) ?? registerTuning(parsedTuning);
  const song = blankImported(
    score.title.trim() || "Imported Guitar Pro",
    "guitarpro",
  );
  song.artist = score.artist;
  song.tuningId = tuning.id;
  song.capo = staff.capo;
  song.tempo = score.tempo;
  const notes: ImportedNote[] = [];
  const importedNotes = new Map<model.Note, ImportedNote>();
  let start = 0,
    tempo = song.tempo;

  for (const [mi, master] of score.masterBars.entries()) {
    const bar = staff.bars[mi];
    if (
      master.isRepeatStart ||
      master.isRepeatEnd ||
      master.alternateEndings ||
      master.directions?.size ||
      bar.simileMark
    )
      unsupported("repeats and navigation");
    if (
      master.isAnacrusis ||
      master.isFreeTime ||
      master.tripletFeel ||
      master.fermata?.size ||
      bar.sustainPedals.length
    )
      unsupported("pickup, free-time, swing or held measures");
    const meter = TimeSignatureSchema.parse([
      master.timeSignatureNumerator,
      master.timeSignatureDenominator,
    ]);
    const duration = (meter[0] * 4) / meter[1];
    const key = keyFromFifths(
      bar.keySignature,
      bar.keySignatureType === model.KeySignatureType.Minor,
    );
    if (mi === 0) {
      song.currentKey = key;
      song.originalKey = { ...key };
      song.timeSignature = [...meter];
    } else if (JSON.stringify(key) !== JSON.stringify(song.currentKey))
      unsupported("key changes");
    const measure: Measure = {
      id: crypto.randomUUID(),
      index: mi,
      timeSignature: meter,
      subdivision: 1,
      chords: [],
    };
    if (master.section) {
      const kind = SectionSchema.shape.kind.safeParse(master.section.marker);
      const label = master.section.text || master.section.marker;
      measure.section = {
        kind: kind.success ? kind.data : "custom",
        ...(label !== (kind.success ? kind.data : "custom") ? { label } : {}),
      };
    }
    const edges = [0, duration],
      lyrics: string[] = [];
    const tempos = master.tempoAutomations.map((automation) => ({
      at: automation.ratioPosition * duration,
      automation,
    }));
    for (const voice of bar.voices)
      for (const beat of voice.beats) {
        checkBeat(beat);
        if (beat.isEmpty) continue;
        const at = beat.playbackStart / TICKS,
          length = beat.playbackDuration / TICKS;
        if (
          !Number.isFinite(at) ||
          !Number.isFinite(length) ||
          at < 0 ||
          length <= 0 ||
          at + length > duration + 1e-6
        )
          throw new Error(
            `Guitar Pro measure ${mi + 1} has invalid or overflowing beat timing.`,
          );
        edges.push(at, at + length);
        for (const automation of beat.automations) {
          if (automation.type === model.AutomationType.Tempo)
            tempos.push({ at, automation });
          else if (
            automation.type === model.AutomationType.Instrument &&
            !near(at, 0)
          )
            unsupported("instrument changes inside measures");
        }
        if (beat.lyrics)
          for (const line of beat.lyrics) if (line.trim()) lyrics.push(line);
        if (beat.hasChord) {
          const chord = beat.chord;
          if (!chord) throw new Error("Guitar Pro references a missing chord.");
          let name: string;
          try {
            name = formatChordName(parseChordName(chord.name));
          } catch {
            throw new Error(
              `Unsupported Guitar Pro chord name: ${chord.name}.`,
            );
          }
          const chordBeat = (at * meter[1]) / 4;
          const existing = measure.chords.find((c) => near(c.beat, chordBeat));
          if (existing && existing.chordName !== name)
            unsupported("simultaneous different chord names");
          if (!existing)
            measure.chords.push({
              id: crypto.randomUUID(),
              beat: chordBeat,
              chordName: name,
            });
        }
        for (const note of beat.notes) {
          const string = 6 - note.string;
          const midi =
            tuning.midi[string] + song.capo + (note.isDead ? 0 : note.fret);
          if (!note.isDead && midi !== note.realValue)
            unsupported("transposed note pitches");
          if (note.isTieDestination) {
            const origin = note.tieOrigin && importedNotes.get(note.tieOrigin);
            if (
              !origin ||
              origin.midi !== midi ||
              origin.string !== string ||
              origin.muted ||
              note.isDead ||
              !near(origin.start + origin.duration, start + at)
            )
              throw new Error("Guitar Pro contains a broken tie.");
            origin.duration += length;
            importedNotes.set(note, origin);
          } else {
            const imported: ImportedNote = {
              start: start + at,
              duration: length,
              midi,
              string,
              muted: note.isDead,
            };
            notes.push(imported);
            importedNotes.set(note, imported);
          }
        }
      }
    for (const { at, automation } of tempos) {
      if (!near(at, 0) || automation.isLinear)
        unsupported("tempo changes inside measures or gradual tempo changes");
      tempo = automation.value;
    }
    if (mi === 0) song.tempo = tempo;
    if (tempo !== song.tempo) measure.tempoOverride = tempo;
    const subdivision = ([1, 2, 4] as const).find((sub) =>
      edges.every((edge) =>
        near(
          ((edge * meter[1]) / 4) * sub,
          Math.round(((edge * meter[1]) / 4) * sub),
        ),
      ),
    );
    if (!subdivision)
      throw new Error(
        `Guitar Pro measure ${mi + 1} needs tuplets or a finer grid; rhythm cannot be imported exactly.`,
      );
    measure.subdivision = subdivision;
    if (lyrics.length) measure.lyrics = lyrics.join(" ");
    song.measures.push(measure);
    start += duration;
  }
  return SongV1.parse(placeImportedNotes(song, notes));
}

/** Writes a real GP7 archive using alphaTab's public score model and exporter. */
export function writeGuitarPro(input: Song): Uint8Array {
  const song = materializeTab(input),
    tuning = resolveTuning(song.tuningId);
  if (!song.measures.length)
    throw new Error("Add a measure before exporting Guitar Pro.");
  const score = new model.Score(),
    track = new model.Track(),
    staff = new model.Staff();
  score.title = song.title;
  score.artist = song.artist;
  score.addTrack(track);
  track.name = "Guitar";
  track.playbackInfo.program = 24;
  track.addStaff(staff);
  staff.stringTuning = new model.Tuning(tuning.label, [...tuning.midi]);
  staff.capo = song.capo;
  const active: (number | null)[] = Array(6).fill(null);
  for (const measure of song.measures) {
    const [n, d] = measure.timeSignature ?? song.timeSignature;
    const master = new model.MasterBar(),
      bar = new model.Bar(),
      voice = new model.Voice();
    master.timeSignatureNumerator = n;
    master.timeSignatureDenominator = d;
    master.tempoAutomations.push(
      model.Automation.buildTempoAutomation(
        false,
        0,
        measure.tempoOverride ?? song.tempo,
        2,
      ),
    );
    if (measure.section) {
      master.section = new model.Section();
      master.section.marker = measure.section.kind;
      master.section.text = measure.section.label ?? measure.section.kind;
    }
    score.addMasterBar(master);
    staff.addBar(bar);
    bar.keySignature = keyFifths(song.currentKey);
    bar.keySignatureType =
      song.currentKey.mode === "minor"
        ? model.KeySignatureType.Minor
        : model.KeySignatureType.Major;
    bar.addVoice(voice);
    const slots =
      measure.tab?.slots ??
      Array.from({ length: n * measure.subdivision }, emptySlot);
    for (const [i, slot] of slots.entries()) {
      const beat = new model.Beat();
      beat.duration = d * measure.subdivision;
      if (i === 0 && measure.lyrics) beat.lyrics = [measure.lyrics];
      const chords = measure.chords.filter((c) =>
        near(c.beat * measure.subdivision, i),
      );
      if (chords.length > 1)
        unsupported("multiple chord labels on the same beat");
      if (chords.length) {
        const chord = new model.Chord();
        chord.name = chords[0].chordName;
        chord.strings =
          chords[0].voicing?.frets.map((fret) =>
            typeof fret === "number" ? fret : -1,
          ) ?? Array(6).fill(-1);
        chord.showDiagram = !!chords[0].voicing;
        const id = `${bar.index}-${i}`;
        staff.addChord(id, chord);
        beat.chordId = id;
      }
      voice.addBeat(beat);
      for (const [string, cell] of slot.entries()) {
        if (cell === null) {
          active[string] = null;
          continue;
        }
        const note = new model.Note();
        note.string = 6 - string;
        if (cell === "hold") {
          if (active[string] === null)
            throw new Error("Cannot export an orphan hold.");
          note.fret = active[string]!;
          note.isTieDestination = true;
        } else {
          note.fret = typeof cell === "number" ? cell : 0;
          note.isDead = cell === "x";
          active[string] = typeof cell === "number" ? cell : null;
        }
        beat.addNote(note);
      }
    }
  }
  score.finish(new Settings());
  return new exporter.Gp7Exporter().export(score, new Settings());
}
