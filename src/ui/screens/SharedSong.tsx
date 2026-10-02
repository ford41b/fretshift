import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cloudAdapter } from "../../cloud/store";
import { loadSong } from "../../schema/migrations";
import {
  TuningSchema,
  registerTuning,
  type Song,
  type Tuning,
} from "../../schema/song.v1";
import { transposeKey } from "../../transforms";
import { useSongStore } from "../../store/songStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Notation } from "../components/Notation";
import { PageTitle, ErrorNotice } from "../components/Common";
export function SharedSong() {
  const { token } = useParams();
  const [song, setSong] = useState<Song | null>(null);
  const [tuning, setTuning] = useState<Tuning | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const navigate = useNavigate();
  const settings = useSettingsStore((state) => state.settings);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setSong(null);
    void (async () => {
      try {
        const result = await cloudAdapter().readShare(token ?? "");
        if (!active) return;
        if (!result)
          throw new Error(
            "This link was revoked or is unavailable. Ask the sender for a new link.",
          );
        const parsed = TuningSchema.parse(result.tuning);
        const sharedTuning = parsed.builtIn
          ? parsed
          : { ...parsed, id: `shared-${crypto.randomUUID()}` };
        registerTuning(sharedTuning);
        setTuning(sharedTuning);
        setSong(
          loadSong({
            ...result.song,
            tuningId: sharedTuning.id,
            ownerId: null,
            referenceAudio: undefined,
          }),
        );
      } catch (error) {
        if (active) setError(String(error));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <>
      <PageTitle
        eyebrow="SHARED ARRANGEMENT"
        title={song?.title ?? "Shared song"}
        description="A read-only snapshot. Transpose for your voice, then save your own copy."
      />
      <ErrorNotice error={error} />
      {busy && <p role="status">Loading arrangement…</p>}
      {song && (
        <>
          <div className="button-row">
            <button onClick={() => setSong(transposeKey(song, -1).song)}>
              Transpose down
            </button>
            <button onClick={() => setSong(transposeKey(song, 1).song)}>
              Transpose up
            </button>
            <button
              onClick={async () => {
                try {
                  if (tuning && !tuning.builtIn)
                    await useSettingsStore.getState().addTuning(tuning);
                  const now = new Date().toISOString();
                  const copy = loadSong({
                    ...song,
                    id: crypto.randomUUID(),
                    ownerId: null,
                    deletedAt: null,
                    createdAt: now,
                    updatedAt: now,
                  });
                  useSongStore.getState().add(copy);
                  navigate(`/song/${copy.id}`);
                } catch (error) {
                  setError(String(error));
                }
              }}
            >
              Save a copy
            </button>
          </div>
          <p>
            {song.artist} · {song.currentKey.root} {song.currentKey.mode} · Capo{" "}
            {song.capo} · {tuning?.label}
          </p>
          <Notation song={song} view={settings.defaultView} />
        </>
      )}
    </>
  );
}
