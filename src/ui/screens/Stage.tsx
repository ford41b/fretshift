import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ChevronLeft, ChevronRight, X, Play, Pause } from "lucide-react";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { displayName } from "../../transforms";
import { resolveTuning } from "../../schema/song.v1";
import { Empty, IconButton, Segments } from "../components/Common";
export function Stage() {
  const { id } = useParams(),
    [query] = useSearchParams(),
    navigate = useNavigate();
  const song = useSongStore((s) => s.songs.find((x) => x.id === id)),
    setlist = useSongStore((s) =>
      s.setlists.find((x) => x.id === query.get("setlist")),
    ),
    songs = useSongStore((s) => s.songs);
  const { settings, update } = useSettingsStore();
  const [index, setIndex] = useState(0),
    [auto, setAuto] = useState(false),
    [awake, setAwake] = useState(
      "Screen wake lock unavailable; adjust your device sleep setting.",
    );
  const nextEntry =
      setlist?.entries[
        (setlist.entries.findIndex((e) => e.songId === id) ?? -1) + 1
      ],
    nextSong = songs.find((s) => s.id === nextEntry?.songId);
  useEffect(() => setIndex(0), [id]);
  useEffect(() => {
    let lock: WakeLockSentinel | undefined,
      cancelled = false,
      pending = false;
    const acquire = async () => {
      if (cancelled || pending || (lock && !lock.released)) return;
      pending = true;
      try {
        if ("wakeLock" in navigator) {
          const acquired = await navigator.wakeLock.request("screen");
          if (cancelled) {
            await acquired.release();
            return;
          }
          lock = acquired;
          setAwake("Screen stays awake");
        }
      } catch {
        if (!cancelled)
          setAwake("Wake lock unavailable; adjust your device sleep setting.");
      } finally {
        pending = false;
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      void lock?.release();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("button,input,select")) return;
      if (["ArrowRight", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
        setAuto(false);
        setIndex((i) => Math.min((song?.measures.length ?? 1) - 1, i + 1));
      }
      if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setAuto(false);
        setIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === "Escape") navigate(`/song/${id}`);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [song, id, navigate]);
  useEffect(() => {
    if (!auto || !song) return;
    const m = song.measures[index];
    if (!m) return;
    const [beats, denom] = m.timeSignature ?? song.timeSignature;
    const timer = setTimeout(
      () => {
        if (index === song.measures.length - 1) setAuto(false);
        else setIndex(index + 1);
      },
      ((60000 / (m.tempoOverride ?? song.tempo)) * beats * 4) / denom,
    );
    return () => clearTimeout(timer);
  }, [auto, index, song]);
  if (!song)
    return (
      <Empty title="Song unavailable">
        <Link to="/">Return to songbook</Link>
      </Empty>
    );
  const measure = song.measures[index];
  return (
    <div className="stage-view">
      <header>
        <div>
          <span className="eyebrow">
            {song.currentKey.root}
            {song.currentKey.mode === "minor" ? "m" : ""} · CAPO {song.capo} ·{" "}
            {resolveTuning(song.tuningId).label}
          </span>
          <h1>{song.title}</h1>
        </div>
        <div className="button-row">
          <Segments
            label="Stage chord names"
            value={settings.nameDisplay}
            options={[
              { value: "sounding", label: "Sounding" },
              { value: "shape", label: "Shape" },
            ]}
            onChange={(v) => void update({ nameDisplay: v })}
          />
          <Link
            to={`/song/${song.id}`}
            className="icon-button"
            aria-label="Leave stage view"
          >
            <X />
          </Link>
        </div>
      </header>
      <div className="stage-page" aria-live="polite">
        <span className="stage-section">
          {[...song.measures.slice(0, index + 1)]
            .reverse()
            .find((m) => m.section)?.section?.label ??
            [...song.measures.slice(0, index + 1)]
              .reverse()
              .find((m) => m.section)?.section?.kind ??
            "Song"}
        </span>
        <div className="stage-chords">
          {measure?.chords.map((c) => (
            <strong key={c.id}>
              {displayName(c.chordName, song, settings.nameDisplay)}
            </strong>
          ))}
        </div>
        <p>{measure?.lyrics || "Instrumental"}</p>
        <div className="stage-next-line">
          {song.measures[index + 1]?.lyrics}
        </div>
      </div>
      <footer>
        <progress
          aria-label="Song progress"
          value={index + 1}
          max={song.measures.length}
        />
        <div className="stage-footer">
          <span>
            {index + 1} / {song.measures.length}
            <small>{awake}</small>
          </span>
          <div className="button-row">
            <IconButton
              label="Previous measure"
              disabled={index === 0}
              onClick={() => {
                setAuto(false);
                setIndex(index - 1);
              }}
            >
              <ChevronLeft />
            </IconButton>
            <button onClick={() => setAuto(!auto)}>
              {auto ? <Pause size={17} /> : <Play size={17} />}{" "}
              {auto ? "Pause scroll" : "Auto-scroll"}
            </button>
            <IconButton
              label="Next measure"
              disabled={index === song.measures.length - 1}
              onClick={() => {
                setAuto(false);
                setIndex(index + 1);
              }}
            >
              <ChevronRight />
            </IconButton>
          </div>
          {nextSong ? (
            <Link
              className="next-song"
              to={`/stage/${nextSong.id}?setlist=${setlist?.id}`}
            >
              <small>
                UP NEXT · CAPO {nextSong.capo} ·{" "}
                {resolveTuning(nextSong.tuningId).label}
              </small>
              <strong>{nextSong.title} →</strong>
              <small>{nextEntry?.note}</small>
            </Link>
          ) : (
            <span className="small">Space or arrows to turn · Esc to exit</span>
          )}
        </div>
      </footer>
    </div>
  );
}
