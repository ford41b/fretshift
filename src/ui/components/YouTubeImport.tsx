import { useEffect, useMemo, useRef, useState } from "react";
import { MonitorPlay, RefreshCcw, ShieldCheck } from "lucide-react";
import { cloudConfig } from "../../cloud/client";
import { useCloudStore } from "../../cloud/store";
import { clearReviewDraft, loadReviewDraft, NEW_YOUTUBE_DRAFT, type ReviewDraft } from "../../audio/intelligence/drafts";
import { BUILT_IN_TUNINGS, MAX_CAPO } from "../../schema/song.v1";
import { planRequests } from "../../youtube/accuracy";
import { analyzeYouTube, youtubeServiceStatus, type ServiceStatus } from "../../youtube/client";
import { YouTubePlayer } from "../../youtube/player";
import { youtubeResultToReview, youtubeSongMeta } from "../../youtube/review";
import {
  CLOSE_UP_FPS,
  DEFAULT_ACCURACY,
  MAX_ANALYSIS_SECONDS,
  MAX_VIDEO_SECONDS,
  type AccuracyOptions,
  type AnalysisRange,
  type PlannedRequest,
  type YouTubeWire,
} from "../../youtube/types";
import { formatClock, parseTimecode, parseYouTubeVideoId } from "../../youtube/url";
import { AudioIntelligenceReview, type YouTubeReviewSource } from "./AudioIntelligenceReview";
import { ErrorNotice } from "./Common";
import "../youtube.css";

const PRIVACY_KEY = "fretshift-youtube-privacy-v1";
function readAck() {
  try { return localStorage.getItem(PRIVACY_KEY) === "accepted"; } catch { return false; }
}
function writeAck() {
  try { localStorage.setItem(PRIVACY_KEY, "accepted"); } catch { /* acknowledgement lasts this session only */ }
}

type Progress = { done: number; total: number; current: PlannedRequest[] };

