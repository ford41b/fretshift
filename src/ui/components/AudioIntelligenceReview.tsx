import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Play, Upload } from "lucide-react";
import { analyzeAudioIntelligenceFile, type AnalysisStage } from "../../audio/intelligence";
import { clearReviewDraft, loadReviewDraft, NEW_YOUTUBE_DRAFT, saveReviewDraft,
  type ReviewDraft } from "../../audio/intelligence/drafts";
import { audioReviewToSong, createAudioReview, gridAtBpm, mergeRegion, moveBoundary,
  splitRegion, type AudioReview } from "../../audio/intelligence/review";
import { loadSong } from "../../schema/migrations";
import type { Song } from "../../schema/song.v1";
import { flushPersistence, useSongStore } from "../../store/songStore";
import { parseChordName } from "../../theory/chordName";
import { snapToGrid } from "../../youtube/accuracy";
import { YouTubePlayer, type MediaHandle } from "../../youtube/player";
import { metaFromSong, youtubeReviewToSong, type YouTubeSongMeta } from "../../youtube/review";
import { addTap, MIN_TAPS, tapTempo } from "../../youtube/tap";
import { AudioNoteEditor, AudioTabLane } from "./AudioNoteEditor";
import { ErrorNotice } from "./Common";
import "../audio-intelligence.css";

/** A fresh YouTube analysis to review. Saved YouTube songs carry the same details in provenance. */
export type YouTubeReviewSource = {
  review: AudioReview;
  providerId: string;
  title: string;
  meta: YouTubeSongMeta;
  /** Restored from a local draft rather than freshly analyzed. */
  restoredAt?: string;
  onDiscard?: () => void;
};

