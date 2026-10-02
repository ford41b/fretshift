import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock3, Flame, TrendingUp, Music2 } from "lucide-react";
import { practiceRepo } from "../../persistence/dexie";
import {
  type PracticeSession,
  type ChordPairRecord,
  type HeatmapEntry,
} from "../../schema/practice";
import { useSongStore } from "../../store/songStore";
import { PageTitle, Empty, ErrorNotice } from "../components/Common";
export function Progress() {
  const songs = useSongStore((s) => s.songs);
  const [sessions, setSessions] = useState<PracticeSession[]>([]),
    [pairs, setPairs] = useState<ChordPairRecord[]>([]),
    [heat, setHeat] = useState<HeatmapEntry[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      practiceRepo.sessions(),
      practiceRepo.pairs(),
      practiceRepo.heatmap(),
    ])
      .then(([s, p, h]) => {
        setSessions(s);
        setPairs(p);
        setHeat(h);
        setReady(true);
      })
      .catch((e) => {
        setError(String(e));
        setReady(true);
      });
  }, []);
  const total = sessions.reduce((sum, s) => sum + s.durationSec, 0),
    days = new Set(sessions.map((s) => new Date(s.startedAt).toDateString()));
  let streak = 0;
  const date = new Date();
  if (!days.has(date.toDateString())) date.setDate(date.getDate() - 1);
  while (days.has(date.toDateString())) {
    streak++;
    date.setDate(date.getDate() - 1);
  }
  const max = Math.max(0, ...sessions.map((s) => s.tempoMultiplierMax));
  return (
    <>
      <PageTitle
        eyebrow="PROGRESS SOUNDS LIKE YOU"
        title="Look how far you've come"
        description="Every minute with your guitar counts."
      />
      <ErrorNotice error={error} />
      {!ready ? (
        <div
          className="skeleton"
          role="status"
          aria-label="Loading practice history"
        >
          <div />
          <div />
        </div>
      ) : (
        <>
          <div className="stats-grid">
            {[
              {
                icon: Clock3,
                value: Math.round(total / 60),
                unit: "minutes played",
                note: "Time well spent",
              },
              {
                icon: Flame,
                value: streak,
                unit: "day streak",
                note: "Keep showing up",
              },
              {
                icon: Music2,
                value: sessions.length,
                unit: "practice sessions",
                note: "One song at a time",
              },
              {
                icon: TrendingUp,
                value: `${Math.round(max * 100)}%`,
                unit: "fastest song speed",
                note: "Your best pace yet",
              },
            ].map((s) => (
              <div className="card stat-card" key={s.unit}>
                <s.icon size={23} />
                <strong>{s.value}</strong>
                <span>{s.unit}</span>
                <small>{s.note}</small>
              </div>
            ))}
          </div>
          {sessions.length ? (
            <>
              <section className="card progress-section">
                <h2>A rhythm of your own</h2>
                <p>
                  Song speed over your last 20 sessions. Hover or focus a
                  session for details.
                </p>
                <div className="tempo-chart">
                  {sessions.slice(-20).map((s) => (
                    <Link
                      key={s.id}
                      to={`/practice/${s.songId}`}
                      title={`${songs.find((x) => x.id === s.songId)?.title ?? "Song"} · ${Math.round(s.tempoMultiplierMax * 100)}% · ${Math.round(s.durationSec / 60)} min`}
                      style={{
                        height: `${Math.max(10, (s.tempoMultiplierMax / Math.max(max, 1)) * 100)}%`,
                      }}
                    >
                      <span>{Math.round(s.tempoMultiplierMax * 100)}%</span>
                    </Link>
                  ))}
                </div>
              </section>
              <section className="card progress-section">
                <h2>Your practice log</h2>
                <div className="practice-log">
                  {[...sessions]
                    .reverse()
                    .slice(0, 30)
                    .map((s) => (
                      <Link to={`/${s.immersive ? "immersive" : "practice"}/${s.songId}`} key={s.id}>
                        <strong>
                          {songs.find((x) => x.id === s.songId)?.title ??
                            "Deleted song"}
                        </strong>
                        <span>
                          {new Date(s.startedAt).toLocaleDateString()}
                        </span>
                        <span>
                          {Math.round(s.durationSec / 60)} min ·{" "}
                          {Math.round(s.tempoMultiplierMax * 100)}% ·{" "}
                          {s.loopCount} loops
                          {s.immersive && <small style={{ display: "block" }}>
                            {s.immersive.mode === "visual"
                              ? `Quiet visual · ${s.immersive.visualProgressPercent ?? 0}% passage progress · unscored`
                              : `Immersive ${s.immersive.mode} · ${s.immersive.matched}/${s.immersive.assessed} pitch matches · ${s.immersive.assessed}/${s.immersive.total} targets assessed`}
                          </small>}
                        </span>
                      </Link>
                    ))}
                </div>
              </section>
            </>
          ) : (
            <Empty title="Your first session is the start of something">
              <p>
                Practice a song and your time, tempo and sessions will appear
                here automatically.
              </p>
              <Link className="primary" to="/practice">
                Find something to play
              </Link>
            </Empty>
          )}
          {pairs.length > 0 && (
            <section className="card progress-section">
              <h2>Chord-change personal bests</h2>
              {[...pairs]
                .sort((a, b) => b.best - a.best)
                .map((p) => (
                  <div
                    className="leaderboard-row"
                    key={`${p.chordA}-${p.chordB}`}
                  >
                    <Link to="/drills">
                      {p.chordA} → {p.chordB}
                    </Link>
                    <strong>{p.best} changes</strong>
                    <span>{p.history.length} sessions</span>
                  </div>
                ))}
            </section>
          )}
          {heat.length > 0 && (
            <section className="card progress-section">
              <h2>A little extra attention</h2>
              <p>Tap a warm spot to open its song for focused practice.</p>
              {[...heat]
                .sort((a, b) => b.score - a.score)
                .slice(0, 8)
                .map((h) => (
                  <Link
                    className="heat-row"
                    to={`/practice/${h.songId}?measure=${h.measureId}`}
                    key={h.measureId}
                  >
                    <span>
                      {songs.find((s) => s.id === h.songId)?.title ?? "Song"} ·
                      measure{" "}
                      {(songs
                        .find((s) => s.id === h.songId)
                        ?.measures.findIndex((m) => m.id === h.measureId) ??
                        -1) + 1}
                    </span>
                    <strong>Focus {Math.round(h.score)}%</strong>
                  </Link>
                ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
