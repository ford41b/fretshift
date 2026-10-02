import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload } from "lucide-react";
import {
  analyzeAudioFile,
  audioAnalysisToSong,
  type AudioChordAnalysis,
} from "../../audio/audioToChords";
import { parseChordName } from "../../theory/chordName";
import type { Song } from "../../schema/song.v1";
import { ErrorNotice } from "./Common";

export function AudioChordReview({
  onDraft,
}: {
  onDraft: (song: Song | null) => void;
}) {
  const [analysis, setAnalysis] = useState<AudioChordAnalysis | null>(null),
    [url, setUrl] = useState(""),
    [title, setTitle] = useState("Audio chord draft"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recording, setRecording] = useState(false),
    [playhead, setPlayhead] = useState(0);
  const audio = useRef<HTMLAudioElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [url],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element || !analysis) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ratio = devicePixelRatio || 1,
      width = element.clientWidth || 700,
      height = 120;
    element.width = width * ratio;
    element.height = height * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue("--bg") ||
      "#eee";
    context.fillRect(0, 0, width, height);
    context.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue(
        "--accent-text",
      ) || "#6848c7";
    analysis.waveform.forEach((value, index) => {
      const x = (index / analysis.waveform.length) * width,
        bar = Math.max(1, value * (height - 18));
      context.fillRect(
        x,
        (height - bar) / 2,
        Math.max(1, width / analysis.waveform.length),
        bar,
      );
    });
    const duration = audio.current?.duration;
    if (duration && Number.isFinite(duration)) {
      context.fillStyle = "#ef476f";
      context.fillRect((playhead / duration) * width - 1, 0, 2, height);
    }
  }, [analysis, playhead]);

  async function analyze(file: File) {
    setBusy(true);
    setError("");
    setAnalysis(null);
    onDraft(null);
    try {
      const result = await analyzeAudioFile(file);
      if (url) URL.revokeObjectURL(url);
      setUrl(result.url);
      setAnalysis(result.analysis);
      setTitle(file.name.replace(/\.[^.]+$/, "") || "Audio chord draft");
      onDraft(
        audioAnalysisToSong(result.analysis, file.name.replace(/\.[^.]+$/, "")),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const next = new MediaRecorder(media);
      chunks.current = [];
      stream.current = media;
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      next.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: next.mimeType || "audio/webm",
        });
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setRecording(false);
        void analyze(
          new File([blob], "New recording.webm", { type: blob.type }),
        );
      };
      recorder.current = next;
      next.start();
      setRecording(true);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow access and try again, or choose an audio file."
          : `Recording could not start: ${String(reason)}`,
      );
    }
  }

  function updateChord(index: number, chordName: string) {
    if (!analysis) return;
    const next = structuredClone(analysis);
    next.chords[index].chordName = chordName;
    setAnalysis(next);
    try {
      next.chords.forEach((chord) => parseChordName(chord.chordName));
      setError("");
      onDraft(audioAnalysisToSong(next, title));
    } catch {
      setError(
        "Corrected chords must use a supported name such as C, F#m, Bb7, or D/F#.",
      );
      onDraft(null);
    }
  }

  return (
    <div className="audio-chord-review">
      <div className="button-row">
        <label className="button file-button">
          <Upload size={17} />
          Choose audio
          <input
            type="file"
            aria-label="Choose audio file"
            accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.webm,.flac"
            disabled={busy || recording}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void analyze(file);
            }}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            recording ? recorder.current?.stop() : void startRecording()
          }
        >
          {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
          {recording ? "Stop recording" : "Record"}
        </button>
      </div>
      {busy && <p role="status">Listening for stable single-string notes on this device…</p>}
      <ErrorNotice error={error} />
      {analysis && (
        <>
          <label>
            Draft title
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                try {
                  onDraft(audioAnalysisToSong(analysis, event.target.value));
                  setError("");
                } catch {
                  setError("Give this audio draft a title before saving.");
                  onDraft(null);
                }
              }}
            />
          </label>
          <p>
            <strong>{analysis.tempo} BPM</strong> · likely key{" "}
            {analysis.keyRoot} · {analysis.chords.length} stable note regions
          </p>
          <canvas
            ref={canvas}
            className="audio-waveform"
            role="img"
            aria-label="Recording waveform; click to move the playhead"
            onClick={(event) => {
              const element = audio.current;
              if (!element || !Number.isFinite(element.duration)) return;
              element.currentTime =
                (event.nativeEvent.offsetX / event.currentTarget.clientWidth) *
                element.duration;
              setPlayhead(element.currentTime);
            }}
          />
          <audio
            ref={audio}
            controls
            src={url}
            onTimeUpdate={(event) =>
              setPlayhead(event.currentTarget.currentTime)
            }
          />
          <div className="chord-estimates">
            {analysis.chords.map((chord, index) => (
              <label key={`${chord.start}-${index}`}>
                <span>
                  {chord.start.toFixed(1)}s ·{" "}
                  {Math.round(chord.confidence * 100)}%
                </span>
                <input
                  aria-label={`Chord at ${chord.start.toFixed(1)} seconds`}
                  value={chord.chordName}
                  onChange={(event) => updateChord(index, event.target.value)}
                  onFocus={() => {
                    if (audio.current) audio.current.currentTime = chord.start;
                  }}
                />
              </label>
            ))}
          </div>
          <p className="muted">
            Single-string mode favors accuracy over chord guessing. Each stable note becomes a provisional chord root; review or change the chord quality before practicing. This draft does not create tab or melody.
          </p>
        </>
      )}
    </div>
  );
}
