import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Play,
  ListMusic,
} from "lucide-react";
import { useSongStore } from "../../store/songStore";
import { type Setlist } from "../../schema/setlist";
import { resolveTuning } from "../../schema/song.v1";
import { planSetlistCapos } from "../../transforms";
import {
  PageTitle,
  Empty,
  Modal,
  IconButton,
  useToast,
  Difficulty,
} from "../components/Common";
export function Setlists() {
  const { songs, setlists, putSetlist, removeSetlist, applySongs } =
    useSongStore();
  const [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [name, setName] = useState("");
  const toast = useToast();
  const current = setlists.find((s) => s.id === selected && !s.deletedAt);
  const live = songs.filter((s) => !s.deletedAt);
  function update(fn: (s: Setlist) => void) {
    if (!current) return;
    const s = structuredClone(current);
    fn(s);
    s.updatedAt = new Date().toISOString();
    putSetlist(s);
  }
  function move(i: number, delta: number) {
    update((s) => {
      const dest = i + delta;
      if (dest < 0 || dest >= s.entries.length) return;
      [s.entries[i], s.entries[dest]] = [s.entries[dest], s.entries[i]];
    });
  }
  return (
    <>
      <PageTitle
        eyebrow="FROM FIRST NOTE TO LAST"
        title={current ? current.name : "Your setlists"}
        description={
          current
            ? "A little planning. A smoother performance."
            : "Bring your songs together for the moment."
        }
        action={
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={18} />
            New setlist
          </button>
        }
      />
      {current ? (
        <>
          <div className="button-row">
            <button onClick={() => setSelected(null)}>← All setlists</button>
            <button
              onClick={() => {
                const plan = planSetlistCapos(
                  current.entries.flatMap(
                    (entry) =>
                      songs.find((song) => song.id === entry.songId) ?? [],
                  ),
                );
                applySongs(plan.songs);
                toast(
                  `Capos planned as one undoable change · ${plan.capoTransitions} capo transition${plan.capoTransitions === 1 ? "" : "s"} · ${plan.tuningTransitions} retune${plan.tuningTransitions === 1 ? "" : "s"}.${plan.warnings.length ? " " + plan.warnings.join(" ") : ""}`,
                  () => useSongStore.temporal.getState().undo(),
                );
              }}
            >
              Plan capos
            </button>
            {current.entries[0] && (
              <Link
                className="primary"
                to={`/stage/${current.entries[0].songId}?setlist=${current.id}`}
              >
                <Play size={16} />
                Stage view
              </Link>
            )}
            <IconButton
              label="Delete setlist"
              onClick={() => {
                removeSetlist(current.id);
                setSelected(null);
                toast("Setlist moved to trash. Undo to restore.", () =>
                  useSongStore.temporal.getState().undo(),
                );
              }}
            >
              <Trash2 size={17} />
            </IconButton>
          </div>
          <label className="setlist-name">
            Setlist name
            <input
              value={current.name}
              onChange={(e) =>
                update((s) => {
                  s.name = e.target.value;
                })
              }
            />
          </label>
          <div className="setlist-entries">
            {current.entries.map((entry, i) => {
              const song = songs.find((s) => s.id === entry.songId),
                previous = songs.find(
                  (s) => s.id === current.entries[i - 1]?.songId,
                );
              if (!song)
                return (
                  <div className="error-notice" key={i}>
                    Song missing from your library.{" "}
                    <button
                      onClick={() =>
                        update((s) => {
                          s.entries.splice(i, 1);
                        })
                      }
                    >
                      Remove entry
                    </button>
                  </div>
                );
              return (
                <div
                  key={`${entry.songId}-${i}`}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", String(i))
                  }
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData("text/plain"));
                    if (
                      !Number.isInteger(from) ||
                      from < 0 ||
                      from >= current.entries.length
                    )
                      return;
                    update((s) => {
                      const [item] = s.entries.splice(from, 1);
                      s.entries.splice(i, 0, item);
                    });
                  }}
                >
                  {previous &&
                    (previous.capo !== song.capo ||
                      previous.tuningId !== song.tuningId) && (
                      <div className="transition-flag">
                        ↳{" "}
                        {previous.tuningId !== song.tuningId
                          ? `Retune to ${resolveTuning(song.tuningId).label}. `
                          : ""}
                        {previous.capo !== song.capo
                          ? `Move capo ${previous.capo} → ${song.capo}.`
                          : ""}
                      </div>
                    )}
                  <article className="setlist-row card">
                    <span className="set-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="grow">
                      <Link to={`/song/${song.id}`}>
                        <h2>
                          {song.title}
                          {song.deletedAt ? " (in trash)" : ""}
                        </h2>
                      </Link>
                      <p>
                        {song.currentKey.root}
                        {song.currentKey.mode === "minor" ? "m" : ""} ·{" "}
                        {resolveTuning(song.tuningId).label} · Capo {song.capo}
                      </p>
                      <input
                        aria-label={`Note for ${song.title}`}
                        value={entry.note ?? ""}
                        placeholder="A note for the moment…"
                        onChange={(e) =>
                          update((s) => {
                            s.entries[i].note = e.target.value;
                          })
                        }
                      />
                    </div>
                    <Difficulty value={song.difficulty} />
                    <IconButton
                      label={`Move ${song.title} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={17} />
                    </IconButton>
                    <IconButton
                      label={`Move ${song.title} down`}
                      disabled={i === current.entries.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={17} />
                    </IconButton>
                    <IconButton
                      label={`Remove ${song.title} from setlist`}
                      onClick={() =>
                        update((s) => {
                          s.entries.splice(i, 1);
                        })
                      }
                    >
                      <Trash2 size={17} />
                    </IconButton>
                  </article>
                </div>
              );
            })}
          </div>
          <label className="add-to-set">
            Add a song
            <select
              value=""
              onChange={(e) => {
                if (e.target.value)
                  update((s) => s.entries.push({ songId: e.target.value }));
              }}
            >
              <option value="">Choose from your songbook…</option>
              {live.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          {!current.entries.length && (
            <Empty title="Every set starts with one song">
              <p>
                Choose a song above, then drag or use arrows to arrange the
                order.
              </p>
            </Empty>
          )}
        </>
      ) : (
        <div className="song-grid">
          {setlists
            .filter((s) => !s.deletedAt)
            .map((s) => (
              <button
                key={s.id}
                className="card setlist-card"
                onClick={() => setSelected(s.id)}
              >
                <ListMusic size={32} />
                <h2>{s.name}</h2>
                <p>{s.entries.length} songs</p>
                <span className="accent-text">Open setlist →</span>
              </button>
            ))}
          {!setlists.some((s) => !s.deletedAt) && (
            <Empty title="Give your next set a home">
              <p>
                Group a few favorites, plan your capo changes and take the
                stage.
              </p>
            </Empty>
          )}
        </div>
      )}
      {creating && (
        <Modal title="Name your set" onClose={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const now = new Date().toISOString(),
                s = {
                  id: crypto.randomUUID(),
                  name: name.trim() || "Untitled set",
                  entries: [],
                  createdAt: now,
                  updatedAt: now,
                };
              putSetlist(s);
              setSelected(s.id);
              setCreating(false);
              setName("");
            }}
          >
            <label>
              Setlist name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sunday porch session"
              />
            </label>
            <button className="primary" type="submit">
              Create setlist
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
