/** Deterministic guitar-like signals, NOT recordings or accuracy validation. */
export function pluckedSignal(
  rate: number,
  duration: number,
  notes: { at: number; midi: number; amplitude?: number; decay?: number }[],
  noise = 0,
) {
  let seed = 12345;
  return Float32Array.from({ length: Math.round(rate * duration) }, (_, i) => {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    let value = noise * ((seed >>> 0) / 2147483648 - 1);
    for (const n of notes) {
      const age = t - n.at;
      if (age < 0) continue;
      const hz = 440 * 2 ** ((n.midi - 69) / 12);
      const envelope =
        Math.min(1, age / 0.003) * Math.exp(-age / (n.decay ?? 0.28));
      // Harmonics decay faster than the fundamental, approximating a clean pluck.
      for (let h = 1; h <= 6; h++)
        value +=
          (((n.amplitude ?? 0.16) * envelope * Math.exp(-age * (h - 1) * 2)) /
            (h * h)) *
          Math.sin(2 * Math.PI * hz * h * age + h * 0.1);
    }
    return value;
  });
}

export const STANDARD = [40, 45, 50, 55, 59, 64];
/** Voicing low E → high E, e.g. "x32010" or "10-12-12-11-10-10". Returns sounding MIDI notes. */
export function voicingMidi(voicing: string, tuning = STANDARD, capo = 0) {
  const frets = voicing.includes("-") ? voicing.split("-") : [...voicing];
  return frets.flatMap((f, i) => (f === "x" ? [] : [tuning[i] + capo + Number(f)]));
}
/** Generated strum (NOT a recording): strings staggered like a pick sweep, slight detune per string. */
export function strumSignal(
  rate: number,
  duration: number,
  strums: { at: number; midis: number[]; direction?: "down" | "up"; spread?: number; amplitude?: number }[],
  noise = 0.002,
) {
  return pluckedSignal(
    rate,
    duration,
    strums.flatMap(({ at, midis, direction = "down", spread = 0.012, amplitude = 0.07 }) =>
      (direction === "down" ? midis : [...midis].reverse()).map((midi, i) => ({
        at: at + i * spread,
        midi: midi + (((i * 37) % 7) - 3) / 100, // ±3 cents, deterministic
        amplitude: amplitude * (1 - i * 0.06),
        decay: 0.9,
      })),
    ),
    noise,
  );
}

/**
 * Generated stand-in for one labeled recording (NOT a recording): 1 s lead
 * silence, strums 2 s apart. Used to exercise the chord harness end to end.
 */
export function syntheticRecording(
  rate: number,
  entry: { label: string; strums: number; strum: string; dynamics?: string; file: string; played: string; target: { voicing: string } },
) {
  const target = voicingMidi(entry.target.voicing);
  const played =
    entry.label === "wrong-chord"
      ? voicingMidi(entry.played.split(" ")[1])
      : entry.label === "missing-tone"
        ? [...(entry.file.match(/missing-strings-(\d)(\d)/)?.slice(1) ?? [])]
            .map((s) => 6 - Number(s))
            .flatMap((i) => {
              const f = [...entry.target.voicing][i];
              return f === "x" ? [] : [STANDARD[i] + Number(f)];
            })
        : entry.label === "single-note"
          ? [Math.min(...target)]
          : target;
  const duration = 1 + Math.max(1, entry.strums) * 2 + 1;
  const at = (i: number) => 1 + i * 2;
  if (entry.label === "muted" || entry.label === "silence") {
    let seed = 99;
    return Float32Array.from({ length: Math.round(rate * duration) }, (_, n) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const t = n / rate,
        white = (seed >>> 0) / 2147483648 - 1;
      if (entry.label === "silence") return white * 0.002;
      // Damped strum: a short broadband thump with no sustained pitch.
      const hit = Array.from({ length: entry.strums }, (_, i) => t - at(i)).find((age) => age >= 0 && age < 0.08);
      return white * (0.002 + (hit === undefined ? 0 : 0.25 * Math.exp(-hit / 0.015)));
    });
  }
  return strumSignal(
    rate,
    duration,
    Array.from({ length: entry.strums }, (_, i) => ({
      at: at(i),
      midis: played,
      direction: entry.strum === "up" ? ("up" as const) : ("down" as const),
      spread: entry.strum === "pick" ? 0 : 0.012,
      amplitude: entry.dynamics === "soft" ? 0.035 : 0.07,
    })),
  );
}
