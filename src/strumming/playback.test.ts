import { expect, it, vi, afterEach } from "vitest";
vi.mock("../audio/context", () => ({ enableAudio: vi.fn() }));
import { enableAudio } from "../audio/context";
import { StrumClock, compilePattern, StrumPlayer } from "./playback";
import { analyzeSong, recommend } from "./engine";

const pattern = recommend(analyzeSong({ tempo: 120 }))[1].pattern;
afterEach(() => vi.unstubAllGlobals());
it("tempo and meter durations use quarter BPM, including compound time", () => {
  expect(compilePattern(pattern, 120).duration).toBe(2);
  expect(compilePattern(pattern, 60).duration).toBe(4);
  const compound = recommend(analyzeSong({ timeSignature: [6, 8] }))[1].pattern;
  expect(compilePattern(compound, 120).duration).toBe(1.5);
  expect(() => compilePattern(pattern, 0)).toThrow();
});
it("long loops remain anchored to the audio clock under jitter", () => {
  const clock = new StrumClock(pattern, 137, 0.1, true),
    emit = vi.fn();
  for (
    let time = 0;
    time < 600;
    time += 0.023 + (Math.round(time * 100) % 3) * 0.001
  )
    clock.tick(time, emit);
  const interval = compilePattern(pattern, 137).interval;
  emit.mock.calls.forEach((call, i) =>
    expect(call[1]).toBeCloseTo(0.1 + i * interval, 9),
  );
  expect(clock.position(0)).toBe(-1);
  expect(clock.position(0.1)).toBe(0);
});
it("nonloop playback ends exactly; delayed timers fail instead of bursting stale notes", () => {
  const clock = new StrumClock(pattern, 120, 1, false),
    emit = vi.fn();
  for (let t = 0.9; t < 3.1; t += 0.025) clock.tick(t, emit);
  expect(emit).toHaveBeenCalledTimes(pattern.events.length);
  expect(clock.position(3.1)).toBe(-1);
  const late = new StrumClock(pattern, 120, 0, true);
  late.tick(0, () => {});
  expect(() => late.tick(2, () => {})).toThrow(/interrupted/);
});
it("stopping during asynchronous audio enable cancels startup", async () => {
  let release!: (v: AudioContext) => void;
  vi.mocked(enableAudio).mockReturnValueOnce(
    new Promise((r) => {
      release = r;
    }),
  );
  const player = new StrumPlayer(),
    onStop = vi.fn(),
    onError = vi.fn();
  const pending = player.start(pattern, 120, {
    loop: true,
    click: true,
    sound: "click",
    onPosition: vi.fn(),
    onStop,
    onError,
  });
  player.stop();
  release({} as AudioContext);
  await pending;
  expect(onStop).toHaveBeenCalledOnce();
  expect(onError).not.toHaveBeenCalled();
});
it("stopping playback terminates worker and disconnects scheduled audio", async () => {
  const oscillator = () => ({
    type: "",
    frequency: { value: 0 },
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  });
  const oscillators: ReturnType<typeof oscillator>[] = [];
  const gain = () => ({
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
  });
  const bus = gain();
  const ctx = {
    currentTime: 0,
    destination: {},
    createGain: vi.fn().mockReturnValueOnce(bus).mockImplementation(gain),
    createOscillator: () => {
      const o = oscillator();
      oscillators.push(o);
      return o;
    },
  };
  vi.mocked(enableAudio).mockResolvedValueOnce(ctx as unknown as AudioContext);
  const terminate = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = null;
      onerror = null;
      postMessage = vi.fn();
      terminate = terminate;
    },
  );
  vi.stubGlobal("requestAnimationFrame", vi.fn().mockReturnValue(1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const player = new StrumPlayer(),
    stopped = vi.fn();
  await player.start(pattern, 120, {
    loop: true,
    click: true,
    sound: "wood",
    onPosition: vi.fn(),
    onStop: stopped,
    onError: vi.fn(),
  });
  expect(oscillators.length).toBeGreaterThan(0);
  player.stop();
  expect(terminate).toHaveBeenCalledOnce();
  expect(bus.disconnect).toHaveBeenCalled();
  expect(
    oscillators.every(
      (o) =>
        o.stop.mock.calls.length >= 2 && o.disconnect.mock.calls.length > 0,
    ),
  ).toBe(true);
  expect(stopped).toHaveBeenCalledOnce();
});
