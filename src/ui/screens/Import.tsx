import { GlassSwitch } from "../components/MobileGlass";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Braces,
  Camera,
  ArrowRight,
  Upload,
  Music2,
  AudioLines,
} from "lucide-react";
import { PageTitle, Segments, ErrorNotice } from "../components/Common";
import { parseChordPro } from "../../io/chordpro";
import { importJSON } from "../../io/json";
import { readStructuredFile } from "../../io/structured";
import {
  extractPdfText,
  pdfPagesToSongs,
  pageHasChordContent,
  suggestPdfSplits,
  type PdfTextPage,
} from "../../io/pdfText";
import { TrackSelectionError, type TrackChoice } from "../../io/timeline";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { loadSong } from "../../schema/migrations";
import { resolveTuning, type Song, type Measure } from "../../schema/song.v1";
import { Notation } from "../components/Notation";
import { AudioChordReview } from "../components/AudioChordReview";
import { AudioIntelligenceReview } from "../components/AudioIntelligenceReview";
import { VisionImport } from "../components/VisionImport";

const sources = [
  {
    id: "chordpro",
    title: "Text & ChordPro",
    description: "Paste chords and lyrics",
    icon: FileText,
  },
  {
    id: "json",
    title: "FretShift JSON",
    description: "A complete arrangement",
    icon: Braces,
  },
  {
    id: "structured",
    title: "Structured files",
    description: "MIDI, MusicXML & Guitar Pro",
    icon: Music2,
  },
  {
    id: "audio",
    title: "Audio recording",
    description: "Draft chords or single-note tab",
    icon: AudioLines,
  },
  {
    id: "pdf",
    title: "Text-layer PDF",
    description: "Read searchable chord sheets locally",
    icon: FileText,
  },
  {
    id: "photo",
    title: "Photos & scans",
    description: "Photo or scanned PDF recognition",
    icon: Camera,
  },
] as const;
type Source = (typeof sources)[number]["id"];

