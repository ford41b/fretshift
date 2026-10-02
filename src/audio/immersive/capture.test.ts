// @vitest-environment node
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
it("capture timestamps raw frames and emits silence: playback-only output cannot feed scored input", () => {
  const messages: { samples: Float32Array; time: number }[] = [];
  let Capture: new () => {
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
  };
  const sandbox = {
    AudioWorkletProcessor: class {
      port = {
        postMessage: (m: { samples: Float32Array; time: number }) =>
          messages.push(m),
      };
    },
    currentFrame: 0,
    sampleRate: 48000,
    Float32Array,
    registerProcessor: (_name: string, constructor: typeof Capture) => {
      Capture = constructor;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    readFileSync(new URL("./capture.worklet.js", import.meta.url), "utf8"),
    sandbox,
  );
  const c = new Capture!();
  for (let block = 0; block < 8; block++) {
    sandbox.currentFrame = block * 128;
    const out = new Float32Array(128);
    c.process([[new Float32Array(128).fill(0.1)]], [[out]]);
    expect(out.every((s) => s === 0)).toBe(true);
  }
  expect(messages).toHaveLength(1);
  expect(messages[0].time).toBe(1024 / 48000);
  expect(messages[0].samples).toHaveLength(1024);
});
