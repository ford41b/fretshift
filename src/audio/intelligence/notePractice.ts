import { hasMediaTimeline, type Song } from "../../schema/song.v1";
import { noteLabel } from "../../theory/pitch";
import { audioChartSignature, sourceBeat } from "./noteReview";

/** Exact source timing, independent of the displayed tab's quantization. No carried-in attack. */
export function audioNotePlan(
  song: Song,
  speed: number,
  first: number,
  last: number,
) {
  const review =
    hasMediaTimeline(song.provenance?.source)
      ? song.provenance?.audioReview
      : undefined;
  const t = review?.noteTranscription;
  if (!review || !t) return null;
  const r = review.reviewed;
  const start =
    first === 0 ? 0 : r.beats[r.firstDownbeatIndex + first * r.meter];
  const end = Math.min(
    review.duration,
    r.beats[r.firstDownbeatIndex + (last + 1) * r.meter] ?? review.duration,
  );
  const valid =
    t.chartSignature === audioChartSignature(song) &&
    start !== undefined &&
    end > start &&
    t.options.tuningId === song.tuningId &&
    t.options.capo === song.capo;
  const notes = t.notes
    .filter((n) => !n.deleted)
    .sort((a, b) => a.start - b.start);
  const targets = notes
    .filter((n) => n.start >= (start ?? 0) && n.start < end)
    .map((n) => {
      const overlaps = notes.some(
        (other) =>
          other.id !== n.id && other.start < n.end && other.end > n.start,
      );
      const measure = Math.max(
        0,
        Math.min(
          song.measures.length - 1,
          Math.floor(sourceBeat(n.start, review) / r.meter),
        ),
      );
      return {
        id: n.id,
        time: (n.start - (start ?? 0)) / speed,
        duration: (Math.min(end, n.end) - n.start) / speed,
        measure,
        slot: Math.max(
          0,
          Math.round((sourceBeat(n.start, review) - measure * r.meter) * 4),
        ),
        label: `${noteLabel(n.midi)}${n.confirmed ? "" : " · needs confirmation"}`,
        kind: "note" as const,
        notes: n.fingering
          ? [
              {
                string: n.fingering.string,
                fret: n.fingering.fret,
                midi: n.midi,
              },
            ]
          : [],
        supported:
          valid &&
          n.confirmed &&
          !n.uncertain &&
          !!n.fingering &&
          !overlaps &&
          n.midi >= 40 &&
          n.midi <= 88,
      };
    });
  const beats = r.beats.flatMap((b, i) =>
    b >= (start ?? 0) && b < end
      ? [
          {
            time: (b - (start ?? 0)) / speed,
            number:
              ((((i - r.firstDownbeatIndex) % r.meter) + r.meter) % r.meter) +
              1,
          },
        ]
      : [],
  );
  return {
    targets,
    beats,
    duration: Math.max(0.01, (end - (start ?? 0)) / speed),
    begin: start ?? 0,
    needsTimingConfirmation:
      !valid ||
      !r.timingConfirmed ||
      song.measures
        .slice(first, last + 1)
        .some((m) => m.timingConfirmed !== true),
    rhythmSupported: targets.every(
      (n, i) => !i || n.time - targets[i - 1].time >= 0.32,
    ),
    countBeat: 60 / r.tempoBpm / speed,
    valid,
  };
}
