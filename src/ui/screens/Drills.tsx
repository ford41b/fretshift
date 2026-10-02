import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Play, Square, ArrowRightLeft, Music2 } from "lucide-react";
import {
  PageTitle,
  Segments,
  ErrorNotice,
  useToast,
} from "../components/Common";
import { ChordDiagram } from "../components/ChordDiagram";
import { useMicrophone } from "../components/AudioTools";
import { newSong, resolveTuning, type Voicing } from "../../schema/song.v1";
import { findVoicings, voicingPitches } from "../../theory/voicingSearch";
import { fingerprintMatch, timingOffset, timingScore } from "../../audio/onset";
import { enableAudio } from "../../audio/context";
import { clickAt } from "../../audio/playback";
import { LookaheadScheduler } from "../../audio/metronome/scheduler";
import { practiceRepo } from "../../persistence/dexie";
import { useSettingsStore } from "../../store/settingsStore";
export function Drills() {
  const [query] = useSearchParams();
  const [kind, setKind] = useState<"changes" | "strum">("changes"),
    [a, setA] = useState(query.get("a") ?? "G"),
    [b, setB] = useState(query.get("b") ?? "D"),
    [bpm, setBpm] = useState(80),
    [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [remaining, setRemaining] = useState(60),
    [count, setCount] = useState(0),
    [best, setBest] = useState(0),
    [offset, setOffset] = useState(0),
    [score, setScore] = useState<number | null>(null),
    [error, setError] = useState(""),
    [history, setHistory] = useState<number[]>([]);
  const startTime = useRef(0),
    endTime = useRef(0),
    worker = useRef<Worker | null>(null),
    offsets = useRef<number[]>([]),
    switches = useRef(0),
    last = useRef<string | null>(null),
    candidate = useRef<string | null>(null),
    frames = useRef(0),
    candidateAt = useRef(0),
    generation = useRef(0),
    busy = useRef(false);
  const toast = useToast();
  const settings = useSettingsStore((s) => s.settings);
  const song = newSong();
  const t = resolveTuning("standard");
  let va: Voicing | undefined, vb: Voicing | undefined;
  try {
    va = findVoicings(a, t, 0, 1)[0];
    vb = findVoicings(b, t, 0, 1)[0];
  } catch {
    /* Invalid pending chord text is displayed below. */
  }
  const valid = !!va && !!vb && a !== b;
  const mic = useMicrophone((f) => {
    if (!running || f.time < startTime.current || f.time >= endTime.current)
      return;
    if (kind === "strum" && f.onset) {
      const ms = timingOffset(f.time, startTime.current, bpm);
      offsets.current.push(ms);
      setOffset(ms);
      setCount(offsets.current.length);
    }
    if (kind === "changes" && va && vb) {
      const match = fingerprintMatch(
        f.chroma,
        voicingPitches(va, t),
        voicingPitches(vb, t),
      ).match;
      if (match !== candidate.current) {
        candidate.current = match;
        candidateAt.current = f.time;
        frames.current = 1;
      } else frames.current++;
      if (match && frames.current === 3 && match !== last.current) {
        if (
          last.current &&
          Math.abs(timingOffset(candidateAt.current, startTime.current, bpm)) <=
            150
        ) {
          switches.current++;
          setCount(switches.current);
        }
        last.current = match;
      }
    }
  });
  useEffect(() => {
    practiceRepo
      .pairs()
      .then((pairs) => {
        const p = pairs.find(
          (p) => p.chordA === a && p.chordB === b && p.tuningId === "standard",
        );
        setBest(p?.best ?? 0);
        setHistory(p?.history.map((h) => h.count) ?? []);
      })
      .catch((e) => setError(String(e)));
  }, [a, b]);
  const finish = async (completed = false) => {
    generation.current++;
    busy.current = false;
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setRemaining(0);
    try {
      if (!completed) {
        toast(
          "Drill stopped. Complete the full minute to save a comparable score.",
        );
        return;
      }
      const at = new Date().toISOString();
      if (kind === "changes") {
        const existing = (await practiceRepo.pairs()).find(
          (p) => p.chordA === a && p.chordB === b && p.tuningId === "standard",
        );
        await practiceRepo.savePair({
          chordA: a,
          chordB: b,
          tuningId: "standard",
          best: Math.max(best, switches.current),
          history: [
            ...(existing?.history ?? []),
            { at, count: switches.current },
          ],
        });
        setBest(Math.max(best, switches.current));
        setHistory((h) => [...h, switches.current]);
        toast(`${switches.current} clean transitions saved.`);
      } else {
        const value = timingScore(offsets.current);
        setScore(value);
        await practiceRepo.saveStrum({
          at,
          tempo: bpm,
          score: value,
          meanOffsetMs: offsets.current.length
            ? offsets.current.reduce((x, y) => x + y, 0) /
              offsets.current.length
            : 0,
        });
        toast("Timing session saved.");
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
    },
    [],
  );
  async function start() {
    if (busy.current || running) return;
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 220) {
      setError("Choose a tempo from 30 to 220 BPM.");
      return;
    }
    if (!mic.enabled) {
      setError("Enable the microphone before starting a scored drill.");
      return;
    }
    busy.current = true;
    setStarting(true);
    const token = ++generation.current;
    try {
      const ctx = await enableAudio();
      if (token !== generation.current) return;
      startTime.current = ctx.currentTime + 0.2;
      endTime.current = startTime.current + 60;
      offsets.current = [];
      switches.current = 0;
      last.current = null;
      candidate.current = null;
      frames.current = 0;
      setCount(0);
      setScore(null);
      setRemaining(60);
      const scheduler = new LookaheadScheduler(60 / bpm);
      scheduler.start(startTime.current);
      const w = new Worker(
        new URL("../../audio/metronome/timer.worker.ts", import.meta.url),
        { type: "module" },
      );
      w.onmessage = () => {
        scheduler.tick(ctx.currentTime, (time, i) => {
          if (time < endTime.current)
            clickAt(ctx, time, i % 4 === 0, settings.metronome.sound);
        });
        setRemaining(Math.max(0, Math.ceil(endTime.current - ctx.currentTime)));
        if (ctx.currentTime >= endTime.current) void finishRef.current(true);
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
    <>
      <PageTitle
        eyebrow="SMALL MOVES. BIG PROGRESS."
        title="Practice the in-between"
        description="One focused minute can make the next song feel different."
        action={
          <Link className="button" to="/practice">
            Back to practice
          </Link>
        }
      />
      <Segments
        label="Drill type"
        value={kind}
        options={[
          { value: "changes", label: "Chord changes" },
          { value: "strum", label: "Strum timing" },
        ]}
        onChange={(v) => {
          if (!running) {
            setKind(v);
            setScore(null);
            setCount(0);
          }
        }}
      />
      <section className="card drill-card">
        <div className="drill-title">
          {kind === "changes" ? (
            <ArrowRightLeft size={27} />
          ) : (
            <Music2 size={27} />
          )}
          <h2>
            {kind === "changes"
              ? "Make the change feel natural"
              : "Find the pocket"}
          </h2>
          <p>
            {kind === "changes"
              ? "Alternate between two known chord shapes on the beat. This compares their harmonic fingerprints; it is not a general chord detector."
              : "Strum along with the pulse. Rhythm only — chord quality is not scored."}
          </p>
        </div>
        {kind === "changes" && (
          <>
            <div className="drill-chords">
              <div>
                <input
                  aria-label="First drill chord"
                  value={a}
                  disabled={running}
                  onChange={(e) => setA(e.target.value)}
                />
                {va && <ChordDiagram song={song} name={a} voicing={va} />}
              </div>
              <ArrowRightLeft size={27} />
              <div>
                <input
                  aria-label="Second drill chord"
                  value={b}
                  disabled={running}
                  onChange={(e) => setB(e.target.value)}
                />
                {vb && <ChordDiagram song={song} name={b} voicing={vb} />}
              </div>
            </div>
            {!valid && (
              <p className="warning">Choose two different, supported chords.</p>
            )}
          </>
        )}
        <div className="drill-numbers">
          <div>
            <strong>{remaining}</strong>
            <span>SECONDS LEFT</span>
          </div>
          <div>
            <strong>{count}</strong>
            <span>{kind === "changes" ? "CLEAN CHANGES" : "STRUMS HEARD"}</span>
          </div>
          <div>
            <strong>{kind === "changes" ? best : (score ?? "—")}</strong>
            <span>{kind === "changes" ? "PERSONAL BEST" : "TIMING SCORE"}</span>
          </div>
        </div>
        {kind === "strum" && (
          <>
            <div
              className={`timing-readout ${Math.abs(offset) > 60 ? "warning" : ""}`}
            >
              {offset < 0 ? "Rushing" : offset > 0 ? "Dragging" : "On the beat"}{" "}
              · {offset >= 0 ? "+" : ""}
              {Math.round(offset)} ms
            </div>
            <div className="accuracy-strip">
              {offsets.current.slice(-24).map((ms, i) => (
                <span
                  key={i}
                  title={`${Math.round(ms)} ms`}
                  className={Math.abs(ms) < 50 ? "accurate" : ""}
                >
                  {Math.abs(ms) < 50 ? "✓" : "·"}
                </span>
              ))}
            </div>
          </>
        )}
        <div className="button-row center">
          <label className="inline-label">
            Tempo
            <input
              type="number"
              min="30"
              max="220"
              value={bpm}
              disabled={running}
              onChange={(e) => setBpm(Number(e.target.value))}
            />
          </label>
          <button onClick={() => void mic.toggle()} disabled={running}>
            {mic.enabled ? "Microphone enabled ✓" : "Enable microphone"}
          </button>
          <button
            className="primary"
            disabled={starting || (kind === "changes" && !valid)}
            onClick={() => (running ? void finish() : void start())}
          >
            {running ? <Square size={17} /> : <Play size={17} />}{" "}
            {starting
              ? "Preparing audio…"
              : running
                ? "Finish early"
                : "Start 60-second drill"}
          </button>
        </div>
        <ErrorNotice error={error || mic.error} />
        {history.length > 0 && kind === "changes" && (
          <div className="drill-history">
            <h3>Your recent sessions</h3>
            <div className="bar-chart">
              {history.slice(-12).map((n, i) => (
                <div
                  key={i}
                  style={{
                    height: `${Math.max(8, (n / Math.max(...history, 1)) * 100)}%`,
                  }}
                  title={`${n} changes`}
                >
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