export function Import() {
  const [source, setSource] = useState<Source>("chordpro");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Song | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tracks, setTracks] = useState<TrackChoice[]>([]);
  const [track, setTrack] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pdfPages, setPdfPages] = useState<PdfTextPage[]>([]);
  const [visionDrafts, setVisionDrafts] = useState<Song[]>([]);
  const [pdfVisual, setPdfVisual] = useState(false);
  const [pdfSplits, setPdfSplits] = useState<Set<number>>(new Set());
  const [pdfDrafts, setPdfDrafts] = useState<Song[]>([]);
  const [pdfDraftIndex, setPdfDraftIndex] = useState(0);
  const request = useRef(0);
  const navigate = useNavigate();
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  function chooseSource(next: Source) {
    request.current++;
    setSource(next);
    setDraft(null);
    setError("");
    setFile(null);
    setTracks([]);
    setTrack("");
    setBusy(false);
    setPdfPages([]);
    setVisionDrafts([]);
    setPdfVisual(false);
    setPdfSplits(new Set());
    setPdfDrafts([]);
    setPdfDraftIndex(0);
  }

  function review(content = text) {
    try {
      setDraft(
        loadSong(
          source === "json" ? importJSON(content) : parseChordPro(content),
        ),
      );
      setError("");
    } catch (e) {
      setDraft(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function reviewFile(selected: File, trackIndex?: number) {
    const current = ++request.current;
    setFile(selected);
    setDraft(null);
    setError("");
    setTracks([]);
    setBusy(true);
    try {
      const imported = await readStructuredFile(selected, trackIndex);
      if (request.current === current) setDraft(imported);
    } catch (e) {
      if (request.current !== current) return;
      if (e instanceof TrackSelectionError) {
        setTracks(e.tracks);
        setTrack("");
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request.current === current) setBusy(false);
    }
  }

  function applyPdfSplits(
    pages: PdfTextPage[],
    splits: Set<number>,
    index = 0,
  ) {
    const songs = pdfPagesToSongs(pages, splits);
    setPdfSplits(splits);
    setPdfDrafts(songs);
    setPdfDraftIndex(Math.min(index, songs.length - 1));
    setDraft(songs[Math.min(index, songs.length - 1)] ?? null);
  }

  async function reviewPdf(selected: File) {
    const current = ++request.current;
    setFile(selected);
    setPdfPages([]);
    setPdfSplits(new Set());
    setPdfDrafts([]);
    setPdfVisual(false);
    setDraft(null);
    setError("");
    setBusy(true);
    try {
      const pages = await extractPdfText(
        new Uint8Array(await selected.arrayBuffer()),
        { allowScannedPages: true },
      );
      if (request.current !== current) return;
      setPdfPages(pages);
      if (pages.some((page) => !page.text.trim())) {
        setError("Some PDF pages have no readable text. Use visual analysis to avoid losing those pages.");
        return;
      }
      const unconfirmed = pages.filter((page) => !pageHasChordContent(page.text));
      if (unconfirmed.length) {
        setError(`Pages ${unconfirmed.map((page) => page.number).join(", ")} have no recognized chord symbols in the text layer. Analyze the PDF visually or inspect and correct those pages before saving.`);
        return;
      }
      const splits = suggestPdfSplits(pages);
      try { applyPdfSplits(pages, splits); }
      catch { applyPdfSplits(pages, new Set()); }
      setError("");
    } catch (e) {
      if (request.current === current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request.current === current) setBusy(false);
    }
  }

  function editImportedMeasure(index: number, change: (m: Measure) => Measure) {
    if (!draft) return;
    const measures = draft.measures.map((m, i) => i === index ? change(m) : m);
    const candidate = loadSong({ ...draft, measures,
      provenance: draft.provenance ? { ...draft.provenance,
        timingNeedsConfirmation: measures.some(m => m.timingConfirmed === false) } : undefined });
    setDraft(candidate);
    setVisionDrafts(existing => existing.map(song => song.id === candidate.id ? candidate : song));
    setPdfDrafts(existing => existing.map(song => song.id === candidate.id ? candidate : song));
  }

  async function saveDraft() {
    if (!draft || saving) return;
    setSaving(true);
    setError("");
    try {
      const settings = useSettingsStore.getState();
      const now = new Date().toISOString();
      const drafts = source === "photo" && visionDrafts.length ? visionDrafts :
        source === "pdf" && pdfDrafts.length ? pdfDrafts : [draft];
      const songs: Song[] = [];
      for (const candidate of drafts) {
        const tuning = resolveTuning(candidate.tuningId);
        if (
          !tuning.builtIn &&
          !settings.tunings.some((t) => t.id === tuning.id)
        )
          await settings.addTuning(tuning);
        const song = loadSong({
          ...candidate,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        });
        useSongStore.getState().add(song);
        songs.push(song);
      }
      navigate(`/song/${songs[0].id}?edit=1`);
    } catch (e) {
      setError(
        `Could not save this draft: ${e instanceof Error ? e.message : String(e)}`,
      );
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="EVERY SONG STARTS SOMEWHERE"
        title="Bring a song along"
        description="From a chart to your hands. Make it your own."
      />
      <div className="import-stepper">
        <span className="active">
          1 <b>Choose source</b>
        </span>
        <i />
        <span className={draft ? "active" : ""}>
          2 <b>Review draft</b>
        </span>
        <i />
        <span>
          3 <b>Make it yours</b>
        </span>
      </div>
      <div className="import-layout">
        <div className="import-sources">
          {sources.map((s) => (
            <button
              key={s.id}
              className={`card ${source === s.id ? "selected" : ""}`}
              aria-pressed={source === s.id}
              disabled={saving}
              onClick={() => chooseSource(s.id)}
            >
              <s.icon size={25} />
              <div>
                <strong>{s.title}</strong>
                <span>{s.description}</span>
              </div>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
        <section className="card import-workspace">
          {source === "photo" ? (
            <VisionImport
              disabled={saving}
              onDraft={(song) => {
                setDraft(song);
                if (song) setError("");
              }}
              onDrafts={setVisionDrafts}
            />
          ) : source === "pdf" ? (
            <>
              <div className="section-title">
                <h2>Read a digital chord sheet</h2>
                <label className="button file-button">
                  <Upload size={17} />
                  Choose PDF
                  <input
                    type="file"
                    aria-label="Choose PDF file"
                    accept=".pdf,application/pdf"
                    disabled={saving}
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      event.target.value = "";
                      if (selected) void reviewPdf(selected);
                    }}
                  />
                </label>
              </div>
              <p>
                Text is extracted on this device. Suggested page boundaries can
                be merged or split before saving.
              </p>
              {busy && <p role="status">Reading PDF text…</p>}
              {file && <div className="smart-pdf-fallback">
                <p>Local text extraction cannot read chords drawn as graphics. If the draft is missing music, inspect the PDF visually without uploading the pages that already work as text.</p>
                <button type="button" className="button" disabled={busy || saving}
                  onClick={() => { setPdfVisual(true); setPdfDrafts([]); setDraft(null); setError(""); }}>
                  <Camera size={17} /> {pdfVisual ? "Visual analysis open" : "Analyze PDF visually / edit pages"}
                </button>
              </div>}
              {pdfVisual && file && <VisionImport initialPdf={file} disabled={saving}
                onDraft={(song) => { setDraft(song); if (song) setError(""); }}
                onDrafts={(songs) => { setPdfDrafts(songs); setPdfDraftIndex(0); setDraft(songs[0] ?? null); }} /> }
              {!pdfVisual && pdfPages.length > 0 && (
                <div className="pdf-boundaries">
                  <strong>
                    {pdfDrafts.length} song{pdfDrafts.length === 1 ? "" : "s"}{" "}
                    proposed from {pdfPages.length} page
                    {pdfPages.length === 1 ? "" : "s"}
                  </strong>
                  {pdfPages.slice(1).map((page) => (
                    <label key={page.number}>
                      <GlassSwitch
                        checked={pdfSplits.has(page.number)}
                        onChange={(event) => {
                          const next = new Set(pdfSplits);
                          if (event.target.checked) next.add(page.number);
                          else next.delete(page.number);
                          try {
                            applyPdfSplits(pdfPages, next, pdfDraftIndex);
                            setError("");
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : String(e),
                            );
                          }
                        }}
                      />
                      Start a new song on page {page.number}
                    </label>
                  ))}
                  {pdfDrafts.length > 1 && (
                    <label>
                      Preview song
                      <select
                        aria-label="Preview PDF song"
                        value={pdfDraftIndex}
                        onChange={(event) => {
                          const index = Number(event.target.value);
                          setPdfDraftIndex(index);
                          setDraft(pdfDrafts[index]);
                        }}
                      >
                        {pdfDrafts.map((song, index) => (
                          <option key={index} value={index}>
                            {index + 1}. {song.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </>
          ) : source === "audio" ? (
            <>
              <AudioLines size={35} className="accent-text" />
              <h2>Build a chord draft from audio</h2>
              <AudioIntelligenceReview onAnalysisStart={() => setDraft(null)} />
              <details><summary>Older single-string draft</summary><p>This separate tool converts stable single notes into provisional chord roots.</p>
              <AudioChordReview
                onDraft={(song) => {
                  setDraft(song);
                  setError("");
                }}
              /></details>
            </>
          ) : source === "structured" ? (
            <>
              <div className="section-title">
                <h2>Bring your score into the songbook</h2>
                <label className="button file-button">
                  <Upload size={17} />
                  Choose file
                  <input
                    type="file"
                    aria-label="Choose structured file"
                    disabled={saving}
                    accept=".mid,.midi,.xml,.musicxml,.mxl,.gp3,.gp4,.gp5,.gpx,.gp"
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      e.target.value = "";
                      if (selected) void reviewFile(selected);
                    }}
                  />
                </label>
              </div>
              <p>
                Choose MIDI, MusicXML or Guitar Pro. Review the guitar track and
                notation before saving an editable copy.
              </p>
              {file && <p className="muted">{file.name}</p>}
              {busy && <p role="status">Reading your score…</p>}
              {tracks.length > 0 && (
                <div>
                  <p>
                    This score has more than one track. Choose the guitar part
                    to keep.
                  </p>
                  <label>
                    Guitar track
                    <select
                      aria-label="Guitar track"
                      value={track}
                      onChange={(e) => setTrack(e.target.value)}
                    >
                      <option value="" disabled>
                        Choose a track
                      </option>
                      {tracks.map((t) => (
                        <option key={t.index} value={t.index}>
                          {t.name}
                          {t.notes === undefined ? "" : ` · ${t.notes} notes`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={track === "" || busy}
                    onClick={() => {
                      if (file) void reviewFile(file, Number(track));
                    }}
                  >
                    Review selected track <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="section-title">
                <h2>
                  {source === "chordpro"
                    ? "A chart, ready to become music"
                    : "Restore an arrangement"}
                </h2>
                <label className="button file-button">
                  <Upload size={17} />
                  Choose file
                  <input
                    type="file"
                    aria-label="Choose text file"
                    disabled={saving}
                    accept={
                      source === "json"
                        ? ".json"
                        : ".txt,.cho,.chopro,.chordpro,.pro"
                    }
                    onChange={async (e) => {
                      const selected = e.target.files?.[0];
                      e.target.value = "";
                      if (!selected) return;
                      const current = ++request.current;
                      setDraft(null);
                      try {
                        const contents = await selected.text();
                        if (current !== request.current) return;
                        setText(contents);
                        review(contents);
                      } catch (e) {
                        if (current === request.current) setError(String(e));
                      }
                    }}
                  />
                </label>
              </div>
              <p>
                {source === "chordpro"
                  ? "Paste your lyrics with inline [G] chords. Add a title, key, capo or section above them."
                  : "Paste or choose a FretShift song JSON file. The whole file is validated before import."}
              </p>
              <textarea
                className="source-editor"
                aria-label="Import source text"
                disabled={saving}
                value={text}
                onChange={(e) => {
                  request.current++;
                  setText(e.target.value);
                  setDraft(null);
                }}
                placeholder={
                  source === "chordpro"
                    ? "{title: My next favorite}\n{key: G}\n{start_of_verse}\n[G]A few words, a [C]little music…"
                    : "Paste your song JSON here…"
                }
                spellCheck={false}
              />
              <button
                className="primary"
                disabled={!text.trim() || saving}
                onClick={() => review()}
              >
                Review song <ArrowRight size={17} />
              </button>
            </>
          )}
          <ErrorNotice error={error} />
        </section>
      </div>
      {draft && (
        <section className="card import-preview">
          <div className="section-title">
            <div>
              <span className="eyebrow">YOUR EDITABLE DRAFT</span>
              <h2>{draft.title}</h2>
              <p>
                {draft.measures.length} measures · {draft.currentKey.root}
                {draft.currentKey.mode === "minor" ? "m" : ""} ·{" "}
                {resolveTuning(draft.tuningId).label} · Capo {draft.capo}
              </p>
            </div>
            <button
              className="primary"
              disabled={saving}
              onClick={() => void saveDraft()}
            >
              {saving
                ? "Saving…"
                : (source === "pdf" && pdfDrafts.length > 1 || source === "photo" && visionDrafts.length > 1)
                  ? "Save all & edit first"
                  : "Save & edit"}{" "}
              <ArrowRight size={17} />
            </button>
          </div>
          {(source === "photo" || source === "pdf") && <section className="import-timing" aria-label="Confirm musical timing">
            <h3>Confirm timing · editable measure positions</h3>
            <p>Printed barlines are preserved, but evenly spaced chord placeholders are NOT a rhythm transcription. Adjust each chord’s attack beat and only confirm after comparing against the original chart. You can save without confirming, but rhythm practice must not grade these positions.</p>
            <p role="status">{draft.measures.filter(m => m.timingConfirmed !== true).length} measures still need timing confirmation.</p>
            {draft.measures.map((measure, mi) => <div className="import-timing-measure" key={measure.id}>
              <strong>Measure {mi + 1}</strong>
              {measure.sourceLine && <code className="import-source-line" title="Original chord line">{measure.sourceLine}</code>}
              {measure.chords.length ? measure.chords.map((chord,ci) => <label key={chord.id}>{chord.chordName} attack beat
                <input type="number" step="0.25" min="0"
                  max={(measure.timeSignature ?? draft.timeSignature)[0] - .25}
                  value={chord.beat} disabled={saving}
                  onChange={e => { const beat = Number(e.target.value);
                    if (!Number.isFinite(beat) || beat < 0 || beat >= (measure.timeSignature ?? draft.timeSignature)[0]) return;
                    editImportedMeasure(mi,m => ({...m,timingConfirmed:false,chords:m.chords.map((c,i)=>i===ci?{...c,beat}:c)}));
                  }}/>
              </label>) : <span>No chord attack on this measure</span>}
              <label className="import-timing-confirm"><GlassSwitch checked={measure.timingConfirmed === true} disabled={saving || !measure.chords.length}
                onChange={e => editImportedMeasure(mi, m => ({...m,timingConfirmed:e.target.checked}))}/>
                {measure.timingConfirmed ? "Timing confirmed" : "Timing needs confirmation"}
              </label>
            </div>)}
          </section>}
          <Segments
            label="Draft names"
            value="sounding"
            options={[{ value: "sounding", label: "Sounding chord names" }]}
            onChange={() => {}}
          />
          <Notation
            song={draft}
            view={source === "structured" ? "combined" : "chord"}
          />
        </section>
      )}
    </>
  );
}