const stages: AnalysisStage[] = ["Preparing audio", "Finding tempo", "Detecting beats",
  "Analyzing chords", "Detecting single notes", "Building timeline", "Preparing review"];
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AudioIntelligenceReview({ song, onAnalysisStart, youtube }: {
  song?: Song; onAnalysisStart?: () => void; youtube?: YouTubeReviewSource;
}) {
  const youtubeMeta = useMemo(() => youtube?.meta ?? (song ? metaFromSong(song) : null), [youtube?.meta, song]);
  const videoId = youtubeMeta?.youtube.videoId ?? null;
  const [transcribeNotes, setTranscribeNotes] = useState(false);
  const [selectedNote, setSelectedNote] = useState("");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [review, setReview] = useState<AudioReview | null>(youtube?.review ?? song?.provenance?.audioReview ?? null);
  const [providerId, setProviderId] = useState(youtube?.providerId ?? song?.provenance?.modelId ?? "fretshift-chroma-v1");
  const [title, setTitle] = useState(youtube?.title ?? song?.title ?? "");
  const [taps, setTaps] = useState<number[]>([]);
  const [playerError, setPlayerError] = useState("");
  const [playerReady, setPlayerReady] = useState(false);
  const [stage, setStage] = useState<AnalysisStage | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);
  const [looping, setLooping] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [firstBeat, setFirstBeat] = useState((youtube?.review ?? song?.provenance?.audioReview)?.reviewed.beats[0] ?? 0);
  const [savedId, setSavedId] = useState(song?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  // An <audio> element, or the YouTube IFrame player adapted to the same interface.
  const audio = useRef<MediaHandle | null>(null);
  const abort = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const activeUrl = useRef("");
  const persistedId = useRef(song?.id ?? "");
  const hasReview = !!review;
  // Unsaved edits are autosaved to IndexedDB so leaving the screen, a reload,
  // or an iOS tab eviction does not lose review work. Keyed by the song once
  // it exists, else by the single "new analysis" slot.
  const newDraftKey = youtube ? NEW_YOUTUBE_DRAFT : null;
  const draftKey = () => song?.id ?? (persistedId.current || newDraftKey);
  const pendingDraft = useRef<{ key: string | null; draft: Omit<ReviewDraft, "savedAt"> } | null>(null);
  const flushDraft = useRef(() => {
    const pending = pendingDraft.current;
    pendingDraft.current = null;
    if (pending) void saveReviewDraft(pending.key, pending.draft).catch(() => undefined);
  });
  const songRef = useRef(song);
  songRef.current = song;
  const freshYouTube = useRef(!!youtube);
  useEffect(() => {
    // A YouTube review handed in by the importer is already the newest state.
    if (freshYouTube.current) return;
    let live = true;
    void loadReviewDraft(songRef.current?.id ?? null).then((draft) => {
      // Never replace an analysis or edit the user started while this loaded.
      if (!live || !draft || operation.current !== 0) return;
      const base = songRef.current;
      setReview(draft.review); setTitle(draft.title); setProviderId(draft.providerId);
      setFirstBeat(draft.firstBeat); setSavedId(""); setRestoredDraft(true);
      setNotice(`Restored unsaved changes from ${new Date(draft.savedAt).toLocaleString()}.` +
        (base && draft.baseUpdatedAt !== base.updatedAt
          ? " The saved song changed after this draft was made; check it before saving." : "") +
        (base && metaFromSong(base) ? "" : " Reattach the original audio to audition regions."));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [song?.id]);
  useEffect(() => {
    if (!review || savedId || stage) { pendingDraft.current = null; return; }
    pendingDraft.current = { key: song?.id ?? (persistedId.current || newDraftKey), draft: {
      review, title, providerId, firstBeat, baseUpdatedAt: song?.updatedAt ?? null,
      ...(youtubeMeta ? { youtube: youtubeMeta } : {}) } };
    const timer = setTimeout(() => flushDraft.current(), 400);
    return () => clearTimeout(timer);
  }, [review, title, providerId, firstBeat, savedId, stage, song?.id, song?.updatedAt, newDraftKey, youtubeMeta]);
  useEffect(() => {
    const flush = flushDraft.current;
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  useEffect(() => {
    const player = audio.current;
    return () => { player?.pause(); };
  }, [url, hasReview]);
  useEffect(() => () => {
    operation.current++;
    abort.current?.abort();
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    if (audio.current) audio.current.pause();
  }, []);

  function change(fn: (next: AudioReview) => void) {
    setReview((current) => {
      if (!current) return null;
      const next: AudioReview = { ...current, reviewed: structuredClone(current.reviewed),
        noteTranscription: current.noteTranscription ? { ...current.noteTranscription,
          notes: structuredClone(current.noteTranscription.notes), options: structuredClone(current.noteTranscription.options) } : undefined };
      fn(next);
      return next;
    });
    setSavedId("");
    setError("");
  }

  function setAudio(fileToPlay: File) {
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = URL.createObjectURL(fileToPlay);
    setUrl(activeUrl.current);
  }

  async function analyze(selectedFile: File) {
    onAnalysisStart?.();
    abort.current?.abort();
    const current = ++operation.current;
    const controller = new AbortController();
    abort.current = controller;
    setStage("Preparing audio");
    setCancelling(false);
    setError(""); setNotice(""); setReview(null); setSavedId("");
    setRestoredDraft(false);
    persistedId.current = "";
    setFile(selectedFile);
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = "";
    setUrl("");
    let waveform: number[] = [];
    try {
      const result = await analyzeAudioIntelligenceFile(selectedFile, controller.signal, {
        transcribeNotes,
        onStage: (value) => { if (operation.current === current && !controller.signal.aborted) setStage(value); },
        onWaveform: (value) => { waveform = value; },
      });
      if (operation.current !== current) return;
      if (!result.chords.segments.length && !result.beats.beats.length && !result.notes?.notes.length)
        throw new Error("No usable beats or chords were detected. This recording did not produce a transcription.");
      const hash = await fileSha256(selectedFile);
      if (operation.current !== current || controller.signal.aborted) return;
      setAudio(selectedFile);
      setReview(createAudioReview(result, selectedFile.name, waveform, hash));
      setProviderId(result.chords.providerId);
      setTitle(selectedFile.name.replace(/\.[^.]+$/, ""));
      setSelected(0); setPlayhead(0); setLoopStart(0); setLoopEnd(result.duration);
      setFirstBeat(result.beats.beats[0] ?? 0);
      if (!result.notes && !result.chords.segments.some((segment) => segment.label))
        setNotice("No reliable chord labels were found. Correct a region before saving.");
    } catch (reason) {
      if (operation.current === current && !(reason instanceof DOMException && reason.name === "AbortError"))
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation.current === current) {
        setStage(null); setCancelling(false);
        if (controller.signal.aborted) setNotice("Analysis cancelled. You can retry or choose another recording.");
      }
    }
  }

  function cancel() {
    abort.current?.abort();
    setCancelling(true);
    setNotice("Cancellation requested. Cleaning up before retry.");
  }

  async function reattach(candidate: File) {
    if (!review) return;
    const current = ++operation.current;
    if (candidate.name !== review.fileName) {
      setError(`Choose the original recording, ${review.fileName}. The saved song contains derived data only.`);
      return;
    }
    if (!/\.(wav|mp3|m4a)$/i.test(candidate.name) || !candidate.size || candidate.size > 30 * 1024 * 1024) {
      setError("Choose the original WAV, MP3, or M4A file, no larger than 30 MB.");
      return;
    }
    try {
      const hash = review.fileSha256 ? await fileSha256(candidate) : undefined;
      if (operation.current !== current) return;
      if (review.fileSha256 && hash !== review.fileSha256) {
        setError("This file does not match the saved recording. Choose the original audio.");
        return;
      }
      setFile(candidate); setAudio(candidate); setError("");
      setNotice(review.fileSha256 ? "Original audio verified and attached for this session." :
        "Audio attached. This older transcription has no file fingerprint; check it matches before editing.");
    } catch {
      if (operation.current === current) setError("The audio file could not be read. Choose it again.");
    }
  }

  function updateLabel(value: string | null, decision: "corrected" | "unknown" | "no-chord") {
    if (value) {
      try { parseChordName(value); }
      catch { setError("Use a supported chord name such as C, F#m, Cadd9, Bm7b5, or D/F#."); return; }
    }
    change((next) => { const segment = next.reviewed.segments[selected];
      if (segment) Object.assign(segment, { label: value, decision, reviewed: true }); });
  }

  function audition(start: number, end: number) {
    if (!audio.current) {
      setError(videoId ? playerError || "The YouTube player is still loading." : "Reattach the original audio to audition this region.");
      return;
    }
    setLoopStart(start); setLoopEnd(end); setLooping(true);
    audio.current.currentTime = start;
    void audio.current.play().catch(() => setError("Playback could not start in this browser."));
  }

  async function save() {
    if (!review || saving) return;
    setSaving(true); setError("");
    try {
      const generated = youtubeMeta ? youtubeReviewToSong(title.trim(), providerId, review, youtubeMeta)
        : audioReviewToSong(title.trim(), providerId, review);
      const existing = useSongStore.getState().songs.find((entry) => entry.id === persistedId.current);
      let id: string;
      if (existing) {
        const updated = loadSong({ ...existing,
          title: generated.title, tempo: generated.tempo, timeSignature: generated.timeSignature,
          tuningId: review.noteTranscription ? generated.tuningId : existing.tuningId,
          capo: review.noteTranscription ? generated.capo : existing.capo, measures: generated.measures,
          provenance: generated.provenance, updatedAt: new Date().toISOString() });
        useSongStore.getState().edit(existing.id, (draft) => Object.assign(draft, updated));
        id = existing.id;
      } else {
        useSongStore.getState().add(generated);
        persistedId.current = generated.id;
        id = generated.id;
      }
      await flushPersistence();
      if (useSongStore.getState().saveState !== "Saved on this device")
        throw new Error(useSongStore.getState().saveState);
      pendingDraft.current = null;
      await Promise.all([clearReviewDraft(id), clearReviewDraft(newDraftKey)]);
      setSavedId(id);
      setRestoredDraft(false);
      setNotice(videoId
        ? "Chord draft saved to your songbook. Only derived chords and timing were saved; the video stays on YouTube."
        : "Transcription saved to your songbook. Raw audio was not saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  }

  async function discard() {
    if (!window.confirm("Discard your unsaved transcription changes?")) return;
    operation.current++;
    pendingDraft.current = null;
    await clearReviewDraft(draftKey()).catch(() => undefined);
    if (youtube && !persistedId.current) { youtube.onDiscard?.(); return; }
    const saved = song?.provenance?.audioReview ?? null;
    setReview(saved); setTitle(song?.title ?? ""); setSavedId(song?.id ?? persistedId.current);
    setFirstBeat(saved?.reviewed.beats[0] ?? 0); setRestoredDraft(false); setError("");
    if (!saved && !persistedId.current) { setFile(null); setUrl("");
      if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); activeUrl.current = ""; }
    setNotice("Unsaved changes discarded.");
  }

  /** Tap-along: taps are media seconds, so playback speed does not skew the tempo. */
  function tap() {
    if (!audio.current || audio.current.paused) { setError("Start playback, then tap on each beat."); return; }
    setError("");
    setTaps((current) => addTap(current, audio.current!.currentTime));
  }

  const snapped = (moved: number) => `${moved} chord boundar${moved === 1 ? "y" : "ies"} snapped to the beat grid.`;

  function snapChanges() {
    if (!review) return;
    const { segments, moved } = snapToGrid(review.reviewed.segments, review.reviewed.beats);
    change((next) => { next.reviewed.segments = structuredClone(segments); });
    setNotice(`${snapped(moved)} Check the regions, then confirm timing.`);
  }

  function applyTaps() {
    const fit = tapTempo(taps);
    if (!fit || !review) { setError(`Tap at least ${MIN_TAPS} steady beats first.`); return; }
    let grid: number[];
    try { grid = gridAtBpm(review.duration, fit.bpm, fit.firstDownbeat); }
    catch (reason) { setError(String(reason)); return; }
    // (e) Optional: snap chord changes to the grid the player just confirmed by tapping.
    const snap = youtubeMeta?.youtube.options.snapToBeats ? snapToGrid(review.reviewed.segments, grid) : null;
    change((next) => {
      next.reviewed.tempoBpm = fit.bpm; next.reviewed.beats = grid; next.reviewed.firstDownbeatIndex = 0;
      next.reviewed.timingConfirmed = false;
      if (snap) next.reviewed.segments = structuredClone(snap.segments);
    });
    setFirstBeat(fit.firstDownbeat);
    setTaps([]);
    setNotice(`Applied ${fit.bpm} BPM from ${taps.length} taps (±${fit.jitterMs} ms) with beat 1 at ${clock(fit.firstDownbeat)}.` +
      (snap ? ` ${snapped(snap.moved)}` : "") + " Listen through, then confirm timing.");
  }

  const reattaching = !!song || restoredDraft;
  const tapFit = tapTempo(taps);
  const visibleStages = transcribeNotes ? stages : stages.filter(item => item !== "Detecting single notes");
  const regions = review?.reviewed.segments ?? [];
  const unresolved = regions.filter((region) => !region.label && region.decision === "detected").length;
  const current = regions[selected];
  const detected = review?.detected.segments.find((segment) => current &&
    segment.start <= current.start + .01 && segment.end > current.start);
  const beats = review?.reviewed.beats ?? [];
  const duration = review?.duration ?? 1;
  const downbeat = review?.reviewed.firstDownbeatIndex ?? 0;
  const meter = review?.reviewed.meter ?? 4;
  // A YouTube timeline starts at the analyzed range, not at 0:00 of a long video.
  const origin = videoId ? Math.min(youtubeMeta?.youtube.startSeconds ?? 0, Math.max(0, duration - 1)) : 0;
  const range = (time: number) => `${(100 * (time - origin) / (duration - origin)).toFixed(4)}%`;
  const span = (seconds: number) => `${(100 * seconds / (duration - origin)).toFixed(4)}%`;

  return <section className="ai-review" aria-label="Audio Intelligence timeline">
    {videoId ? <div className="ai-review-head">
      <div><span className="eyebrow">YOUTUBE LINK · GEMINI DRAFT</span><h2>{song ? "Edit YouTube chord timeline" : "Review the YouTube chord draft"}</h2></div>
    </div> : <><div className="ai-review-head">
      <div><span className="eyebrow">AUDIO INTELLIGENCE</span><h2>{song ? "Edit audio transcription" : transcribeNotes ? "Audio to notes and tablature" : "Audio to chords and rhythm"}</h2></div>
      <label className="button file-button"><Upload size={17}/>{reattaching ? "Reattach audio" : "Choose WAV, MP3, or M4A"}
        <input type="file" disabled={!!stage} aria-label={reattaching ? "Reattach original audio" : "Choose audio for Audio Intelligence"}
          accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" onChange={(event) => {
            const chosen = event.target.files?.[0]; event.target.value = "";
            if (chosen) { if (reattaching) void reattach(chosen); else void analyze(chosen); }
          }}/></label>
    </div>
    {!song && <label className="ai-note-mode"><input type="checkbox" disabled={!!stage} checked={transcribeNotes}
      onChange={e=>setTranscribeNotes(e.target.checked)}/> Also transcribe a single-note guitar passage (experimental)</label>}
    {transcribeNotes && !song && <p>Choose an isolated melody with one note at a time. Polyphonic or multiple-guitar recordings cannot be separated into a reliable part.</p>}
    <p className="muted">Your recording stays on this device. Choose a WAV, MP3, or M4A file up to 30 MB and 5 minutes.</p>
    <details><summary>Advanced: processing and storage</summary><p>Analysis runs in this browser and a local Worker. Audio is not sent to an Audio Intelligence server. Derived musical data, a small waveform, and a file fingerprint are saved with the song and may sync with your account. The raw file stays in memory for this session and is released when you leave. Format support depends on your browser.</p></details></>}
    {videoId && <p className="muted">Chords, tempo and sections are Gemini suggestions from the video. Nothing is saved until you choose Save, and all timing starts unconfirmed.{youtubeMeta && ` Analyzed ${clock(youtubeMeta.youtube.startSeconds)}–${clock(youtubeMeta.youtube.endSeconds)} with ${youtubeMeta.youtube.requests} Gemini request${youtubeMeta.youtube.requests === 1 ? "" : "s"}.`}</p>}
    {stage && <div role="status" className="ai-stage"><strong>{cancelling ? "Finishing cancellation" : `${stage}…`}</strong><ol>{visibleStages.map((item) =>
      <li key={item} className={stages.indexOf(item) <= stages.indexOf(stage) ? "active" : ""}>{item}</li>)}</ol>
      <button disabled={cancelling} onClick={cancel}>Cancel analysis</button></div>}
    {file && !stage && !review && <button onClick={() => void analyze(file)}>Retry analysis</button>}
    <ErrorNotice error={error}/>{notice && <p role="status" className="ai-notice">{notice}</p>}
    {review && <>
      <div className="ai-summary"><label>Song title<input value={title} onChange={(e) => {setTitle(e.target.value); setSavedId("");}}/></label>
        <span>{clock(duration)} · {regions.length} regions · {beats.length} beats</span>
        {unresolved > 0 && <strong role="status">{unresolved} chord regions need review</strong>}
        {unresolved > 0 && <button onClick={() => change((next) => {
          next.reviewed.segments.forEach((region) => {
            if (!region.label && region.decision === "detected") {
              region.decision = "unknown"; region.reviewed = true;
            }
          });
        })}>Mark all uncertain regions Unknown</button>}</div>
      {videoId ? <div className="ai-player yt-review-player">
        <YouTubePlayer videoId={videoId} start={youtubeMeta?.youtube.startSeconds ?? 0}
          onReady={(media) => { audio.current = media; media.playbackRate = playbackRate; setPlayerReady(true); setPlayerError(""); }}
          onTime={(time) => {
            setPlayhead(time);
            if (looping && time >= loopEnd && loopEnd > loopStart && audio.current) audio.current.currentTime = loopStart;
          }}
          onError={(message) => { audio.current = null; setPlayerReady(false); setPlayerError(message); }}/>
        <div className="yt-player-controls"><button disabled={!playerReady} aria-label={audio.current?.paused === false ? "Pause video" : "Play video"}
          onClick={() => { if (!audio.current) return; if (audio.current.paused) void audio.current.play(); else audio.current.pause(); }}>
          {audio.current?.paused === false ? <Pause size={17}/> : <Play size={17}/>}</button><span>{clock(playhead)}</span>
          {playerError && <span role="alert">{playerError} The draft can still be reviewed and saved.</span>}</div>
      </div> : url ? <div className="ai-player"><button aria-label={audio.current?.paused ? "Play audio" : "Pause audio"}
        onClick={() => { if (!audio.current) return; if (audio.current.paused) void audio.current.play(); else audio.current.pause(); }}>
        {audio.current?.paused === false ? <Pause size={17}/> : <Play size={17}/>}</button>
        <audio ref={(element) => { audio.current = element; }} src={url} controls preload="metadata" onLoadedMetadata={e=>{e.currentTarget.playbackRate=playbackRate;e.currentTarget.preservesPitch=true;}} onEnded={e=>{if(looping && loopEnd>loopStart){e.currentTarget.currentTime=loopStart;void e.currentTarget.play();}}} onTimeUpdate={(e) => {
          const time = e.currentTarget.currentTime; setPlayhead(time);
          if (looping && time >= loopEnd && loopEnd > loopStart) e.currentTarget.currentTime = loopStart;
        }}/><span>{clock(playhead)}</span></div> : <p>Raw audio was not retained. Reattach the original file to audition regions.</p>}
      <div className="ai-controls"><label>Playback speed<select aria-label="Playback speed" value={playbackRate} onChange={e=>{const rate=Number(e.target.value);setPlaybackRate(rate);if(audio.current){audio.current.playbackRate=rate;audio.current.preservesPitch=true;}}}>
        <option value=".5">50%</option><option value=".75">75%</option><option value="1">100%</option></select></label><label>Zoom <input type="range" min="1" max="6" step=".5" value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}/></label>
        <label>Loop from <input type="number" min="0" max={duration} step=".01" value={loopStart}
          onChange={(e) => setLoopStart(Number(e.target.value))}/></label>
        <label>to <input type="number" min="0" max={duration} step=".01" value={loopEnd}
          onChange={(e) => setLoopEnd(Number(e.target.value))}/></label>
        <label><input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)}/> Loop</label></div>
      <div className="ai-scroll" aria-label="Waveform and chord timeline"><div className="ai-track" style={{width:`${zoom * 100}%`}}>
        <div className={`ai-waveform${review.waveform.length ? "" : " ai-waveform-empty"}`} onClick={(e) => { if (audio.current) {
          const bounds = e.currentTarget.getBoundingClientRect();
          audio.current.currentTime = origin + Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)) * (duration - origin);
        } }}>
          {review.waveform.map((height, i) => <i key={i} style={{height:`${Math.max(2, height * 100)}%`}}/>)}
          {beats.map((beat, i) => <b key={i} className={i >= downbeat && (i-downbeat)%meter===0 ? "measure" : ""}
            style={{left:range(beat)}} title={`Beat ${i+1}: ${clock(beat)}`}/>)}
          <em style={{left:range(playhead)}}/></div>
        <div className="ai-regions">{regions.map((region, i) => <button key={region.id}
          className={`${i===selected ? "selected" : ""} ${!region.label || !region.reviewed ? "uncertain" : ""}`}
          style={{left:range(region.start),width:span(region.end-region.start)}}
          title={`${clock(region.start)}–${clock(region.end)}: ${region.label ?? "Unknown"}`}
          onClick={() => {setSelected(i); if (audio.current) audio.current.currentTime = region.start;}}>
          {region.label ?? (region.decision === "no-chord" ? "No chord" : "Unknown")}</button>)}</div>
        {review.noteTranscription && <AudioTabLane review={review} playhead={playhead} selected={selectedNote || review.noteTranscription.notes.find(n=>!n.deleted)?.id || ""}
          select={id=>{setSelectedNote(id);const n=review.noteTranscription!.notes.find(n=>n.id===id);if(n && audio.current)audio.current.currentTime=n.start;}}/>}
      </div></div>
      {review.noteTranscription && <AudioNoteEditor review={review} selected={selectedNote} select={setSelectedNote}
        change={change} playhead={playhead} audition={audition}/>}
      {current && <section className="ai-edit"><h3>Region {selected+1}: {clock(current.start)}–{clock(current.end)}</h3>
        <p>Suggested chord: {detected?.label ?? "needs review"}.</p><p className="muted">Voicing needs confirmation</p>
        <details><summary>Advanced: recognition evidence</summary><p>Original state: {detected?.status ?? "region changed"}. Similarity measures a template match, not transcription accuracy.</p></details>
        {detected?.alternatives.length ? <div className="button-row">{detected.alternatives.slice(0,4).map((candidate) =>
          <button key={candidate.label} onClick={() => updateLabel(candidate.label,"corrected")}>{candidate.label}</button>)}</div> : null}
        <div className="ai-controls"><label>Replace chord<input aria-label="Replacement chord" key={current.id+current.label}
          defaultValue={current.label ?? ""} onBlur={(e) => {if(e.target.value.trim()) updateLabel(e.target.value.trim(),"corrected");}}/></label>
          <button onClick={() => updateLabel(null,"unknown")}>Mark unknown</button>
          <button onClick={() => updateLabel(null,"no-chord")}>Mark no chord</button>
          <button onClick={() => change((next) => {next.reviewed.segments[selected].reviewed=true;})}>Confirm label</button></div>
        <div className="ai-controls"><label>Boundary with next region (s)<input type="number" min={current.start+.03}
          max={regions[selected+1]?.end} step=".01" value={current.end}
          disabled={!regions[selected+1]} onChange={(e) => {
            try { const next = moveBoundary(regions,selected,Number(e.target.value)); change((r)=>{r.reviewed.segments=next;}); }
            catch(reason){setError(String(reason));}
          }}/></label>
          <button onClick={() => {try {const next=splitRegion(regions,selected,
            playhead>current.start+.02 && playhead<current.end-.02 ? playhead : (current.start+current.end)/2);
            change((r)=>{r.reviewed.segments=next;});} catch(reason){setError(String(reason));}}}>Split</button>
          <button disabled={!regions[selected+1]} onClick={() => {try {const next=mergeRegion(regions,selected);
            change((r)=>{r.reviewed.segments=next;});} catch(reason){setError(String(reason));}}}>Merge next</button>
          <button onClick={() => audition(current.start,current.end)}>Audition region</button></div></section>}
      <section className="ai-timing"><h3>Timing review</h3>
        <p>{review.detected.tempoBpm?.toFixed(1) ?? "No detected tempo"} BPM suggested · {review.detected.meter ? `${review.detected.meter}/4 suggested` : "check measure boundaries"}. {review.reviewed.timingConfirmed ? "Timing confirmed by you." : "Timing needs review."}</p>
        {review.detected.beatWarnings?.length ? <details><summary>Detector timing warnings</summary><ul>
          {review.detected.beatWarnings.map((warning,i)=><li key={i}>{warning}</li>)}
        </ul></details> : null}
        {videoId && <div className="yt-tap" aria-label="Tap along to confirm tempo">
          <p><strong>Tap along.</strong> Play the video and tap on every beat, starting on beat 1 of a bar. Use at least {MIN_TAPS} steady taps; 8 or more is better.</p>
          <div className="ai-controls">
            <button className="yt-tap-button" disabled={!playerReady} onClick={tap}>Tap beat</button>
            <span role="status">{taps.length} tap{taps.length === 1 ? "" : "s"}{tapFit ? ` · ${tapFit.bpm} BPM · beat 1 at ${clock(tapFit.firstDownbeat)} · ±${tapFit.jitterMs} ms` : ""}</span>
            <button disabled={!tapFit} onClick={applyTaps}>Use tapped tempo and downbeat</button>
            <button disabled={!taps.length} onClick={() => setTaps([])}>Clear taps</button>
            <button disabled={beats.length < 2} onClick={snapChanges}>Snap chord changes to beats</button>
          </div></div>}
        {regions.some((segment) => segment.label && beats[downbeat] !== undefined && segment.start < beats[downbeat]) &&
          <p role="note">Pickup chords before the selected downbeat appear at chart beat 1. Their exact source timestamps remain in the audio timeline.</p>}
        <div className="ai-controls"><label>BPM<input type="number" min="20" max="400" step=".1" value={review.reviewed.tempoBpm}
          onChange={(e) => change((r)=>{r.reviewed.tempoBpm=Number(e.target.value);r.reviewed.timingConfirmed=false;})}/></label>
          <label>First beat (s)<input type="number" min="0" max={duration} step=".01" value={firstBeat}
            onChange={(e)=>setFirstBeat(Number(e.target.value))}/></label>
          <button onClick={() => {try {const grid=gridAtBpm(duration,review.reviewed.tempoBpm,firstBeat);
            change((r)=>{r.reviewed.beats=grid;r.reviewed.firstDownbeatIndex=0;r.reviewed.timingConfirmed=false;});}
            catch(reason){setError(String(reason));}}}>Apply BPM and rebuild beats</button>
          <label>Meter<select value={meter} onChange={(e)=>change((r)=>{r.reviewed.meter=Number(e.target.value) as 3|4;r.reviewed.timingConfirmed=false;})}>
            <option value="3">3/4</option><option value="4">4/4</option></select></label>
          <label>First downbeat<select value={downbeat} onChange={(e)=>change((r)=>{r.reviewed.firstDownbeatIndex=Number(e.target.value);r.reviewed.timingConfirmed=false;})}>
            {beats.map((beat,i)=><option key={i} value={i}>Beat {i+1} · {clock(beat)}</option>)}</select></label></div>
        <details><summary>Edit individual beat timestamps ({beats.length})</summary><div className="ai-beat-list">{beats.map((beat,i)=><label key={i}>
          Beat {i+1}<input type="number" step=".01" min="0" max={duration} value={beat} onChange={(e)=>change((r)=>{
            r.reviewed.beats[i]=Number(e.target.value);r.reviewed.timingConfirmed=false;})}/></label>)}</div></details>
        <label className="ai-confirm"><input type="checkbox" checked={review.reviewed.timingConfirmed}
          onChange={(e)=>{if(e.target.checked && (beats.length<downbeat+meter || beats.some((b,i)=>i>0 && b<=beats[i-1]))) {
            setError("Correct the beat grid and choose a complete first measure before confirming timing.");return;}
            change((r)=>{r.reviewed.timingConfirmed=e.target.checked;});}}/> I checked the beat grid, meter, and downbeats against the audio.</label>
      </section>
      <div className="ai-actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : song ? "Save corrections" : "Save as FretShift song"}</button>
        {!savedId && <button disabled={saving} onClick={() => void discard()}>Discard unsaved changes</button>}
        {savedId && <><Link className="button" to={`/audio-review/${savedId}`}>Reopen transcription</Link>
          <Link className="button" to={`/practice/${savedId}`}>Practice</Link>
          <Link className="button" to={`/immersive/${savedId}`}>Immersive Practice</Link></>}
      </div>
    </>}
  </section>;
}
