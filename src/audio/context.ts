import * as Tone from "tone";
import { yin, TunerState, type Pitch } from "./pitch";
import { OnsetDetector, chroma } from "./onset";
let context: AudioContext | undefined;
export async function enableAudio() {
  await Tone.start();
  if (!context) context = Tone.getContext().rawContext as AudioContext;
  if (context.state === "suspended") await context.resume();
  return context;
}
export function getAudioContext() {
  if (!context)
    throw new Error("Audio is not enabled. Tap to enable audio first.");
  return context;
}
export type MicFrame = {
  pitch: Pitch;
  chroma: number[];
  onset: boolean;
  time: number;
};
export async function startMicrophone(
  a4: number,
  onFrame: (frame: MicFrame) => void,
) {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "No input device: this browser does not support microphone capture. Use HTTPS or localhost.",
    );
  // Start both gesture-gated operations together. WebKit can leave the UI
  // pending when audio startup is awaited before microphone permission.
  const audioReady = enableAudio().then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (e) {
    const code = (e as DOMException).name;
    throw new Error(
      code === "NotAllowedError"
        ? "Microphone permission denied. Allow microphone access in browser settings and try again."
        : code === "NotFoundError"
          ? "No input device found. Connect a microphone and try again."
          : `Microphone could not start: ${String(e)}`,
    );
  }
  const audio = await audioReady;
  if (audio.error || !audio.value) {
    stream.getTracks().forEach((track) => track.stop());
    throw audio.error ?? new Error("Audio could not start.");
  }
  const ctx = audio.value;
  const source = ctx.createMediaStreamSource(stream),
    analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  source.connect(analyser);
  const samples = new Float32Array(4096),
    tuner = new TunerState(),
    onsets = new OnsetDetector();
  let frame = 0,
    running = true,
    last = 0;
  const update = () => {
    if (!running) return;
    if (ctx.currentTime - last > 0.035) {
      analyser.getFloatTimeDomainData(samples);
      const now = ctx.currentTime;
      onFrame({
        pitch: tuner.update(yin(samples, ctx.sampleRate), a4),
        chroma: chroma(samples, ctx.sampleRate),
        onset: onsets.process(samples, now).onset,
        time: now,
      });
      last = now;
    }
    frame = requestAnimationFrame(update);
  };
  update();
  return () => {
    running = false;
    cancelAnimationFrame(frame);
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };
}
