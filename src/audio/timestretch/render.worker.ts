import { renderReference, type ReferenceSegment } from "./core";
self.onmessage = (
  event: MessageEvent<{
    channels: Float32Array[];
    sampleRate: number;
    segments: ReferenceSegment[];
  }>,
) => {
  try {
    const { channels, sampleRate, segments } = event.data;
    const rendered = renderReference(channels, sampleRate, segments);
    self.postMessage(
      { channels: rendered },
      { transfer: rendered.map((c) => c.buffer) },
    );
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
