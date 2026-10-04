# Labeling YouTube lessons for `pnpm bench:youtube`

The benchmark compares Gemini's chord timeline with yours. Copy
`manifest.example.json` to `manifest.json`, then add one case per video. Live
runs save raw responses under `recordings/` (git-ignored).

## Manifest format

```jsonc
{
  "version": 1,
  "cases": [{
    "id": "lesson-01",                 // any unique name
    "videoId": "dQw4w9WgXcQ",          // the 11 characters after watch?v= or youtu.be/
    "title": "…", "artist": "…",       // optional: sent only by the hints (a) variants
    "tuning": "Standard (EADGBE)",     // optional hint, FretShift tuning label
    "capo": 0,                         // optional hint, fret number
    "closeUp": true,                   // fretting hand clearly visible? (c) only applies when true
    "startSeconds": 42,                // analyzed range, seconds from the start of the video
    "endSeconds": 162,                 // keep each range ≤ 10 minutes
    "durationSeconds": 734,            // whole video length (YouTube shows it)
    "grid": { "tempoBpm": 92, "firstDownbeatSeconds": 44.1, "meter": 4 },
    // or, for rubato/tempo changes, every beat instead of "grid":
    // "beats": [44.1, 44.75, 45.40, …],
    "chords": [                        // one entry per change; each lasts until the next
      { "start": 42, "label": "N.C." },
      { "start": 44.1, "label": "G" },
      { "start": 49.32, "label": "D/F#" }
    ]
  }]
}
```

Chord labels use FretShift's vocabulary: root `A`–`G` with optional `#`/`b`,
quality `m`, `dim`, `aug`, `sus2`, `sus4` or `5`, extensions in the order `6 7
maj7 9 maj9 11 13 add9 b5 #5 b9 #9 #11 b13`, optional `/bass`. Use `N.C.` for
talking, silence and single-note riffs.

## Checklist (5–10 lessons, about 20 minutes each)

1. **Pick variety**: at least two close-up lessons (hand fills the frame), two
   wide shots, one with a capo, one in 3/4 or with a tempo change, one where the
   teacher talks between playing passages. Public videos only.
2. **Choose a 1–3 minute range** that contains playing, not just talk. Note
   `startSeconds`/`endSeconds` and the full `durationSeconds`.
3. **Grid first**: in FretShift's tap-along (or any tap-tempo tool), tap 16+
   beats of the main groove. Write `tempoBpm`, the time of the first beat 1
   (`firstDownbeatSeconds`) and the `meter`. If the tempo drifts, list `beats`.
4. **Label chords at 0.75× speed**, writing the time of each change to ±0.1 s
   (YouTube's "," and "." keys step frame by frame while paused). Name the
   **sounding** chord: with a capo, transpose the shape (G shape, capo 2 → A).
5. **Mark non-chord time** as `N.C.` (talking, demonstrations of single notes).
6. **Check one pass** by playing the video while reading your list; fix any
   change that is more than a quarter-beat off.
7. **Keep it private**: label chords and times only. Never copy lyrics into the
   manifest.

## Running

```sh
pnpm bench:youtube                                   # SIMULATED, no network (synthetic manifest)
YOUTUBE_BENCH_LIVE=1 GEMINI_API_KEY=… pnpm bench:youtube      # PAID, direct to Gemini
YOUTUBE_BENCH_LIVE=1 YOUTUBE_IMPORT_URL=https://<project>.supabase.co/functions/v1/youtube-import \
  FRETSHIFT_USER_ACCESS_TOKEN=… SUPABASE_ANON_KEY=… pnpm bench:youtube   # PAID, through the deployed function
YOUTUBE_BENCH_REPLAY=test-fixtures/youtube/recordings/<file>.json pnpm bench:youtube   # re-score, no network
```

Live runs refuse to start above `YOUTUBE_BENCH_MAX_REQUESTS` (default 60).
Narrow them with `YOUTUBE_BENCH_VARIANTS=baseline,a-hints,d-passes-3`. Each
live run records every response so later scoring changes cost nothing.
