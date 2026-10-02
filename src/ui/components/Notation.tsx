import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Copy, Trash2, ChevronUp, ChevronDown, Plus } from "lucide-react";
import {
  type Song,
  type Measure,
  type Cell,
  emptySlot,
  resolveTuning,
  newMeasure,
} from "../../schema/song.v1";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { parseChordName } from "../../theory/chordName";
import { noteLabel } from "../../theory/pitch";
import { ChordLabel } from "./ChordDiagram";
import { IconButton, ErrorNotice } from "./Common";
export function Notation({
  song,
  view,
  editing = false,
  activeMeasure,
  activeSlot,
  activePitch,
  heat,
  onMeasureClick,
}: {
  song: Song;
  view: "chord" | "tab" | "combined";
  editing?: boolean;
  activeMeasure?: number;
  activeSlot?: number;
  activePitch?: number;
  heat?: Record<string, number>;
  onMeasureClick?: (index: number) => void;
}) {
  return (
    <div className="notation-list">
      {song.measures.map((m, index) => (
        <VirtualMeasure
          key={m.id}
          song={song}
          measure={m}
          index={index}
          view={view}
          editing={editing}
          active={activeMeasure === index}
          activeSlot={activeMeasure === index ? activeSlot : undefined}
          activePitch={activePitch}
          heat={heat?.[m.id]}
          onSelect={() => onMeasureClick?.(index)}
        />
      ))}
      {editing && (
        <button
          className="add-measure"
          onClick={() =>
            useSongStore
              .getState()
              .edit(song.id, (s) =>
                s.measures.push(
                  newMeasure(s.measures.length, s.timeSignature[0]),
                ),
              )
          }
        >
          <Plus size={18} />
          Add measure
        </button>
      )}
    </div>
  );
}
function VirtualMeasure(props: {
  song: Song;
  measure: Measure;
  index: number;
  view: "chord" | "tab" | "combined";
  editing: boolean;
  active: boolean;
  activeSlot?: number;
  activePitch?: number;
  heat?: number;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(props.index < 8);
  // Height the measure last rendered at. An offscreen placeholder keeps it, so
  // hiding a measure never changes the layout above the viewport. (Browsers
  // without CSS scroll anchoring, e.g. WebKit, otherwise jump the page and
  // move controls out from under the pointer.)
  const [renderedHeight, setRenderedHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting && entry.boundingClientRect.height > 0)
          setRenderedHeight(entry.boundingClientRect.height);
        setVisible(entry.isIntersecting);
      },
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // A different view or edit mode renders at a different height.
  useEffect(() => setRenderedHeight(null), [props.view, props.editing]);
  const estimate = props.view === "chord" ? 120 : 250;
  return (
    <div
      ref={ref}
      id={`measure-${props.measure.id}`}
      className={`virtual-measure ${props.active ? "is-playing" : ""}`}
      style={{ minHeight: estimate }}
    >
      {visible ? (
        <MeasureView {...props} />
      ) : (
        <div
          role="group"
          aria-label={`Measure ${props.index + 1}, offscreen`}
          style={{ height: renderedHeight ?? estimate }}
        />
      )}
    </div>
  );
}
function MeasureView({
  song,
  measure: m,
  index,
  view,
  editing,
  active,
  activeSlot,
  activePitch,
  heat,
  onSelect,
}: {
  song: Song;
  measure: Measure;
  index: number;
  view: "chord" | "tab" | "combined";
  editing: boolean;
  active: boolean;
  activeSlot?: number;
  activePitch?: number;
  heat?: number;
  onSelect: () => void;
}) {
  const [cursor, setCursor] = useState([0, 0]);
  const [chord, setChord] = useState("");
  const [chordBeat, setChordBeat] = useState(0);
  const [error, setError] = useState("");
  const lastDigit = useRef({ at: 0, value: "" });
  const cells = useRef<Map<string, SVGGElement>>(new Map());
  const edit = useSongStore((s) => s.edit);
  const settings = useSettingsStore((s) => s.settings);
  const t = resolveTuning(song.tuningId);
  const beats = (m.timeSignature ?? song.timeSignature)[0],
    count = beats * m.subdivision;
  const slots = m.tab?.slots ?? Array.from({ length: count }, emptySlot);
  const change = (fn: (m: Measure) => void) =>
    edit(song.id, (s) => fn(s.measures[index]));
  function move(si: number, st: number) {
    const a = Math.max(0, Math.min(count - 1, si)),
      b = Math.max(0, Math.min(5, st));
    setCursor([a, b]);
    cells.current.get(`${a}-${b}`)?.focus();
  }
  function keyboard(e: KeyboardEvent<SVGGElement>, si: number, st: number) {
    if (!editing) return;
    let value: Cell | undefined;
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      move(
        si + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0),
        st + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0),
      );
      return;
    }
    if (e.key === "Tab") {
      const next = document.querySelector(
        `#measure-${song.measures[index + (e.shiftKey ? -1 : 1)]?.id} [data-cell="0-0"]`,
      ) as SVGGElement | null;
      if (next) {
        e.preventDefault();
        next.focus();
      }
      return;
    }
    if (/^\d$/.test(e.key)) {
      const now = Date.now();
      const text =
        now - lastDigit.current.at < 400
          ? lastDigit.current.value + e.key
          : e.key;
      const number = Number(text);
      lastDigit.current = { at: now, value: text.length === 1 ? text : "" };
      if (number > 22) {
        setError(
          `Fret ${number} is outside 0–22. The previous value is retained.`,
        );
        return;
      }
      value = number;
    } else if (["Backspace", "Delete"].includes(e.key)) value = null;
    else if (e.key.toLowerCase() === "h") value = "hold";
    else if (e.key.toLowerCase() === "x") value = "x";
    if (value !== undefined) {
      e.preventDefault();
      setError("");
      change((mm) => {
        if (!mm.tab)
          mm.tab = { slots: Array.from({ length: count }, emptySlot) };
        mm.tab.slots[si][st] = value!;
      });
    }
  }
  function reorder(delta: number) {
    edit(song.id, (s) => {
      const target = index + delta;
      if (target < 0 || target >= s.measures.length) return;
      [s.measures[index], s.measures[target]] = [
        s.measures[target],
        s.measures[index],
      ];
      s.measures.forEach((mm, i) => (mm.index = i));
    });
  }
  return (
    <section
      className={`measure ${m.outOfRange ? "out-of-range" : ""} ${active ? "active" : ""}`}
      aria-label={`Measure ${index + 1}`}
      onDoubleClick={onSelect}
    >
      {m.section && (
        <h3 className="section-heading">
          {m.section.label ?? m.section.kind}
          <span>
            {(m.timeSignature ?? song.timeSignature).join("/")} ·{" "}
            {m.tempoOverride ?? song.tempo} BPM
          </span>
        </h3>
      )}
      <div className="measure-header">
        <span className="measure-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        {m.outOfRange && (
          <strong className="warning">! Pitches need review</strong>
        )}
        {heat !== undefined && heat > 0 && (
          <button className="heat-badge" onClick={onSelect}>
            Practice focus {Math.round(heat)}%
          </button>
        )}
        {editing && (
          <div className="measure-actions">
            <IconButton
              label={`Move measure ${index + 1} up`}
              disabled={index === 0}
              onClick={() => reorder(-1)}
            >
              <ChevronUp size={16} />
            </IconButton>
            <IconButton
              label={`Move measure ${index + 1} down`}
              disabled={index === song.measures.length - 1}
              onClick={() => reorder(1)}
            >
              <ChevronDown size={16} />
            </IconButton>
            <IconButton
              label={`Duplicate measure ${index + 1}`}
              onClick={() =>
                edit(song.id, (s) => {
                  const copy = structuredClone(m);
                  copy.id = crypto.randomUUID();
                  copy.chords.forEach((c) => (c.id = crypto.randomUUID()));
                  s.measures.splice(index + 1, 0, copy);
                  s.measures.forEach((mm, i) => (mm.index = i));
                })
              }
            >
              <Copy size={16} />
            </IconButton>
            <IconButton
              label={`Delete measure ${index + 1}`}
              onClick={() =>
                edit(song.id, (s) => {
                  s.measures.splice(index, 1);
                  s.measures.forEach((mm, i) => (mm.index = i));
                })
              }
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        )}
      </div>
      <div
        className="measure-chords"
        style={{
          gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
          width: `min(100%, ${Math.max(
            16,
            Math.min(
              64,
              Math.max((m.lyrics ?? "").trim().length + 6, m.chords.length * 8),
            ),
          )}ch)`,
        }}
      >
        {m.chords.map((c) => (
          <div
            key={c.id}
            className={
              activeSlot !== undefined &&
              c.beat <= activeSlot / m.subdivision &&
              ![...m.chords].some(
                (next) =>
                  next.beat > c.beat && next.beat <= activeSlot / m.subdivision,
              )
                ? "current-chord"
                : undefined
            }
            style={{ gridColumn: Math.round(c.beat * m.subdivision) + 1 }}
          >
            <ChordLabel song={song} name={c.chordName} voicing={c.voicing} />
            {editing && (
              <button
                className="tiny-delete"
                aria-label={`Delete ${c.chordName} at beat ${c.beat + 1}`}
                onClick={() =>
                  change((mm) => {
                    mm.chords = mm.chords.filter((x) => x.id !== c.id);
                  })
                }
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {view !== "chord" && (
        <svg
          className="tab-svg"
          viewBox={`0 0 ${Math.max(480, count * 55)} 170`}
          role="img"
          aria-label={`Tab for measure ${index + 1}. High string on top.`}
          data-mirrored="false"
        >
          <g
            role="group"
            aria-label={`Measure ${index + 1}, ${m.chords.map((c) => c.chordName).join(" to ") || "no chords"}, ${slots.flat().filter((v) => typeof v === "number").length} notes.`}
          >
            {Array.from({ length: 6 }, (_, st) => (
              <g key={st}>
                <text x="6" y={35 + st * 22} className="string-label">
                  {noteLabel(t.midi[st]).replace(/\d/, "")}
                </text>
                <line
                  x1="36"
                  y1={31 + st * 22}
                  x2={Math.max(480, count * 55) - 10}
                  y2={31 + st * 22}
                  className="tab-line"
                />
              </g>
            ))}
            {slots.map((slot, si) =>
              slot.map((cell, st) => {
                const width = (Math.max(480, count * 55) - 50) / count;
                const x = 50 + si * width,
                  y = 31 + st * 22;
                return (
                  <g
                    key={`${si}-${st}`}
                    ref={(el) => {
                      if (el) cells.current.set(`${si}-${st}`, el);
                    }}
                    data-cell={`${si}-${st}`}
                    tabIndex={
                      editing && cursor[0] === si && cursor[1] === st ? 0 : -1
                    }
                    role={editing ? "button" : "img"}
                    aria-label={`String ${st + 1}, beat ${si / m.subdivision + 1}, ${cell === null ? "empty" : cell === "hold" ? "hold" : cell === "x" ? "muted" : "fret " + cell}`}
                    onFocus={() => setCursor([si, st])}
                    onClick={() => {
                      if (editing) move(si, st);
                      else onSelect();
                    }}
                    onKeyDown={(e) => keyboard(e, si, st)}
                    className={`tab-cell ${editing ? "editable" : ""} ${activeSlot === si ? "current" : ""} ${activeSlot === si && typeof cell === "number" && t.midi[st] + song.capo + cell === activePitch ? "pitch-match" : ""}`}
                    aria-current={activeSlot === si ? "true" : undefined}
                  >
                    <rect
                      className="cell-background"
                      x={x - 13}
                      y={y - 11}
                      width="26"
                      height="22"
                      rx="6"
                      fill={cell !== null ? "var(--card)" : "transparent"}
                    />
                    <text
                      x={x}
                      y={y + 5}
                      textAnchor="middle"
                      className={cell === "hold" ? "hold" : ""}
                    >
                      {cell === "hold"
                        ? "—"
                        : cell === null
                          ? ""
                          : cell === "x"
                            ? "×"
                            : cell}
                    </text>
                  </g>
                );
              }),
            )}
            {Array.from({ length: beats }, (_, i) => (
              <text
                key={i}
                x={
                  50 +
                  (i * m.subdivision * (Math.max(480, count * 55) - 50)) / count
                }
                y="165"
                textAnchor="middle"
                className="beat-label"
              >
                {i + 1}
              </text>
            ))}
          </g>
        </svg>
      )}
      {(view !== "tab" || editing) && (
        <div className="measure-lyrics">
          {editing ? (
            <input
              aria-label={`Lyrics measure ${index + 1}`}
              value={m.lyrics ?? ""}
              placeholder="Add lyrics to this measure…"
              onChange={(e) =>
                change((mm) => {
                  mm.lyrics = e.target.value;
                })
              }
            />
          ) : (
            <p>{m.lyrics || <span className="muted">Instrumental</span>}</p>
          )}
        </div>
      )}
      {editing && (
        <details className="measure-editor">
          <summary>Edit chords & measure</summary>
          <div className="form-row">
            <label>
              Chord
              <input
                value={chord}
                onChange={(e) => setChord(e.target.value)}
                placeholder="Cmaj7"
                aria-label={`Chord name measure ${index + 1}`}
              />
            </label>
            <label>
              Beat (from 1)
              <input
                type="number"
                min="1"
                max={beats + 1 - 1 / m.subdivision}
                step={1 / m.subdivision}
                value={chordBeat + 1}
                onChange={(e) => setChordBeat(Number(e.target.value) - 1)}
              />
            </label>
            <button
              onClick={() => {
                try {
                  parseChordName(chord);
                  change((mm) => {
                    const found = mm.chords.find((c) => c.beat === chordBeat);
                    if (found) {
                      found.chordName = chord;
                      found.voicing = undefined;
                    } else
                      mm.chords.push({
                        id: crypto.randomUUID(),
                        beat: chordBeat,
                        chordName: chord,
                      });
                    mm.chords.sort((a, b) => a.beat - b.beat);
                  });
                  setError("");
                  setChord("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Add / replace chord
            </button>
          </div>
          <div className="form-row">
            <label>
              Section
              <input
                value={m.section?.label ?? m.section?.kind ?? ""}
                placeholder="Verse 1"
                onChange={(e) =>
                  change((mm) => {
                    mm.section = e.target.value
                      ? { kind: "custom", label: e.target.value }
                      : undefined;
                  })
                }
              />
            </label>
            <label>
              Tempo
              <input
                type="number"
                value={m.tempoOverride ?? song.tempo}
                onChange={(e) =>
                  change((mm) => {
                    mm.tempoOverride = Number(e.target.value);
                  })
                }
              />
            </label>
            <label>
              Beats
              <input
                type="number"
                min="1"
                max="32"
                value={beats}
                onChange={(e) =>
                  change((mm) => {
                    mm.timeSignature = [
                      Number(e.target.value),
                      (mm.timeSignature ?? song.timeSignature)[1],
                    ];
                  })
                }
              />
            </label>
            <label>
              Subdivision
              <select
                value={m.subdivision}
                onChange={(e) =>
                  change((mm) => {
                    mm.subdivision = Number(e.target.value) as 1 | 2 | 4;
                  })
                }
              >
                <option value="1">Quarter grid</option>
                <option value="2">Eighth grid</option>
                <option value="4">Sixteenth grid</option>
              </select>
            </label>
          </div>
          {slots.length !== count && (
            <p className="warning">
              Grid has {slots.length} slots; measure needs {count}.{" "}
              <button
                onClick={() =>
                  change((mm) => {
                    if (!mm.tab) mm.tab = { slots: [] };
                    if (
                      mm.tab.slots.length > count &&
                      mm.tab.slots
                        .slice(count)
                        .some((slot) => slot.some((c) => c !== null))
                    ) {
                      setError(
                        "Clear notes in excess slots before shortening the grid.",
                      );
                      return;
                    }
                    mm.tab.slots = Array.from(
                      { length: count },
                      (_, i) => mm.tab?.slots[i] ?? emptySlot(),
                    );
                  })
                }
              >
                Resize empty grid
              </button>
            </p>
          )}
        </details>
      )}
      <ErrorNotice error={error} />
      <span className="sr-only">
        {settings.leftHanded
          ? "Left-handed diagrams enabled; tab order remains high to low."
          : ""}
      </span>
    </section>
  );
}
