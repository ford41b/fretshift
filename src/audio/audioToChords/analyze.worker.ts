import { analyzeAudioSamples } from "./core";

self.onmessage = (
  event: MessageEvent<{ samples: Float32Array; sampleRate: number }>,
) => {
  try {
    self.postMessage({
      result: analyzeAudioSamples(event.data.samples, event.data.sampleRate),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
