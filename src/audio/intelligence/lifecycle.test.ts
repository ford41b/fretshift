import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeAudioIntelligenceFile, BrowserAudioDecoder } from "./index";

class SilentWorker {
  static instances: SilentWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { SilentWorker.instances.push(this); }
}
const file = new File(["fixture"], "test.wav");
function setup() {
  vi.useFakeTimers();
  SilentWorker.instances = [];
  vi.stubGlobal("Worker", SilentWorker);
  vi.spyOn(BrowserAudioDecoder.prototype, "decode").mockResolvedValue({
    samples: new Float32Array(8000), sampleRate: 8000,
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("local analysis lifecycle", () => {
  it("does not decode an already-cancelled file", async () => {
    setup();
    const controller = new AbortController(); controller.abort();
    await expect(analyzeAudioIntelligenceFile(file, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(BrowserAudioDecoder.prototype.decode).not.toHaveBeenCalled();
    expect(SilentWorker.instances).toHaveLength(0);
  });
  it("times out a stalled Worker and removes its abort handler", async () => {
    setup();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const task = analyzeAudioIntelligenceFile(file, controller.signal);
    const assertion = expect(task).rejects.toThrow(/too long/i);
    await vi.advanceTimersByTimeAsync(120000);
    await assertion;
    expect(SilentWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("terminates on cancellation and permits a fresh successful retry", async () => {
    setup();
    const controller = new AbortController();
    const task = analyzeAudioIntelligenceFile(file, controller.signal);
    const assertion = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(); await assertion;
    expect(SilentWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retry = analyzeAudioIntelligenceFile(file);
    await vi.advanceTimersByTimeAsync(0);
    SilentWorker.instances[1].onmessage!({ data: { result: { version: 1 } } });
    await expect(retry).resolves.toEqual({ version: 1 });
    expect(SilentWorker.instances[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans up when posting PCM fails", async () => {
    setup();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const task = analyzeAudioIntelligenceFile(file, controller.signal, {
      onWaveform: () => {
        // Constructor still runs after the waveform callback.
        vi.stubGlobal("Worker", class extends SilentWorker {
          postMessage = vi.fn(() => { throw new Error("transfer failed"); });
        });
      },
    });
    await expect(task).rejects.toThrow("transfer failed");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(SilentWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("decoder cancellation boundary", () => {
  it("closes a cancelled decoder without allocating or downmixing returned PCM", async () => {
    let finish!: (value: AudioBuffer) => void;
    const close = vi.fn().mockResolvedValue(undefined);
    const getChannelData = vi.fn();
    vi.stubGlobal("AudioContext", class {
      close = close;
      decodeAudioData = () => new Promise<AudioBuffer>(resolve => { finish = resolve; });
    });
    const controller = new AbortController();
    const input = {name:"pending.wav",size:100,arrayBuffer:async()=>new ArrayBuffer(100)} as File;
    const task = new BrowserAudioDecoder().decode(input,controller.signal);
    const assertion = expect(task).rejects.toMatchObject({name:"AbortError"});
    await Promise.resolve();
    controller.abort();
    finish({duration:300,length:13230000,sampleRate:44100,numberOfChannels:2,getChannelData} as unknown as AudioBuffer);
    await assertion;
    expect(getChannelData).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(["onerror","onmessageerror"] as const)("cleans up %s", async (event) => {
    setup();
    const task = analyzeAudioIntelligenceFile(file);
    const assertion = expect(task).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    SilentWorker.instances[0][event]!();
    await assertion;
    expect(SilentWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
