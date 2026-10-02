import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cloudAdapter, useCloudStore } from "../../cloud/store";
import { cloudConfig } from "../../cloud/client";
import { resolveTuning, type Song } from "../../schema/song.v1";
import { loadSong } from "../../schema/migrations";
import { ErrorNotice } from "./Common";
import type { ShareRecord } from "../../sync/adapter";
export function ShareSong({
  song,
  disabled,
}: {
  song: Song;
  disabled: boolean;
}) {
  const session = useCloudStore((state) => state.session);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!session) {
      setShares([]);
      return;
    }
    void cloudAdapter(session.user.id)
      .listShares()
      .then((rows) => {
        if (active)
          setShares(
            rows.filter((row) => row.songId === song.id && !row.revokedAt),
          );
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [session, song.id]);
  return (
    <section>
      <h3>Share this arrangement</h3>
      <ErrorNotice error={error} />
      {!cloudConfig() ? (
        <p>Sharing isn't configured. Set up Supabase using README.</p>
      ) : !session ? (
        <p>
          <Link to="/settings">Sign in</Link> to create a read-only link.
        </p>
      ) : (
        <>
          <p className="muted">
            Anyone with the link can view this snapshot and save a copy. Your
            recordings and practice history are excluded.
          </p>
          <button
            disabled={disabled || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const snapshot = loadSong({
                  ...song,
                  ownerId: undefined,
                  referenceAudio: undefined,
                });
                const token = await cloudAdapter(session.user.id).createShare(
                  snapshot,
                  resolveTuning(song.tuningId),
                );
                setShares((current) => [
                  {
                    token,
                    songId: song.id,
                    createdAt: new Date().toISOString(),
                    revokedAt: null,
                  },
                  ...current,
                ]);
              } catch (error) {
                setError(String(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : "Create read-only link"}
          </button>
          {shares.map((share) => (
            <div className="share-link" key={share.token}>
              <label>
                Share link
                <input
                  readOnly
                  value={`${location.origin}/share/${encodeURIComponent(share.token)}`}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await cloudAdapter(session.user.id).revokeShare(
                      share.token,
                    );
                    setShares((current) =>
                      current.filter((row) => row.token !== share.token),
                    );
                  } catch (error) {
                    setError(String(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Revoke link
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
