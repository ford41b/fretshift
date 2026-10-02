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
