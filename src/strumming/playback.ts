import { PatternSchema, type Pattern, type StrumEvent } from "./schema";
import { enableAudio } from "../audio/context";

export function compilePattern(pattern: Pattern, bpm: number) {
  PatternSchema.parse(pattern);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400)
    throw new Error("Playback tempo must be 20–400 BPM.");
  const beatDuration = ((60 / bpm) * 4) / pattern.meter[1];
  return {
    duration: pattern.meter[0] * beatDuration,
    interval: beatDuration / pattern.subdivision,
    events: pattern.events.map((event) => ({
      ...event,
      time: event.position * beatDuration,
    })),
  };
}
// Absolute event indices anchor every loop to the audio clock, avoiding accumulated timer drift.
export class StrumClock {
  cursor = 0;
  private interval: number;
  constructor(
    public pattern: Pattern,
    public bpm: number,
    public start: number,
    public loop: boolean,
  ) {
    this.interval = compilePattern(pattern, bpm).interval;
  }
  tick(
    now: number,
    emit: (event: StrumEvent, at: number, index: number) => void,
  ) {
    const interval = this.interval;
    const count = this.pattern.events.length;
    if (!this.loop && this.cursor >= count) return;
    if (this.cursor && this.start + this.cursor * interval < now - 0.08)
      throw new Error(
        "Playback was interrupted. Press play to restart in time.",
      );
    while (
      this.start + this.cursor * interval < now + 0.12 &&
      (this.loop || this.cursor < count)
    ) {
      const index = this.cursor % count;
      emit(
        this.pattern.events[index],
        this.start + this.cursor * interval,
        index,
      );
      this.cursor++;
    }
  }
  position(now: number) {
    const interval = this.interval;
    const elapsed = now - this.start;
    if (elapsed < 0) return -1;
    const step = Math.floor(elapsed / interval);
    return !this.loop && step >= this.pattern.events.length
      ? -1
      : step % this.pattern.events.length;
  }
}

export class StrumPlayer {
  private worker?: Worker;
  private raf = 0;
  private token = 0;
  private sources = new Set<OscillatorNode>();
  private bus?: GainNode;
  private ctx?: AudioContext;
  private onStop?: () => void;
  private hidden = () => {
    if (document.hidden) this.stop();
  };
  async start(
    pattern: Pattern,
    bpm: number,
    options: {
      loop: boolean;
      click: boolean;
      sound: "click" | "wood" | "beep";
      onPosition: (index: number) => void;
      onStop: () => void;
      onError: (message: string) => void;
    },
  ) {
    this.stop();
    const token = ++this.token;
    this.onStop = options.onStop;
    try {
      const ctx = await enableAudio();
      if (token !== this.token) return;
      this.ctx = ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.6;
      this.bus.connect(ctx.destination);
      const clock = new StrumClock(
        pattern,
        bpm,
        ctx.currentTime + 0.08,
        options.loop,
      );
      const plan = compilePattern(pattern, bpm);
      const pump = () => {
        try {
          clock.tick(ctx.currentTime, (event, at, index) => {
            if (event.stroke !== "rest")
              this.strum(event, at, Math.min(0.24, plan.interval * 0.9));
            if (options.click && index % pattern.subdivision === 0)
              this.click(at, index === 0, options.sound);
          });
        } catch (e) {
          this.stop();
          options.onError(String(e));
        }
      };
      pump();
      this.worker = new Worker(
        new URL("../audio/metronome/timer.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = pump;
      this.worker.onerror = () => {
        this.stop();
        options.onError(
          "The audio timer could not start. Reload and try again.",
        );
      };
      this.worker.postMessage("start");
      const draw = () => {
        if (token !== this.token) return;
        options.onPosition(clock.position(ctx.currentTime));
        if (!options.loop && ctx.currentTime >= clock.start + plan.duration) {
          this.stop();
          return;
        }
        this.raf = requestAnimationFrame(draw);
      };
      draw();
      document.addEventListener("visibilitychange", this.hidden);
    } catch (e) {
      if (token === this.token) {
        this.stop();
        options.onError(String(e));
      }
    }
  }
  private tone(
    frequency: number,
    at: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ) {
    if (!this.ctx || !this.bus) return;
    const oscillator = this.ctx.createOscillator(),
      envelope = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(volume, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope).connect(this.bus);
    this.sources.add(oscillator);
    oscillator.onended = () => {
      this.sources.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }
  private strum(event: StrumEvent, at: number, duration: number) {
    const volume = 0.018 + event.accent * 0.027;
    if (event.stroke === "mute") {
      [170, 263, 397, 641].forEach((f) =>
        this.tone(f, at, 0.028, volume, "triangle"),
      );
      return;
    }
    // Neutral guitar-register voicing: a rhythm preview, not a harmony transcription.
    const pitches =
      event.stroke === "up"
        ? [329.63, 246.94, 196]
        : [82.41, 110, 146.83, 196, 246.94, 329.63];
    pitches.forEach((f, i) =>
      this.tone(
        f,
        at + i * 0.003,
        duration,
        volume * (event.stroke === "up" ? 0.85 : 1),
        "triangle",
      ),
    );
  }
  private click(at: number, accent: boolean, sound: "click" | "wood" | "beep") {
    this.tone(
      (accent ? 1200 : 800) * (sound === "wood" ? 0.6 : 1),
      at,
      0.04,
      accent ? 0.07 : 0.045,
      sound === "wood" ? "triangle" : sound === "beep" ? "sine" : "square",
    );
  }
  stop() {
    this.token++;
    this.worker?.terminate();
    this.worker = undefined;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.hidden);
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
    });
    this.sources.clear();
    this.bus?.disconnect();
    this.bus = undefined;
    const stopped = this.onStop;
    this.onStop = undefined;
    stopped?.();
  }
}
