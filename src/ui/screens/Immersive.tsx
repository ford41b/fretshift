import { GlassSwitch } from "../components/MobileGlass";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Mic,
  Pause,
  Play,
  Repeat2,
  Guitar,
  VolumeX,
} from "lucide-react";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { usePracticeStore } from "../../store/practiceStore";
import { getSession, subscribeAuth } from "../../cloud/client";
import { practiceRepo } from "../../persistence/dexie";
import {
  compileTargets,
  EventScorer,
  scorablePassages,
  summarize,
  type Result,
  type Target,
} from "../../audio/immersive/score";
import {
  IMMERSIVE_BETA,
  IMMERSIVE_FEATURES,
  scoringEnabledFor,
} from "../../audio/immersive/release";
import {
  openPracticeInput,
  type PracticeInput,
} from "../../audio/immersive/microphone";
import type { Evidence } from "../../audio/immersive/recognition";
import {
  inputKey,
  loadCalibration,
  type CalibrationRecord,
} from "../../audio/immersive/calibration";
import { ImmersiveCalibration } from "../components/ImmersiveCalibration";
import { type Song, resolveTuning } from "../../schema/song.v1";
import { noteLabel } from "../../theory/pitch";
import "../immersive.css";

/** Chord scoring follows its release flag (off until real recordings meet thresholds). */
const COMPILE = { chordScoring: IMMERSIVE_FEATURES.chordScoring.enabled };
type Phase = "setup" | "running" | "paused" | "results";
type Mode = "learn" | "rhythm" | "visual";
type Run = {
  scorer: EventScorer;
  start: number;
  progress: number;
  startDate: string;
  owner: string | null;
  seconds: number;
  lastClock: number;
  cycles: number;
  completed: Result[];
  extra: number;
};
export function Immersive() {
  const { id } = useParams();
  const library = useSongStore((s) => s.songs);
  const songs = library.filter((s) => !s.deletedAt);
  const song = songs.find((s) => s.id === id);
  if (!song)
    return (
      <section className="imm-library" aria-label="Choose a song for immersive practice">
        <div className="imm-library-hero">
          <span className="imm-hero-symbol"><Guitar size={34} strokeWidth={1.6} /></span>
          <span className="imm-eyebrow">FRETSHIFT / LIVE GUITAR PRACTICE</span>
          <h1>Immersive practice<span className="imm-period">.</span></h1>
          {IMMERSIVE_BETA && <span className="imm-beta-chip">BETA</span>}
          <p>Six strings. One clear next step. Choose a song and make some room for the music.</p>
        </div>
        <ReleaseNotes />
        <div className="imm-library-heading"><span>YOUR PRACTICE LIBRARY</span><span>{songs.length} {songs.length === 1 ? "song" : "songs"}</span></div>
        <div className="immersive-song-list">
          {songs.map((s) => (
            <Link className="imm-song-card" to={`/immersive/${s.id}`} key={s.id}>
              <span className="imm-song-icon"><Guitar size={22} strokeWidth={1.7}/></span>
              <div><h2>{s.title}</h2><p>{s.artist || "Your arrangement"} · {s.tempo} BPM</p></div>
              <span className="imm-enter">ENTER PRACTICE <ArrowRight size={18}/></span>
            </Link>
          ))}
        </div>
        {!songs.length && <p className="imm-empty">Your songbook is empty. <Link to="/import">Import a song to get started →</Link></p>}
        <div className="imm-library-foot"><span>GUITAR PRACTICE, AT YOUR PACE</span><span>Microphone analysis stays on your device</span></div>
      </section>
    );
  if (!song.measures.length)
    return (
      <>
        <h1>{song.title}</h1>
        <p>
          This chart has no measures yet. Add a passage before starting
          immersive practice.
        </p>
        <Link to={`/song/${song.id}`}>Back to chart</Link>
      </>
    );
  return <PracticeRoom key={song.id} song={song} />;
}
/** Which features are on in this build, and why (criteria from src/audio/immersive/release.ts). */
function ReleaseNotes() {
  return (
    <details className="imm-release">
      <summary>What’s on in this {IMMERSIVE_BETA ? "beta" : "release"}</summary>
      <ul>
        {Object.values(IMMERSIVE_FEATURES).map((f) => (
          <li key={f.id}>
            <strong>{f.label}: {f.enabled ? "on" : "off"}</strong>
            <span>{f.why}</span>
          </li>
        ))}
      </ul>
      {IMMERSIVE_BETA && <p>Beta until the physical iPhone and guitar checklist passes. Current checks use emulated browsers and generated signals.</p>}
    </details>
  );
}
function PracticeRoom({ song }: { song: Song }) {
  const settings = useSettingsStore((s) => s.settings);
  const region = usePracticeStore.getState();
  const selectedFirst = Math.max(
    0,
    song.measures.findIndex((m) => m.id === region.loopStartMeasureId),
  );
  const selectedLast = song.measures.findIndex(
    (m) => m.id === region.loopEndMeasureId,
  );
  const initialLast =
    selectedLast >= selectedFirst ? selectedLast : song.measures.length - 1;
  const scoring = scoringEnabledFor(song);
  const [first, setFirst] = useState(selectedFirst),
    [last, setLast] = useState(initialLast);
  const [speed, setSpeed] = useState(0.75),
    [mode, setMode] = useState<Mode>(() => {
      const initial = compileTargets(song, 0.75, selectedFirst, initialLast, COMPILE).targets;
      return scoring && initial.length && initial.every((t) => t.supported)
        ? "learn"
        : "visual";
    }),
    [loop, setLoop] = useState(false);
  const [confirmed, setConfirmed] = useState(false),
    [offset, setOffset] = useState(0),
    [offsetSource, setOffsetSource] = useState<"none" | "calibrated" | "manual">("none"),
    [calibration, setCalibration] = useState<CalibrationRecord | null>(null),
    [calibrating, setCalibrating] = useState(false),
    [phase, setPhase] = useState<Phase>("setup");
  const [connected, setConnected] = useState(false),
    [connecting, setConnecting] = useState(false),
    [noiseReady, setNoiseReady] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tuner, setTuner] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null>(null),
    [position, setPosition] = useState(0),
    [feedback, setFeedback] = useState("Your next note starts here");
  const [visualReport, setVisualReport] = useState({ seconds: 0, percent: 0, measures: 0 }),
    [results, setResults] = useState<Result[]>([]),
    [saved, setSaved] = useState("");
  const [extra, setExtra] = useState(0),
    [, redraw] = useState(0);
  const input = useRef<PracticeInput | null>(null),
    visualClock = useRef<AudioContext | null>(null),
    abort = useRef<AbortController | null>(null);
  const run = useRef<Run | null>(null),
    phaseRef = useRef<Phase>(phase),
    modeRef = useRef(mode),
    planRef = useRef<ReturnType<typeof compileTargets> | null>(null);
  const attackSequence = useRef(0);
  const currentFrame = useRef<Evidence | null>(null),
    floor = useRef(0.007),
    noise = useRef<{ until: number; levels: number[] } | null>(null);
  const calibrationSink = useRef<((e: Evidence) => void) | null>(null);
  const applyCalibration = useCallback((record: CalibrationRecord) => {
    setCalibration(record);
    setOffset(record.offsetMs);
    setOffsetSource("calibrated");
  }, []);
  const pendingSave = useRef<
    Parameters<typeof practiceRepo.saveSession>[0] | null
  >(null);
  const plan = useMemo(
    () => compileTargets(song, speed, first, last, COMPILE),
    [song, speed, first, last],
  );
  const passages = useMemo(
    () => (scoring ? scorablePassages(song, 6, COMPILE) : []),
    [song, scoring],
  );
  planRef.current = plan;
  modeRef.current = mode;
  phaseRef.current = phase;
  const disconnect = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    input.current?.stop();
    input.current = null;
    void visualClock.current?.close().catch(() => {});
    visualClock.current = null;
  }, []);
  const pause = useCallback(
    (message = "Paused · microphone off") => {
      if (phaseRef.current !== "running") return;
      const r = run.current,
        ctx = input.current?.context ?? visualClock.current;
      if (r && ctx && phaseRef.current === "running") {
        r.scorer.interrupt(ctx.currentTime - r.start);
        r.progress = Math.max(0, ctx.currentTime - r.start);
      }
      phaseRef.current = "paused";
      disconnect();
      setConnected(false);
      setConnecting(false);
      setPhase("paused");
      setNotice(modeRef.current === "visual" ? "" : message);
    },
    [disconnect],
  );
  useEffect(() => {
    const hide = () => {
      if (document.hidden)
        pause(
          "Paused while FretShift was in the background. Reconnect when ready.",
        );
    };
    const leave = () => pause("Interrupted. Reconnect when ready.");
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    const unsubscribe = subscribeAuth(() => {
      if (run.current)
        pause("Account changed. Finish this session before starting another.");
    });
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      unsubscribe();
      disconnect();
    };
  }, [disconnect, pause]);
  async function connect() {
    disconnect();
    setError("");
    setNotice("");
    setConnecting(true);
    setNoiseReady(false);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const device = await openPracticeInput(
        settings.a4Hz,
        controller.signal,
        (e) => {
          currentFrame.current = e;
          if (noise.current) {
            noise.current.levels.push(e.rms);
            if (e.time >= noise.current.until) {
              const levels = noise.current.levels.sort((a, b) => a - b);
              floor.current = Math.max(
                0.003,
                levels[Math.floor(levels.length * 0.8)] ?? 0.007,
              );
              noise.current = null;
              if (floor.current > 0.025) {
                setNoiseReady(false);
                setError(
                  "Room noise is too high. Quiet the room, then reconnect and keep the strings still during the check.",
                );
              } else {
                setNoiseReady(true);
                input.current?.reset(floor.current);
              }
            }
          }
          // Calibration owns the frames while it runs; it never scores.
          if (calibrationSink.current) {
            calibrationSink.current(e);
            return;
          }
          if (phaseRef.current !== "running") return;
          if (e.unhealthy) {
            pause(
              "Input is noisy or clipping. Scoring paused; quiet the room and reconnect.",
            );
            return;
          }
          const r = run.current;
          if (!r || !e.attack || modeRef.current === "visual") return;
          const time = e.attack.time - r.start;
          if (time < -0.22 || time < r.progress - 0.22) return;
          r.scorer.attack({
            ...e.attack,
            id: ++attackSequence.current,
            time,
            resolvedAt: e.attack.resolvedAt - r.start,
          });
        },
        (message) => {
          setError(message);
          pause(message);
        },
        { chords: COMPILE.chordScoring },
      );
      if (controller.signal.aborted) {
        device.stop();
        return;
      }
      input.current = device;
      noise.current = { until: device.context.currentTime + 1, levels: [] };
      // The measured per-device value replaces the 0 ms default; a manual choice stays.
      const stored = loadCalibration(inputKey(device.inputLabel));
      setCalibration(stored);
      if (offsetSource !== "manual") {
        setOffset(stored?.offsetMs ?? 0);
        setOffsetSource(stored ? "calibrated" : "none");
      }
      setConnected(true);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setConnecting(false);
    }
  }
  async function save() {
    if (!pendingSave.current) return;
    setSaved("Saving…");
    try {
      await practiceRepo.saveSession(pendingSave.current);
      pendingSave.current = null;
      setSaved("Saved on this device · available in Progress");
    } catch {
      setSaved("Could not save. Keep this page open and retry.");
    }
  }
  function finish() {
    const r = run.current;
    if (!r) {
      disconnect();
      setPhase("setup");
      return;
    }
    phaseRef.current = "results";
    const rows = [...r.completed, ...r.scorer.finish()];
    const summary = summarize(rows);
    const elapsed = Math.max(position, r.lastClock - r.start, r.progress);
    const visualFraction = Math.min(1, Math.max(0, elapsed / Math.max(.001, plan.duration)));
    setVisualReport({ seconds: r.seconds,
      percent: Math.round(100 * visualFraction),
      measures: Math.min(last - first + 1, Math.max(0, Math.floor(visualFraction * (last-first+1)))) });
    setNotice("");
    setError("");
    setResults(rows);
    setExtra(r.extra + r.scorer.extraAttacks);
    disconnect();
    setConnected(false);
    setPhase("results");
    pendingSave.current = {
      id: crypto.randomUUID(),
      songId: song.id,
      startedAt: r.startDate,
      durationSec: Math.round(r.seconds),
      tempoMultiplierMax: speed,
      loopCount: r.cycles,
      immersive: {
        version: 1,
        ownerId: r.owner,
        mode,
        firstMeasure: first,
        lastMeasure: last,
        ...summary,
        ...(mode === "visual" ? { visualProgressPercent: Math.round(100 * visualFraction) } : {}),
        ...(mode === "visual" ? {} : { timingOffsetMs: offset, timingOffsetSource: offsetSource }),
        extraAttacks: r.extra + r.scorer.extraAttacks,
      },
    };
    run.current = null;
    void save();
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    let raf = 0,
      lastPaint = 0;
    const paint = () => {
      const r = run.current,
        ctx = input.current?.context ?? visualClock.current;
      if (performance.now() - lastPaint > 40) {
        lastPaint = performance.now();
        setEvidence(currentFrame.current);
        if (phaseRef.current === "running" && r && ctx) {
          if (ctx.state !== "running") {
            pause("Audio suspended. Reconnect to resume.");
            return;
          }
          const t = ctx.currentTime - r.start;
          const analyzedThrough =
            (currentFrame.current?.time ?? r.start) - r.start;
          if (t >= 0) r.seconds += Math.max(0, ctx.currentTime - Math.max(r.lastClock, r.start));
          r.lastClock = ctx.currentTime;
          if (t >= r.progress) {
            if (modeRef.current === "rhythm")
              r.scorer.tick(Math.min(t, analyzedThrough));
            if (modeRef.current === "visual")
              r.scorer.index = Math.min(
                r.scorer.targets.length,
                r.scorer.targets.findIndex((x) => x.time >= t) < 0
                  ? r.scorer.targets.length
                  : r.scorer.targets.findIndex((x) => x.time >= t),
              );
          }
          setPosition(t);
          setFeedback(r.scorer.feedback);
          redraw((n) => n + 1);
          const done =
            modeRef.current === "learn"
              ? r.scorer.index >= r.scorer.targets.length
              : t > planRef.current!.duration + 0.65 &&
                (modeRef.current === "visual" ||
                  analyzedThrough > planRef.current!.duration + 0.62);
          if (done) {
            if (loop && modeRef.current !== "learn") {
              r.completed.push(...r.scorer.finish());
              r.extra += r.scorer.extraAttacks;
              r.cycles++;
              r.scorer = new EventScorer(
                planRef.current!.targets,
                "rhythm",
                offset,
              );
              r.start = ctx.currentTime + 4 * planRef.current!.countBeat;
              r.progress = 0;
              input.current?.reset(floor.current);
            } else {
              finishRef.current();
              return;
            }
          }
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [loop, offset, pause, phase]);
  async function start() {
    setError("");
    setNotice("");
    if (mode !== "visual" && (!input.current || !noiseReady)) return;
    let ctx = input.current?.context;
    if (mode === "visual") {
      disconnect();
      setConnected(false);
      try {
        visualClock.current = new AudioContext();
        await visualClock.current.resume();
        ctx = visualClock.current;
      } catch {
        setError("Audio clock could not start. Tap Start again.");
        return;
      }
    }
    if (!ctx) return;
    const resume = phase === "paused" && run.current;
    if (resume && resume.owner !== (getSession()?.user.id ?? null)) {
      setError("Finish this session before changing accounts.");
      return;
    }
    if (!resume)
      run.current = {
        scorer: new EventScorer(
          plan.targets,
          mode === "learn" ? "learn" : "rhythm",
          offset,
        ),
        start: 0,
        progress: 0,
        startDate: new Date().toISOString(),
        owner: getSession()?.user.id ?? null,
        seconds: 0,
        lastClock: ctx.currentTime,
        cycles: 0,
        completed: [],
        extra: 0,
      };
    const r = run.current!;
    // Resume at the same point with a fresh count-in. Old microphone generations are disposed.
    r.start =
      ctx.currentTime +
      (mode === "learn" ? 0.15 : 4 * plan.countBeat) -
      r.progress;
    r.lastClock = ctx.currentTime;
    input.current?.reset(floor.current);
    setPosition(-4 * plan.countBeat);
    setPhase("running");
    phaseRef.current = "running";
  }
  function reset(passage?: number) {
    disconnect();
    run.current = null;
    setConnected(false);
    setNoiseReady(false);
    setResults([]);
    setSaved("");
    setPosition(0);
    setNotice("");
    setError("");
    setPhase("setup");
    if (passage !== undefined) {
      setFirst(passage);
      setLast(passage);
    }
  }
  function restartPassage() {
    // Restarting discards the active partial session; no credit is carried over.
    reset();
    setNotice("Restart begins a new session. Choose Start when ready.");
  }
  function changePassage() {
    reset();
    setNotice("Changing passage or speed starts a new session; partial results are not saved.");
  }
  function previousVisualTarget() {
    if (mode !== "visual" || phase !== "paused" || !run.current) return;
    const r = run.current;
    const preceding = [...plan.targets].reverse().find(t => t.time < r.progress - .05);
    r.progress = preceding?.time ?? 0;
    r.scorer.index = Math.max(0, preceding ? plan.targets.findIndex(t => t.id === preceding.id) : 0);
    setPosition(r.progress);
  }
  const active = phase === "running" || phase === "paused";
  const guidedChords = plan.targets.filter(t => (t.kind === "chord" || t.kind === "muted") && !t.supported).length;
  const scoredPassageAllowed = scoring && plan.targets.length > 0 && plan.targets.every(t => t.supported);
  const current = plan.targets[run.current?.scorer.index ?? 0];
  const summary = summarize(results);
  const beatNumber =
    [...plan.beats].reverse().find((b) => b.time <= position)?.number ?? 1;
  const rhythmAllowed =
    scoredPassageAllowed && plan.rhythmSupported &&
    !song.measures.slice(first, last + 1).some(m => m.timingConfirmed === false) &&
    (!plan.needsTimingConfirmation || confirmed);
  const count =
    position < (run.current?.progress ?? 0) && phase === "running"
      ? Math.ceil(((run.current?.progress ?? 0) - position) / plan.countBeat)
      : 0;
  return (
    <section
      className={`immersive immersive-surface ${active ? "immersive-active" : ""}`}
      aria-label="Immersive practice"
    >
      {song.provenance?.audioReview?.noteTranscription && <p className="imm-caption" role="note">
        Audio tab: confirm every note in the selected passage. Pitch is scored; string and fret are suggestions.
        After changing the ordinary song chart, reopen the audio transcription and save corrections before scoring.
      </p>}
      <header className="imm-header">
        <Link
          className="button"
          to={`/song/${song.id}`}
          onClick={(event) => {
            if (active) {
              event.preventDefault();
              finish();
            } else disconnect();
          }}
        >
          <ArrowLeft size={18} /> Exit
        </Link>
        <div className="imm-heading">
          <span className="imm-heading-icon"><Guitar size={21} strokeWidth={1.7}/></span>
          <div><span className="imm-eyebrow">FRETSHIFT / IMMERSIVE PRACTICE{IMMERSIVE_BETA && <span className="imm-beta-chip">BETA</span>}</span><h1>{song.title}</h1><span className="imm-artist">{song.artist || "Your arrangement"}</span></div>
        </div>
        <button
          className="imm-fullscreen"
          onClick={() => {
            if (document.fullscreenElement)
              void document.exitFullscreen?.().catch(() => {});
            else {
              const el = document.querySelector<HTMLElement>(".immersive");
              if (el?.requestFullscreen)
                void el
                  .requestFullscreen()
                  .catch(() =>
                    setNotice(
                      "Fullscreen isn’t available. Rotate your device for a wider lane.",
                    ),
                  );
              else
                setNotice(
                  "Rotate your device for a wider lane; fullscreen isn’t available here.",
                );
            }
          }}
          aria-label="Fullscreen"
        >
          <Maximize2 size={20} />
        </button>
      </header>
      {error && mode !== "visual" && (
        <p role="alert" className="imm-notice">
          {error}
        </p>
      )}
      {notice && phase !== "results" && <p className="imm-notice">{notice}</p>}
      {phase === "setup" && <div className="imm-intro">
        <div className="imm-intro-emblem"><Guitar size={32} strokeWidth={1.5}/></div>
        <span className="imm-eyebrow">A NEW WAY TO GET INTO THE MUSIC</span>
        <h2>Step into the song<span className="imm-period">.</span></h2>
        <p>{song.artist || "Your arrangement"} · measures {first + 1}–{last + 1}</p>
      </div>}
      {phase === "results" ? (
        <div className="imm-results">
          <span className="eyebrow">A LITTLE BETTER, EVERY SESSION</span>
          <h2>Your practice, honestly.</h2>
          {mode === "visual" ? <div className="imm-stats" aria-label="Quiet visual practice summary">
            <div><strong>{Math.floor(visualReport.seconds / 60)}:{String(Math.round(visualReport.seconds % 60)).padStart(2,"0")}</strong><span>Time practiced · unscored</span></div>
            <div><strong>{visualReport.percent}%</strong><span>Passage progress · {visualReport.measures}/{last-first+1} measures passed</span></div>
          </div> : <><div className="imm-stats">
            <div>
              <strong>
                {summary.accuracy === null ? "—" : `${summary.accuracy}%`}
              </strong>
              <span>
                Pitch match · {summary.matched}/{summary.assessed} assessed
              </span>
            </div>
            <div>
              <strong>{summary.coverage}%</strong>
              <span>
                Assessed coverage · {summary.assessed}/{summary.total} targets
              </span>
            </div>
            <div>
              <strong>
                {mode === "rhythm" ? `${summary.onTime}/${summary.timed}` : "—"}
              </strong>
              <span>
                {mode === "rhythm"
                  ? "Detected attacks on time (±80 ms)"
                  : "Timing not scored"}
              </span>
            </div>
          </div>
          <p>
            {summary.wrong} wrong · {summary.missed} missed ·{" "}
            {summary.uncertain} uncertain · {summary.unsupported} unsupported ·{" "}
            {summary.skipped} skipped · {summary.unassessed} unassessed ·{" "}
            {extra} extra attacks
          </p>
          {summary.meanOffsetMs !== null && (
            <p>
              Mean signed timing offset: {summary.meanOffsetMs > 0 ? "+" : ""}
              {summary.meanOffsetMs} ms. Timing coverage: {summary.timed}/
              {summary.total} targets.
            </p>
          )}
          {mode === "rhythm" && (
            <p>
              Timing adjustment applied: {offset > 0 ? "+" : ""}
              {offset} ms ·{" "}
              {offsetSource === "calibrated"
                ? "measured on this device"
                : offsetSource === "manual"
                  ? "set manually"
                  : "not calibrated"}
              .
            </p>
          )}
          <p>
            Coverage shows how much could be assessed. Uncertain, skipped, and
            unsupported targets never earn a match.{" "}
            {COMPILE.chordScoring
              ? "Chords are judged by which written tones were heard; individual strings are not assessed."
              : "Chord completeness and individual strings are not assessed."}
          </p>
          {mode === "learn" && (
            <p>
              Learn results describe completed targets after retries; timing is
              not graded.
            </p>
          )}
          <h3>Give these measures another visit</h3>
          <div className="button-row">
            {summary.troublesome.length ? (
              summary.troublesome.map((m) => (
                <button
                  key={m}
                  disabled={!!pendingSave.current}
                  onClick={() => reset(m)}
                >
                  Measure {m + 1}
                </button>
              ))
            ) : (
              <p>No confidently identified trouble spots in this session.</p>
            )}
          </div>
          </>}
          <p role="status">{saved}</p>
          {pendingSave.current && (
            <button onClick={() => void save()}>Retry saving</button>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={!!pendingSave.current}
              onClick={() => reset()}
            >
              <Repeat2 size={18} /> Practice this passage again
            </button>
            <Link className="button" to="/progress">
              View progress
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="imm-status">
            {mode === "visual" ? <span>Quiet visual · follow your passage</span> : <span>
              <Mic size={16} />{" "}
              {connected
                ? noiseReady
                  ? "Microphone ready"
                  : "Checking room · keep strings still"
                : "Microphone off"}
            </span>}
            <span>
              <VolumeX size={16} /> Guide audio off
            </span>
            {phase === "running" && mode !== "learn" && (
              <span
                className="imm-beat"
                aria-label={`Visual beat ${beatNumber}`}
              >
                {count > 0 ? "Count in" : `● Beat ${beatNumber}`}
              </span>
            )}
            {active && loop && (
              <span>Pass {(run.current?.cycles ?? 0) + 1}</span>
            )}
            <span>
              {Math.round(song.tempo * speed)} BPM · {Math.round(speed * 100)}%
            </span>
          </div>
          {active && <>
          <div className="imm-progress" role="progressbar" aria-label="Passage progress" aria-valuemin={0} aria-valuemax={plan.targets.length} aria-valuenow={run.current?.scorer.index ?? 0}><span style={{ width: `${plan.targets.length ? Math.min(100, 100 * (run.current?.scorer.index ?? 0) / plan.targets.length) : 0}%`}} /></div>
          <Lane
            targets={plan.targets}
            current={run.current?.scorer.index ?? 0}
            results={mode === "visual" ? [] : run.current?.scorer.results ?? []}
            time={position}
            moving={mode !== "learn" && phase === "running"}
            leftHanded={settings.leftHanded}
            tuning={resolveTuning(song.tuningId).midi}
          />
          <div className="imm-cue">
            <div>
              <span className="eyebrow">
                {count > 0
                  ? "COUNT IN"
                  : current
                    ? `MEASURE ${current.measure + 1} · ${!current.supported ? "GUIDED · UNSCORED" : current.kind === "chord" ? "CHORD" : "SINGLE NOTE"}`
                    : "PASSAGE COMPLETE"}
              </span>
              <h2>
                {count > 0
                  ? Math.min(count, 4)
                  : (current?.label ?? "Nice work showing up.")}
              </h2>
              {current?.kind === "note" && (
                <p>
                  String {current.notes[0].string + 1} · fret{" "}
                  {current.notes[0].fret} · sounding {current.label}
                </p>
              )}
            </div>
            {mode !== "visual" && <p role="status" className="imm-feedback">
              {phase === "running"
                ? feedback
                : "Settle in. Take it one note at a time."}
            </p>}
          </div>
          </>}
          {active ? (
            <>
              <div className="imm-controls">
                {phase === "running" ? (
                  <button className="primary" onClick={() => pause()}>
                    <Pause size={20} /> Pause
                  </button>
                ) : (
                  <>
                    {mode !== "visual" && <button
                      disabled={connecting}
                      onClick={() => void connect()}
                    >
                      <Mic size={18} />
                      {connecting ? "Connecting…" : "Reconnect microphone"}
                    </button>}
                    <button
                      className="primary"
                      disabled={
                        mode !== "visual" && (!connected || !noiseReady)
                      }
                      onClick={() => void start()}
                    >
                      <Play size={18} /> Resume
                    </button>
                  </>
                )}
                {mode === "learn" && (
                  <button
                    disabled={phase !== "running"}
                    onClick={() => {
                      const r = run.current;
                      if (r && input.current)
                        r.scorer.skip(
                          input.current.context.currentTime - r.start,
                        );
                      redraw((n) => n + 1);
                    }}
                  >
                    Skip target →
                  </button>
                )}
                {phase === "paused" && <>
                  <button onClick={restartPassage}><Repeat2 size={17}/> Restart passage</button>
                  <button onClick={changePassage}>Change passage / speed</button>
                  {mode === "visual" && <button onClick={previousVisualTarget}><ArrowLeft size={17}/> Previous target</button>}
                </>}
                <button onClick={finish}>Finish{mode === "visual" ? " visual practice" : " & see results"}</button>
              </div>
              {mode !== "visual" && <div className="imm-legend" aria-label="Feedback legend"><span><i className="imm-key imm-key-hit"/> Matched</span><span><i className="imm-key imm-key-missed"/> Wrong or missed</span><span><i className="imm-key imm-key-uncertain"/> Uncertain</span></div>}
              <p className="imm-caption">
                {mode === "learn"
                  ? `Learn mode waits for a clear, fresh ${COMPILE.chordScoring ? "note or chord" : "note"}. Skip awards no credit; timing is not scored.`
                  : mode === "visual"
                    ? "Quiet visual practice: follow the lane at your pace. Pause for Restart, Previous target, or Change passage."
                    : "Follow the fixed play line. Early / late timing and pitch matches are assessed separately."}{" "}
                Changing the passage or speed starts a new session.
              </p>
            </>
          ) : (
            <div className="imm-setup">
              <div className="card imm-setup-card">
                <div className="imm-panel-title"><span className="imm-step">01</span><div><span className="imm-eyebrow">{song.title}</span><h2>Choose your flow.</h2></div></div>
                <div className="imm-modes">
                  {(["learn", "rhythm", "visual"] as const).map((m) => (
                    <button
                      key={m}
                      aria-pressed={mode === m}
                      disabled={m !== "visual" && !scoredPassageAllowed}
                      className={mode === m ? "selected" : ""}
                      onClick={() => {
                        if (m === "visual") { disconnect(); setConnected(false); setNoiseReady(false); setTuner(false); }
                        setMode(m);
                      }}
                    >
                      <strong>{m === "learn" ? "Learn" : m === "rhythm" ? "Rhythm" : "Quiet visual"}</strong>
                      <small>{m === "learn" ? "One clear target at a time. No timing grade." : m === "rhythm" ? "Follow the play line. Find the beat." : "No microphone. No performance grade."}</small>
                    </button>
                  ))}
                </div>
                <p>
                  {mode === "learn"
                    ? "Wait for a confident single-note match. Timing is not graded."
                    : mode === "rhythm"
                      ? "A visual count-in, written attacks, and separate timing feedback."
                      : "Follow the lane without a microphone. No performance scores."}
                </p>
                {guidedChords > 0 && <p role="status" className="imm-scope-warning">This passage contains {guidedChords} guided chord or muted targets; chord matching isn’t scored. Use Quiet visual practice here, or choose a single-note passage for Learn and Rhythm.</p>}
                {!guidedChords && !scoredPassageAllowed && <p role="status" className="imm-scope-warning">{scoring ? "This passage has no supported single-note targets (one sounding note, E2–E6). Use Quiet visual practice." : "Scoring is off for this song in this build. Use Quiet visual practice."}</p>}
                {!scoredPassageAllowed && passages.length > 0 && (
                  <div className="imm-passages" role="group" aria-label="Scored single-note passages">
                    <span>Scored single-note passages in this song</span>
                    {passages.map((p) => (
                      <button
                        key={p.first}
                        type="button"
                        onClick={() => {
                          setFirst(p.first);
                          setLast(p.last);
                          if (mode === "visual") setMode("learn");
                        }}
                      >
                        {p.first === p.last ? `Measure ${p.first + 1}` : `Measures ${p.first + 1}–${p.last + 1}`} · {p.notes} notes
                      </button>
                    ))}
                  </div>
                )}
                <div className="imm-fields">
                  <label>
                    From measure
                    <select
                      value={first}
                      onChange={(e) => {
                        const n = +e.target.value;
                        setFirst(n);
                        setLast((v) => Math.max(n, v));
                      }}
                    >
                      {song.measures.map((m, i) => (
                        <option key={m.id} value={i}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Through measure
                    <select
                      value={last}
                      onChange={(e) => setLast(+e.target.value)}
                    >
                      {song.measures.map(
                        (m, i) =>
                          i >= first && (
                            <option key={m.id} value={i}>
                              {i + 1}
                            </option>
                          ),
                      )}
                    </select>
                  </label>
                </div>
                <div className="imm-speed-row"><span>Playback speed</span><strong>{Math.round(speed * 100)}%</strong></div>
                <div className="imm-speed-options" role="group" aria-label="Playback speed">
                  {[0.25, 0.5, 0.6, 0.75, 1].map((s) => (
                    <button key={s} type="button" aria-pressed={speed === s} className={speed === s ? "selected" : ""} onClick={() => setSpeed(s)}>{Math.round(s * 100)}%</button>
                  ))}
                </div>
                {mode !== "learn" && (
                  <label className="imm-check">
                    <GlassSwitch
                      checked={loop}
                      onChange={(e) => setLoop(e.target.checked)}
                    />{" "}
                    Loop passage with a fresh count-in
                  </label>
                )}
                {mode === "rhythm" && plan.needsTimingConfirmation &&
                  !song.measures.slice(first,last+1).some(m => m.timingConfirmed === false) && (
                  <label className="imm-check">
                    <GlassSwitch
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{" "}
                    I reviewed the chart: the displayed positions represent the
                    attacks I intend to play.
                  </label>
                )}
                {mode === "rhythm" && song.measures.slice(first,last+1).some(m => m.timingConfirmed === false) && <p role="alert">Timing needs confirmation: review the chord positions in the import measure editor before rhythm practice. A simple checkbox cannot verify unknown attacks.</p>}
                {mode === "rhythm" && !plan.rhythmSupported && (
                  <p role="alert">
                    These attacks are too close for this detector. Choose a
                    slower speed (at least 320 ms between attacks) or Learn
                    mode.
                  </p>
                )}
              </div>
              {mode !== "visual" && <div className="card imm-setup-card">
                <div className="imm-panel-title"><span className="imm-step">02</span><div><span className="imm-eyebrow">LISTEN LOCALLY</span><h2>Get your guitar ready.</h2><p>A clean guitar and a quiet room are all you need.</p></div></div>
                <p>
                  Use a clean guitar in a quiet room. Connect, keep strings
                  still for one second, then play a note to check the level.
                </p>
                <div className="imm-level">
                  <span>Input level</span>
                  <meter
                    aria-label="Microphone input level"
                    min={0}
                    max={0.3}
                    value={evidence?.rms ?? 0}
                  />
                  <span>
                    {evidence && evidence.rms > 0.007 ? "Signal" : "Quiet"}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    onClick={() => void connect()}
                    disabled={connecting}
                  >
                    <Mic size={17} />
                    {connecting
                      ? "Waiting for permission…"
                      : connected
                        ? "Recheck microphone"
                        : "Connect microphone"}
                  </button>
                  <button
                    disabled={!connected}
                    aria-pressed={tuner}
                    onClick={() => setTuner((v) => !v)}
                  >
                    Tuner
                  </button>
                  {connecting && (
                    <button
                      onClick={() => {
                        disconnect();
                        setConnecting(false);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {tuner && (
                  <p className="imm-tuner" role="status">
                    {evidence?.midi
                      ? `${noteLabel(evidence.midi)} · ${Math.round(evidence.cents)} cents · A4 ${settings.a4Hz} Hz`
                      : "Play one open string and let it settle."}
                  </p>
                )}
                {IMMERSIVE_FEATURES.latencyCalibration.enabled && <ImmersiveCalibration
                  input={connected && noiseReady ? input.current : null}
                  ready={connected && noiseReady && phase === "setup"}
                  floor={floor.current}
                  sink={calibrationSink}
                  record={calibration}
                  onBusy={setCalibrating}
                  onSaved={applyCalibration}
                />}
                <details className="imm-advanced"><summary>Advanced · timing and technical details</summary><label>
                  Timing adjustment: {offset > 0 ? "+" : ""}
                  {offset} ms ·{" "}
                  {offsetSource === "calibrated"
                    ? "calibrated"
                    : offsetSource === "manual"
                      ? "manual override"
                      : "not calibrated"}
                  <input
                    aria-label="Timing adjustment"
                    type="range"
                    min={-200}
                    max={250}
                    step={1}
                    value={offset}
                    onChange={(e) => {
                      setOffset(+e.target.value);
                      setOffsetSource("manual");
                    }}
                  />
                </label>
                {calibration && offsetSource === "manual" && (
                  <button type="button" onClick={() => applyCalibration(calibration)}>
                    Use calibrated value ({calibration.offsetMs > 0 ? "+" : ""}
                    {calibration.offsetMs} ms)
                  </button>
                )}
                <p className="imm-caption">
                  Positive values subtract delay from detected attacks. The
                  default is the median measured by timing calibration for this
                  microphone; move the slider to override it for this session.
                  Calibration measures input delay against a cue; it does not
                  measure screen delay.
                </p></details>
              </div>}
              <div className="imm-start">
                <details className="imm-advanced"><summary>Technical details</summary><div>
                  <h3>Your guitar. Your focus.</h3>
                  <p>
                    Single notes E2–E6; clear attacks at moderate tempos. Chords
                    and muted targets are shown but unscored. A microphone hears
                    pitch, not which finger or string made it.
                  </p>
                  <ReleaseNotes />
                  <p>
                    Audio stays on this device. Scored mode has no accompaniment
                    or guide playback. Use headphones for any external
                    accompaniment; isolation cannot be verified automatically.
                  </p>
                </div></details>
                <button
                  className="primary"
                  disabled={
                    !plan.targets.length ||
                    (mode !== "visual" && !scoredPassageAllowed) ||
                    (mode !== "visual" && (!connected || !noiseReady)) ||
                    (mode === "rhythm" && !rhythmAllowed) ||
                    calibrating
                  }
                  onClick={() => void start()}
                >
                  <Play size={20} /> Start{" "}
                  {mode === "learn"
                    ? "learning"
                    : mode === "rhythm"
                      ? "rhythm practice"
                      : "visual practice"}
                </button>
                {!plan.targets.length && (
                  <p>
                    This passage has no written attacks. Choose another passage.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function Lane({
  targets,
  current,
  results,
  time,
  moving,
  leftHanded,
  tuning,
}: {
  targets: Target[];
  current: number;
  results: (Result | undefined)[];
  time: number;
  moving: boolean;
  leftHanded: boolean;
  tuning: number[];
}) {
  const reduced = useRef(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const visible = targets
    .map((t, i) => ({
      t,
      i,
      x:
        moving && !reduced.current
          ? 24 + (t.time - time) * 24
          : 24 + (i - current) * 18,
    }))
    .filter((v) => v.x > 5 && v.x < 108);
  return (
    <div
      className={`imm-lane ${leftHanded ? "imm-left" : ""}`}
      role="img"
      aria-label={`Six-string practice lane. ${targets[current] ? `Next: ${targets[current].label}, measure ${targets[current].measure + 1}.` : "End of passage."} String and fret numbers are chart instructions, not detected string correctness.`}
    >
      <div className="imm-lane-top">
        <span>THE NEXT FEW NOTES</span>
        <span>{leftHanded ? "Left-handed view" : "High E → low E"}</span>
      </div>
      <div className="imm-strings">
        {tuning.map((m, i) => (
          <div className="imm-string" key={i} style={{ top: `${i * 18 + 5}%` }}>
            <span>{noteLabel(m).replace(/\d/g, "")}</span>
          </div>
        ))}
        <div className="imm-playline">
          <span>PLAY</span>
        </div>
        {visible.map(({ t, i, x }) => (
          <div
            key={t.id}
            className={`imm-target ${t.kind} ${i === current ? "current" : ""} ${results[i]?.outcome ?? ""}`}
            style={{ left: `${x}%` }}
          >
            {t.kind !== "note" && (
              <span className="imm-chord-name">{t.label} ◇</span>
            )}
            {(t.notes.length
              ? t.notes
              : [{ string: 2, fret: "◇", midi: 0 }]
            ).map((n, j) => (
              <span
                key={j}
                className="imm-fret"
                style={{ top: `${n.string * 18 + 5}%` }}
              >
                {n.fret}
              </span>
            ))}
            {results[i] && (
              <span className="imm-target-result">
                {results[i]!.outcome === "hit"
                  ? "✓"
                  : results[i]!.outcome === "wrong"
                    ? "×"
                    : results[i]!.outcome === "missed"
                      ? "−"
                      : "◇"}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="imm-lane-bottom">
        <span>LISTEN. PLAY. REPEAT.</span>
        <span>
          {current + 1 > targets.length ? targets.length : current + 1} /{" "}
          {targets.length} targets
        </span>
      </div>
    </div>
  );
}
