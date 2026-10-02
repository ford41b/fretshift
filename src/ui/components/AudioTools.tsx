import { useState, useRef, useEffect } from "react";
import { Play, Square, Mic, MicOff, Hand, Minus, Plus } from "lucide-react";
import {
  enableAudio,
  startMicrophone,
  type MicFrame,
} from "../../audio/context";
import { LookaheadScheduler } from "../../audio/metronome/scheduler";
import { clickAt } from "../../audio/playback";
import { silence, type Pitch } from "../../audio/pitch";
import { useSettingsStore } from "../../store/settingsStore";
import { resolveTuning, type Tuning } from "../../schema/song.v1";
import { noteLabel } from "../../theory/pitch";
import { IconButton, ErrorNotice } from "./Common";
export function useMicrophone(onFrame?: (f: MicFrame) => void) {
  const [enabled, setEnabled] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [pitch, setPitch] = useState<Pitch>(silence);
  const stop = useRef<(() => void) | null>(null),
    generation = useRef(0),
    busy = useRef(false),
    mounted = useRef(true),
    frameHandler = useRef(onFrame);
  frameHandler.current = onFrame;
  const a4 = useSettingsStore((s) => s.settings.a4Hz);
  useEffect(() => {
    const tokenRef = generation;
    mounted.current = true;
    return () => {
      mounted.current = false;
      tokenRef.current++;
      stop.current?.();
      stop.current = null;
      busy.current = false;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    stop.current?.();
    stop.current = null;
    busy.current = false;
    setEnabled(false);
    setPending(false);
    setPitch(silence);
  }, [a4]);
  async function toggle() {
    if (stop.current || busy.current) {
      generation.current++;
      stop.current?.();
      stop.current = null;
      busy.current = false;
      setEnabled(false);
      setPending(false);
      setPitch(silence);
      return;
    }
    const token = ++generation.current;
    busy.current = true;
    setPending(true);
    try {
      const dispose = await startMicrophone(a4, (f) => {
        if (mounted.current && token === generation.current) {
          setPitch(f.pitch);
          frameHandler.current?.(f);
        }
      });
      if (!mounted.current || token !== generation.current) {
        dispose();
        return;
      }
      stop.current = dispose;
      setEnabled(true);
      setError("");
    } catch (e) {
      if (mounted.current && token === generation.current) setError(String(e));
    } finally {
      if (mounted.current && token === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return { enabled, pending, error, pitch, toggle };
}
export function TunerGauge({
  pitch,
  enabled,
}: {
  pitch: Pitch;
  enabled: boolean;
}) {
  const stable = !["no signal", "detecting"].includes(pitch.state);
  const cents = stable ? Math.round(pitch.cents) : 0;
  return (
    <div
      className={`tuner-display ${stable ? pitch.state.replace(" ", "-") : ""}`}
    >
      <div className="tuner-top">
        <span>{enabled ? pitch.state : "Microphone off"}</span>
        <strong>{stable ? pitch.note : "—"}</strong>
        <span>
          {stable ? `${cents > 0 ? "+" : ""}${cents}¢` : "Play one string"}
        </span>
      </div>
      <div className="tuner-gauge">
        <span>♭</span>
        <div className="gauge-track">
          <i className="gauge-center" />
          <b style={{ left: `${50 + Math.max(-45, Math.min(45, cents))}%` }}>
            {stable ? (cents < -5 ? "→" : cents > 5 ? "←" : "✓") : "·"}
          </b>
        </div>
        <span>♯</span>
      </div>
      <p>
        {stable
          ? Math.abs(cents) <= 5
            ? "Right on. Let it ring."
            : cents < 0
              ? "A little flat — tighten the string."
              : "A little sharp — loosen the string."
          : "Play a single, clear note and let it sustain."}
      </p>
    </div>
  );
}
export function Fretboard({ tuning, pitch }: { tuning: Tuning; pitch: Pitch }) {
  const left = useSettingsStore((s) => s.settings.leftHanded);
  const x = (f: number) => (left ? 560 - f * 40 : 40 + f * 40);
  return (
    <svg
      viewBox="0 0 600 160"
      className="fretboard"
      role="img"
      aria-label={`Live fretboard${left ? ", left handed" : ""}. ${pitch.state === "no signal" ? "No note detected" : pitch.note}`}
      data-mirrored={left}
    >
      {Array.from({ length: 13 }, (_, f) => (
        <g key={f}>
          <line x1={x(f)} y1="20" x2={x(f)} y2="135" stroke="var(--line)" />
          <text
            x={x(f)}
            y="154"
            textAnchor="middle"
            fill="var(--text-2)"
            fontSize="10"
          >
            {f}
          </text>
        </g>
      ))}
      {tuning.midi.map((open, s) => (
        <g key={s}>
          <line
            x1="40"
            y1={25 + s * 20}
            x2="560"
            y2={25 + s * 20}
            stroke="var(--line)"
            strokeWidth={0.5 + s * 0.3}
          />
          <text x="12" y={28 + s * 20} fill="var(--text-2)" fontSize="9">
            {noteLabel(open).replace(/\d/, "")}
          </text>
          {pitch.state !== "no signal" &&
            pitch.state !== "detecting" &&
            pitch.midi - open >= 0 &&
            pitch.midi - open <= 12 && (
              <circle
                cx={x(pitch.midi - open)}
                cy={25 + s * 20}
                r="8"
                fill="var(--accent-text)"
              />
            )}
        </g>
      ))}
    </svg>
  );
}
export function Tuner({ tuningId = "standard" }: { tuningId?: string }) {
  const mic = useMicrophone();
  const tuning = resolveTuning(tuningId);
  return (
    <section className="card audio-card">
      <div className="section-title">
        <div>
          <span className="eyebrow">A GOOD PLACE TO START</span>
          <h2>Find your tune</h2>
        </div>
        <button
          className={mic.enabled ? "selected" : ""}
          onClick={() => void mic.toggle()}
        >
          {mic.enabled ? <MicOff size={17} /> : <Mic size={17} />}{" "}
          {mic.pending
            ? "Cancel microphone request"
            : mic.enabled
              ? "Stop microphone"
              : "Enable microphone"}
        </button>
      </div>
      <ErrorNotice error={mic.error} />
      <TunerGauge pitch={mic.pitch} enabled={mic.enabled} />
      <div className="string-targets">
        {[...tuning.midi].reverse().map((n, i) => (
          <div key={i}>
            <strong>{noteLabel(n)}</strong>
            <span>String {6 - i}</span>
          </div>
        ))}
      </div>
      <Fretboard tuning={tuning} pitch={mic.pitch} />
      <p className="small muted">
        {tuning.label} · A4 {useSettingsStore((s) => s.settings.a4Hz)} Hz.
        Monophonic: tune one string at a time. Microphone audio stays on this
        device.
      </p>
    </section>
  );
}
export function Metronome() {
  const settings = useSettingsStore((s) => s.settings.metronome);
  const [bpm, setBpm] = useState(90),
    [beats, setBeats] = useState(4),
    [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [beat, setBeat] = useState(0),
    [error, setError] = useState("");
  const worker = useRef<Worker | null>(null),
    timers = useRef(new Set<ReturnType<typeof setTimeout>>()),
    generation = useRef(0),
    busy = useRef(false),
    taps = useRef<number[]>([]);
  const stop = () => {
    generation.current++;
    busy.current = false;
    setStarting(false);
    worker.current?.terminate();
    worker.current = null;
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    setRunning(false);
  };
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  async function start() {
    if (busy.current || running) return;
    busy.current = true;
    setStarting(true);
    const token = ++generation.current;
    try {
      const ctx = await enableAudio();
      if (token !== generation.current) return;
      const division = settings.subdivisionClicks ? 2 : 1,
        scheduler = new LookaheadScheduler(60 / bpm / division);
      scheduler.start(ctx.currentTime + 0.08);
      const w = new Worker(
        new URL("../../audio/metronome/timer.worker.ts", import.meta.url),
        { type: "module" },
      );
      w.onmessage = () => {
        try {
          scheduler.tick(ctx.currentTime, (time, index) => {
            const downbeat = index % (beats * division) === 0;
            clickAt(
              ctx,
              time,
              settings.accentDownbeat && downbeat,
              settings.sound,
            );
            const timer = setTimeout(
              () => {
                timers.current.delete(timer);
                setBeat(Math.floor(index / division) % beats);
              },
              Math.max(0, time - ctx.currentTime) * 1000,
            );
            timers.current.add(timer);
          });
        } catch (e) {
          stop();
          setError(String(e));
        }
      };
      w.postMessage("start");
      worker.current = w;
      setRunning(true);
      setError("");
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) {
        busy.current = false;
        setStarting(false);
      }
    }
  }
  return (
    <section className="card audio-card">
      <div className="section-title">
        <div>
          <span className="eyebrow">ONE BEAT AT A TIME</span>
          <h2>Keep good time</h2>
        </div>
        <span className="pill">{settings.sound}</span>
      </div>
      <div className={`metronome-ring ${running ? "running" : ""}`}>
        <div>
          <strong>{bpm}</strong>
          <span>BEATS PER MINUTE</span>
        </div>
        <div className="beat-dots">
          {Array.from({ length: beats }, (_, i) => (
            <i key={i} className={running && i === beat ? "active" : ""} />
          ))}
        </div>
      </div>
      <div className="bpm-controls">
        <IconButton
          label="Decrease tempo"
          disabled={running || bpm <= 20}
          onClick={() => setBpm(bpm - 1)}
        >
          <Minus />
        </IconButton>
        <label className="sr-only" htmlFor="metro-bpm">
          Metronome tempo
        </label>
        <input
          id="metro-bpm"
          type="range"
          min="20"
          max="240"
          value={bpm}
          disabled={running}
          onChange={(e) => setBpm(Number(e.target.value))}
        />
        <IconButton
          label="Increase tempo"
          disabled={running || bpm >= 240}
          onClick={() => setBpm(bpm + 1)}
        >
          <Plus />
        </IconButton>
      </div>
      <div className="button-row center">
        <button
          className="primary"
          disabled={starting}
          onClick={() => (running ? stop() : void start())}
        >
          {running ? <Square size={17} /> : <Play size={17} />}{" "}
          {starting
            ? "Preparing audio…"
            : running
              ? "Stop"
              : "Tap to enable audio"}
        </button>
        <button
          disabled={running}
          onClick={() => {
            const now = performance.now();
            taps.current = taps.current
              .filter((t) => now - t < 4000)
              .concat(now)
              .slice(-6);
            if (taps.current.length >= 3) {
              const avg = (now - taps.current[0]) / (taps.current.length - 1);
              const tempo = Math.round(60000 / avg);
              if (tempo >= 20 && tempo <= 240) setBpm(tempo);
              else setError("Tap a tempo between 20 and 240 BPM.");
            }
          }}
        >
          <Hand size={17} />
          Tap tempo
        </button>
        <select
          aria-label="Beats per measure"
          value={beats}
          disabled={running}
          onChange={(e) => setBeats(Number(e.target.value))}
        >
          {[2, 3, 4, 6].map((n) => (
            <option key={n} value={n}>
              {n} beats
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice error={error} />
      <p className="small muted centered">
        Audio begins only after a tap. Timing uses the audio clock and a
        background worker.
      </p>
    </section>
  );
}
