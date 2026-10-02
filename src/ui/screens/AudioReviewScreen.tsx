import { Link, useParams } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { AudioIntelligenceReview } from "../components/AudioIntelligenceReview";

export function AudioReviewScreen() {
  const { id } = useParams();
  const song = useSongStore((state) => state.songs.find((item) => item.id === id && !item.deletedAt));
  if (!song?.provenance?.audioReview) return <section className="card"><h1>Audio transcription unavailable</h1>
    <Link to="/">Back to songbook</Link></section>;
  return <section className="card"><AudioIntelligenceReview key={song.id} song={song}/></section>;
}
