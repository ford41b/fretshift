import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Timer } from "lucide-react";
import {
  BEAT_SECONDS,
  CalibrationRun,
  calibrationPlan,
  inputKey,
  saveCalibration,
  type CalibrationRecord,
  type Cue,
} from "../../audio/immersive/calibration";
import type { PracticeInput } from "../../audio/immersive/microphone";
import type { Evidence } from "../../audio/immersive/recognition";

type Props = {
  input: PracticeInput | null;
  ready: boolean;
  floor: number;
  sink: MutableRefObject<((e: Evidence) => void) | null>;
  record: CalibrationRecord | null;
  onBusy: (busy: boolean) => void;
  onSaved: (record: CalibrationRecord) => void;
};
type Active = { run: CalibrationRun; sources: AudioBufferSourceNode[]; context: AudioContext };

/** Unpitched noise burst: it cannot resolve to a stable pitch, so leaked clicks never count as taps. */
function clickBuffer(context: AudioContext, gain: number) {
  const length = Math.round(context.sampleRate * 0.012),
    buffer = context.createBuffer(1, length, context.sampleRate),
    data = buffer.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    data[i] = ((seed >>> 0) / 2147483648 - 1) * Math.exp(-i / (length / 4)) * gain;
  }
  return buffer;
}

/**
 * Guided timing calibration. Clicks play only here, never during scored
 * practice, and nothing is scored while calibrating.
 */
export function ImmersiveCalibration({ input, ready, floor, sink, record, onBusy, onSaved }: Props) {
  const active = useRef<Active | null>(null);
  const [cue, setCue] = useState<Cue>("click");
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<{ stage: string; beat: number; taps: number; next: number } | null>(null);
  const [message, setMessage] = useState("");

  const stop = useCallback(() => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    sink.current = null;
    for (const source of a.sources) {
      try {
        source.stop();
      } catch {
        /* already finished */
      }
      source.disconnect();
    }
    setView(null);
    setRunning(false);
    onBusy(false);
  }, [onBusy, sink]);

  // A changed or lost microphone ends calibration without saving.
  useEffect(() => () => stop(), [input, stop]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const a = active.current;
      if (!a) return;
      const now = a.context.currentTime,
        { run } = a;
      if (a.context.state !== "running" || now > run.plan.end + 3) {
        stop();
        setMessage("Calibration stopped: microphone frames stopped arriving. Reconnect and try again. Nothing was saved.");
        return;
      }
      if (run.done) {
        const outcome = run.result();
        stop();
        input?.reset(floor);
        if (!outcome.ok) {
          setMessage(outcome.message);
          return;
        }
        const saved: CalibrationRecord = {
          offsetMs: outcome.offsetMs,
          spreadMs: outcome.spreadMs,
          used: outcome.used,
          rejected: outcome.rejected,
          cue: run.plan.cue,
          outputDelayMs: Math.round(run.plan.outputDelay * 1000),
          outputLatencyReported: run.plan.cue === "click" && (a.context.outputLatency ?? 0) > 0,
          sampleRate: a.context.sampleRate,
          inputLabel: inputKey(input?.inputLabel),
          measuredAt: new Date().toISOString(),
        };
        const stored = saveCalibration(inputKey(input?.inputLabel), saved);
        onSaved(saved);
        setMessage(
          `Measured ${saved.offsetMs > 0 ? "+" : ""}${saved.offsetMs} ms from ${outcome.used} of ${outcome.cues} taps` +
            `${outcome.rejected ? ` (${outcome.rejected} outlier${outcome.rejected === 1 ? "" : "s"} rejected)` : ""}` +
            `${outcome.unclear ? ` · ${outcome.unclear} unclear` : ""}. ` +
            (stored ? "Saved for this microphone on this device." : "Applied to this session; this browser would not store it."),
        );
        return;
      }
      const step = run.step(now),
        upcoming = [...run.plan.countIn, ...run.plan.measured].find((c) => c > now);
      setView({ ...step, taps: run.tapsHeard, next: upcoming === undefined ? 1 : Math.max(0, 1 - (upcoming - now) / BEAT_SECONDS) });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, floor, input, onSaved, stop]);

  function begin() {
    if (!input || !ready || active.current) return;
    const context = input.context;
    input.reset(floor);
    // Compensate the audio output path when the browser reports it.
    const outputDelay = (context.baseLatency || 0) + (context.outputLatency || 0);
    const plan = calibrationPlan(context.currentTime + 0.6, cue, outputDelay);
    const run = new CalibrationRun(plan);
    const sources =
      cue === "click"
        ? [...plan.leak, ...plan.countIn, ...plan.measured].map((at) => {
            const source = context.createBufferSource();
            source.buffer = clickBuffer(context, plan.countIn.includes(at) ? 0.5 : 0.35);
            source.connect(context.destination);
            source.start(at);
            return source;
          })
        : [];
    active.current = { run, sources, context };
    sink.current = (e) => run.frame(e.time, e.attack, e.unhealthy);
    setMessage("");
    onBusy(true);
    setRunning(true);
    setView({ ...run.step(context.currentTime), taps: 0, next: 0 });
  }

  const instruction = !view
    ? null
    : view.stage === "still"
      ? `Keep the strings still · click ${Math.max(1, view.beat)} of 3`
      : view.stage === "count-in"
        ? `Get ready · ${Math.max(1, view.beat)} of 4`
        : view.stage === "play"
          ? `Pluck one open string on each ${cue === "click" ? "click" : "pulse"} · ${Math.max(1, view.beat)} of 12`
          : "Checking your taps…";

  return (
    <div className="imm-calibration" aria-label="Timing calibration">
      <div className="imm-calibration-head">
        <Timer size={17} aria-hidden="true" />
        <strong>Timing calibration</strong>
        <span>
          {record
            ? `${record.offsetMs > 0 ? "+" : ""}${record.offsetMs} ms · ${record.used} taps · ${new Date(record.measuredAt).toLocaleDateString()}`
            : "Not calibrated on this device"}
        </span>
      </div>
      {view ? (
        <>
          <p role="status" className="imm-calibration-step">{instruction}</p>
          {cue === "visual" && view.stage !== "analyzing" && (
            <div className="imm-calibration-track" aria-hidden="true">
              <span style={{ left: `${Math.round(view.next * 80)}%` }} />
              <i />
            </div>
          )}
          <p className="imm-caption">Clear taps heard: {view.taps}</p>
          <button type="button" onClick={() => { stop(); input?.reset(floor); setMessage("Calibration cancelled. Nothing was saved."); }}>
            Cancel calibration
          </button>
        </>
      ) : (
        <>
          <p className="imm-caption">
            About 15 seconds. Keep the strings still for three clicks, listen to a four-click count-in, then pluck one open string on each of 12 cues.
            The median delay is saved for this microphone and becomes your timing adjustment. Clicks play only here, never during scored practice.
          </p>
          <div className="imm-calibration-cues" role="group" aria-label="Calibration cue">
            <button type="button" aria-pressed={cue === "click"} className={cue === "click" ? "selected" : ""} onClick={() => setCue("click")}>
              Clicks · wired headphones
            </button>
            <button type="button" aria-pressed={cue === "visual"} className={cue === "visual" ? "selected" : ""} onClick={() => setCue("visual")}>
              Visual pulse · no audio
            </button>
          </div>
          <button type="button" disabled={!ready} onClick={begin}>
            <Timer size={17} aria-hidden="true" /> {record ? "Recalibrate timing" : "Calibrate timing"}
          </button>
        </>
      )}
      {message && <p role="status" className="imm-calibration-result">{message}</p>}
    </div>
  );
}
