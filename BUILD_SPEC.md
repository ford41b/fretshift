# FretShift — Complete Build Prompt

You are building FretShift end to end in a single autonomous run. This document has three parts: **Part A** tells you how to work, **Part B** tells you what to build, **Part C** tells you the order and how you'll know each stage is done. Read all three before writing any code.

---

# PART A — HOW TO WORK

## A1. Mode of operation

- **Nobody is watching this run.** Every decision point below has a stated default. Take the default, log it, keep moving. Never stop to ask a question.
- **Do everything that can be done without human-provided secrets first.** Key-dependent work (Section B21) comes last and is built behind environment checks so that the run completes even if no keys are present.
- **Finish and polish each stage before starting the next.** Do not scaffold all four stages with placeholder logic. Each stage has a Definition of Done (Section C2).
- **Use real execution.** Terminal, test runner, dev server, and a real browser for anything past pure logic. Look at the rendered notation view early, while redirecting is cheap.

## A2. Required files you maintain

- **`DECISIONS.md`** at the repo root. Every assumption made to resolve ambiguity, every stack substitution, every "couldn't complete X because Y" gets a dated entry with reasoning. Updated in the same commit as the code it describes.
- **`TODO.md`** at the repo root. Every item marked `[Human+Hardware]` in Part C, every missing-prerequisite checklist, and every stuck item goes here as an open task. Never claim these done.
- **`README.md`** — how to run, test, deploy, and configure keys (Section B21).

## A3. Rules

