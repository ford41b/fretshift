import { ArrowLeft, ArrowUpRight, Guitar, Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import "../immersive-beta.css";

/** The beta gate deliberately does not mount the live practice room or request microphone access. */
export function ImmersiveBeta() {
  const { id } = useParams();
  const song = useSongStore((state) =>
    id ? state.songs.find((entry) => entry.id === id && !entry.deletedAt) : undefined,
  );
  const practicePath = song ? `/practice/${song.id}` : "/practice";

  return (
    <section className="imm-beta" aria-labelledby="imm-beta-title">
      <div className="imm-beta-orb imm-beta-orb--one" aria-hidden="true" />
      <div className="imm-beta-orb imm-beta-orb--two" aria-hidden="true" />
      <div className="imm-beta-panel">
        <div className="imm-beta-emblem" aria-hidden="true">
          <Guitar size={40} strokeWidth={1.5} />
        </div>
        <span className="imm-beta-kicker"><Sparkles size={13} aria-hidden="true" /> FRETSHIFT / WHAT'S NEXT</span>
        <span className="imm-beta-status"><span className="imm-beta-status-dot" aria-hidden="true" /> IN BETA</span>
        <h1 id="imm-beta-title">Immersive practice<span>.</span><br />Coming soon<span>.</span></h1>
        <p className="imm-beta-description">
          A more immersive way to learn your favorite songs is on the way.
          We're fine-tuning the experience before opening it up for practice.
        </p>
        {song ? <p className="imm-beta-context">In the meantime, keep playing <strong>{song.title}</strong>.</p> : null}
        <div className="imm-beta-actions">
          <Link className="imm-beta-cta" to={practicePath}>
            <Guitar size={18} aria-hidden="true" /> Keep practicing <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <Link className="imm-beta-secondary" to={song ? `/song/${song.id}` : "/"}>
            <ArrowLeft size={17} aria-hidden="true" /> {song ? "Back to song" : "Back to songbook"}
          </Link>
        </div>
        <div className="imm-beta-foot">SIX STRINGS. A NEW WAY TO PRACTICE. SOON.</div>
      </div>
    </section>
  );
}
