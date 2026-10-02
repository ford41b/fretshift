import { NoteRecognizer } from "./recognition";
let recognizer: NoteRecognizer;
self.onmessage = (
  event: MessageEvent<{
    samples?: Float32Array;
    time: number;
    rate: number;
    a4: number;
    floor: number;
    chords?: boolean;
  }>,
) => {
  const m = event.data;
  if (!m.samples) {
    recognizer = new NoteRecognizer(m.rate, m.a4, m.floor, m.chords === true);
    return;
  }
  self.postMessage(recognizer.process(m.samples, m.time));
};
