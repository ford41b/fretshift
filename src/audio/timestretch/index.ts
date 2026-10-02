import { type ReferenceSegment } from "./core";
export async function prepareReference(
  ctx: BaseAudioContext,
  input: AudioBuffer,
  segments: ReferenceSegment[],
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  if (signal?.aborted)
    throw new DOMException("Reference preparation cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException("Reference preparation cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (e) => {
      finish();
      reject(new Error(`Reference processing failed: ${e.message}`));
    };
    worker.onmessage = (
      e: MessageEvent<{ channels?: Float32Array[]; error?: string }>,
    ) => {
      finish();
      if (e.data.error || !e.data.channels) {
        reject(
          new Error(e.data.error ?? "Reference processing returned no audio."),
        );
        return;
      }
      const channels = e.data.channels,
        buffer = ctx.createBuffer(
          channels.length,
          channels[0].length,
          input.sampleRate,
        );
      channels.forEach((c, i) => buffer.getChannelData(i).set(c));
      resolve(buffer);
    };
    const channels = Array.from({ length: input.numberOfChannels }, (_, i) =>
      input.getChannelData(i).slice(),
    );
    worker.postMessage(
      { channels, sampleRate: input.sampleRate, segments },
      channels.map((c) => c.buffer),
    );
  });
}
export function playReference(
  ctx: AudioContext,
  buffer: AudioBuffer,
  start: number,
  onEnded?: () => void,
) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  let stopped = false;
  source.onended = () => {
    stopped = true;
    source.disconnect();
    onEnded?.();
  };
  source.start(start);
  return () => {
    if (!stopped) {
      stopped = true;
      source.stop();
      source.disconnect();
    }
  };
}
export async function stretchOffline(input: AudioBuffer, rate: number) {
  const ctx = new OfflineAudioContext(
    input.numberOfChannels,
    1,
    input.sampleRate,
  );
  return prepareReference(ctx, input, [
    { offset: 0, sourceDuration: input.duration, rate },
  ]);
}
