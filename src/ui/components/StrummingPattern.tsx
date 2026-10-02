import { GlassSwitch } from "./MobileGlass";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music2, Play, Pause, RotateCcw, Save, RefreshCw } from "lucide-react";
import type { Song } from "../../schema/song.v1";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import {
  analyzeSong,
  beatLabel,
  editEvent,
  ensureRecommendations,
  fingerprint,
} from "../../strumming/engine";
import {
  emptyStrummingState,
  type InputSettings,
  type Pattern,
  type Stroke,
} from "../../strumming/schema";
import { StrumPlayer } from "../../strumming/playback";
import { ErrorNotice } from "./Common";
import "../strumming.css";

const symbols: Record<Stroke, string> = {
  down: "↓",
  up: "↑",
  mute: "×",
  rest: "—",
};
export function StrummingPattern({
  song,
  practiceRunning = false,
}: {
  song: Song;
  practiceRunning?: boolean;
}) {
  const [measureId, setMeasureId] = useState(song.measures[0]?.id ?? "song");
  const contextId = song.measures.some((m) => m.id === measureId)
    ? measureId
    : (song.measures[0]?.id ?? "song");
  return (
    <section className="card strumming-card" aria-label="Strumming pattern">
      <div className="strumming-heading">
        <div>
          <span className="strumming-eyebrow">
            <Music2 size={15} /> LOCAL RHYTHM STUDIO
          </span>
          <h2>Strumming pattern</h2>
        </div>
        <span className="strumming-badge">Offline ready</span>
      </div>
      <p className="small">
        Suggested guitar arrangements, not verified transcriptions of the
        recording.
      </p>
      <label className="strumming-context">
        Arrange a measure / section
        <select
          value={contextId}
          onChange={(e) => setMeasureId(e.target.value)}
        >
          {!song.measures.length && <option value="song">Whole song</option>}
          {song.measures.map((m, i) => (
            <option key={m.id} value={m.id}>
              Measure {i + 1}
              {m.section ? ` · ${m.section.label ?? m.section.kind}` : ""}
            </option>
          ))}
        </select>
      </label>
      <PatternEditor
        key={`${song.id}:${contextId}`}
        song={song}
        contextId={contextId}
        practiceRunning={practiceRunning}
      />
    </section>
  );
}
function PatternEditor({
  song,
  contextId,
  practiceRunning,
}: {
  song: Song;
  contextId: string;
  practiceRunning: boolean;
}) {
  const edit = useSongStore((s) => s.edit),
    saveState = useSongStore((s) => s.saveState);
  const metronome = useSettingsStore((s) => s.settings.metronome);
  const state = song.strumming ?? emptyStrummingState();
  const analysis = analyzeSong(song, contextId, state.inputs);
  const key = fingerprint(song, contextId, state.inputs);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Pattern | null>(null);
  const [eventIndex, setEventIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(-1);
  const [loop, setLoop] = useState(true);
  const [click, setClick] = useState(true);
  const [speed, setSpeed] = useState(100);
  const [name, setName] = useState("My variation");
  const [status, setStatus] = useState("");
  const player = useRef<StrumPlayer | null>(null);
  const stop = useCallback(() => {
    player.current?.stop();
    setRunning(false);
    setActive(-1);
  }, []);
  const cached = state.contexts[contextId];
  const resolved = useMemo(() => {
    try {
      return { state: ensureRecommendations(song, contextId), error: "" };
    } catch (e) {
      return {
        state: song.strumming ?? emptyStrummingState(),
        error: String(e),
      };
    }
    // The fingerprint contains every analysis input; unrelated song edits do not regenerate.
  }, [song, contextId]);
  useEffect(() => {
    if (resolved.state !== song.strumming && !resolved.error)
      edit(song.id, (s) => {
        s.strumming = resolved.state;
      });
  }, [resolved, song.id, song.strumming, edit]);
  const context = resolved.state.contexts[contextId];
  const custom = state.customs.find((c) => c.id === context?.selectedId);
  const recommendation =
    context?.recommendations.find((r) => r.pattern.id === context.selectedId) ??
    context?.recommendations[1];
  const selected = custom?.pattern ?? recommendation?.pattern;
  const pattern = draft ?? selected;
  const sourceFingerprint = useRef(key);
  const staleCustom = custom && custom.fingerprint !== key;
  const mismatch =
    pattern && pattern.meter.join("/") !== analysis.meter.join("/");
  const bpm = Math.round(((custom?.tempo ?? analysis.bpm) * speed) / 100);
  const playbackAllowed = bpm >= 20 && bpm <= 400 && !mismatch;
  useEffect(() => {
    stop();
  }, [key, speed, loop, click, pattern, stop, practiceRunning]);
  useEffect(
    () => () => {
      player.current?.stop();
    },
    [],
  );
  function inputs(patch: Partial<InputSettings>) {
    stop();
    setError("");
    edit(song.id, (s) => {
      s.strumming ??= emptyStrummingState();
      s.strumming.inputs = { ...s.strumming.inputs, ...patch };
    });
  }
  function choose(id: string) {
    stop();
    setDraft(null);
    setEventIndex(0);
    setStatus("");
    setSpeed(100);
    sourceFingerprint.current = key;
    edit(song.id, (s) => {
      s.strumming ??= resolved.state;
      const c = s.strumming.contexts[contextId];
      if (c) c.selectedId = id;
    });
  }
  function change(patch: { stroke?: Stroke; accent?: number }) {
    if (!pattern) return;
    if (!draft) sourceFingerprint.current = custom?.fingerprint ?? key;
    setDraft(
      editEvent(
        pattern,
        Math.min(eventIndex, pattern.events.length - 1),
        patch,
      ),
    );
    setStatus("Unsaved variation · changing selection discards these edits.");
  }
  function save() {
    if (!pattern || !name.trim()) return;
    const id = crypto.randomUUID();
    edit(song.id, (s) => {
      s.strumming ??= resolved.state;
      s.strumming.customs.push({
        id,
        contextId,
        sourceId: custom?.sourceId ?? recommendation?.pattern.id ?? pattern.id,
        fingerprint: draft
          ? sourceFingerprint.current
          : (custom?.fingerprint ?? key),
        tempo: Math.max(20, Math.min(400, bpm)),
        pattern: { ...pattern, id, name: name.trim() },
        savedAt: new Date().toISOString(),
      });
      const c = s.strumming.contexts[contextId];
      if (c) c.selectedId = id;
    });
    setDraft(null);
    setSpeed(100);
    setStatus("Variation saved with this song.");
  }
  async function play() {
    if (running) {
      stop();
      return;
    }
    if (!pattern || !playbackAllowed) return;
    setError("");
    setRunning(true);
    player.current ??= new StrumPlayer();
    await player.current.start(pattern, bpm, {
      loop,
      click,
      sound: metronome.sound,
      onPosition: setActive,
      onStop: () => {
        setRunning(false);
        setActive(-1);
      },
      onError: setError,
    });
  }
  return (
    <>
      <details className="strumming-inputs">
        <summary>Musical inputs & assumptions</summary>
        <div className="strumming-fields">
          <label>
            Practice BPM (quarter note)
            <input
              type="number"
              min="20"
              max="400"
              key={analysis.bpm}
              defaultValue={analysis.bpm}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 20 && n <= 400)
                  inputs({ tempo: n });
                else {
                  e.target.value = String(analysis.bpm);
                  setError("Choose a tempo between 20 and 400 BPM.");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
          <label>
            Practice meter
            <select
              value={analysis.meter.join("/")}
              onChange={(e) =>
                inputs({
                  meter: e.target.value
                    .split("/")
                    .map(Number) as Pattern["meter"],
                })
              }
            >
              {[
                ...new Set([
                  analysis.meter.join("/"),
                  "4/4",
                  "3/4",
                  "6/8",
                  "2/4",
                  "5/4",
                  "7/8",
                  "9/8",
                  "12/8",
                  "2/2",
                ]),
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Style
            <select
              value={state.inputs.style ?? "auto"}
              onChange={(e) =>
                inputs({ style: e.target.value as InputSettings["style"] })
              }
            >
              {[
                "auto",
                "pop",
                "folk",
                "rock",
                "country",
                "worship",
                "blues",
                "funk",
                "ballad",
              ].map((s) => (
                <option value={s} key={s}>
                  {s === "auto" ? "Use explicit song tags" : s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Playing level
            <select
              value={state.inputs.difficulty ?? "intermediate"}
              onChange={(e) =>
                inputs({
                  difficulty: e.target.value as InputSettings["difficulty"],
                })
              }
            >
              {["beginner", "intermediate", "advanced"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="strumming-check">
          <GlassSwitch
            checked={!!state.inputs.metadataConfirmed}
            onChange={(e) => inputs({ metadataConfirmed: e.target.checked })}
          />
          I have confirmed the practice tempo and meter
        </label>
        <label className="strumming-check">
          <GlassSwitch
            checked={!!state.inputs.chordTimingConfirmed}
            onChange={(e) => inputs({ chordTimingConfirmed: e.target.checked })}
          />
          Use the score's chord positions (timing verified)
        </label>
        <button
          onClick={() => {
            stop();
            edit(song.id, (s) => {
              if (s.strumming) s.strumming.inputs = {};
            });
          }}
        >
          Use score defaults
        </button>
        <ul className="small muted">
          {analysis.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
      {!state.inputs.metadataConfirmed && (
        <p className="strumming-assumption small">
          Practice tempo · {analysis.bpm} BPM / provisional{" "}
          {analysis.meter.join("/")} · confirm in Musical inputs.
        </p>
      )}
      <ErrorNotice error={resolved.error || error} />
      {context && !resolved.error && (
        <div
          className="strumming-options"
          role="group"
          aria-label="Recommended patterns"
        >
          {context.recommendations.map((r) => (
            <button
              key={r.role}
              aria-pressed={!custom && context.selectedId === r.pattern.id}
              onClick={() => choose(r.pattern.id)}
            >
              <strong>{r.role}</strong>
              <span>{r.pattern.name}</span>
              <small>{r.pattern.difficulty}</small>
            </button>
          ))}
        </div>
      )}
      {state.customs.some((c) => c.contextId === contextId) && (
        <label className="strumming-context">
          Saved variations
          <select
            value={custom?.id ?? ""}
            onChange={(e) => {
              if (e.target.value) choose(e.target.value);
            }}
          >
            <option value="">Choose a saved variation</option>
            {state.customs
              .filter((c) => c.contextId === contextId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.pattern.name} · {c.pattern.meter.join("/")}
                </option>
              ))}
          </select>
        </label>
      )}
      {pattern && (
        <>
          <div className="strumming-pattern-title">
            <h3>{draft ? "Custom variation" : pattern.name}</h3>
            <span>
              {pattern.difficulty} · {bpm} BPM · {pattern.meter.join("/")}
            </span>
          </div>
          <p className="small">
            {draft
              ? "Your edits keep the original rhythmic grid. Save to keep this variation."
              : custom
                ? "Your saved arrangement. Its strokes remain unchanged when song metadata changes."
                : recommendation?.explanation}
          </p>
          {(staleCustom || (draft && sourceFingerprint.current !== key)) && (
            <p role="status" className="strumming-assumption">
              Song inputs changed. Your variation is preserved; review it before
              saving a new copy.
            </p>
          )}
          {mismatch && (
            <p role="alert">
              This saved variation uses {pattern.meter.join("/")}; the current
              measure uses {analysis.meter.join("/")}. Select a current
              recommendation to play this measure.
            </p>
          )}
          <div
            className={`strumming-grid subdivisions-${pattern.subdivision}`}
            role="group"
            aria-label="Strumming rhythm grid"
          >
            {Array.from({ length: pattern.meter[0] }, (_, beat) => (
              <div className="strumming-beat" key={beat}>
                {pattern.events
                  .slice(
                    beat * pattern.subdivision,
                    (beat + 1) * pattern.subdivision,
                  )
                  .map((event, part) => {
                    const index = beat * pattern.subdivision + part;
                    return (
                      <button
                        key={index}
                        className={`strumming-event ${index === active ? "is-playing" : ""} ${index === eventIndex ? "is-editing" : ""}`}
                        aria-label={`Beat ${event.position + 1}: ${event.stroke}${event.accent >= 0.75 ? ", accented" : ""}`}
                        aria-pressed={eventIndex === index}
                        onClick={() => setEventIndex(index)}
                      >
                        <small>{beatLabel(pattern, index)}</small>
                        <span className="strumming-accent" aria-hidden="true">
                          {event.accent >= 0.75 ? ">" : " "}
                        </span>
                        <strong aria-hidden="true">
                          {symbols[event.stroke]}
                        </strong>
                        {event.chord && (
                          <small className="strumming-chord">
                            {event.chord}
                          </small>
                        )}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
          <p className="small muted strumming-legend">
            ↓ down · ↑ up · × muted · — rest · &gt; accent. Tap a position to
            edit. Counts use{" "}
            {pattern.meter[1] === 8
              ? "eighth"
              : pattern.meter[1] === 2
                ? "half"
                : "quarter"}{" "}
            notes.
          </p>
          <div className="strumming-edit" aria-label="Edit selected strum">
            <span>
              Position{" "}
              {(pattern.events[eventIndex] ?? pattern.events[0]).position + 1}
            </span>
            <label>
              Stroke
              <select
                value={(pattern.events[eventIndex] ?? pattern.events[0]).stroke}
                onChange={(e) => change({ stroke: e.target.value as Stroke })}
              >
                {["down", "up", "mute", "rest"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Accent
              <select
                disabled={
                  (pattern.events[eventIndex] ?? pattern.events[0]).stroke ===
                  "rest"
                }
                value={(pattern.events[eventIndex] ?? pattern.events[0]).accent}
                onChange={(e) => change({ accent: Number(e.target.value) })}
              >
                {[
                  ...new Set([
                    0.35,
                    0.65,
                    0.8,
                    1,
                    (pattern.events[eventIndex] ?? pattern.events[0]).accent,
                  ]),
                ]
                  .sort()
                  .map((a) => (
                    <option key={a} value={a}>
                      {a >= 0.75 ? "Strong" : a >= 0.5 ? "Medium" : "Light"} (
                      {Math.round(a * 100)}%)
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="strumming-playback">
            <button
              className="primary"
              onClick={() => void play()}
              disabled={!playbackAllowed || practiceRunning}
              aria-label={running ? "Pause strumming" : "Play strumming"}
            >
              {running ? <Pause size={17} /> : <Play size={17} />}{" "}
              {running ? "Pause" : "Listen"}
            </button>
            <label className="strumming-check">
              <GlassSwitch
                checked={loop}
                onChange={(e) => setLoop(e.target.checked)}
              />
              Loop
            </label>
            <label className="strumming-check">
              <GlassSwitch
                checked={click}
                onChange={(e) => setClick(e.target.checked)}
              />
              Metronome
            </label>
            <label className="strumming-speed">
              Playback speed · {speed}%
              <input
                aria-label="Strumming playback speed"
                type="range"
                min="50"
                max="150"
                step="5"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              />
            </label>
          </div>
          {practiceRunning && (
            <p className="small">
              Stop score playback to listen to this strumming pattern.
            </p>
          )}
          {!playbackAllowed && !mismatch && (
            <p role="alert">
              Adjust speed to keep playback between 20 and 400 BPM.
            </p>
          )}
          <p className="small muted">
            Neutral synthesized guitar tones preview the rhythm. Clicks share
            its audio clock. Pausing or changing controls restarts at beat 1.
          </p>
          <div className="strumming-save">
            <label>
              Variation name
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button onClick={save} disabled={!name.trim() || !playbackAllowed}>
              <Save size={15} />
              Save variation
            </button>
          </div>
          <div className="strumming-actions">
            <button
              onClick={() => {
                const original =
                  context?.recommendations.find(
                    (r) => r.pattern.id === custom?.sourceId,
                  ) ?? recommendation;
                if (original) choose(original.pattern.id);
              }}
            >
              <RotateCcw size={15} />
              Reset to recommendation
            </button>
            <button
              disabled={!!draft}
              onClick={() => {
                try {
                  const next = ensureRecommendations(song, contextId, true);
                  edit(song.id, (s) => {
                    s.strumming = next;
                  });
                  setStatus(
                    "Alternatives refreshed where equally suitable templates exist. Saved variations are preserved.",
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <RefreshCw size={15} />
              Regenerate alternatives
            </button>
          </div>
          <p className="small" role="status">
            {status ? `${status} · ${saveState}` : `Patterns · ${saveState}`}
          </p>
          {cached && cached.fingerprint !== key && (
            <p className="small muted">
              Updating recommendations for these musical inputs…
            </p>
          )}
        </>
      )}
    </>
  );
}
