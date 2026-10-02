import { SoundTouch } from "@soundtouchjs/core";
import { z } from "zod";
export const ReferenceSegmentSchema = z.object({
  offset: z.number().finite(),
  sourceDuration: z.number().positive(),
  rate: z.number().min(0.1).max(8),
});
export type ReferenceSegment = z.infer<typeof ReferenceSegmentSchema>;
export function stretchSamples(
  channels: Float32Array[],
  sampleRate: number,
  rate: number,
) {
  if (!Number.isFinite(rate) || rate < 0.1 || rate > 8)
    throw new Error(
      "Reference speed must be between 0.1× and 8× its original tempo. Confirm the recording tempo.",
    );
  if (!channels.length || channels.length > 2 || !channels[0].length)
    throw new Error("Use a nonempty mono or stereo recording.");
  if (rate === 1) return channels.map((c) => c.slice());
  const frames = channels[0].length,
    length = Math.ceil(frames / rate),
    pipe = new SoundTouch({ sampleRate });
  pipe.pitch = 1;
  pipe.stretch.tempo = rate;
  pipe.setStretchParameters({ sequenceMs: 20, seekWindowMs: 10, overlapMs: 8 });
  const output = channels.map(() => new Float32Array(length));
  let written = 0,
    read = 0;
  // Feed padding to flush WSOLA's buffered tail, then retain the exact target duration.
  while (written < length) {
    const input = new Float32Array(4096 * 2);
    for (let i = 0; i < 4096; i++) {
      input[i * 2] = channels[0][read + i] ?? 0;
      input[i * 2 + 1] = (channels[1] ?? channels[0])[read + i] ?? 0;
    }
    read += 4096;
    pipe.inputBuffer.putSamples(input);
    pipe.process();
    const count = Math.min(pipe.outputBuffer.frameCount, length - written);
    if (count) {
      const chunk = new Float32Array(count * 2);
      pipe.outputBuffer.extract(chunk, 0, count);
      pipe.outputBuffer.receive(count);
      for (let c = 0; c < channels.length; c++)
        for (let i = 0; i < count; i++)
          output[c][written + i] = chunk[i * 2 + c];
      written += count;
    }
    if (read > frames + sampleRate * 10 && count === 0)
      throw new Error(
        "The time-stretch processor stopped producing audio. Try a different recording tempo.",
      );
  }
  return output;
}
export function renderReference(
  channels: Float32Array[],
  sampleRate: number,
  segments: ReferenceSegment[],
) {
  z.array(ReferenceSegmentSchema).min(1).parse(segments);
  const totalSource = channels[0]?.length / sampleRate;
  if (!Number.isFinite(totalSource) || !totalSource)
    throw new Error("The recording is empty.");
  if (
    segments[0].offset >= totalSource ||
    segments.at(-1)!.offset + segments.at(-1)!.sourceDuration <= 0
  )
    throw new Error(
      "The selected reference region does not overlap the recording. Adjust the offset.",
    );
  if (
    segments.some(
      (s) => s.offset + s.sourceDuration > totalSource + 1 / sampleRate,
    )
  )
    throw new Error(
      "The recording ends before the selected practice region. Select a shorter loop or attach a longer recording.",
    );
  const rendered = segments.map((s) => {
    const count = Math.round(s.sourceDuration * sampleRate),
      start = Math.round(s.offset * sampleRate);
    const slice = channels.map((c) =>
      Float32Array.from({ length: count }, (_, i) => c[start + i] ?? 0),
    );
    return stretchSamples(slice, sampleRate, s.rate);
  });
  const length = rendered.reduce((n, c) => n + c[0].length, 0),
    result = channels.map(() => new Float32Array(length));
  let at = 0;
  for (const part of rendered) {
    part.forEach((c, i) => result[i].set(c, at));
    at += part[0].length;
  }
  return result;
}
