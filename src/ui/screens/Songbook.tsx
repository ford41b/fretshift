import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  ArrowUpRight,
  Music2,
  SlidersHorizontal,
  Trash2,
  RotateCcw,
  Sparkles,
  ArrowRight,
  FolderInput,
  X,
} from "lucide-react";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { newSong, type Song, resolveTuning } from "../../schema/song.v1";
import {
  Difficulty,
  PageTitle,
  Empty,
  Modal,
  IconButton,
  useToast,
} from "../components/Common";
import { ChordDiagram } from "../components/ChordDiagram";
import { practiceRepo } from "../../persistence/dexie";
export function Songbook() {
  const state = useSongStore();
  const tunings = useSettingsStore((s) => s.tunings);
  const navigate = useNavigate();
  const toast = useToast();
  const [nudge, setNudge] = useState<{ text: string; to: string } | null>(null);
  const [search, setSearch] = useState(""),
    [tag, setTag] = useState("All songs"),
    [filter, setFilter] = useState(false),
    [tuning, setTuning] = useState(""),
    [key, setKey] = useState(""),
    [sort, setSort] = useState("title"),
    [max, setMax] = useState(10),
    [trash, setTrash] = useState(false),
    [create, setCreate] = useState(false),
    [title, setTitle] = useState(""),
    [tour, setTour] = useState(!localStorage.getItem("fretshift-tour")),
    [practiced, setPracticed] = useState<Record<string, string>>({});
  useEffect(() => {
    practiceRepo
      .sessions()
      .then((sessions) => {
        const map: Record<string, string> = {};
        for (const s of sessions)
          if (!map[s.songId] || s.startedAt > map[s.songId])
            map[s.songId] = s.startedAt;
        setPracticed(map);
        const candidates = useSongStore
          .getState()
          .songs.filter((s) => !s.deletedAt);
        for (const song of candidates) {
          const recent = sessions
            .filter((s) => s.songId === song.id)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, 3);
          if (
            recent.length === 3 &&
            recent[0].tempoMultiplierMax < 1 &&
            recent.every(
              (s) =>
                Math.abs(s.tempoMultiplierMax - recent[0].tempoMultiplierMax) <
                0.01,
            )
          ) {
            setNudge({
              text: `You've played ${song.title} at ${Math.round(recent[0].tempoMultiplierMax * 100)}% three times. Try ${Math.round(Math.min(1, recent[0].tempoMultiplierMax + 0.1) * 100)}% next.`,
              to: `/practice/${song.id}`,
            });
            return;
          }
        }
        void practiceRepo
          .pairs()
          .then((pairs) => {
            const slowest = pairs
              .filter((p) => p.history.length)
              .sort((a, b) => a.best - b.best)[0];
            if (slowest) {
              setNudge({
                text: `Your ${slowest.chordA} → ${slowest.chordB} change could use a focused minute.`,
                to: `/drills?a=${encodeURIComponent(slowest.chordA)}&b=${encodeURIComponent(slowest.chordB)}`,
              });
              return;
            }
            const key = candidates.find(
              (s) =>
                candidates.filter(
                  (x) =>
                    x.currentKey.root === s.currentKey.root &&
                    x.currentKey.mode === s.currentKey.mode,
                ).length >= 3,
            )?.currentKey;
            if (key)
              setNudge({
                text: `Three songs share ${key.root} ${key.mode}. Bring them together in a setlist.`,
                to: "/setlists",
              });
          })
          .catch((e) =>
            toast(`Drill history could not be loaded: ${String(e)}`),
          );
      })
      .catch((e) =>
        toast(`Practice history could not be loaded: ${String(e)}`),
      );
  }, [toast]);
  const active = state.songs.filter((s) => !s.deletedAt),
    tags = [...new Set(active.flatMap((s) => s.tags))];
  const songs = state.songs
    .filter((s) => Boolean(s.deletedAt) === trash)
    .filter(
      (s) =>
        (tag === "All songs" || s.tags.includes(tag)) &&
        (!tuning || s.tuningId === tuning) &&
        (!key || s.currentKey.root === key) &&
        s.difficulty <= max &&
        `${s.title} ${s.artist} ${s.measures.map((m) => `${m.lyrics} ${m.chords.map((c) => c.chordName).join(" ")}`).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "difficulty"
        ? a.difficulty - b.difficulty
        : sort === "added"
          ? b.createdAt.localeCompare(a.createdAt)
          : sort === "practiced"
            ? (practiced[b.id] ?? "").localeCompare(practiced[a.id] ?? "")
            : sort === "artist"
              ? a.artist.localeCompare(b.artist)
              : a.title.localeCompare(b.title),
    );
  const featured = active.find((s) => practiced[s.id]) ?? active[0];
  return (
    <>
      <PageTitle
        eyebrow="MAKE ROOM FOR MUSIC"
        title={trash ? "Your trash" : "Your songbook"}
        description={
          trash
            ? "Deleted songs stay here until you restore them."
            : `${active.length} songs. Endless ways to play them.`
        }
        action={
          <button className="primary" onClick={() => setCreate(true)}>
            <Plus size={19} />
            New song
          </button>
        }
      />
      {tour && !trash && (
        <div className="tour">
          <Sparkles size={20} />
          <div>
            <strong>A little inspiration to get you started.</strong>
            <span>
              {" "}
              Explore a sample, make it your own with the control bar, then head
              to Practice. Or import your first chart.
            </span>
          </div>
          <IconButton
            label="Dismiss welcome tour"
            onClick={() => {
              localStorage.setItem("fretshift-tour", "done");
              setTour(false);
            }}
          >
            <X size={18} />
          </IconButton>
        </div>
      )}
      {featured && !trash && (
        <div className="featured">
          <div className="featured-copy">
            <span className="pill light-pill">
              <span className="dot" />
              YOUR NEXT SESSION
            </span>
            <h2>
              A familiar song.
              <br />A fresh way to play.
            </h2>
            <p>
              {nudge?.text ??
                `${featured.title} is ready when you are. Find your key, settle into a rhythm, and make a little progress.`}
            </p>
            <Link
              className="white-button"
              to={nudge?.to ?? `/song/${featured.id}`}
            >
              Pick up where you left off <ArrowRight size={18} />
            </Link>
          </div>
          <div className="featured-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-chord">
              <ChordDiagram
                song={featured}
                name={
                  featured.measures.flatMap((m) => m.chords)[0]?.chordName ??
                  "G"
                }
              />
              <span>{featured.title}</span>
            </div>
            <span className="music-spark spark-one">✦</span>
            <span className="music-spark spark-two">✧</span>
            <span className="art-note">a little practice goes a long way</span>
          </div>
        </div>
      )}
      <div className="library-toolbar">
        <label className="search">
          <Search size={19} />
          <input
            placeholder="Search songs, artists, lyrics or chords…"
            aria-label="Search songbook"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="key-hint">⌘ K</span>
        </label>
        <button
          className={filter ? "selected" : ""}
          onClick={() => setFilter(!filter)}
          aria-expanded={filter}
        >
          <SlidersHorizontal size={17} />
          Filters
        </button>
        <select
          aria-label="Sort songs"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="title">Title A–Z</option>
          <option value="artist">Artist</option>
          <option value="added">Recently added</option>
          <option value="difficulty">Easiest first</option>
          <option value="practiced">Last practiced</option>
        </select>
        <IconButton
          label={trash ? "Back to songbook" : "Open trash"}
          onClick={() => setTrash(!trash)}
        >
          <Trash2 size={18} />
        </IconButton>
      </div>
      {filter && (
        <div className="filter-panel card form-row">
          <label>
            Tuning
            <select value={tuning} onChange={(e) => setTuning(e.target.value)}>
              <option value="">All tunings</option>
              {tunings.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Key
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="">All keys</option>
              {[...new Set(active.map((s) => s.currentKey.root))].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Maximum difficulty: {max}/10
            <input
              type="range"
              min="1"
              max="10"
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              setTuning("");
              setKey("");
              setMax(10);
              setTag("All songs");
            }}
          >
            Reset filters
          </button>
        </div>
      )}
      <div className="tag-row">
        <div>
          {["All songs", ...tags].map((t) => (
            <button
              key={t}
              className={`tag ${t === tag ? "active" : ""}`}
              aria-pressed={t === tag}
              onClick={() => setTag(t)}
            >
              {t}
              {t === "All songs" && <span>{active.length}</span>}
            </button>
          ))}
        </div>
        <span className="muted">
          {songs.length} {songs.length === 1 ? "song" : "songs"}
        </span>
      </div>
      {songs.length ? (
        <div className="song-grid">
          {songs.map((song, i) => (
            <SongCard key={song.id} song={song} index={i} trash={trash} />
          ))}
          {!trash && (
            <button className="import-card" onClick={() => navigate("/import")}>
              <span className="import-plus">
                <Plus size={27} />
              </span>
              <strong>Make room for a new favorite</strong>
              <span>Import a chart or start from scratch</span>
              <span className="accent-text">
                Add to your songbook <ArrowUpRight size={16} />
              </span>
            </button>
          )}
        </div>
      ) : (
        <Empty
          title={trash ? "Nothing in the trash" : "A fresh page for your music"}
        >
          <p>
            {search
              ? "No songs match those filters. Try a broader search."
              : "Import a chart or create your first song."}
          </p>
          <Link className="primary" to="/import">
            <FolderInput size={18} />
            Import a song
          </Link>
        </Empty>
      )}
      <div className="library-footer">
        <span>
          <span className="local-dot" />
          Your music lives on this device
        </span>
        <span>Built for the way you play.</span>
      </div>
      {create && (
        <Modal title="Start something good" onClose={() => setCreate(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const s = newSong(title.trim() || "Untitled song");
              state.add(s);
              setCreate(false);
              navigate(`/song/${s.id}?edit=1`);
            }}
          >
            <label>
              Song title
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What are we playing?"
              />
            </label>
            <p className="muted">
              Start with a blank measure. Add chords, lyrics or tab in the
              editor.
            </p>
            <button className="primary" type="submit">
              Create song <ArrowRight size={18} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function SongCard({
  song,
  index,
  trash,
}: {
  song: Song;
  index: number;
  trash: boolean;
}) {
  const toast = useToast();
  const unique = [
    ...new Set(song.measures.flatMap((m) => m.chords.map((c) => c.chordName))),
  ];
  return (
    <article className={`song-card card palette-${index % 5}`}>
      <Link to={`/song/${song.id}`} className="song-card-main">
        <div className="song-card-top">
          <span className="song-icon">
            <Music2 size={23} />
          </span>
          <span className="key-badge">
            {song.currentKey.root}
            {song.currentKey.mode === "minor" ? "m" : ""}
          </span>
        </div>
        <h2>{song.title}</h2>
        <p>{song.artist || "Your original arrangement"}</p>
        <div className="song-chord-preview" aria-hidden="true">
          {unique.slice(0, 5).map((n, i) => (
            <span key={n}>
              {n}
              {i < Math.min(unique.length, 5) - 1 && <i />}
            </span>
          ))}
        </div>
        <div className="song-meta">
          <span>
            {resolveTuning(song.tuningId).label.replace(" (EADGBE)", "")}
          </span>
          <span>{song.capo ? `Capo ${song.capo}` : "No capo"}</span>
          <span>{song.tempo} BPM</span>
        </div>
        <Difficulty
          value={song.difficulty}
          override={song.difficultyOverride}
        />
      </Link>
      <div className="song-card-footer">
        <span className="mini-tag">
          {song.tags.find((t) => t !== "Public domain") ?? "Original"}
        </span>
        {trash ? (
          <button
            onClick={() => {
              useSongStore.getState().restore(song.id);
              toast("Song restored.");
            }}
          >
            <RotateCcw size={15} />
            Restore
          </button>
        ) : (
          <IconButton
            label={`Move ${song.title} to trash`}
            onClick={() => {
              useSongStore.getState().remove(song.id);
              toast("Song moved to trash.", () =>
                useSongStore.temporal.getState().undo(),
              );
            }}
          >
            <Trash2 size={15} />
          </IconButton>
        )}
      </div>
    </article>
  );
}
