import { loadSong } from "../../schema/migrations";
import { type Song } from "../../schema/song.v1";
export const exportJSON = (song: Song) =>
  JSON.stringify(loadSong(song), null, 2);
export function importJSON(text: string) {
  try {
    return loadSong(JSON.parse(text));
  } catch (e) {
    throw new Error(
      `Cannot import song: ${e instanceof Error ? e.message : "invalid JSON"}`,
    );
  }
}
export function downloadFile(
  content: BlobPart,
  name: string,
  type = "application/json",
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
