import { useState } from "react";
import { BUILT_IN_TUNINGS, resolveTuning } from "../../schema/song.v1";
import type { FingeringOptions, ReviewedNote } from "../../schema/audioNotes";
import {
  fingeringCandidates,
  suggestFingerings,
} from "../../audio/intelligence/fingering";
import { quantizeNote } from "../../audio/intelligence/noteReview";
import type { AudioReview } from "../../audio/intelligence/review";
import { noteLabel } from "../../theory/pitch";

type Props = {
  review: AudioReview;
  selected: string;
  select: (id: string) => void;
};
export function AudioTabLane({
  review,
  selected,
  select,
  playhead,
}: Props & { playhead: number }) {
  const t = review.noteTranscription!;
  const tuning = resolveTuning(t.options.tuningId).midi;
  return (
    <div className="ai-tab-lane" aria-label="Six-string tablature">
      {review.reviewed.beats.map((beat, i) => (
        <i
          key={i}
          aria-hidden="true"
          className="ai-tab-grid"
          style={{ left: `${(beat / review.duration) * 100}%` }}
        />
      ))}
      <em
        className="ai-tab-cursor"
        aria-hidden="true"
        style={{ left: `${(playhead / review.duration) * 100}%` }}
      />
      {tuning.map((midi, string) => (
        <div
          key={string}
          className="ai-tab-string"
          style={{ top: 24 + string * 36 }}
        >
          <span>
            {noteLabel(midi).replace(/\d/g, "")}
            <small>{string + 1}</small>
          </span>
        </div>
      ))}
      {t.notes
        .filter((n) => !n.deleted)
        .map((n, i) => (
          <button
            key={n.id}
            aria-label={`Note ${i + 1}, ${noteLabel(n.midi)}, ${n.fingering ? `suggested string ${n.fingering.string + 1} fret ${n.fingering.fret}` : "no playable fingering"}, ${n.confirmed ? "confirmed" : "unconfirmed"}`}
            aria-pressed={n.id === selected}
            className={`ai-tab-note ${n.confirmed ? "confirmed" : "uncertain"} ${n.id === selected ? "selected" : ""}`}
            style={{
              left: `${(n.start / review.duration) * 100}%`,
              top: 9 + (n.fingering?.string ?? 6) * 36,
              width: `max(28px, ${((n.end - n.start) / review.duration) * 100}%)`,
            }}
            onClick={() => select(n.id)}
          >
            <b>{n.fingering?.fret ?? "?"}</b>
            <span>{n.confirmed ? "✓" : "·"}</span>
          </button>
        ))}
      <div className="ai-tab-unplaced">Unplaced</div>
    </div>
  );
}

