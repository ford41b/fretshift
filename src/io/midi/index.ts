import { parseMidi, writeMidi as encodeMidi } from "midi-file";
import { keyFifths, midiSignatureKey } from "../keys";
import { Midi } from "@tonejs/midi";
import { TimeSignatureSchema, newMeasure } from "../../schema/song.v1";
import { type Song } from "../../schema/song.v1";
import {
  blankImported,
  quarterTimeline,
  placeImportedNotes,
  TrackSelectionError,
} from "../timeline";
const normalizeTempo = (bpm: number) => Math.round(bpm * 1000) / 1000;
export function readMidi(bytes: Uint8Array, trackIndex?: number): Song {
  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch (e) {
    throw new Error(`Malformed MIDI file: ${String(e)}`);
  }
  const tracks = midi.tracks
    .map((t, index) => ({
      index,
      name: t.name || `Track ${index + 1} · ${t.instrument.name}`,
      notes: t.notes.length,
    }))
    .filter((t) => t.notes > 0);
  if (!tracks.length) throw new Error("This MIDI file has no pitched notes.");
  if (trackIndex === undefined && tracks.length > 1)
    throw new TrackSelectionError(tracks);
  const track = midi.tracks[trackIndex ?? tracks[0].index];
  if (!track || !track.notes.length)
    throw new Error("The selected MIDI track has no notes.");
  if (track.instrument.percussion)
    throw new Error(
      "Choose a pitched guitar track; percussion tracks are unsupported.",
    );
  if (
    track.pitchBends.some((p) => p.value !== 0) ||
    track.controlChanges[64]?.some((c) => c.value > 0)
  )
    throw new Error(
      "Pitch bends and sustain-pedal articulation cannot be represented by this guitar grid.",
    );
  const song = blankImported(
      midi.name || track.name || "Imported MIDI",
      "midi",
    ),
    ppq = midi.header.ppq;
  const tempos = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks),
    meters = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks);
  song.tempo = normalizeTempo(tempos.find((t) => t.ticks === 0)?.bpm ?? 120);
  song.timeSignature = TimeSignatureSchema.parse(
    meters.find((t) => t.ticks === 0)?.timeSignature ?? [4, 4],
  );
  const keys = midi.header.keySignatures;
  if (keys.some((k) => k.key !== keys[0].key || k.scale !== keys[0].scale))
    throw new Error("Key changes within a MIDI file require separate songs.");
  if (keys.length) {
    const key = midiSignatureKey(keys[0].key, keys[0].scale === "minor");
    song.currentKey = key;
    song.originalKey = { ...key };
  }
  const end = Math.max(
    track.endOfTrackTicks ?? 0,
    ...track.notes.map((n) => n.ticks + n.durationTicks),
  );
  let start = 0,
    currentMeter = song.timeSignature,
    currentTempo = song.tempo;
  while (start < end - 1e-6) {
    const meter = meters.find((m) => Math.abs(m.ticks - start) < 1e-6);
    if (meter) currentMeter = TimeSignatureSchema.parse(meter.timeSignature);
    const tempo = tempos.find((t) => Math.abs(t.ticks - start) < 1e-6);
    if (tempo) currentTempo = normalizeTempo(tempo.bpm);
    const duration = ((currentMeter[0] * 4) / currentMeter[1]) * ppq;
    if (
      [...tempos, ...meters].some(
        (e) => e.ticks > start + 1e-6 && e.ticks < start + duration - 1e-6,
      )
    )
      throw new Error(
        "Tempo or meter changes inside a measure cannot be represented. Split the MIDI at that change.",
      );
    const m = newMeasure(song.measures.length, currentMeter[0]);
    m.subdivision = 4;
    m.timeSignature = [...currentMeter];
    if (currentTempo !== song.tempo) m.tempoOverride = currentTempo;
    const lyrics = midi.header.meta
      .filter(
        (e) =>
          e.type === "lyrics" && e.ticks >= start && e.ticks < start + duration,
      )
      .map((e) => e.text);
    if (lyrics.length) m.lyrics = lyrics.join(" ");
    const marker = midi.header.meta.find(
      (e) => e.type === "marker" && Math.abs(e.ticks - start) < 1e-6,
    );
    if (marker) m.section = { kind: "custom", label: marker.text };
    song.measures.push(m);
    start += duration;
    if (song.measures.length > 10000)
      throw new Error(
        "This MIDI exceeds 10,000 measures. Split it before importing.",
      );
  }
  return placeImportedNotes(
    song,
    track.notes.map((n) => ({
      midi: n.midi,
      start: n.ticks / ppq,
      duration: n.durationTicks / ppq,
    })),
  );
}
export function writeMidi(song: Song) {
  const projection = quarterTimeline(song);
  if (projection.notes.some((n) => n.muted))
    throw new Error(
      "MIDI cannot preserve muted guitar hits in a single pitched track. Use MusicXML or Guitar Pro.",
    );
  const midi = new Midi(),
    ppq = midi.header.ppq;
  midi.header.name = song.title;
  midi.header.tempos = [];
  midi.header.timeSignatures = [];
  midi.header.keySignatures = [];
  let lastTempo = -1,
    lastMeter = "";
  song.measures.forEach((m, i) => {
    const ticks = Math.round(projection.measures[i].start * ppq),
      tempo = m.tempoOverride ?? song.tempo,
      meter = m.timeSignature ?? song.timeSignature;
    if (tempo !== lastTempo) {
      midi.header.tempos.push({ ticks, bpm: tempo });
      lastTempo = tempo;
    }
    if (meter.join("/") !== lastMeter) {
      midi.header.timeSignatures.push({ ticks, timeSignature: [...meter] });
      lastMeter = meter.join("/");
    }
    if (m.section)
      midi.header.meta.push({
        ticks,
        type: "marker",
        text: m.section.label ?? m.section.kind,
      });
    if (m.lyrics)
      midi.header.meta.push({ ticks, type: "lyrics", text: m.lyrics });
  });
  midi.header.update();
  const track = midi.addTrack();
  track.name = song.title;
  track.instrument.number = 24;
  projection.notes.forEach((n) =>
    track.addNote({
      midi: n.midi,
      ticks: Math.round(n.start * ppq),
      durationTicks: Math.round(n.duration * ppq),
      velocity: 0.8,
    }),
  );
  track.endOfTrackTicks = Math.round(projection.duration * ppq);
  const encoded = parseMidi(midi.toArray());
  encoded.tracks[0].unshift({
    deltaTime: 0,
    meta: true,
    type: "keySignature",
    key: keyFifths(song.currentKey),
    scale: song.currentKey.mode === "minor" ? 1 : 0,
  });
  return new Uint8Array(encodeMidi(encoded));
}