1. **Commit cadence:** commit after every green test run with a message naming what was made to pass. Never leave more than one feature's worth of uncommitted work.
2. **Stuck rule:** if a specific step fails after a few genuine attempts (a test won't pass, a build won't run, a library won't install), stop retrying it. Leave a clearly marked `TODO` in the code *and* in `DECISIONS.md` with what you tried and why it failed, then move to the next item. "Stuck" is a stop condition for that item, not a reason to keep retrying the same fix.
3. **Missing secrets rule:** if a required key or service (Section B21) is absent, do **not** stub around it with fake responses in production code. Build the real integration, read config from environment variables, render a clear "Not configured" state in the UI with setup instructions, test the integration against a mocked transport, and write the human's setup checklist into `TODO.md`. Then continue.
4. **Never silently degrade.** No clamping, dropping, or guessing in music logic (Section B3). No swallowed errors in UI. No skipped tests marked as passing.
5. **Schema is the source of truth.** Types are derived from Zod schemas; never hand-write divergent types.
6. **Red CI blocks the next stage.** If the pipeline is red at a stage boundary, fix it or log the stuck item before moving on.

## A4. Tech stack (defaults — substitute only with a logged reason)

| Layer | Choice | Why |
|---|---|---|
| Runtime / tooling | Node 20 LTS (`.nvmrc`), pnpm, Vite | Pinned so CI and local match |
| Frontend | React 18 + TypeScript (strict) | Many interlocking fields; TS catches breakage in transposition/capo logic |
| Schema | Zod; TS types via `z.infer` | Spec and validator cannot drift |
| State | Zustand + Immer middleware + `zundo` (temporal undo/redo) | Nested state reads as direct mutation; undo for free |
| Local persistence | Dexie (IndexedDB) behind repository interfaces (`SongRepository`, `SetlistRepository`, `PracticeRepository`, `SettingsRepository`) | Stage 1 survives refresh; Stage 4 swaps adapters without touching UI |
| Styling | Tailwind + CSS variables for tokens | Both themes are just variable sets |
| Renderer | SVG | DOM events, `aria-*`, CSS tokens, focus work natively |
| Routing | React Router | Standard |
| Testing | Vitest (jsdom) + fast-check (property tests) + Playwright + `@axe-core/playwright` | jsdom cannot measure color contrast; that needs a real browser |
| Audio scheduling | Web Audio API; timer in a Web Worker | `setInterval` drifts and throttles in background tabs |
| Playback synthesis | Tone.js | Adequate MIDI-quality guitar |
| Pitch detection (real-time) | YIN autocorrelation, on-device | Monophonic; proven |
| Onset detection | Spectral flux on device | For strum-timing and heatmap signals |
| Audio-to-chords (offline) | Chroma features + chord-template matching + HMM/Viterbi smoothing, beat tracking via onset autocorrelation, all in a Web Worker. Essentia.js (WASM) is an acceptable drop-in. | On-device, no key, no upload |
| Time-stretch | A WASM phase-vocoder or WSOLA library (e.g. `soundtouchjs` or `rubberband-wasm`) | Pitch-preserving tempo change |
| PDF | pdf.js for text layer and page rasterization | On-device |
| Guitar Pro | alphaTab for parsing `.gp3/.gp4/.gp5/.gpx/.gp`; alphaTab's exporter for writing. If export proves unreliable, log it and rely on MusicXML. | Only mature open-source GP library |
| MusicXML / MIDI | Hand-written serializers/parsers over the internal model (small, testable); `@tonejs/midi` acceptable for MIDI | Full control of round-trip |
| PDF chord sheets | `@react-pdf/renderer` or `pdf-lib` | Structured, not screenshot |
| Randomness | Seeded PRNG (mulberry32 or `seedrandom`) | Re-rolls reproducible in tests |
| Vision | Multimodal LLM via a Supabase Edge Function proxy; strict JSON; runtime-validated | Keys never ship to the client |
| Backend | Supabase (Postgres + Auth + Storage + Edge Functions) | One provider for auth, DB, storage, RLS, proxy |
| Hygiene / CI | ESLint + Prettier; GitHub Actions runs `pnpm lint`, `pnpm test`, `pnpm test:e2e` on every push | Red pipeline blocks the next stage |
| Hosting | Static frontend to Vercel or Netlify (config committed; deployment itself is a human step) | Default |

## A5. Repository layout

```
/
├─ .nvmrc  .github/workflows/ci.yml  package.json  pnpm-lock.yaml
├─ README.md  DECISIONS.md  TODO.md
├─ src/
│  ├─ schema/        song.v1.ts, setlist.ts, practice.ts, settings.ts, migrations.ts
│  ├─ theory/        pitch.ts, chordName.ts, chordDictionary.ts, enharmonics.ts, voicingSearch.ts
│  ├─ transforms/    transposeKey.ts, transposeTuning.ts, capo.ts, difficulty.ts, scale.ts
│  ├─ io/            chordpro/, json/, midi/, musicxml/, guitarpro/, pdfText/, pdfSheet/, backup/
│  ├─ audio/         context.ts, metronome/, tuner/, pitch/, onset/, playback/, timestretch/, audioToChords/
│  ├─ vision/        client.ts (calls proxy), types.ts
│  ├─ store/         songStore.ts, practiceStore.ts, setlistStore.ts, settingsStore.ts
│  ├─ persistence/   repositories.ts, dexie/, supabase/, fakes/
│  ├─ sync/          engine.ts, adapter.ts, conflicts.ts
│  ├─ ui/            components/, screens/, tokens.css
│  └─ samples/       public-domain sample songs as ChordPro + JSON
├─ supabase/
│  ├─ migrations/    SQL for tables, RLS, triggers
│  └─ functions/vision-import/   index.ts, prompt.v1.md, README.md
├─ test-fixtures/    golden pitch table, rubric fixtures, ChordPro corpus, vision-corpus/
└─ e2e/              Playwright specs
```

State your final file structure in `DECISIONS.md` before writing feature code; justify deviations.

---

# PART B — WHAT TO BUILD

## B1. Overview

FretShift is a web app for guitarists who want to take any song — from a photo, a PDF, a text chart, a recording, or a notation file — and make it their own: convert between chord and tab notation, put it in a singable key, retune or capo it to suit their hands, simplify or enrich the arrangement, and practice it with real-time feedback and tools that track improvement.

Three promises govern every feature:

1. **Any song comes in, any song goes out.** Multiple import paths, multiple export formats, no lock-in.
2. **Every transformation is musically honest.** Pitch is preserved through retuning, chord names always describe what the listener hears, nothing is silently clamped, dropped, or guessed.
3. **Machine-generated content is always a draft.** Photo, PDF, and audio transcriptions are editable starting points with visible confidence — never ground truth.

## B2. Users

Hobbyists learning from photographed charts; singers who need playable shapes in a comfortable key; alternate-tuning and fingerstyle players who need charts re-derived for DADGAD or Drop D; gigging players who need setlists, capo planning, and a stage-readable view; beginners who need songs simplified and drills with feedback.

## B3. Core concepts and rules

### B3.1 Data model

Zod schemas in `src/schema/` must produce exactly these types via `z.infer`.

```ts
// ---- Constants ----
export const A4_HZ_DEFAULT = 440;   // user-adjustable 432–446
export const MAX_FRET = 22;
export const MAX_CAPO = 7;
export const STRING_COUNT = 6;

export type NoteName =
  | "C" | "C#" | "Db" | "D" | "D#" | "Eb" | "E" | "F" | "F#" | "Gb"
  | "G" | "G#" | "Ab" | "A" | "A#" | "Bb" | "B";

export interface Key { root: NoteName; mode: "major" | "minor" }

// ---- Tunings: data, not a union. midi index 0 = high E … 5 = low E ----
export interface Tuning {
  id: string;            // built-ins use stable slugs; custom use uuid
  label: string;
  midi: [number, number, number, number, number, number];
  builtIn: boolean;
}
export const BUILT_IN_TUNINGS: Tuning[] = [
  { id: "standard",  label: "Standard (EADGBE)", midi: [64,59,55,50,45,40], builtIn: true },
  { id: "drop-d",    label: "Drop D",            midi: [64,59,55,50,45,38], builtIn: true },
  { id: "dadgad",    label: "DADGAD",            midi: [62,57,55,50,45,38], builtIn: true },
  { id: "open-g",    label: "Open G",            midi: [62,59,55,50,43,38], builtIn: true },
  { id: "open-d",    label: "Open D",            midi: [62,57,54,50,45,38], builtIn: true },
  { id: "drop-c",    label: "Drop C",            midi: [62,57,53,48,43,36], builtIn: true },
  { id: "half-down", label: "Half-step down",    midi: [63,58,54,49,44,39], builtIn: true },
];

// ---- Voicing ----
type Fret = number | "x";               // number = fret (0 = open), "x" = muted
type Finger = 0 | 1 | 2 | 3 | 4;
export interface Voicing {
  frets: [Fret, Fret, Fret, Fret, Fret, Fret];      // 0 = high E … 5 = low E
  barre?: { fret: number; fromString: number; toString: number };
  fingering?: [Finger, Finger, Finger, Finger, Finger, Finger];
}

// ---- Chord events ----
export interface ChordEvent {
  id: string;
  beat: number;            // 0-indexed; fractional only in multiples of 1/subdivision
  chordName: string;       // SOUNDING name (B3.3)
  voicing?: Voicing;       // chosen by Chord→Tab or the user; absent = default lookup
  voicingPinned?: boolean; // true = transforms may not replace it
}

// ---- Tab grid ----
export type Cell = number | null | "hold" | "x";
export type Slot = [Cell, Cell, Cell, Cell, Cell, Cell];
export interface TabFrame { slots: Slot[] }  // length = beatsPerMeasure × subdivision

// ---- Measures & songs ----
export type SectionKind = "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "solo" | "outro" | "custom";
export interface Section { kind: SectionKind; label?: string }  // marks the START of a section

export interface Measure {
  id: string;
  index: number;
  timeSignature?: [number, number];
  tempoOverride?: number;
  subdivision: number;
  section?: Section;
  lyrics?: string;
  chords: ChordEvent[];
  tab?: TabFrame;
  outOfRange?: boolean;
}

export interface Provenance {          // present on machine-derived drafts
  source: "photo" | "pdf-scan" | "pdf-text" | "audio" | "midi" | "musicxml" | "guitarpro" | "chordpro" | "manual" | "json";
  confidence?: Record<string, number>; // JSON-path → 0..1
  overallConfidence?: number;
  modelId?: string;
  promptVersion?: string;
  processedAt?: string;
}

export interface Song {
  schemaVersion: 1;
  id: string;
  title: string;
  artist: string;
  originalKey: Key;
  currentKey: Key;
  tuningId: string;
  capo: number;                       // 0–MAX_CAPO
  tempo: number;                      // BPM, default 120
  timeSignature: [number, number];
  difficulty: number;                 // 1–10, rubric-computed on save
  difficultyOverride?: number;
  tags: string[];
  measures: Measure[];
  provenance?: Provenance;
  referenceAudio?: { fileName: string; offsetMs: number; sourceTempo: number }; // file itself stays in IndexedDB blob store
  ownerId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

// ---- Setlists ----
export interface SetlistEntry { songId: string; note?: string }
export interface Setlist {
  id: string; name: string; entries: SetlistEntry[];
  ownerId?: string | null; createdAt: string; updatedAt: string; deletedAt?: string | null;
}

// ---- Practice records (NEVER on Song) ----
export interface PracticeSession {
  id: string; songId: string; startedAt: string; durationSec: number;
  tempoMultiplierMax: number; loopCount: number;
}
export interface HeatmapEntry { songId: string; measureId: string; score: number; updatedAt: string }
export interface ChordPairRecord { chordA: string; chordB: string; tuningId: string; best: number; history: { at: string; count: number }[] }
export interface StrumRecord { at: string; tempo: number; score: number; meanOffsetMs: number }

// ---- Settings ----
export interface Settings {
  theme: "system" | "dark" | "light";
  leftHanded: boolean;
  a4Hz: number;
  defaultView: "chord" | "tab" | "combined";
  metronome: { sound: "click" | "wood" | "beep"; countIn: 0 | 1 | 2; accentDownbeat: boolean; subdivisionClicks: boolean };
  nameDisplay: "sounding" | "shape";
}
```

### B3.2 Practice state (`practiceStore`, not persisted with songs)
Loop region (`loopStartMeasureId`, `loopEndMeasureId`), tempo multiplier, scroll position, ramp config and progress, active drill state, upscale seed. Editing a song never touches practice history; practicing never dirties the song.

### B3.3 Sounding vs. shape names
`chordName` always stores the **sounding** chord. With `capo: 2` in Standard, a song in D stores `"D"`; the hand plays a C shape. The UI derives shape names from `chordName + capo + tuning` and every chord-name surface offers a **Sounding / Shape** toggle. All transforms operate on sounding names. Vision import must ask for sounding names *and* detected capo.

### B3.4 Chord-name grammar
`<Root><Quality?><Extensions?>(/<Bass>)?` — Root/Bass ∈ `NoteName`; Quality ∈ `{"", "m", "dim", "aug", "sus2", "sus4", "5"}`; Extensions ∈ `{"6", "7", "maj7", "9", "maj9", "11", "13", "add9", "b5", "#5", "b9", "#9", "#11", "b13"}` combinable in that order. One `parseChordName()` / `formatChordName()` pair with round-trip property tests; everything else consumes the parsed form.

### B3.5 Enharmonic spelling
Roots use the key signature's accidental (flats in F/Bb/Eb/Ab/Db/Gb and relative minors; sharps elsewhere). Out-of-key chords prefer fewer accidentals; ties follow the key.

### B3.6 `"hold"` rules
Allowed in slot 0 (continues from the previous measure). A hold with no prior strike on that string in this measure or the last slot of the previous measure is a validation error, never a silent blank.

### B3.7 Out-of-range rule
If a transform yields fret `< 0` or `> MAX_FRET` with no octave-equivalent alternative, leave the cell unchanged and set `measure.outOfRange = true`. The UI flags it. Never clamp or drop.

### B3.8 Order of operations
Key transposition → tuning transposition → capo optimization. Each operates on the previous output. No other ordering exposed.

### B3.9 Capo is user-owned
Capo optimization runs only on explicit "Suggest capo" or as part of difficulty downscale. Key and tuning changes never move the capo.

### B3.10 Two kinds of audio analysis
- **Real-time microphone** (tuner, live pitch, drills, heatmap signals): on-device, frame-by-frame, **monophonic**. Does not identify arbitrary chords; drills are designed around this (B10).
- **Offline analysis of a complete recording** (audio-to-chords): heavier on-device batch process producing tempo, key, and a harmonic label per beat. Always a draft.

### B3.11 Lossy scaling
`upscale(downscale(song))` need not equal the original. By design.

## B4. Songbook (home)

Create from scratch or any import; responsive card grid (title, artist, key, tuning, capo, difficulty meter with numeric label, tags); search by title/artist/lyric/chord; filter and sort by tuning, key, artist, difficulty range, tags, last practiced, date added; free tagging with suggestions; featured/nudge card at top (B11); undo/redo across all edits including deletes; soft delete to a recoverable trash; whole-library backup export/import (songs, tags, custom tunings, setlists, practice records) as one JSON file.

## B5. Getting songs in

Every path lands in the editable notation view. Machine-derived imports carry `provenance` and render as drafts.

- **B5.1 ChordPro text** — inline `[G]` chords; directives `{title:}`, `{artist:}`, `{key:}`, `{capo:}`, `{tempo:}`, `{time:}`, `{start_of_chorus}`/`{end_of_chorus}`, `{start_of_verse}`/`{end_of_verse}`, `{start_of_bridge}`, `{comment:}`. Deterministic, unit-tested parser and serializer; the source panel round-trips with grid edits.
- **B5.2 Manual grid entry** — per B6.3.
- **B5.3 Structured files** — JSON (own format, validated by B25), MIDI, MusicXML, Guitar Pro (`.gp3/.gp4/.gp5/.gpx/.gp`). Malformed files rejected with a specific message, never partially accepted. Multi-track MIDI/GP prompts for track selection when ambiguous.
- **B5.4 Photo import** — up to 10 images; on-device preprocessing (HEIC→JPEG, longest edge ≈1600px, strip EXIF); sent to the `vision-import` Edge Function (B21); returns a `Song` with sounding names, detected key and capo, per-field confidence keyed by JSON path, `modelId`, `promptVersion`. Confidence shown as underline tint + pattern + tooltip. Side-by-side image/draft review. On 30s timeout, malformed output, or overall confidence < 0.6: retry once, then surface an error naming the page with ChordPro/manual fallback. Prompt lives in `supabase/functions/vision-import/prompt.v1.md`, versioned.
- **B5.5 PDF import** — try the text layer first per page (pdf.js); parse chords/lyrics on device when present. Only scan pages (no usable text) go through the photo path. Detect song boundaries (title lines, page breaks, section directives) and propose a split the user can merge/re-split. Align lyrics across page boundaries.
- **B5.6 Audio-to-chords** — record or upload; on-device analysis in a Web Worker produces tempo, key, and a chord per beat or half-bar with confidence. Review view with waveform, playhead, and scrub-to-chord. Harmony-level only; no tab or melody.

## B6. Notation view and editing

- **B6.1 Layout** — chord strip (diagrams of every distinct chord, current one highlighted during playback); large notation card (SVG fretboard/tab renderer); lyrics with chords beneath, aligned to measures, section labels as headings; sticky pill control bar (key ±, tuning, capo, difficulty slider, Sounding/Shape); slide-out panel (ChordPro source, JSON, export, edit toggles).
- **B6.2 Views** — Chord / Tab / Combined; view changes never change data.
- **B6.3 Keyboard model** — arrows move the cell cursor; Tab/Shift+Tab move between measures; digits enter a fret (two digits within 400ms for 10–22); Backspace/Delete → `null`; `H` → hold; `X` → mute; `0` → open; typing a chord name at a focused beat adds/replaces a chord event; Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo/redo. Focused cell has a visible accent ring; SR announces "String 2, beat 1.5, fret 3." Each measure `<g>` has `role="group"` and an `aria-label` like "Measure 3, G to D, 6 notes."
- **B6.4 Operations** — insert/delete/duplicate/reorder measures; change measure time signature, tempo, subdivision; edit lyrics inline; add/move/delete chord events; pin/unpin voicing; set/clear section label.
- **B6.5 Validation** — live; errors marked inline in red with plain-language text; they do not block editing but block export and sync until resolved.
- **B6.6 Performance** — virtualize measures outside the viewport; a 200-measure song renders and scrolls smoothly.

## B7. Transformations and algorithms

All pure, in `src/theory/` and `src/transforms/`, unit-tested independently of UI, reversible via undo, and each returns a human-readable summary of what changed.

- **Pitch math** — `midiOf(tuning, stringIdx, fret)`, `fretsFor(tuning, midi)`. Golden open-string frequency table (E2 82.41, A2 110.00, D3 146.83, G3 196.00, B3 246.94, E4 329.63) in a fixture.
- **B7.1 Chord → Tab** — curated shapes for Standard and Drop D (E, Em, A, Am, D, Dm, G, C, F, B7, E7, A7, D7, G7, C7, Cmaj7, Am7, Em7, Dsus4, Asus2); otherwise fretboard search: span ≤ 4 frets, positions 0–12, cover all required intervals, score by open strings ↑, root in bass ↑, fewer fretted fingers ↑, no muted inner strings ↑; return top N. Works for any tuning. User cycles alternatives and pins.
- **B7.2 Tab → Chord** — interval table per quality with required vs. optional members; the 5th is optional except in dim/aug. Open C7 (x-3-2-3-1-0) must match `C7`. Ambiguity → top candidates.
- **B7.3 Key transposition** — parse → shift root and bass → respell → format; update `currentKey`; shift tab cells with octave-equivalent search; flag out-of-range; capo untouched. **Property test:** every non-null, non-"x" cell's sounding MIDI moves by exactly `semitones`.
- **B7.4 Tuning transposition** — compute sounding MIDI per cell; find it in the target tuning preferring same string, then adjacent, then any; flag out-of-range. Re-derive unpinned voicings. **Property test (fast-check):** sounding MIDI preserved for every playable cell across all tuning pairs.
- **B7.5 Capo suggestion** — for capo 0–7, re-derive shape voicings, score with the rubric, pick the lowest score whose shapes exist for every chord; ties → lowest capo.
- **B7.6 Difficulty rubric** `scoreDifficulty(song)` — per measure with chords: barre fraction ×3.0 + mean extensions beyond triad ×1.5 + fraction of consecutive pairs with Δ(lowest fretted fret) ≥ 3 ×1.5 − fraction of voicings with ≥ 2 open strings ×1.0. Average over measures; `score = clamp(round(1 + raw × 1.8), 1, 10)`. Missing voicing → default voicing for the song's tuning. Computed on save; manual override shown with a "manual" label alongside.
- **B7.7 Difficulty scaling** — slider 1–10 shows current score; dragging previews "Simplify / Enrich / No change"; release applies, shows a toast with summary and Undo, slider snaps to the new score.
  - **1–4 simplify:** unpinned barres → open equivalents where the dictionary has one → strip extensions beyond triad (keep dominant 7 on V) → capo suggestion. If `score(after) ≥ score(before)`, return input unchanged with "Already as simple as we can make it."
  - **5–6:** no transform; tooltip explains.
  - **7–10 enrich:** seeded PRNG (seed in `practiceStore`; Re-roll increments): add function-appropriate extensions (maj7 on I/IV, 9 on ii/V, etc.) → slash bass for stepwise lines → per-measure fingerstyle pattern into `tab` (root on beat 1, alternating bass, arpeggiated upper strings). Assert `score(after) > score(before)`. Same seed + same input → identical output (tested).

## B8. Chord diagrams

Any chord name anywhere shows a chord-box diagram on hover/tap (grid, finger dots, barre bar, open/muted markers, position number above the nut). Diagrams honor tuning, capo, and Sounding/Shape. Chord strip tap cycles alternative voicings and pins. **Left-handed mode** mirrors diagrams and the fretboard display only — **tab is never mirrored**.

## B9. Practice mode

Audio starts only on a user gesture ("Tap to enable audio"). Explicit states: audio not enabled, permission denied, no input device.

- **B9.1 Metronome** — lookahead scheduler (≈25ms tick, ≈100ms lookahead) with the timer in a Web Worker; tap-tempo; count-in; accented downbeat; subdivision clicks; three click sounds; tempo multiplier; honors `tempoOverride`.
- **B9.2 Tuner** — `getUserMedia` with `echoCancellation: false, noiseSuppression: false, autoGainControl: false`; buffer ≥ 4096 at 44.1kHz; YIN threshold ≈ 0.1; RMS noise gate; 3 consistent frames before showing a note; states no signal / detecting / flat / in tune (±5¢) / sharp; color + arrow + signed cents together; A4 432–446; shows target note per string for the song's tuning.
- **B9.3 Live pitch** — highlights detected single note on fretboard and current tab cell; during chordal passages the highlight follows notation; help text states the monophonic limit.
- **B9.4 Notated playback** — Tone.js; hold = sustain, "x" = short noise burst; respects multiplier; highlights current chord/cell.
- **B9.5 Auto-scroll and loop** — loop by dragging brackets, choosing a section, or keyboard start/end pickers.
- **B9.6 Tempo ramp** — on each clean pass, +N BPM until target. Clean = onsets within tolerance and no stop/rewind; single-note passages also require pitch accuracy. "That was clean" button advances manually. Segmented meter shows progress.
- **B9.7 Reference-recording playalong** — attach a local file (stored as a blob in IndexedDB); set offset and confirm tempo; time-stretch without pitch change to the multiplier; play synced. Never uploaded.

## B10. Drills

- **B10.1 Chord-change trainer** — pick two chords (or accept a suggested hard pair from a song); 60s timer; the app compares the incoming harmonic fingerprint against the two known voicings and counts a **clean transition** each time the match switches within the beat window. Shows count, personal best, history graph. Help text: distinguishes the two chosen chords; not a general detector.
- **B10.2 Strum-timing trainer** — metronome at chosen tempo/pattern; onset detection scored against nearest beat; live rushing/dragging readout with signed ms; per-beat accuracy strip; summary score. Rhythm only.

## B11. Progress and practice log

Auto-logged on device (synced when signed in): per-song time, sessions, max multiplier, tempo-over-time graph; streak ring; **weak-spot heatmap** per measure from stops/rewinds, loop repeats, onset deviation, off-pitch single notes, and explicit "Mark this spot" — overlaid on the tab, tap a hot measure to loop it; nudges on the featured card ("You've done *X* at 90% three times — try 100%", "Your G→D change is slowest — drill it", "Three songs share a key — make a setlist?"); drill personal bests.

## B12. Setlists

Create/rename/reorder (drag + keyboard)/delete; a song can belong to many; entries show key, capo, tuning, difficulty, and a note; transition summary flags capo/tuning changes between consecutive songs; "Plan capos" runs capo suggestion across the set to minimize tuning changes; stage view plays through in order; included in backup and sync.

## B13. Stage view

Full-bleed, very large type, maximum contrast, chords over lyrics (tab optional), section headings, minimal progress bar; tempo-driven auto-scroll with manual override; page turns via space/arrows/Bluetooth pedal (keyboard events); honors Sounding/Shape and capo; shows next song's capo/tuning/note in a setlist; keeps screen awake (Wake Lock API with fallback).

## B14. Getting songs out

JSON (full fidelity); MIDI (single guitar track); MusicXML (chords, lyrics, sections, tab — the recommended interchange); Guitar Pro via alphaTab exporter (secondary; MusicXML if unreliable); printable PDF chord sheet (chords over lyrics, diagram strip, Sounding or Shape, capo/tuning header, Letter and A4); whole-songbook backup; share link when signed in (read-only, opens in recipient's theme and handedness; recipient may transpose and save a copy).

## B15. Accounts, sync, offline

Offline-first — everything except sync, share links, and photo/scan import works with no network. No account required; sign-in later migrates local data. Sync across own devices: last-write-wins on `updatedAt` (server-assigned); when both sides changed since last sync, prompt "Keep mine / Keep server / Keep both as copy"; soft deletes propagate. Every song loaded from Dexie or Postgres passes B25 validation and migrations; failures are quarantined with an explanation. Single-user; no CRDT/OT.

## B16. Settings

Theme (System/Dark/Light), left-handed, A4 reference, default view, metronome sound/count-in/accent/subdivision, custom tuning manager, account and sync status, backup export/import, privacy info. Persist per device; preferences (not device capabilities) sync when signed in.

## B17. Privacy

Photo/scan pages go to the vision proxy transiently, not retained (state this on the Import screen before first upload). Text-layer PDFs, audio-to-chords, and structured imports are on-device. Microphone input never leaves the device. Reference and drill audio stay local unless explicitly shared. Practice history syncs only to the user's own account.

## B18. First-run

Seed the songbook with public-domain samples: *Amazing Grace* (easy, Standard), *House of the Rising Sun* (arpeggio tab, Standard), *Scarborough Fair* (DADGAD), *Wayfaring Stranger* (minor key, capo), *Greensleeves* (3/4). Clearly labeled, deletable. A brief dismissible tour: import paths, control bar, practice mode.

## B19. Interface and design

### B19.1 Character
Soft, card-based. Large rounded tiles (16–24px radius; full pills on controls) on a flat surface, separated by contrast — no hairlines, no heavy shadows. Generous padding; calm empty states.

### B19.2 Tokens (CSS variables; both themes required from Stage 1)

```css
:root[data-theme="dark"] {
  --bg: #0E0F12;  --card: #17181C;  --card-hover: #1E2025;  --border-subtle: #24262C;
  --text: #F2F3F5;  --text-2: #9AA0A8;  --disabled: #3A3D45;
  --accent: #6B4EFF;        /* fills: buttons, active pills, featured cards (white text on it ≈ 5.0:1) */
  --accent-text: #A594FF;   /* accent-colored text/icons on dark surfaces (≈ 8:1 on --bg) */
  --amber: #F5B942;  --red: #FF5C5C;  --ok: #6B4EFF;
}
:root[data-theme="light"] {
  --bg: #F4F5F7;  --card: #FFFFFF;  --card-hover: #F0F1F4;  --border-subtle: #E4E6EB;
  --text: #111216;  --text-2: #5C6370;  --disabled: #C9CDD4;
  --accent: #6B4EFF;  --accent-text: #5A3FE0;   /* ≈ 5.7:1 on white */
  --amber: #B97A0A;  --red: #D92D2D;  --ok: #5A3FE0;
}
```
Contrast values are approximate; **verify with Playwright+axe and adjust lightness rather than exempting a pairing.** Follow `prefers-color-scheme` by default; toggle in rail and settings; persist.

### B19.3 Color usage
Accent for primary actions, current chord/note, featured cards, active segments, chart fills, focus rings, live-pitch glow. Amber for tuner ±5–20¢, low confidence, warm heatmap. Red for tuner >20¢, validation errors, hot heatmap. **Color is never the only signal** (arrows + numbers, underline pattern + tooltip, thicker outline, numeric heat badge).

### B19.4 Type
Display: Space Grotesk (or Manrope) bold. Body: Inter. Data numerals (BPM, cents, difficulty, frets, stats): Inter with `font-variant-numeric: tabular-nums`, large.

### B19.5 Components
Pills (segmented toggles, filter chips, segmented meters); cards; rings (metronome with BPM centered and pulsing on beat, streaks, completion); rounded bars with chunky tooltip bubbles; horizontal pill tuner gauge; chord-box diagrams in the same style.

### B19.6 Screens
- **Songbook:** left icon rail (Songbook, Setlists, Practice, Tuner & Metronome, Import, Progress, Settings) with theme toggle and avatar at bottom, collapsing to a bottom tab bar on mobile; search + chips; featured/nudge card; sticky "+ New Song."
- **Song detail:** chord strip, notation card, lyrics with section headings, sticky pill bar, slide-out panel.
- **Practice:** notation card with metronome ring, tuner gauge, loop/ramp controls, transport; drills as full-screen cards.
- **Setlists:** setlist cards; inside, reorderable list with transition flags and "Plan capos."
- **Progress:** stat cards, tempo charts, chord-pair leaderboard, heatmap entry points.
- **Import:** pill stepper (Choose source → Review pages → Edit draft → Save); rounded thumbnails; side-by-side review.
- **Stage view:** full-bleed minimal.

### B19.7 Motion
Metronome ring pulses; live-pitch glow glides along the string; cards lift slightly on hover. Under `prefers-reduced-motion` everything becomes static; no information depends on animation.

## B20. Accessibility and quality floor

Fully keyboard-operable (tab grid, pills, loop setting with keyboard alternative, setlist reordering, stage view); visible focus everywhere; accessible names; measure and cell announcements per B6.3; WCAG AA in both themes; reduced-motion and color-scheme respected; responsive phone→desktop with finger-sized targets; every screen has loading (skeleton), empty (inviting), and error (what happened + what next) states; audio screens add permission-denied / no-device / audio-disabled; Playwright+axe zero critical or serious violations.

## B21. External services, keys, and how to handle their absence

| Capability | Requires | If absent |
|---|---|---|
| Everything in B4–B14 except photo/scan import and share links | Nothing | — |
| Photo import, scanned-PDF pages | Supabase project + `LLM_API_KEY` as an Edge Function secret; `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local` | Build the Edge Function, client, prompt, and validation fully; test against a mocked transport; UI shows "Photo import isn't configured" with setup steps from README; PDF import still works for text-layer pages |
| Accounts, sync, share links | Same Supabase project with Auth (email + magic link) | Build the sync engine against a `SyncAdapter` interface with an in-memory fake (used in tests) plus the real Supabase adapter; commit SQL migrations, RLS, and `updatedAt` triggers in `supabase/migrations/`; UI shows "Sign in isn't configured" |
| Magic-link email at volume | SMTP provider key in Supabase | Document in README |
| Hosting | Vercel/Netlify account | Commit deploy config; human deploys |

Never place secrets in client code or commits. Provide `.env.example`.

## B22. Out of scope (do not build, do not re-litigate)

Real-time chord recognition from the microphone (single-pitch only; offline audio-to-chords and the two-chord drill are deliberately narrower and in scope); tuplets/triplets/swing; articulations (hammer-on, pull-off, slide, bend, vibrato — `Cell` has no annotation slot; adding one is a schema bump); collaborative editing; instruments other than six-string guitar; effects/amp simulation; social feed, comments, likes, public discovery; fractional/partial capo; guaranteed transcription accuracy; guaranteed reversibility of scaling.

## B23. Vision proxy contract

Edge Function `vision-import`: accepts up to 10 images + optional hints; returns

```ts
interface VisionResult {
  song: Song;                          // sounding names, detected key & capo
  confidence: Record<string, number>;  // JSON-path → 0..1
  overallConfidence: number;
  pageIds: string[];
  modelId: string;
  promptVersion: string;
  processedAt: string;
}
```
Validated by B25 before entering the editor; `modelId` + `promptVersion` stored in `provenance`. Configure the provider for no data retention where available.

## B24. Vision benchmark corpus

`/test-fixtures/vision-corpus/` — ≥ 20 images spanning printed, handwritten-style, glare/skew, multi-page, each with golden JSON. **You may generate a provisional corpus** by rendering the sample ChordPro fixtures to images with synthetic skew/noise; log it as provisional in `DECISIONS.md` and `TODO.md`. Metric: chord accuracy (exact normalized name at correct measure/beat) ≥ 80%; lyric CER ≤ 10%; schema-invalid responses count as 0% for that page. Provide a `pnpm bench:vision` script that runs the corpus when keys are present and writes `RESULTS.md`.

## B25. Schema validation and migrations

`src/schema/song.v1.ts` (Zod; `Song = z.infer<typeof SongV1>`); `src/schema/migrations.ts` as `Record<number, (old: unknown) => unknown>` keyed by from-version; `loadSong(raw)` reads `schemaVersion`, migrates, validates; unknown version → hard error with a clear message. Refinements: `slots.length === beats × subdivision`; hold continuity; `beat` within measure and grid-aligned; `capo ≤ MAX_CAPO`; chord names parse; `tuningId` resolves. Used to gate vision output, JSON/backup import, and every song loaded from Dexie or Postgres. Include a v0→v1 migration fixture (v0 = same shape without `section`, `provenance`, `tuningId` as slug) that round-trips.

---

# PART C — EXECUTION PLAN

## C1. Stage order and contents

Complete each stage, meet its Definition of Done, then proceed. Key-dependent work is isolated to the end of Stage 3 and Stage 4 so the run completes regardless.

### Stage 1 — Songbook and notation engine (no audio, no network, no keys)
Repo, CI, tokens, both themes, settings; Zod schemas + migrations + `loadSong`; chord-name parser/formatter; pitch math; chord dictionary + voicing search + curated shapes; Dexie repositories; song store with undo/redo; Songbook screen; Song Detail with chord strip, SVG renderer (virtualized), lyrics, control bar, slide-out; ChordPro parser/serializer with sections; JSON import/export; keyboard editing; live validation; Chord↔Tab; key transposition; tuning transposition; custom tunings; capo suggestion; rubric; difficulty scaling with seeded re-roll; chord diagrams; left-handed mode; setlists (incl. transition flags and "Plan capos"); whole-library backup; sample songs and tour; loading/empty/error states everywhere.

### Stage 2 — Practice audio (no network, no keys)
AudioContext lifecycle and states; Worker metronome; tuner; live pitch; Tone.js playback; auto-scroll and loop; tempo ramp; reference-recording playalong with time-stretch; chord-change trainer; strum-timing trainer; practice log; heatmap; nudges; Progress screen; Stage view with wake lock.

### Stage 3 — Imports and interchange
Text-layer PDF import with song-boundary detection; on-device audio-to-chords with review UI; MIDI, MusicXML, Guitar Pro import; MusicXML, MIDI, Guitar Pro export; PDF chord sheets; **then** photo import + scanned-PDF path: Edge Function, prompt v1, client, preprocessing, confidence UI, retry/fallback, provisional corpus and bench script (key-gated per B21).

### Stage 4 — Accounts and sync (key-gated per B21)
Supabase SQL migrations with RLS and timestamp triggers; auth (email + magic link); local-to-account migration; `SyncAdapter` (fake + Supabase); sync engine with last-write-wins, conflict prompt, soft deletes; share links; settings sync; validation-on-load for cloud songs.

## C2. Definition of Done (every stage)

All `[Automated]` criteria for the stage green in CI · loading/empty/error states for every new screen · Playwright+axe zero critical/serious in both themes · `DECISIONS.md` updated · `[Human+Hardware]` items listed as open tasks in `TODO.md`, not claimed done · key-gated features show their "Not configured" state cleanly when env vars are absent.

## C3. Acceptance criteria

`[Automated]` = a test confirms it alone. `[Human+Hardware]` = needs a person with a device/instrument; list it, don't claim it.

**Stage 1 [Automated]:** create → persist → reload → render; ChordPro parse/serialize round-trip incl. sections; JSON round-trip; chord↔tab on fixtures incl. open C7; key transposition pitch invariant (property); tuning transposition pitch invariant across all built-in pairs (property); enharmonic spelling fixtures; capo suggestion fixtures; rubric fixtures with hand-verified scores; downscale asserts lower score or returns unchanged; upscale asserts higher score and seed determinism; undo/redo restores exact prior state; chord-name grammar round-trip (property); v0→v1 migration fixture; hold-continuity and slot-length refinements reject bad input; left-handed flag mirrors diagrams and not tab (snapshot); setlist transition flags; backup export→import equality; Playwright+axe on Songbook, Song Detail, Setlists, Settings in both themes.

**Stage 2 [Automated]:** metronome drift < 1ms over 5 min on a mocked clock; pitch-to-note correct for synthetic sines E2–E6 at 0/±10/±40¢; tuner state machine transitions; onset detector on synthetic clicks; rushing/dragging sign correct; two-chord fingerprint discriminates synthetic G vs D voicings; ramp advances only on clean pass; heatmap aggregation; time-stretch preserves pitch on a synthetic tone (spectral peak within ±10¢); practice records never mutate `Song`. **[Human+Hardware]:** real guitar tuning accuracy; metronome feel; live line tracking; chord-change drill on real strums; iOS Safari background stability; foot pedal.

**Stage 3 [Automated]:** MIDI/MusicXML/GP fixture round-trips (import→export→import equality on supported fields); text-layer PDF fixture parses to expected song with correct boundaries; audio-to-chords on a synthetic rendered progression (Tone.js-rendered I–IV–V–I) ≥ 80% chord accuracy; PDF sheet renders both name modes (snapshot); vision client validates and rejects malformed mocked responses; retry-once behavior; preprocessing downsizes and strips EXIF. **[Human review, ongoing]:** vision corpus ≥ 80% chord accuracy / ≤ 10% CER on real photos once keys exist; results in `RESULTS.md`.

**Stage 4 [Automated]:** two simulated clients under last-write-wins; offline edits reconcile without loss; conflict prompt fires when both changed; soft deletes propagate; loaded songs validated against declared `schemaVersion`; local→account migration moves all data; RLS policy tests via the fake adapter contract. **[Human+Hardware]:** real cross-device sync; magic-link email delivery; deployed URL.

## C4. Final handoff

When the run ends, the repo must contain: green CI on the last commit; `README.md` with run/test/deploy/config steps; `.env.example`; `DECISIONS.md` with the full trail; `TODO.md` listing every `[Human+Hardware]` item, every key the human must add (with exact variable names and where they go), every provisional artifact (vision corpus), and every stuck item with what was tried. The app must run locally with `pnpm install && pnpm dev`, fully functional for everything not gated on keys, in both themes, from an empty database seeded with the sample songs.