export function AudioNoteEditor({
  review,
  selected,
  select,
  change,
  playhead,
  audition,
}: Props & {
  change: (fn: (r: AudioReview) => void) => void;
  playhead: number;
  audition: (a: number, b: number) => void;
}) {
  const [error, setError] = useState("");
  const t = review.noteTranscription!;
  const live = t.notes
    .filter((n) => !n.deleted)
    .sort((a, b) => a.start - b.start);
  const note = live.find((n) => n.id === selected) ?? live[0];
  const raw = t.detected.notes.find((n) => n.id === note?.detectedId);
  const candidates = note ? fingeringCandidates(note.midi, t.options) : [];
  let quantized: ReviewedNote["quantized"] = null;
  try {
    if (note) quantized = quantizeNote(note, review);
  } catch {
    /* Timing editor supplies a usable grid. */
  }
  function edit(patch: Partial<ReviewedNote>) {
    if (!note) return;
    setError("");
    const updated = { ...note, ...patch };
    if (
      !Number.isFinite(updated.start) ||
      !Number.isFinite(updated.end) ||
      updated.start < 0 ||
      updated.end > review.duration ||
      updated.end <= updated.start ||
      !Number.isInteger(updated.midi) ||
      updated.midi < 0 ||
      updated.midi > 127
    ) {
      setError(
        "Use a MIDI pitch from 0 to 127 and positive note times inside the recording.",
      );
      return;
    }
    change((r) => {
      const nt = r.noteTranscription!;
      nt.notes = nt.notes.map((n) =>
        n.id === note.id
          ? { ...updated, confirmed: false, quantized: null }
          : n,
      );
      nt.notes = suggestFingerings(nt.notes, nt.options);
    });
  }
  function options(patch: Partial<FingeringOptions>) {
    try {
      const value = { ...t.options, ...patch };
      const notes = suggestFingerings(
        t.notes.map((n) => ({ ...n, confirmed: false })),
        value,
      );
      change((r) => {
        r.noteTranscription!.options = value;
        r.noteTranscription!.notes = notes;
      });
      setError("");
    } catch {
      setError(
        "Choose at least one string and an ordered fret range from 0 to 22.",
      );
    }
  }
  return (
    <section className="ai-note-editor" aria-label="Guitar note editor">
      <div className="ai-note-heading">
        <div>
          <span className="eyebrow">YOUR GUITAR, YOUR CHOICES</span>
          <h3>Shape the passage</h3>
        </div>
        <span className="ai-note-count">
          {live.filter((n) => n.confirmed).length} / {live.length} confirmed
        </span>
      </div>
      <p>
        Pitch suggests a note, not a string. Frets below are playable
        suggestions. Listen, correct, then confirm each note for practice.
      </p>
      <p className="muted">
        Single-note passages only. Chords and multiple guitars cannot be
        separated. Voicing needs confirmation.
      </p>
      <details className="ai-guitar-options">
        <summary>Guitar setup &amp; playing position</summary>
        <div className="ai-controls">
          <label>
            Tuning
            <select
              aria-label="Tuning"
              value={t.options.tuningId}
              onChange={(e) => options({ tuningId: e.target.value })}
            >
              {BUILT_IN_TUNINGS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capo
            <input
              type="number"
              min="0"
              max="7"
              value={t.options.capo}
              onChange={(e) => options({ capo: Number(e.target.value) })}
            />
          </label>
          <label>
            Lowest fret
            <input
              type="number"
              min="0"
              max="22"
              value={t.options.minFret}
              onChange={(e) => options({ minFret: Number(e.target.value) })}
            />
          </label>
          <label>
            Highest fret
            <input
              type="number"
              min="0"
              max="22"
              value={t.options.maxFret}
              onChange={(e) => options({ maxFret: Number(e.target.value) })}
            />
          </label>
          <label>
            Playing position
            <input
              type="number"
              min="0"
              max="22"
              value={t.options.position}
              onChange={(e) => options({ position: Number(e.target.value) })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={t.options.preferOpen}
              onChange={(e) => options({ preferOpen: e.target.checked })}
            />{" "}
            Prefer open strings
          </label>
        </div>
        <fieldset>
          <legend>Available strings · 1 is the highest string</legend>
          <div className="ai-controls">
            {[0, 1, 2, 3, 4, 5].map((string) => (
              <label key={string}>
                <input
                  type="checkbox"
                  checked={t.options.availableStrings.includes(string)}
                  onChange={(e) =>
                    options({
                      availableStrings: e.target.checked
                        ? [...t.options.availableStrings, string].sort()
                        : t.options.availableStrings.filter(
                            (s) => s !== string,
                          ),
                    })
                  }
                />
                String {string + 1}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="muted">
          Frets are relative to the capo, within the guitar’s physical fret 22.
          Setup changes clear confirmation.
        </p>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="ai-controls">
        <label>
          Selected note
          <select
            aria-label="Selected note"
            value={note?.id ?? ""}
            onChange={(e) => select(e.target.value)}
          >
            {!live.length && <option value="">No notes yet</option>}
            {live.map((n, i) => (
              <option key={n.id} value={n.id}>
                {i + 1} · {noteLabel(n.midi)} · {n.start.toFixed(2)}s
                {n.confirmed ? " ✓" : " ?"}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            const start = Math.min(
                Math.max(0, playhead),
                review.duration - 0.05,
              ),
              id = crypto.randomUUID();
            change((r) => {
              const nt = r.noteTranscription!;
              nt.notes = suggestFingerings(
                [
                  ...nt.notes,
                  {
                    id,
                    detectedId: null,
                    start,
                    end: Math.min(review.duration, start + 0.25),
                    midi: 64,
                    confirmed: false,
                    uncertain: true,
                    deleted: false,
                    fingering: null,
                    quantized: null,
                  },
                ],
                nt.options,
              );
            });
            select(id);
          }}
        >
          Add note at playhead
        </button>
      </div>
      {note && (
        <div className="ai-note-detail" key={note.id}>
          <div className="ai-note-identity">
            <strong>{noteLabel(note.midi)}</strong>
            <span>
              {note.confirmed
                ? "Confirmed by you"
                : note.uncertain
                  ? "Uncertain · listen and review"
                  : "Edited · awaiting confirmation"}
            </span>
          </div>
          <div className="ai-controls">
            <label>
              Note pitch
              <select aria-label="Note pitch" value={note.midi}
                onChange={e => edit({midi: Number(e.target.value), fingering: null})}>
                {Array.from({length:128},(_,midi)=><option key={midi} value={midi}>{noteLabel(midi)}</option>)}
              </select>
            </label>
            <label>
              Onset seconds
              <input
                type="number"
                min="0"
                max={review.duration}
                step=".01"
                key={`s${note.start}`}
                defaultValue={note.start.toFixed(3)}
                onBlur={(e) => {
                  if (Math.abs(Number(e.target.value) - note.start) > 0.0005)
                    edit({ start: Number(e.target.value) });
                }}
              />
            </label>
            <label>
              Duration seconds
              <input
                type="number"
                min=".01"
                max={review.duration}
                step=".01"
                key={`d${note.end - note.start}`}
                defaultValue={(note.end - note.start).toFixed(3)}
                onBlur={(e) => {
                  if (
                    Math.abs(Number(e.target.value) - (note.end - note.start)) >
                    0.0005
                  )
                    edit({ end: note.start + Number(e.target.value) });
                }}
              />
            </label>
          </div>
          <details><summary>Advanced: chart timing</summary><p className="ai-grid-note">
            {quantized
              ? `Chart grid: beat ${quantized.startBeat.toFixed(2)} → ${quantized.endBeat.toFixed(2)} (zero-based, sixteenth-note grid).`
              : "Set a beat grid to preview musical quantization."}{" "}
            Source seconds stay separate.
          </p></details>
          <h4>Choose a fingering</h4>
          <div className="ai-fingerings">
            {candidates.map((f) => (
              <button
                key={`${f.string}:${f.fret}`}
                aria-pressed={
                  note.fingering?.string === f.string &&
                  note.fingering?.fret === f.fret
                }
                onClick={() => edit({ fingering: { ...f, source: "user" } })}
              >
                <span>String {f.string + 1}</span>
                <strong>Fret {f.fret}</strong>
              </button>
            ))}
          </div>
          {!candidates.length && (
            <p role="status">
              No playable position in this setup. Correct the pitch or expand
              the fret/string range.
            </p>
          )}
          {note.fingering && (
            <div className="ai-controls">
              <p>
                {note.fingering.source === "user"
                  ? "Your fingering choice"
                  : "Suggested fingering"}{" "}
                · string {note.fingering.string + 1}
              </p>
              <label>
                Edit fret
                <input
                  type="number"
                  min="0"
                  max="22"
                  key={`f${note.fingering.fret}`}
                  defaultValue={note.fingering.fret}
                  onBlur={(e) => {
                    const fret = Number(e.target.value),
                      string = note.fingering!.string;
                    const midi =
                      resolveTuning(t.options.tuningId).midi[string] +
                      t.options.capo +
                      fret;
                    if (
                      !fingeringCandidates(midi, t.options).some(
                        (f) => f.fret === fret && f.string === string,
                      )
                    ) {
                      setError("That fret is outside this guitar setup.");
                      return;
                    }
                    if (fret !== note.fingering!.fret)
                      edit({
                        midi,
                        fingering: { string, fret, source: "user" },
                      });
                  }}
                />
              </label>
              <small>
                Changing the fret also changes the reviewed sounding pitch.
              </small>
            </div>
          )}
          <div className="ai-controls">
            <button onClick={() => audition(note.start, note.end)}>
              Loop selected note
            </button>
            <label>
              <input
                type="checkbox"
                checked={note.uncertain}
                onChange={(e) => edit({ uncertain: e.target.checked })}
              />{" "}
              Mark uncertain
            </label>
            <button
              className="primary"
              disabled={!note.fingering || note.confirmed}
              onClick={() =>
                change((r) => {
                  const n = r.noteTranscription!.notes.find(
                    (n) => n.id === note.id,
                  )!;
                  n.confirmed = true;
                  n.uncertain = false;
                })
              }
            >
              Confirm note
            </button>
            {note.confirmed && (
              <button onClick={() => edit({ confirmed: false })}>
                Unconfirm note
              </button>
            )}
            <button
              onClick={() => {
                edit({ deleted: true });
                select(live.find((n) => n.id !== note.id)?.id ?? "");
              }}
            >
              Delete note
            </button>
          </div>
          <details>
            <summary>Advanced: original pitch, timing &amp; uncertainty evidence</summary>
            <p>
              {raw
                ? `Detected ${noteLabel(raw.midi)} (${raw.midi}), ${raw.start.toFixed(4)}–${raw.end.toFixed(4)} s. Harmonic evidence ${raw.confidence.toFixed(3)}; this is not an accuracy probability.`
                : "Added by you; no detected pitch or timing exists."}
            </p>
            <p>
              Inferred articulation: unknown. No bend, slide, hammer-on,
              pull-off or string identity was detected.
            </p>
          </details>
        </div>
      )}
      <details>
        <summary>Advanced: detector scope &amp; saved evidence</summary>
        {t.detected.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <p>
          {t.detected.frames.length} raw frames retained,{" "}
          {t.detected.hopSeconds.toFixed(4)} s hop. Deleted detections remain in
          the saved evidence.
        </p>
      </details>
    </section>
  );
}
