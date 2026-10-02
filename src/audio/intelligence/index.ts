import { extractAudioFeatures } from "./features";
import { OnsetBeatAnalyzer } from "./beat";
import { ChromaChordAnalyzer } from "./chord";
import { reconstructProvisionalMeasures } from "./measures";
import type {
  AnalysisOrchestrator, AudioDecoder, AudioIngestor, AudioInput,
  AudioIntelligenceResult, BeatAnalyzer, ChordAnalyzer, NoteTranscriber,
  PcmAudio, StemSeparator,
} from "./types";

export * from "./types";
export { extractAudioFeatures } from "./features";
export { OnsetBeatAnalyzer } from "./beat";
export { ChromaChordAnalyzer } from "./chord";
export { reconstructProvisionalMeasures } from "./measures";
export { reviewedAnalysisToSong } from "./song";

export class LocalFileIngestor implements AudioIngestor {
  async resolve(input: AudioInput): Promise<File> {
    if (input.kind === "file") return input.file;
    throw new Error("Licensed URL ingestion is not configured. Upload an authorized audio file.");
  }
}

export class BrowserAudioDecoder implements AudioDecoder {
  readonly id = "browser-web-audio-v1";
  async decode(file: File, signal?: AbortSignal): Promise<PcmAudio> {
    signal?.throwIfAborted();
    if (!/\.(wav|mp3|m4a)$/i.test(file.name))
      throw new Error("Choose a WAV, MP3, or M4A audio file.");
    if (!file.size || file.size > 30 * 1024 * 1024)
      throw new Error("Use a nonempty audio file no larger than 30 MB.");
    const Context = window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error("This browser cannot decode audio files.");
    const context = new Context();
    let released = false;
    const release = () => {
      if (released) return Promise.resolve();
      released = true;
      return context.close().catch(() => undefined);
    };
    try {
      let buffer: AudioBuffer;
      // Browsers give no way to interrupt decodeAudioData once it starts: the
      // decode keeps running on the browser's own thread. Cancellation therefore
      // stops *waiting* for it, closes the context (best effort; browsers may
      // still finish the decode), and discards any late result unread.
      const decoding = (async () => {
        const bytes = await file.arrayBuffer();
        signal?.throwIfAborted();
        return context.decodeAudioData(bytes);
      })();
      decoding.catch(() => undefined); // a late failure after cancel is expected
      try {
        buffer = await untilAborted(decoding, signal, () => void release());
      }
      catch {
        signal?.throwIfAborted();
        throw new Error("This browser could not decode the audio. Try WAV or MP3, or convert the file locally.");
      }
      signal?.throwIfAborted();
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 5 * 60)
        throw new Error("Audio Intelligence currently supports recordings up to 5 minutes.");
      const samples = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
      }
      return { samples, sampleRate: buffer.sampleRate };
    } finally {
      // On cancel the context was already released without waiting on close().
      if (!signal?.aborted) await release(); else void release();
    }
  }
}

/** Settles with `work`, or rejects with an AbortError as soon as `signal` aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined,
  onAbort: () => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      onAbort();
      reject(new DOMException("Analysis cancelled.", "AbortError"));
    };
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export class LocalAnalysisOrchestrator implements AnalysisOrchestrator {
  constructor(
    private readonly beatAnalyzer: BeatAnalyzer = new OnsetBeatAnalyzer(),
    private readonly chordAnalyzer: ChordAnalyzer = new ChromaChordAnalyzer(),
    private readonly stemSeparator?: StemSeparator,
    private readonly noteTranscriber?: NoteTranscriber,
    private readonly onStage?: (stage: AnalysisStage) => void,
  ) {}

  async analyze(audio: PcmAudio): Promise<AudioIntelligenceResult> {
    this.onStage?.("Finding tempo");
    const sourceFeatures = extractAudioFeatures(audio);
    this.onStage?.("Detecting beats");
    const beats = await this.beatAnalyzer.analyze(sourceFeatures);
    this.onStage?.("Analyzing chords");
    const separated = this.stemSeparator ? await this.stemSeparator.separate(audio) : null;
    const harmonic = separated?.stems.guitar ?? separated?.stems.other ?? audio;
    const chords = await this.chordAnalyzer.analyze(
      harmonic === audio ? sourceFeatures : extractAudioFeatures(harmonic));
    if (this.noteTranscriber) this.onStage?.("Detecting single notes");
    const notes = this.noteTranscriber ? await this.noteTranscriber.transcribe(harmonic) : null;
    this.onStage?.("Building timeline");
    const measures = reconstructProvisionalMeasures(sourceFeatures.duration, beats, chords);
    this.onStage?.("Preparing review");
    return { version: 1, duration: sourceFeatures.duration, beats, chords, measures, notes,
      stemProviderId: this.stemSeparator?.id ?? null,
      warnings: [...beats.warnings, ...chords.warnings,
        ...(notes?.warnings ?? []),

      ] };
  }
}

export type AnalysisStage = "Preparing audio" | "Finding tempo" | "Detecting beats" |
  "Analyzing chords" | "Detecting single notes" | "Building timeline" | "Preparing review";
export type AnalysisUpdates = { transcribeNotes?: boolean; onStage?: (stage: AnalysisStage) => void;
  onWaveform?: (waveform: number[]) => void };

/** Heavy local analysis runs in a Worker so the existing editor stays responsive. */
export async function analyzeAudioIntelligenceFile(file: File, signal?: AbortSignal,
  updates: AnalysisUpdates = {}): Promise<AudioIntelligenceResult> {
  signal?.throwIfAborted();
  updates.onStage?.("Preparing audio");
  const audio = await new BrowserAudioDecoder().decode(file, signal);
  if (signal?.aborted) throw new DOMException("Analysis cancelled.", "AbortError");
  const bins = 512, size = Math.max(1, Math.ceil(audio.samples.length / bins));
  const waveform = Array.from({ length: Math.ceil(audio.samples.length / size) }, (_, bin) => {
    let peak = 0;
    for (let i = bin * size; i < Math.min(audio.samples.length, (bin + 1) * size); i++)
      peak = Math.max(peak, Math.abs(audio.samples[i]));
    return Number(Math.min(1, peak).toFixed(3));
  });
  updates.onWaveform?.(waveform);
  const worker = new Worker(new URL("./analyze.worker.ts", import.meta.url), { type: "module" });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<AudioIntelligenceResult>((resolve, reject) => {
      abort = () => reject(new DOMException("Analysis cancelled.", "AbortError"));
      timeout = setTimeout(() => reject(new Error("Analysis took too long. Try a shorter recording or retry.")), 120_000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      worker.onmessage = (event: MessageEvent<{ result?: AudioIntelligenceResult; error?: string;
        stage?: AnalysisStage }>) => {
        if (event.data.stage) { updates.onStage?.(event.data.stage); return; }
        if (event.data.result) resolve(event.data.result);
        else reject(new Error(event.data.error ?? "Audio Intelligence failed."));
      };
      worker.onerror = () => {
        reject(new Error("Audio Intelligence worker stopped unexpectedly."));
      };
      worker.onmessageerror = () => reject(new Error("The analysis result could not be read. Retry the recording."));
      worker.postMessage({ ...audio, transcribeNotes: updates.transcribeNotes === true }, [audio.samples.buffer]);
    });
  } finally {
    clearTimeout(timeout);
    if (abort) signal?.removeEventListener("abort", abort);
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
  }
}
