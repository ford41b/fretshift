/* global AudioWorkletProcessor, currentFrame, sampleRate, registerProcessor */
// Only capture and timestamp here; YIN/FFT run on a dedicated worker.
class PracticeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.position = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input)
      for (let i = 0; i < input.length; i++) {
        this.buffer[this.position++] = input[i];
        if (this.position === this.buffer.length) {
          this.port.postMessage(
            { samples: this.buffer, time: (currentFrame + i + 1) / sampleRate },
            [this.buffer.buffer],
          );
          this.buffer = new Float32Array(1024);
          this.position = 0;
        }
      }
    return true; // Outputs stay zero: microphone monitoring is never audible.
  }
}
registerProcessor("practice-capture", PracticeCapture);
