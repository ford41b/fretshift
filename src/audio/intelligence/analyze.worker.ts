import { LocalAnalysisOrchestrator } from "./index";
import { YinNoteTranscriber } from "./notes";
import type { PcmAudio } from "./types";

self.onmessage = async (event: MessageEvent<PcmAudio & { transcribeNotes?: boolean }>) => {
  try { self.postMessage({ result: await new LocalAnalysisOrchestrator(
    undefined, undefined, undefined, event.data.transcribeNotes ? new YinNoteTranscriber() : undefined,
    (stage) => self.postMessage({ stage }),
  ).analyze(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
