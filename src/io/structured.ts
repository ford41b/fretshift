import { loadSong } from "../schema/migrations";
import { type Song } from "../schema/song.v1";

export type StructuredFormat = "midi" | "musicxml" | "guitarpro";
export const MAX_STRUCTURED_FILE_BYTES = 25 * 1024 * 1024;

export async function readStructuredFile(file: File, trackIndex?: number) {
  if (file.size > MAX_STRUCTURED_FILE_BYTES)
    throw new Error(
      "This score is larger than 25 MB. Split or simplify it before importing.",
    );
  const extension = file.name.split(".").pop()?.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length)
    throw new Error("This file is empty. Choose a score with music in it.");
  let song: Song;
  if (extension === "mid" || extension === "midi") {
    const { readMidi } = await import("./midi");
    song = readMidi(bytes, trackIndex);
  } else if (["xml", "musicxml", "mxl"].includes(extension ?? "")) {
    const { readMusicXML, unpackMusicXML } = await import("./musicxml");
    song = readMusicXML(unpackMusicXML(bytes), trackIndex);
  } else if (["gp3", "gp4", "gp5", "gpx", "gp"].includes(extension ?? "")) {
    const { readGuitarPro } = await import("./guitarpro");
    song = readGuitarPro(bytes, trackIndex);
  } else {
    throw new Error(
      "Choose a MIDI, MusicXML (.xml, .musicxml, .mxl), or Guitar Pro (.gp3, .gp4, .gp5, .gpx, .gp) file.",
    );
  }
  return loadSong(song);
}

export async function exportStructured(song: Song, format: StructuredFormat) {
  const valid = loadSong(song);
  if (format === "midi") {
    const { writeMidi } = await import("./midi");
    return { content: writeMidi(valid), extension: "mid", mime: "audio/midi" };
  }
  if (format === "musicxml") {
    const { writeMusicXML } = await import("./musicxml");
    return {
      content: writeMusicXML(valid),
      extension: "musicxml",
      mime: "application/vnd.recordare.musicxml+xml",
    };
  }
  const { writeGuitarPro } = await import("./guitarpro");
  return {
    content: writeGuitarPro(valid),
    extension: "gp",
    mime: "application/octet-stream",
  };
}
