import captureUrl from "./capture.worklet.js?url";
import type { Evidence } from "./recognition";

export type PracticeInput = {
  context: AudioContext;
  stop: () => void;
  reset: (floor: number) => void;
  /** Browser label of the capturing microphone; keys per-device timing calibration. */
  inputLabel: string;
};
async function bounded<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function openPracticeInput(
  a4: number,
  signal: AbortSignal,
  onFrame: (e: Evidence) => void,
  onFailure: (message: string) => void,
  options: { chords?: boolean } = {},
): Promise<PracticeInput> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error(
      "Microphone unavailable. Open FretShift over HTTPS or localhost.",
    );
  const context = new AudioContext({ latencyHint: "interactive" });
  let stream: MediaStream | undefined,
    source: MediaStreamAudioSourceNode | undefined;
  let capture: AudioWorkletNode | undefined, worker: Worker | undefined;
  let stopped = false,
    lastFrame = performance.now(),
    watch = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(watch);
    signal.removeEventListener("abort", stop);
    stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.onmute = null;
      t.stop();
    });
    context.onstatechange = null;
    source?.disconnect();
    capture?.disconnect();
    capture?.port.close();
    worker?.terminate();
    void context.close().catch(() => {});
  };
  const fail = (message: string) => {
    if (!stopped) {
      stop();
      onFailure(message);
    }
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const resumed = context.resume().then(
      () => null,
      (error: unknown) => error,
    );
    const requested = navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    // A dismissed permission sheet must not leave the session permanently pending.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      stream = await Promise.race([
        requested,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            stop();
            reject(
              new Error(
                "Microphone request timed out. Check browser permissions, then retry.",
              ),
            );
          }, 15000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      void requested.then(
        (s) => {
          if (stopped) s.getTracks().forEach((t) => t.stop());
        },
        () => {},
      );
    }
    const resumeError = await bounded(
      resumed,
      "Audio could not start. Tap reconnect, or choose quiet visual practice.",
    );
    if (resumeError) throw resumeError;
    if (stopped || signal.aborted)
      throw new Error("Microphone setup cancelled.");
    if (!context.audioWorklet)
      throw new Error(
        "Scored input needs AudioWorklet support. Quiet visual practice is still available.",
      );
    await bounded(
      context.audioWorklet.addModule(captureUrl),
      "Microphone processor did not start. Retry or use quiet visual practice in this browser.",
    );
    if (stopped) throw new Error("Microphone setup cancelled.");
    worker = new Worker(new URL("./analyze.worker.ts", import.meta.url), {
      type: "module",
    });
    const reset = (floor: number) =>
      worker?.postMessage({ rate: context.sampleRate, a4, floor, chords: options.chords === true });
    reset(0.007);
    worker.onmessage = (e: MessageEvent<Evidence>) => {
      if (stopped) return;
      lastFrame = performance.now();
      if (context.currentTime - e.data.time > 0.6) {
        fail(
          "Audio analysis fell behind. Practice paused; try again with fewer apps open.",
        );
        return;
      }
      onFrame(e.data);
    };
    worker.onerror = () =>
      fail("Audio analysis stopped. Reconnect the microphone to resume.");
    capture = new AudioWorkletNode(context, "practice-capture");
    capture.port.onmessage = (e) => {
      if (!stopped) worker?.postMessage(e.data, [e.data.samples.buffer]);
    };
    capture.onprocessorerror = () =>
      fail("Microphone processing stopped. Reconnect to resume.");
    source = context.createMediaStreamSource(stream);
    source.connect(capture).connect(context.destination);
    stream.getTracks().forEach((t) => {
      t.onended = () => fail("Microphone disconnected. Reconnect to resume.");
      t.onmute = () => fail("Microphone interrupted. Reconnect to resume.");
    });
    context.onstatechange = () => {
      if (context.state !== "running")
        fail("Audio was suspended. Reconnect to resume.");
    };
    watch = window.setInterval(() => {
      if (performance.now() - lastFrame > 1200)
        fail(
          "No microphone frames received. Practice paused; reconnect to resume.",
        );
    }, 500);
    return {
      context,
      stop,
      reset,
      inputLabel: stream.getAudioTracks()[0]?.label ?? "",
    };
  } catch (e) {
    stop();
    if ((e as DOMException).name === "NotAllowedError")
      throw new Error(
        "Microphone permission denied. Allow access in browser settings, then retry, or use quiet visual practice.",
      );
    throw e;
  }
}