export function YouTubeImport({ disabled = false }: { disabled?: boolean }) {
  const config = cloudConfig();
  const configured = !!config;
  const session = useCloudStore((state) => state.session);
  const [service, setService] = useState<ServiceStatus | null>(null);
  const [acknowledged, setAcknowledged] = useState(readAck);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [tuningId, setTuningId] = useState("");
  const [capo, setCapo] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [options, setOptions] = useState<AccuracyOptions>(DEFAULT_ACCURACY);
  const [duration, setDuration] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<YouTubeReviewSource | null>(null);
  const [restorable, setRestorable] = useState<ReviewDraft | null>(null);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, YouTubeWire>());
  const videoId = parseYouTubeVideoId(url);

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    void youtubeServiceStatus(controller.signal).then((status) => { if (!controller.signal.aborted) setService(status); });
    return () => controller.abort();
  }, [configured]);
  useEffect(() => {
    let live = true;
    void loadReviewDraft(NEW_YOUTUBE_DRAFT).then((draft) => { if (live && draft?.youtube) setRestorable(draft); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { setDuration(null); setPreviewError(""); }, [videoId]);

  const startSeconds = parseTimecode(start), endSeconds = parseTimecode(end);
  const range = useMemo((): AnalysisRange | string => {
    if (!videoId) return "Paste a youtube.com/watch, youtu.be or youtube.com/shorts link to one video.";
    if (startSeconds === null || endSeconds === null) return "Write start and end times like 1:23 or 83.";
    if (duration && duration > MAX_VIDEO_SECONDS)
      return "This video is longer than an hour. FretShift analyzes videos up to an hour long.";
    const from = startSeconds ?? 0, to = endSeconds ?? duration;
    if (!to) return "Enter an end time; the player has not reported the video's length yet.";
    if (duration && from >= duration) return "Start time is after the end of the video.";
    if (duration && to > duration + 1) return "End time is after the end of the video.";
    if (to - from < 5) return "Analyze at least 5 seconds of video.";
    if (to - from > MAX_ANALYSIS_SECONDS)
      return `Choose a start and end time up to ${MAX_ANALYSIS_SECONDS / 60} minutes apart. Long videos are too long for one draft.`;
    return { startSeconds: from, endSeconds: duration ? Math.min(to, duration) : to };
  }, [videoId, startSeconds, endSeconds, duration]);
  const plan = typeof range === "string" ? [] : planRequests(range, options);
  const blocked = !configured ? "YouTube import isn't configured in this build. Add the Supabase URL and public key first." :
    service?.providerConfigured === false ? "YouTube import isn't set up on this FretShift server yet (no Gemini API key)." :
      !session ? "Sign in under Account & sync to analyze YouTube links. Other import sources work without an account." : "";
  const tuning = BUILT_IN_TUNINGS.find((item) => item.id === tuningId);
  const capoNumber = capo === "" ? undefined : Number(capo);

  function reset() {
    setSource(null);
    setRestorable(null);
    setNotice("Unsaved review discarded.");
  }

  async function analyze() {
    if (typeof range === "string") { setError(range); return; }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true); setError(""); setNotice("");
    setProgress({ done: 0, total: plan.length, current: [] });
    try {
      const result = await analyzeYouTube({
        url, range, options, signal: controller.signal, cache: cache.current, onProgress: setProgress,
        videoDurationSeconds: duration ?? undefined,
        hints: { ...(title.trim() ? { title: title.trim() } : {}), ...(artist.trim() ? { artist: artist.trim() } : {}),
          ...(tuning ? { tuning: tuning.label } : {}), ...(capoNumber !== undefined ? { capo: capoNumber } : {}) },
      });
      if (controller.signal.aborted) return;
      const meta = youtubeSongMeta(result, { artist: artist.trim() || undefined, tuningId: tuning?.id, capo: capoNumber });
      setRestorable(null);
      setSource({ review: youtubeResultToReview(result), providerId: result.modelId, meta, onDiscard: reset,
        title: title.trim() || result.video.title?.slice(0, 160) || "YouTube chord draft" });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError")
        setNotice(`Analysis cancelled.${cache.current.size ? " Finished parts are kept, so Retry continues where it stopped." : ""}`);
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (abort.current === controller) { abort.current = null; setRunning(false); setProgress(null); }
    }
  }

  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
    setProgress(null);
    setNotice(`Analysis cancelled.${cache.current.size ? " Finished parts are kept, so Retry continues where it stopped." : ""}`);
  }

  const option = <K extends keyof AccuracyOptions>(key: K, value: AccuracyOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  if (source)
    return <div className="yt-import">
      <AudioIntelligenceReview key={`${source.meta.youtube.videoId}:${source.meta.processedAt}`} youtube={source} />
      <button type="button" onClick={() => { setSource(null); setNotice(""); }}>Analyze another link</button>
    </div>;

  return <div className="yt-import">
    <div className="section-title"><div><MonitorPlay size={35} className="accent-text" /><h2>Chords from a YouTube lesson</h2></div></div>
    <p>Paste a public YouTube link. Google's Gemini watches and listens to it and suggests chords, tempo and sections. You review everything before anything is saved.</p>
    {blocked && <p role="status" className="yt-signin">{blocked}</p>}
    {restorable?.youtube && <div className="yt-restore" role="status">
      <span>Unsaved review of a YouTube video from {new Date(restorable.savedAt).toLocaleString()}.</span>
      <button type="button" onClick={() => setSource({ review: restorable.review, providerId: restorable.providerId,
        title: restorable.title, meta: restorable.youtube!, restoredAt: restorable.savedAt, onDiscard: reset })}>Restore review</button>
      <button type="button" onClick={() => { void clearReviewDraft(NEW_YOUTUBE_DRAFT); setRestorable(null); }}>Discard it</button>
    </div>}
    {!acknowledged ? <section className="yt-privacy" aria-label="YouTube import privacy notice">
      <h3><ShieldCheck size={18} /> Before you analyze a link</h3>
      <ul>
        <li>The YouTube link, the time range and any hints you type are sent through FretShift's server to <strong>Google's Gemini API</strong>. Google's API terms apply to that request.</li>
        <li>Google fetches the public video itself. FretShift never downloads YouTube audio or video, and your own recordings never leave this device.</li>
        <li>Only chords, timing and section labels come back. Lyrics are never requested or stored.</li>
        <li>The video plays in YouTube's embedded player (privacy-enhanced mode), which loads only after you continue.</li>
      </ul>
      <button type="button" className="primary" onClick={() => { writeAck(); setAcknowledged(true); }}>I understand, continue</button>
    </section> : <>
      <div className="yt-form">
        <label className="yt-url">YouTube link
          <input type="url" inputMode="url" value={url} disabled={disabled || running} placeholder="https://www.youtube.com/watch?v=…"
            aria-invalid={!!url && !videoId} onChange={(event) => { setUrl(event.target.value); setError(""); }} /></label>
        {url && !videoId && <p className="yt-hint" role="status">Use a youtube.com/watch, youtu.be or youtube.com/shorts link to one video.</p>}
        <label>Song title (optional)<input value={title} maxLength={160} disabled={running} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Artist (optional)<input value={artist} maxLength={160} disabled={running} onChange={(e) => setArtist(e.target.value)} /></label>
        <label>Tuning (optional)<select value={tuningId} disabled={running} onChange={(e) => setTuningId(e.target.value)}>
          <option value="">Not specified</option>
          {BUILT_IN_TUNINGS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Capo (optional)<input type="number" min="0" max={MAX_CAPO} step="1" value={capo} disabled={running}
          onChange={(e) => setCapo(e.target.value === "" ? "" : String(Math.max(0, Math.min(MAX_CAPO, Math.round(Number(e.target.value)) || 0))))} /></label>
        <label>Start time (optional)<input value={start} placeholder="0:00" disabled={running} aria-invalid={startSeconds === null}
          onChange={(e) => setStart(e.target.value)} /></label>
        <label>End time (optional)<input value={end} placeholder={duration ? formatClock(duration) : "end"} disabled={running}
          aria-invalid={endSeconds === null} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {videoId && <div className="yt-preview">
        <YouTubePlayer videoId={videoId} onReady={(_media, length) => setDuration(length || null)}
          onError={(message) => setPreviewError(message)} />
        <p className="muted">{duration ? `Video length ${formatClock(duration)}.` : "Loading the YouTube player…"}</p>
        {previewError && <p role="alert">{previewError} Enter an end time to analyze it anyway.</p>}
      </div>}
      <fieldset className="yt-options" disabled={running}>
        <legend>Accuracy options</legend>
        <label className="yt-check"><input type="checkbox" checked={options.useHints} onChange={(e) => option("useHints", e.target.checked)} />
          (a) Send my title, artist, tuning and capo hints to Gemini</label>
        <label className="yt-check"><input type="checkbox" checked={options.windowSeconds !== null}
          onChange={(e) => option("windowSeconds", e.target.checked ? 90 : null)} />
          (b) Analyze in overlapping windows</label>
        {options.windowSeconds !== null && <label className="yt-sub">Window length
          <select value={options.windowSeconds} onChange={(e) => option("windowSeconds", Number(e.target.value))}>
            {[45, 60, 90, 120, 180].map((value) => <option key={value} value={value}>{value} s</option>)}</select>
          with {options.overlapSeconds} s overlap</label>}
        <label className="yt-check"><input type="checkbox" checked={options.closeUp} onChange={(e) => option("closeUp", e.target.checked)} />
          (c) Close-up lesson: sample {CLOSE_UP_FPS} frames per second so the fretting hand is visible</label>
        <label>(d) Independent passes
          <select value={options.passes} onChange={(e) => option("passes", Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>1</option><option value={2}>2 (both must agree)</option><option value={3}>3 (majority vote)</option></select></label>
        <label className="yt-check"><input type="checkbox" checked={options.snapToBeats} onChange={(e) => option("snapToBeats", e.target.checked)} />
          (e) Snap chord changes to the beat grid I confirm by tapping along</label>
        <p className="muted">{plan.length ? `This analysis uses ${plan.length} Gemini request${plan.length === 1 ? "" : "s"} from your quota.` :
          "Choose a link and range to see how many Gemini requests this uses."}</p>
      </fieldset>
      {running && progress && <div role="status" className="ai-stage yt-progress">
        <strong>Analyzing with Gemini… {progress.done} of {progress.total} part{progress.total === 1 ? "" : "s"} done</strong>
        <progress max={progress.total} value={progress.done} aria-label="YouTube analysis progress" />
        {progress.current.length > 0 && <ol>{progress.current.map((item) => <li key={`${item.window}:${item.pass}`} className="active">
          {formatClock(item.segment.startSeconds)}–{formatClock(item.segment.endSeconds)}{options.passes > 1 ? ` · pass ${item.pass}` : ""}</li>)}</ol>}
        <p className="muted">Each part can take a minute or two.</p>
        <button type="button" onClick={cancel}>Cancel analysis</button>
      </div>}
      {!running && <div className="button-row">
        <button type="button" className="primary" disabled={disabled || !!blocked || typeof range === "string"}
          onClick={() => void analyze()}>{error || notice.startsWith("Analysis cancelled")
            ? <><RefreshCcw size={17} /> Retry analysis</> : <><MonitorPlay size={17} /> Analyze video</>}</button>
      </div>}
      {typeof range === "string" && videoId && <p className="muted">{range}</p>}
    </>}
    <ErrorNotice error={error} />
    {notice && <p role="status" className="ai-notice">{notice}</p>}
  </div>;
}
