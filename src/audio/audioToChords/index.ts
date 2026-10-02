import type { AudioChordAnalysis } from "./core";
export {
  audioAnalysisToSong,
  type AudioChordAnalysis,
  type ChordEstimate,
} from "./core";

export async function analyzeAudioFile(
  file: File,
): Promise<{ analysis: AudioChordAnalysis; url: string }> {
  if (!file.size) throw new Error("This audio file is empty.");
  if (file.size > 150 * 1024 * 1024)
    throw new Error(
      "This recording is larger than 150 MB. Trim or compress it before analysis.",
    );
  const Context =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Context) throw new Error("This browser cannot decode audio files.");
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer()),
      samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index++)
        samples[index] += data[index] / buffer.numberOfChannels;
    }
    const worker = new Worker(new URL("./analyze.worker.ts", import.meta.url), {
      type: "module",
    });
    const analysis = await new Promise<AudioChordAnalysis>(
      (resolve, reject) => {
        worker.onmessage = (
          event: MessageEvent<{ result?: AudioChordAnalysis; error?: string }>,
        ) =>
          event.data.result
            ? resolve(event.data.result)
            : reject(new Error(event.data.error ?? "Audio analysis failed."));
        worker.onerror = () =>
          reject(new Error("Audio analysis worker stopped unexpectedly."));
        worker.postMessage({ samples, sampleRate: buffer.sampleRate }, [
          samples.buffer,
        ]);
      },
    ).finally(() => worker.terminate());
    return { analysis, url: URL.createObjectURL(file) };
  } catch (error) {
    throw new Error(
      `Could not analyze this recording: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await context.close();
  }
}
