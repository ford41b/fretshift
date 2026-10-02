import { type Song, type Voicing, resolveTuning } from "../../schema/song.v1";
import { findVoicings } from "../../theory/voicingSearch";
import { useSettingsStore } from "../../store/settingsStore";
import { displayName } from "../../transforms";
export function ChordDiagram({
  song,
  name,
  voicing,
  compact = false,
}: {
  song: Song;
  name: string;
  voicing?: Voicing;
  compact?: boolean;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const v =
    voicing ??
    findVoicings(name, resolveTuning(song.tuningId), song.capo, 1)[0];
  const frets =
    v?.frets.filter((f): f is number => typeof f === "number" && f > 0) ?? [];
  const start = Math.max(
    1,
    Math.min(...frets, 99) > 4 ? Math.min(...frets) : 1,
  );
  const x = (s: number) => 25 + (settings.leftHanded ? s : 5 - s) * 14;
  return (
    <svg
      className={`chord-diagram ${compact ? "compact" : ""}`}
      viewBox="0 0 126 145"
      role="img"
      aria-label={`${displayName(name, song, settings.nameDisplay)} chord diagram${settings.leftHanded ? ", left handed" : ""}${v ? ", frets low to high " + [...v.frets].reverse().join(",") : ", no playable voicing"}`}
      data-mirrored={settings.leftHanded}
    >
      <text x="63" y="17" className="diagram-title" textAnchor="middle">
        {displayName(name, song, settings.nameDisplay)}
      </text>
      {!v ? (
        <text x="63" y="80" textAnchor="middle" fontSize="11">
          No voicing
        </text>
      ) : (
        <>
          <g fill="none" stroke="currentColor" opacity=".42">
            {Array.from({ length: 6 }, (_, i) => (
              <line key={"s" + i} x1={x(i)} y1="46" x2={x(i)} y2="126" />
            ))}
            {Array.from({ length: 5 }, (_, i) => (
              <line
                key={"f" + i}
                x1="25"
                y1={46 + i * 20}
                x2="95"
                y2={46 + i * 20}
                strokeWidth={i === 0 && start === 1 ? 3 : 1}
              />
            ))}
          </g>
          {start > 1 && (
            <text x="10" y="60" fontSize="10">
              {start}
            </text>
          )}
          {v.frets.map((f, s) =>
            f === "x" || f === 0 ? (
              <text key={s} x={x(s)} y="36" textAnchor="middle" fontSize="12">
                {f === "x" ? "×" : "○"}
              </text>
            ) : (
              <g key={s}>
                <circle
                  cx={x(s)}
                  cy={56 + (f - start) * 20}
                  r="5.5"
                  fill="var(--accent-text)"
                />
                {v.fingering?.[s] && (
                  <text
                    x={x(s)}
                    y={59 + (f - start) * 20}
                    textAnchor="middle"
                    fontSize="7"
                    fill="var(--card)"
                  >
                    {v.fingering[s]}
                  </text>
                )}
              </g>
            ),
          )}
          {v.barre && (
            <line
              x1={x(v.barre.fromString)}
              x2={x(v.barre.toString)}
              y1={56 + (v.barre.fret - start) * 20}
              y2={56 + (v.barre.fret - start) * 20}
              stroke="var(--accent-text)"
              strokeWidth="10"
              strokeLinecap="round"
            />
          )}
        </>
      )}
    </svg>
  );
}
export function ChordLabel({
  song,
  name,
  voicing,
}: {
  song: Song;
  name: string;
  voicing?: Voicing;
}) {
  const mode = useSettingsStore((s) => s.settings.nameDisplay);
  return (
    <span className="chord-label" tabIndex={0}>
      {displayName(name, song, mode)}
      <span className="chord-tooltip">
        <ChordDiagram song={song} name={name} voicing={voicing} />
      </span>
    </span>
  );
}
