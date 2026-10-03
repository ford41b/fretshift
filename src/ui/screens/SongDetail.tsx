import { StrummingPattern } from "../components/StrummingPattern";
import { ShareSong } from "../components/ShareSong";
import { useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Guitar,
  MoreHorizontal,
  Undo2,
  Redo2,
  Minus,
  Plus,
  Pin,
  RefreshCw,
  Download,
  Code2,
  Music2,
  Maximize2,
  SlidersHorizontal,
} from "lucide-react";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { usePracticeStore } from "../../store/practiceStore";
import { SongV1, resolveTuning, type Song } from "../../schema/song.v1";
import { ChordDiagram } from "../components/ChordDiagram";
import { Notation } from "../components/Notation";
import {
  IconButton,
  Segments,
  Empty,
  Modal,
  ErrorNotice,
  useToast,
  Difficulty,
} from "../components/Common";
import { findVoicings } from "../../theory/voicingSearch";
import {
  transposeKey,
  transposeTuning,
  setCapo,
  suggestCapo,
  scaleDifficulty,
  chordToTab,
  tabToChord,
  type TransformResult,
} from "../../transforms";
import { serializeChordPro, applyChordProSource } from "../../io/chordpro";
import { exportJSON, importJSON, downloadFile } from "../../io/json";
import { exportStructured, type StructuredFormat } from "../../io/structured";
import { writePdfSheet, type PdfSheetOptions } from "../../io/pdfSheet";
export function SongDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const song = useSongStore((s) => s.songs.find((x) => x.id === id));
  const edit = useSongStore((s) => s.edit),
    saveState = useSongStore((s) => s.saveState);
  const { settings, update, tunings } = useSettingsStore();
  const practice = usePracticeStore();
  const [view, setView] = useState(settings.defaultView),
    [editing, setEditing] = useState(params.has("edit")),
    [panel, setPanel] = useState(false),
    [source, setSource] = useState(""),
    [format, setFormat] = useState<"chordpro" | "json">("chordpro"),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState<StructuredFormat | null>(null),
    [pdfExporting, setPdfExporting] = useState(false),
    [pdfPageSize, setPdfPageSize] =
      useState<PdfSheetOptions["pageSize"]>("letter"),
    [pdfNameMode, setPdfNameMode] = useState<PdfSheetOptions["nameMode"]>(
      settings.nameDisplay,
    ),
    [diff, setDiff] = useState(song?.difficulty ?? 1);
  const toast = useToast();
  useEffect(() => setDiff(song?.difficulty ?? 1), [song?.difficulty]);
  if (!song)
    return (
      <Empty title="This song isn't in your songbook">
        <Link to="/">Back to songbook</Link>
      </Empty>
    );
  const validation = SongV1.safeParse(song);
  const issues = validation.success ? [] : validation.error.issues;
  const unique = [
    ...new Set(song.measures.flatMap((m) => m.chords.map((c) => c.chordName))),
  ];
  function apply(fn: () => TransformResult) {
    try {
      const r = fn();
      if (r.changed) edit(song!.id, (s) => Object.assign(s, r.song));
      toast(
        [
          r.summary,
          ...r.warnings.slice(0, 3),
          r.warnings.length > 3
            ? `${r.warnings.length - 3} more flags in the score.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        () => useSongStore.temporal.getState().undo(),
      );
      setDiff(r.song.difficulty);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function downloadStructured(format: StructuredFormat) {
    if (exporting || !song) return;
    setExporting(format);
    setError("");
    try {
      const result = await exportStructured(song, format);
      const content =
        typeof result.content === "string"
          ? result.content
          : new Uint8Array(result.content).buffer;
      downloadFile(content, `${song.title}.${result.extension}`, result.mime);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }
  async function downloadPdf() {
    if (pdfExporting || !song) return;
    setPdfExporting(true);
    setError("");
    try {
      const bytes = await writePdfSheet(song, {
        pageSize: pdfPageSize,
        nameMode: pdfNameMode,
      });
      downloadFile(
        new Uint8Array(bytes).buffer,
        `${song.title}-${pdfNameMode}.pdf`,
        "application/pdf",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfExporting(false);
    }
  }
  function showPanel() {
    setSource(
      format === "chordpro"
        ? serializeChordPro(song!, true)
        : JSON.stringify(song, null, 2),
    );
    setPanel(true);
  }
  return (
    <>
      <div className="detail-breadcrumb">
        <Link to="/">
          <ArrowLeft size={16} />
          Songbook
        </Link>
        <span>{saveState}</span>
        <div>
          <IconButton
            label="Undo"
            onClick={() => useSongStore.temporal.getState().undo()}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo"
            onClick={() => useSongStore.temporal.getState().redo()}
          >
            <Redo2 size={18} />
          </IconButton>
        </div>
      </div>
      <header className="detail-header">
        <div>
          <span className="eyebrow">
            {song.tags.includes("Public domain")
              ? "A TRADITIONAL FAVORITE"
              : "YOUR ARRANGEMENT"}
          </span>
          {editing ? (
            <input
              className="title-input"
              aria-label="Song title"
              value={song.title}
              onChange={(e) =>
                edit(song.id, (s) => {
                  s.title = e.target.value;
                })
              }
            />
          ) : (
            <h1>{song.title}</h1>
          )}
          {editing ? (
            <input
              aria-label="Artist"
              value={song.artist}
              placeholder="Artist"
              onChange={(e) =>
                edit(song.id, (s) => {
                  s.artist = e.target.value;
                })
              }
            />
          ) : (
            <p>
              {song.artist || "Original arrangement"}{" "}
              <span className="separator">•</span>
              {song.tempo} BPM <span className="separator">•</span>
              {song.timeSignature.join("/")}
            </p>
          )}
        </div>
        <div className="button-row detail-actions">
          <div className="detail-practice-actions" aria-label="Practice options">
            <Link className="detail-practice-action primary" to={`/practice/${song.id}`}>
              <Play size={18} fill="currentColor" aria-hidden="true" />
              <span>Practice</span>
            </Link>
            <Link className="detail-practice-action detail-practice-action--immersive" to={`/immersive/${song.id}`}>
              <Guitar size={18} aria-hidden="true" />
              <span>Immersive practice</span>
            </Link>
          </div>
          {song.provenance?.audioReview && <Link className="button" to={`/audio-review/${song.id}`}>
            Edit audio timeline
          </Link>}
          <Link
            className="icon-button"
            to={`/stage/${song.id}`}
            aria-label="Open stage view"
            title="Stage view"
          >
            <Maximize2 size={19} />
          </Link>
          <IconButton label="Source and export" onClick={showPanel}>
            <MoreHorizontal />
          </IconButton>
        </div>
      </header>
      {song.provenance &&
        [
          "photo",
          "pdf-scan",
          "pdf-text",
          "audio",
          "youtube",
          "midi",
          "musicxml",
          "guitarpro",
        ].includes(song.provenance.source) && (
          <div className="draft-banner">
            ✧ Editable draft · {song.provenance.source}
            {song.provenance.overallConfidence !== undefined
              ? ` · ${Math.round(song.provenance.overallConfidence * 100)}% confidence`
              : ""}
            . Review chords, timing and lyrics before playing.
          </div>
        )}
      <ErrorNotice error={error} />
      {issues.length > 0 && (
        <ErrorNotice
          error={`Fix before export or sync: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" ")}`}
        />
      )}
      <div className="chord-strip-label">
        <h2>
          Your chord palette <span>{unique.length} chords</span>
        </h2>
        <span>Tap to explore a voicing · pin to keep it</span>
      </div>
      <div className="chord-strip">
        {unique.map((name) => {
          const event = song.measures
            .flatMap((m) => m.chords)
            .find((c) => c.chordName === name)!;
          return (
            <div
              className={`chord-tile ${event.voicingPinned ? "pinned" : ""}`}
              key={name}
            >
              <button
                className="diagram-button"
                aria-label={`Cycle ${name} voicing`}
                onClick={() => {
                  const alternatives = findVoicings(
                    name,
                    resolveTuning(song.tuningId),
                    song.capo,
                    8,
                  );
                  if (!alternatives.length) {
                    toast(
                      "No complete voicing found for this chord and tuning.",
                    );
                    return;
                  }
                  const current = alternatives.findIndex(
                    (v) =>
                      JSON.stringify(v.frets) ===
                      JSON.stringify(event.voicing?.frets),
                  );
                  const next =
                    alternatives[(current + 1) % alternatives.length];
                  edit(song.id, (s) =>
                    s.measures.forEach((m) =>
                      m.chords.forEach((c) => {
                        if (c.chordName === name) c.voicing = next;
                      }),
                    ),
                  );
                  toast(
                    `Selected another ${name} voicing. Convert chords to tab to use it in the score.`,
                  );
                }}
              >
                <ChordDiagram song={song} name={name} voicing={event.voicing} />
              </button>
              <button
                className={`pin-button ${event.voicingPinned ? "active" : ""}`}
                aria-label={`${event.voicingPinned ? "Unpin" : "Pin"} ${name} voicing`}
                aria-pressed={!!event.voicingPinned}
                onClick={() =>
                  edit(song.id, (s) =>
                    s.measures.forEach((m) =>
                      m.chords.forEach((c) => {
                        if (c.chordName === name) {
                          c.voicingPinned = !event.voicingPinned;
                          if (!c.voicing)
                            c.voicing = findVoicings(
                              name,
                              resolveTuning(s.tuningId),
                              s.capo,
                              1,
                            )[0];
                        }
                      }),
                    ),
                  )
                }
              >
                <Pin size={13} />
                {event.voicingPinned ? "Pinned" : "Pin voicing"}
              </button>
            </div>
          );
        })}
        {!unique.length && (
          <p className="muted">Add your first chord in a measure below.</p>
        )}
      </div>
      <div className="score-card card">
        <div className="score-toolbar">
          <Segments
            label="Notation view"
            value={view}
            options={[
              { value: "chord", label: "Chords" },
              { value: "tab", label: "Tab" },
              { value: "combined", label: "Combined" },
            ]}
            onChange={setView}
          />
          <button
            className={editing ? "selected" : ""}
            onClick={() => setEditing(!editing)}
            aria-pressed={editing}
          >
            <SlidersHorizontal size={16} />
            {editing ? "Done editing" : "Edit notation"}
          </button>
        </div>
        {editing && (
          <p className="editor-help">
            Click a tab cell. Arrows move · digits enter frets · H sustains · X
            mutes · Delete clears · Tab moves to the next measure.
          </p>
        )}
        <Notation song={song} view={view} editing={editing} />
      </div>
      <StrummingPattern key={song.id} song={song} />
      <div className="transform-bar">
        <div className="key-control">
          <span className="control-label">KEY</span>
          <IconButton
            label="Transpose down one semitone"
            onClick={() => apply(() => transposeKey(song, -1))}
          >
            <Minus size={16} />
          </IconButton>
          <strong>
            {song.currentKey.root}
            {song.currentKey.mode === "minor" ? "m" : ""}
          </strong>
          <IconButton
            label="Transpose up one semitone"
            onClick={() => apply(() => transposeKey(song, 1))}
          >
            <Plus size={16} />
          </IconButton>
        </div>
        <label className="bar-select">
          <span className="control-label">TUNING</span>
          <select
            aria-label="Song tuning"
            value={song.tuningId}
            onChange={(e) =>
              apply(() => transposeTuning(song, resolveTuning(e.target.value)))
            }
          >
            {tunings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label.replace(" (EADGBE)", "")}
              </option>
            ))}
          </select>
        </label>
        <label className="bar-select">
          <span className="control-label">CAPO</span>
          <select
            aria-label="Capo"
            value={song.capo}
            onChange={(e) => apply(() => setCapo(song, Number(e.target.value)))}
          >
            {Array.from({ length: 8 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? "None" : i}
              </option>
            ))}
          </select>
        </label>
        <div className="difficulty-control">
          <label htmlFor="difficulty">
            DIFFICULTY <strong>{diff}/10</strong>
          </label>
          <input
            id="difficulty"
            type="range"
            min="1"
            max="10"
            value={diff}
            onChange={(e) => setDiff(Number(e.target.value))}
            onPointerUp={() =>
              apply(() => scaleDifficulty(song, diff, practice.seed))
            }
            onKeyUp={(e) => {
              if (e.key.startsWith("Arrow"))
                apply(() => scaleDifficulty(song, diff, practice.seed));
            }}
            title={
              diff <= 4
                ? "Simplify"
                : diff <= 6
                  ? "No change at levels 5–6"
                  : "Enrich"
            }
          />
        </div>
        <Segments
          label="Chord name display"
          value={settings.nameDisplay}
          options={[
            { value: "sounding", label: "Sounding" },
            { value: "shape", label: "Shape" },
          ]}
          onChange={(v) => void update({ nameDisplay: v })}
        />
      </div>
      <div className="below-score">
        <button onClick={() => apply(() => suggestCapo(song))}>
          Suggest capo
        </button>
        <button onClick={() => apply(() => chordToTab(song))}>
          <Music2 size={16} />
          Chords → Tab
        </button>
        <button onClick={() => apply(() => tabToChord(song))}>
          Tab → Chords
        </button>
        <button
          onClick={() => {
            practice.reroll();
            apply(() => scaleDifficulty(song, 9, practice.seed + 1));
          }}
        >
          <RefreshCw size={15} />
          Re-roll enrichment
        </button>
      </div>
      {panel && (
        <Modal
          title="Your chart, your format"
          onClose={() => setPanel(false)}
          wide
        >
          <div className="form-row">
            <label>
              Artist
              <input
                value={song.artist}
                onChange={(e) =>
                  edit(song.id, (s) => {
                    s.artist = e.target.value;
                  })
                }
              />
            </label>
            <label>
              Tempo
              <input
                type="number"
                min="20"
                max="400"
                value={song.tempo}
                onChange={(e) =>
                  edit(song.id, (s) => {
                    s.tempo = Number(e.target.value);
                  })
                }
              />
            </label>
            <label>
              Tags (comma separated)
              <input
                defaultValue={song.tags.join(", ")}
                onBlur={(e) =>
                  edit(song.id, (s) => {
                    s.tags = e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean);
                  })
                }
                list="tag-suggestions"
              />
            </label>
            <datalist id="tag-suggestions">
              {[
                ...new Set(
                  useSongStore.getState().songs.flatMap((s) => s.tags),
                ),
              ].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <label>
              Manual difficulty
              <input
                type="number"
                min="1"
                max="10"
                placeholder="Automatic"
                value={song.difficultyOverride ?? ""}
                onChange={(e) =>
                  edit(song.id, (s) => {
                    s.difficultyOverride = e.target.value
                      ? Number(e.target.value)
                      : undefined;
                  })
                }
              />
            </label>
          </div>
          <Difficulty
            value={song.difficulty}
            override={song.difficultyOverride}
          />
          <div className="source-toolbar">
            <Segments
              label="Source format"
              value={format}
              options={[
                { value: "chordpro", label: "ChordPro source" },
                { value: "json", label: "JSON" },
              ]}
              onChange={(f) => {
                setFormat(f);
                setSource(
                  f === "chordpro"
                    ? serializeChordPro(song, true)
                    : JSON.stringify(song, null, 2),
                );
              }}
            />
            <button
              onClick={() => {
                try {
                  const s: Song =
                    format === "json"
                      ? importJSON(source)
                      : applyChordProSource(song, source);
                  edit(song.id, (current) => Object.assign(current, s));
                  setError("");
                  setPanel(false);
                  toast("Source applied.", () =>
                    useSongStore.temporal.getState().undo(),
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Code2 size={16} />
              Apply source
            </button>
          </div>
          <textarea
            className="source-editor"
            aria-label="Editable chart source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
          />
          <ErrorNotice error={error} />
          <p className="muted">
            Source uses [Chord@beat] for exact positions. Applying it preserves
            matching tab and per-measure settings; JSON preserves every field.
            MusicXML carries guitar strings, chords and lyrics; MIDI carries
            sounding notes and timing. Guitar Pro exports a .gp score.
          </p>
          <ShareSong song={song} disabled={issues.length > 0} />
          <div className="form-row pdf-export-options">
            <label>
              PDF paper
              <select
                value={pdfPageSize}
                onChange={(event) =>
                  setPdfPageSize(
                    event.target.value as PdfSheetOptions["pageSize"],
                  )
                }
              >
                <option value="letter">Letter</option>
                <option value="a4">A4</option>
              </select>
            </label>
            <label>
              PDF chord names
              <select
                value={pdfNameMode}
                onChange={(event) =>
                  setPdfNameMode(
                    event.target.value as PdfSheetOptions["nameMode"],
                  )
                }
              >
                <option value="sounding">Sounding</option>
                <option value="shape">Shape</option>
              </select>
            </label>
            <button
              disabled={issues.length > 0 || pdfExporting}
              onClick={() => void downloadPdf()}
            >
              <Download size={16} />
              {pdfExporting ? "Preparing…" : "Printable PDF"}
            </button>
          </div>
          <div className="button-row">
            <button
              disabled={issues.length > 0}
              onClick={() =>
                downloadFile(exportJSON(song), `${song.title}.json`)
              }
            >
              <Download size={16} />
              JSON
            </button>
            <button
              disabled={issues.length > 0}
              onClick={() =>
                downloadFile(
                  serializeChordPro(song),
                  `${song.title}.cho`,
                  "text/plain",
                )
              }
            >
              <Download size={16} />
              ChordPro
            </button>
            {(
              [
                { id: "midi", label: "MIDI" },
                { id: "musicxml", label: "MusicXML" },
                { id: "guitarpro", label: "Guitar Pro" },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                disabled={issues.length > 0 || exporting !== null}
                onClick={() => void downloadStructured(f.id)}
              >
                <Download size={16} />
                {exporting === f.id ? "Preparing…" : f.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
