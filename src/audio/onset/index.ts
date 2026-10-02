export function spectrum(samples: Float32Array): Float64Array {
  const n = samples.length;
  if ((n & (n - 1)) !== 0) throw new Error("FFT size must be a power of two.");
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < n; i++)
    re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      let wr = 1,
        wi = 0;
      const cr = Math.cos(angle),
        ci = Math.sin(angle);
      for (let j = 0; j < len / 2; j++) {
        const u = i + j,
          v = u + len / 2,
          tr = re[v] * wr - im[v] * wi,
          ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
        const temp = wr * cr - wi * ci;
        wi = wr * ci + wi * cr;
        wr = temp;
      }
    }
  }
  return Float64Array.from({ length: n / 2 }, (_, i) =>
    Math.hypot(re[i], im[i]),
  );
}
export class OnsetDetector {
  private previous: Float64Array | null = null;
  private average = 0.01;
  private last = -1;
  process(samples: Float32Array, time: number) {
    const spec = spectrum(samples);
    let flux = 0;
    for (let i = 0; i < spec.length; i++)
      flux += Math.max(0, spec[i] - (this.previous?.[i] ?? 0));
    flux /= spec.length;
    const onset =
      flux > Math.max(0.012, this.average * 2.5) && time - this.last > 0.12;
    this.average = this.average * 0.92 + flux * 0.08;
    this.previous = spec;
    if (onset) this.last = time;
    return { onset, flux, time };
  }
}
export function timingOffset(time: number, start: number, bpm: number) {
  const beat = 60 / bpm;
  return (time - start - Math.round((time - start) / beat) * beat) * 1000;
}
export function timingScore(offsets: number[], tolerance = 100) {
  if (!offsets.length) return 0;
  return Math.round(
    (100 *
      offsets.reduce(
        (sum, o) => sum + Math.max(0, 1 - Math.abs(o) / tolerance),
        0,
      )) /
      offsets.length,
  );
}
export function chroma(samples: Float32Array, rate: number) {
  const spec = spectrum(samples),
    out = Array(12).fill(0) as number[];
  for (let i = 1; i < spec.length; i++) {
    const hz = (i * rate) / samples.length;
    if (hz < 55 || hz > 1500) continue;
    const midi = 69 + 12 * Math.log2(hz / 440),
      nearest = Math.round(midi),
      distance = Math.abs(midi - nearest);
    if (distance > 0.4) continue;
    out[((nearest % 12) + 12) % 12] += spec[i] * (1 - distance);
  }
  const norm = Math.hypot(...out);
  return norm ? out.map((v) => v / norm) : out;
}
export function fingerprintMatch(
  observed: number[],
  pitchesA: number[],
  pitchesB: number[],
) {
  const score = (pitches: number[]) => {
    const bins = Array(12).fill(0) as number[];
    pitches.forEach((p) => (bins[((p % 12) + 12) % 12] = 1));
    const norm = Math.hypot(...bins);
    return observed.reduce((sum, v, i) => sum + v * bins[i], 0) / (norm || 1);
  };
  const a = score(pitchesA),
    b = score(pitchesB);
  return {
    match:
      Math.max(a, b) < 0.55 || Math.abs(a - b) < 0.045
        ? null
        : a > b
          ? ("A" as const)
          : ("B" as const),
    confidence: Math.max(a, b),
    margin: Math.abs(a - b),
  };
}
