import { StrummingPattern } from "../components/StrummingPattern";
import { useState, useRef, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Play,
  Square,
  Mic,
  Flag,
  Repeat2,
  Upload,
  Check,
  Headphones,
} from "lucide-react";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { usePracticeStore } from "../../store/practiceStore";
import { enableAudio } from "../../audio/context";
import { GuitarPlayer, clickAt } from "../../audio/playback";
import {
  practiceTimeline,
  TimelineQueue,
  type PracticeTimeline,
} from "../../audio/playback/timeline";
import { advanceRamp, aggregateHeat, isCleanPass } from "../../audio/practice";
import { playReference, prepareReference } from "../../audio/timestretch";
import { db, practiceRepo } from "../../persistence/dexie";
import { Notation } from "../components/Notation";
import { GlassSwitch } from "../components/MobileGlass";
import { PageTitle, Empty, ErrorNotice, useToast } from "../components/Common";
import { useMicrophone, TunerGauge, Fretboard } from "../components/AudioTools";
import { resolveTuning } from "../../schema/song.v1";
export function Practice() {
  const { id } = useParams();
  const [query] = useSearchParams();
  const library = useSongStore((s) => s.songs),
    all = library.filter((x) => !x.deletedAt),
    song = all.find((s) => s.id === id);
  const settings = useSettingsStore((s) => s.settings);
  const {
    tempoMultiplier,
    setMultiplier,
    loopStartMeasureId,
    loopEndMeasureId,
    setLoop,
  } = usePracticeStore();
  const [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [measure, setMeasure] = useState(0),
    [activeSlot, setActiveSlot] = useState(0),
    [loops, setLoops] = useState(0),
    [error, setError] = useState(""),
    [autoScroll, setAutoScroll] = useState(true),
    [ramp, setRamp] = useState(false),
    [step, setStep] = useState(5),
    [target, setTarget] = useState(120),
    [heat, setHeat] = useState<Record<string, number>>({}),
    [reference, setReference] = useState(false),
    [offset, setOffset] = useState(0),
    [sourceTempo, setSourceTempo] = useState(song?.tempo ?? 120);
  const worker = useRef<Worker | null>(null),
    player = useRef<GuitarPlayer | null>(null),
    referenceStops = useRef(new Set<() => void>()),
    referenceAbort = useRef<AbortController | null>(null),
    raf = useRef(0),
    generation = useRef(0),
    mounted = useRef(true),
    timeline = useRef<TimelineQueue | null>(null),
    session = useRef<{
      songId: string;
      startedAt: string;
      performanceStart: number;
      max: number;
    } | null>(null),
    loopCount = useRef(0),
    evidence = useRef(
      new Map<number, { offsets: number[]; pitches: boolean[] }>(),
    ),
    currentMeasure = useRef(0),
    cleanTracker = useRef({ rewound: false }),
    lastPitchHeat = useRef(0),
    heatQueue = useRef(Promise.resolve());
  const toast = useToast();
  const live = useRef({ autoScroll, ramp, step, target });
  live.current = { autoScroll, ramp, step, target };
  const timingScorable = song?.provenance?.source !== "audio" ||
    (song.provenance.audioReview?.reviewed.timingConfirmed === true &&
      song.provenance.timingNeedsConfirmation !== true &&
      song.measures.every((measure) => measure.timingConfirmed === true));
  async function mark(
    index = measure,
    reason: {
      marked?: boolean;
      repeats?: number;
      offsetMs?: number;
      stops?: number;
      rewinds?: number;
      offPitch?: number;
    } = { marked: true },
  ) {
    if (!song?.measures[index]) return;
    const songId = song.id,
      measureId = song.measures[index].id;
    heatQueue.current = heatQueue.current.then(async () => {
      const previous = await db.heat.get([
        songId,
        measureId,
      ] as unknown as string);
      const score = aggregateHeat(previous?.score ?? 0, reason);
      await practiceRepo.saveHeat({
        songId,
        measureId,
        score,
        updatedAt: new Date().toISOString(),
      });
      if (mounted.current) setHeat((h) => ({ ...h, [measureId]: score }));
    });
    return heatQueue.current;
  }
  const mic = useMicrophone((frame) => {
    const q = timeline.current;
    // This room emits guide notes/clicks. Audio-note performance belongs in silent Immersive mode.
    if (!running || !q || frame.time < q.start || song?.provenance?.audioReview?.noteTranscription) return;
    const cycle = q.position(frame.time).cycle;
    const bucket = evidence.current.get(cycle) ?? { offsets: [], pitches: [] };
    evidence.current.set(cycle, bucket);
    const ms = q.nearestBeatOffset(frame.time);
    if (frame.onset && ms !== null && timingScorable) {
      bucket.offsets.push(ms);
      void mark(currentMeasure.current, { offsetMs: ms }).catch((e) =>
        setError(String(e)),
      );
    }
    const expected = q.activePitches(frame.time);
    if (
      expected.length === 1 &&
      !["detecting", "no signal"].includes(frame.pitch.state)
    ) {
      const correct =
        expected[0] === frame.pitch.midi && Math.abs(frame.pitch.cents) <= 40;
      bucket.pitches.push(correct);
      if (!correct && frame.time - lastPitchHeat.current > 0.5) {
        lastPitchHeat.current = frame.time;
        void mark(currentMeasure.current, { offPitch: 1 }).catch((e) =>
          setError(String(e)),
        );
      }
    }
  });
  const stop = () => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    player.current?.dispose();
    player.current = null;
    referenceStops.current.forEach((fn) => fn());
    referenceStops.current.clear();
    referenceAbort.current?.abort();
    referenceAbort.current = null;
    cancelAnimationFrame(raf.current);
    timeline.current = null;
    if (mounted.current) {
      setRunning(false);
      setStarting(false);
    }
    const saved = session.current;
    session.current = null;
    if (saved) {
      const durationSec = Math.round(
        (performance.now() - saved.performanceStart) / 1000,
      );
      if (durationSec > 0)
        practiceRepo
          .saveSession({
            id: crypto.randomUUID(),
            songId: saved.songId,
            startedAt: saved.startedAt,
            durationSec,
            tempoMultiplierMax: saved.max,
            loopCount: loopCount.current,
          })
          .catch((e) => {
            if (mounted.current)
              setError(`Practice session was not saved: ${String(e)}`);
            else console.error("Practice save failed", e);
          });
    }
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    mounted.current = true;
    setRunning(false);
    setStarting(false);
    setMeasure(0);
    setActiveSlot(0);
    return () => {
      mounted.current = false;
      stopRef.current();
    };
  }, [id]);
  useEffect(() => {
    if (!song) return;
    setOffset(song.referenceAudio?.offsetMs ?? 0);
    setSourceTempo(song.referenceAudio?.sourceTempo ?? song.tempo);
    practiceRepo
      .heatmap()
      .then((entries) => {
        if (mounted.current)
          setHeat(
            Object.fromEntries(
              entries
                .filter((e) => e.songId === song.id)
                .map((e) => [e.measureId, e.score]),
            ),
          );
      })
      .catch((e) => setError(String(e)));
  }, [song]);
  useEffect(() => {
    const measureId = query.get("measure");
    if (song?.measures.some((m) => m.id === measureId))
      setLoop(measureId, measureId);
  }, [id, query, song, setLoop]);
  async function start() {
    if (!song || starting || running) return;
    const token = ++generation.current;
    setStarting(true);
    let p: GuitarPlayer | undefined;
    try {
      const ctx = await enableAudio();
      p = new GuitarPlayer();
      await p.enable();
      if (token !== generation.current) {
        p.dispose();
        return;
      }
      player.current = p;
      let multiplier = tempoMultiplier;
      const startIndex = Math.max(
        0,
        song.measures.findIndex((m) => m.id === loopStartMeasureId),
      );
      let endIndex = song.measures.findIndex((m) => m.id === loopEndMeasureId);
      if (endIndex < startIndex) endIndex = song.measures.length - 1;
      let plan = practiceTimeline(song, multiplier, startIndex, endIndex);
      if (!plan.duration)
        throw new Error("Add a measure before starting practice.");
      let buffer: AudioBuffer | undefined;
      const prepared = new Map<number, AudioBuffer>();
      referenceAbort.current = new AbortController();
      if (reference) {
        if (!Number.isFinite(sourceTempo) || sourceTempo < 20)
          throw new Error("Confirm a valid recording tempo before playback.");
        const local = await db.blobs.get(song.id);
        if (!local) throw new Error("Attach a reference recording first.");
        buffer = await ctx.decodeAudioData(await local.blob.arrayBuffer());
      }
      if (token !== generation.current) {
        p.dispose();
        return;
      }
      const first = song.measures[startIndex];
      const prepare = async (speed: number) => {
        if (!buffer || prepared.has(speed)) return;
        const region = practiceTimeline(song, speed, startIndex, endIndex);
        let sourceOffset =
          offset / 1000 + (region.sourceQuarterOffset * 60) / sourceTempo;
        const segments = song.measures
          .slice(startIndex, endIndex + 1)
          .map((m) => {
            const [n, d] = m.timeSignature ?? song.timeSignature;
            const sourceDuration = (((n * 4) / d) * 60) / sourceTempo;
            const segment = {
              offset: sourceOffset,
              sourceDuration,
              rate: ((m.tempoOverride ?? song.tempo) * speed) / sourceTempo,
            };
            sourceOffset += sourceDuration;
            return segment;
          });
        prepared.set(
          speed,
          await prepareReference(
            ctx,
            buffer,
            segments,
            referenceAbort.current?.signal,
          ),
        );
      };
      await prepare(multiplier);
      if (token !== generation.current) return;
      const beatDuration =
          ((60 / (first.tempoOverride ?? song.tempo) / multiplier) * 4) /
          (first.timeSignature ?? song.timeSignature)[1],
        countBeats =
          settings.metronome.countIn *
          (first.timeSignature ?? song.timeSignature)[0],
        at = ctx.currentTime + 0.2,
        startAt = at + countBeats * beatDuration;
      for (let i = 0; i < countBeats; i++)
        clickAt(
          ctx,
          at + i * beatDuration,
          i % (first.timeSignature ?? song.timeSignature)[0] === 0,
          settings.metronome.sound,
        );
      const startRecording = (
        base: number,
        _region: PracticeTimeline,
        speed: number,
      ) => {
        if (!buffer) return;
        const rendered = prepared.get(speed);
        if (!rendered)
          throw new Error(
            "The next reference speed is still preparing. Restart the pass.",
          );
        const dispose = playReference(ctx, rendered, base, () =>
          referenceStops.current.delete(dispose),
        );
        referenceStops.current.add(dispose);
      };
      const withSubdivisions = (region: PracticeTimeline) =>
        settings.metronome.subdivisionClicks
          ? {
              ...region,
              clicks: region.positions.map((pos) => ({
                ...pos,
                accent: pos.slot === 0,
              })),
            }
          : region;
      plan = withSubdivisions(plan);
      const q = new TimelineQueue(
        plan,
        startAt,
        !!(loopStartMeasureId || loopEndMeasureId),
      );
      timeline.current = q;
      startRecording(startAt, plan, multiplier);
      evidence.current.clear();
      cleanTracker.current.rewound = false;
      loopCount.current = 0;
      setLoops(0);
      session.current = {
        songId: song.id,
        startedAt: new Date().toISOString(),
        performanceStart: performance.now(),
        max: multiplier,
      };
      const guitar = p;
      let confirmedCycle = 0,
        nextMultiplier = multiplier,
        preparingRamp = false;
      const plans = new Map<
        number,
        { plan: PracticeTimeline; multiplier: number }
      >([[0, { plan, multiplier }]]);
      const w = new Worker(
        new URL("../../audio/metronome/timer.worker.ts", import.meta.url),
        { type: "module" },
      );
      w.onmessage = () => {
        if (token !== generation.current) return;
        try {
          const actual = q.position(ctx.currentTime);
          if (actual.cycle > confirmedCycle) {
            for (let c = confirmedCycle; c < actual.cycle; c++) {
              const completed = plans.get(c)!;
              const bucket = evidence.current.get(c) ?? {
                offsets: [],
                pitches: [],
              };
              const monophonic = completed.plan.positions.some((pos) => {
                const notes = completed.plan.events.filter(
                  (e) =>
                    !e.muted &&
                    e.time <= pos.time &&
                    e.time + e.duration > pos.time,
                );
                return notes.length === 1;
              });
              const clean = isCleanPass({
                stopped: false,
                rewound: cleanTracker.current.rewound,
                onsetOffsets: bucket.offsets,
                monophonic,
                pitchAccuracy: bucket.pitches.length
                  ? bucket.pitches.filter(Boolean).length /
                    bucket.pitches.length
                  : 0,
              });
              if (live.current.ramp && clean && !preparingRamp) {
                const proposed =
                  advanceRamp(
                    song.tempo * nextMultiplier,
                    live.current.step,
                    live.current.target,
                    true,
                  ) / song.tempo;
                if (buffer && proposed !== nextMultiplier) {
                  preparingRamp = true;
                  void prepare(proposed)
                    .then(() => {
                      if (token === generation.current)
                        nextMultiplier = proposed;
                    })
                    .catch((e) => {
                      if (token === generation.current) {
                        stopRef.current();
                        setError(String(e));
                      }
                    })
                    .finally(() => {
                      preparingRamp = false;
                    });
                } else nextMultiplier = proposed;
              }
              evidence.current.delete(c);
              plans.delete(c);
            }
            confirmedCycle = actual.cycle;
            loopCount.current = actual.cycle;
            setLoops(actual.cycle);
            const activeSpeed = plans.get(actual.cycle)!.multiplier;
            setMultiplier(activeSpeed);
            if (session.current)
              session.current.max = Math.max(session.current.max, activeSpeed);
            void mark(endIndex, { repeats: 1 }).catch((e) =>
              setError(String(e)),
            );
            cleanTracker.current.rewound = false;
          }
          q.tick(
            ctx.currentTime,
            (event, time) => {
              if (time < ctx.currentTime - 0.05)
                throw new Error(
                  "Audio scheduling was interrupted. Restart this pass.",
                );
              guitar.play(
                event,
                Math.max(ctx.currentTime + 0.002, time),
                settings.a4Hz,
              );
            },
            (time, accent) =>
              clickAt(
                ctx,
                Math.max(ctx.currentTime + 0.002, time),
                settings.metronome.accentDownbeat && accent,
                settings.metronome.sound,
              ),
            (cycle, base) => {
              multiplier = nextMultiplier;
              const next = withSubdivisions(
                practiceTimeline(song, multiplier, startIndex, endIndex),
              );
              plans.set(cycle, { plan: next, multiplier });
              startRecording(base, next, multiplier);
              return next;
            },
          );
          if (!q.loop && ctx.currentTime >= q.start + q.timeline.duration)
            stopRef.current();
        } catch (e) {
          stopRef.current();
          setError(String(e));
        }
      };
      worker.current = w;
      w.postMessage("start");
      setStarting(false);
      setRunning(true);
      setError("");
      const animate = () => {
        if (token !== generation.current) return;
        const pos = q.position(ctx.currentTime);
        setActiveSlot(pos.slot);
        if (pos.measure !== currentMeasure.current) {
          currentMeasure.current = pos.measure;
          setMeasure(pos.measure);
          if (live.current.autoScroll)
            document
              .getElementById(`measure-${song.measures[pos.measure].id}`)
              ?.scrollIntoView({
                behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "auto"
                  : "smooth",
                block: "center",
              });
        }
        raf.current = requestAnimationFrame(animate);
      };
      animate();
    } catch (e) {
      if (token !== generation.current) {
        p?.dispose();
        return;
      }
      stop();
      if (mounted.current) setError(String(e));
    }
  }
  if (!song)
    return (
      <>
        <PageTitle
          eyebrow="A LITTLE EVERY DAY"
          title="Time to play"
          description="Choose a song and meet yourself where you are."
        />
        <div className="practice-hub">
          <Link className="card" to="/tools">
            <Headphones size={26} />
            <h2>Tune up & find a tempo</h2>
            <p>A calm start to a good session.</p>
          </Link>
          <Link className="card" to="/drills">
            <Repeat2 size={26} />
            <h2>Small moves. Big progress.</h2>
            <p>Chord changes and strum timing drills.</p>
          </Link>
        </div>
        <div className="song-grid">
          {all.map((s) => (
            <Link
              className="card practice-choice"
              to={`/practice/${s.id}`}
              key={s.id}
            >
              <h2>{s.title}</h2>
              <p>
                {s.currentKey.root}
                {s.currentKey.mode === "minor" ? "m" : ""} · {s.tempo} BPM
              </p>
              <span className="accent-text">Start a session →</span>
            </Link>
          ))}
          {!all.length && (
            <Empty title="Your next session starts with a song">
              <Link to="/import">Import your first chart</Link>
            </Empty>
          )}
        </div>
      </>
    );
  return (
    <>
      <PageTitle
        eyebrow="STAY WITH THE MUSIC"
        title={song.title}
        description={`Practice · ${Math.round(song.tempo * tempoMultiplier)} BPM · ${loops} loops`}
        action={
          <Link to={`/song/${song.id}`} className="button">
            Back to chart
          </Link>
        }
      />
      <ErrorNotice error={error} />
      {song.provenance?.source === "audio" && !timingScorable && <p role="alert" className="card">
        Timing needs confirmation. Practice playback is available, but microphone attacks will not receive rhythm timing scores until the audio timeline is confirmed.
      </p>}
      <div className="button-row" style={{ marginBottom: 16 }}><Link className="primary" to={`/immersive/${song.id}`}>Immersive practice</Link><span>Focus on the selected passage, one attack at a time.</span></div>
      <div className="practice-controls card">
        <div className="button-row">
          <button
            className="primary"
            disabled={starting}
            onClick={() => {
              if (running) {
                void mark(currentMeasure.current, { stops: 1 }).catch((e) =>
                  setError(String(e)),
                );
                stop();
              } else void start();
            }}
          >
            {running ? <Square size={17} /> : <Play size={17} />}{" "}
            {starting
              ? "Preparing audio…"
              : running
                ? "Stop & save session"
                : "Play / enable audio"}
          </button>
          <button
            className={mic.enabled ? "selected" : ""}
            onClick={() => void mic.toggle()}
          >
            <Mic size={17} />
            {mic.enabled ? "Stop microphone" : "Live pitch"}
          </button>
          <button onClick={() => void mark().catch((e) => setError(String(e)))}>
            <Flag size={17} />
            Mark this spot
          </button>
          <label className="inline-check">
            <GlassSwitch
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>
        <div className="form-row">
          <label>
            Speed · {Math.round(tempoMultiplier * 100)}%
            <input
              type="range"
              min=".4"
              max="1.5"
              step=".05"
              value={tempoMultiplier}
              disabled={running}
              onChange={(e) => setMultiplier(Number(e.target.value))}
            />
          </label>
          <label>
            Loop start
            <select
              value={loopStartMeasureId ?? ""}
              disabled={running}
              onChange={(e) =>
                setLoop(e.target.value || null, loopEndMeasureId)
              }
            >
              <option value="">Whole song</option>
              {song.measures.map((m, i) => (
                <option key={m.id} value={m.id}>
                  Measure {i + 1}
                  {m.section ? " · " + (m.section.label ?? m.section.kind) : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Loop end
            <select
              value={loopEndMeasureId ?? ""}
              disabled={running}
              onChange={(e) =>
                setLoop(loopStartMeasureId, e.target.value || null)
              }
            >
              <option value="">Song end</option>
              {song.measures.map((m, i) => (
                <option key={m.id} value={m.id}>
                  Measure {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="loop-editor">
          <label>
            Loop a section
            <select
              aria-label="Loop a section"
              defaultValue=""
              disabled={running}
              onChange={(e) => {
                const i = Number(e.target.value);
                if (e.target.value === "") return;
                const next = song.measures.findIndex(
                  (m, index) => index > i && m.section,
                );
                setLoop(
                  song.measures[i].id,
                  song.measures[next < 0 ? song.measures.length - 1 : next - 1]
                    .id,
                );
              }}
            >
              <option value="">Choose a section</option>
              {song.measures.map((m, i) =>
                m.section ? (
                  <option key={m.id} value={i}>
                    {m.section.label ?? m.section.kind}
                  </option>
                ) : null,
              )}
            </select>
          </label>
          <label>
            Start bracket
            <input
              aria-label="Loop start bracket"
              type="range"
              min="0"
              max={song.measures.length - 1}
              value={Math.max(
                0,
                song.measures.findIndex((m) => m.id === loopStartMeasureId),
              )}
              disabled={running}
              onChange={(e) => {
                const i = Number(e.target.value),
                  end = song.measures.findIndex(
                    (m) => m.id === loopEndMeasureId,
                  );
                setLoop(
                  song.measures[i].id,
                  end >= 0 && end < i ? song.measures[i].id : loopEndMeasureId,
                );
              }}
            />
          </label>
          <label>
            End bracket
            <input
              aria-label="Loop end bracket"
              type="range"
              min="0"
              max={song.measures.length - 1}
              value={
                loopEndMeasureId
                  ? song.measures.findIndex((m) => m.id === loopEndMeasureId)
                  : song.measures.length - 1
              }
              disabled={running}
              onChange={(e) => {
                const i = Number(e.target.value),
                  start = song.measures.findIndex(
                    (m) => m.id === loopStartMeasureId,
                  );
                setLoop(
                  start > i ? song.measures[i].id : loopStartMeasureId,
                  song.measures[i].id,
                );
              }}
            />
          </label>
          <div
            className="practice-pulse"
            aria-label={`Beat ${Math.floor(activeSlot / (song.measures[measure]?.subdivision ?? 2)) + 1}`}
          >
            <strong>
              {Math.floor(
                activeSlot / (song.measures[measure]?.subdivision ?? 2),
              ) + 1}
            </strong>
            <span>BEAT</span>
          </div>
        </div>
        <div className="ramp-row">
          <label className="inline-check">
            <GlassSwitch
              checked={ramp}
              onChange={(e) => setRamp(e.target.checked)}
            />
            Tempo ramp
          </label>
          <label>
            Step BPM
            <input
              type="number"
              min="1"
              max="20"
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
            />
          </label>
          <label>
            Target BPM
            <input
              type="number"
              min="20"
              max="400"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </label>
          <button
            disabled={running}
            onClick={() => {
              setMultiplier(
                advanceRamp(song.tempo * tempoMultiplier, step, target, true) /
                  song.tempo,
              );
              toast("Nice pass. Tempo advanced for your next play.");
            }}
          >
            <Check size={16} />
            That was clean
          </button>
          <progress
            max={target}
            value={song.tempo * tempoMultiplier}
            aria-label="Tempo ramp progress"
          />
        </div>
        <p className="small muted">
          Automatic clean passes need microphone timing evidence; single-note
          passages also need pitch evidence. After a full clean pass, a ramp
          applies to the next loop that has not already been scheduled. You can
          also advance manually.
        </p>
      </div>
      {song.provenance?.audioReview?.noteTranscription && <p className="small muted" role="note">
        Guided playback is unscored for this transcription. Use Immersive Practice for single-note performance feedback without guide audio.
      </p>}
      {mic.enabled && (
        <div className="card live-pitch">
          <TunerGauge enabled pitch={mic.pitch} />
          <Fretboard tuning={resolveTuning(song.tuningId)} pitch={mic.pitch} />
          <p className="small muted">
            Single-note detection only. During chords, follow the written
            voicing.
          </p>
        </div>
      )}
      <ErrorNotice error={mic.error} />
      <div className="card score-card">
        <Notation
          song={song}
          view="combined"
          activeMeasure={running ? measure : undefined}
          activeSlot={running ? activeSlot : undefined}
          activePitch={
            mic.enabled && !["no signal", "detecting"].includes(mic.pitch.state)
              ? mic.pitch.midi
              : undefined
          }
          heat={heat}
          onMeasureClick={(i) => {
            if (running) {
              cleanTracker.current.rewound = true;
              void mark(i, { rewinds: 1 }).catch((e) => setError(String(e)));
              stop();
            }
            setMeasure(i);
            setLoop(song.measures[i].id, song.measures[i].id);
            toast(`Loop set to measure ${i + 1}.`);
          }}
        />
      </div>
      <StrummingPattern key={song.id} song={song} practiceRunning={running || starting} />
      <section className="card reference-card">
        <div className="section-title">
          <h2>Play alongside a recording</h2>
          <label className="button file-button">
            <Upload size={17} />
            Attach local audio
            <input
              type="file"
              accept="audio/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await db.blobs.put({ id: song.id, blob: f });
                  useSongStore.getState().edit(song.id, (s) => {
                    s.referenceAudio = {
                      fileName: f.name,
                      offsetMs: offset,
                      sourceTempo,
                    };
                  });
                  toast(
                    "Recording saved on this device. Confirm its tempo and offset.",
                  );
                } catch (err) {
                  setError(String(err));
                }
              }}
            />
          </label>
        </div>
        <p>
          {song.referenceAudio?.fileName ??
            "A local recording can join your practice session. Audio never uploads."}
        </p>
        <div className="form-row">
          <label>
            Recording tempo
            <input
              type="number"
              min="20"
              max="400"
              value={sourceTempo}
              disabled={running}
              onChange={(e) => setSourceTempo(Number(e.target.value))}
              onBlur={() => {
                if (song.referenceAudio)
                  useSongStore.getState().edit(song.id, (s) => {
                    s.referenceAudio!.sourceTempo = sourceTempo;
                  });
              }}
            />
          </label>
          <label>
            Start offset (ms)
            <input
              type="number"
              value={offset}
              disabled={running}
              onChange={(e) => setOffset(Number(e.target.value))}
              onBlur={() => {
                if (song.referenceAudio)
                  useSongStore.getState().edit(song.id, (s) => {
                    s.referenceAudio!.offsetMs = offset;
                  });
              }}
            />
          </label>
          <label className="inline-check">
            <GlassSwitch
              checked={reference}
              disabled={running || !song.referenceAudio}
              onChange={(e) => setReference(e.target.checked)}
            />
            Play reference with notation
          </label>
        </div>
        <p className="small muted">
          Pitch stays the same as speed changes. The reference is prepared
          locally and follows loops and measure tempo changes. Extreme tempo
          differences outside 0.1×–8× need a different recording tempo.
        </p>
      </section>
    </>
  );
}
