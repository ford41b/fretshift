# Smart strumming patterns

This release extends the supplied Liquid Glass Dark Mode build. All rhythm generation, validation, editing, persistence and synthesis run locally. No new runtime dependencies, API keys, inference services or subscriptions are required.

## Using the feature

Open a song or its Practice screen and find **Strumming pattern**. Choose a measure to arrange, then Simple, Recommended or Expressive. Section markers influence the recommendation for that measure and subsequent measures until the next marker.

Open **Musical inputs & assumptions** to choose a practice tempo, meter, playing level or explicit style. Existing song tempo/meter values can be import defaults, so these are labeled provisional until confirmed. Confirm chord timing separately before the engine uses exact written chord positions. The original score is not rewritten by these practice settings.

Tap an event to change only that stroke or accent. A rest occupies its original slot. **Save variation** creates a new named copy inside the song; resetting or regenerating never deletes saved copies. Unsaved edits are discarded when explicitly selecting another pattern or measure. Playback speed is 50–150%, within 20–400 quarter-note BPM. A saved variation retains its saved tempo; the playback speed control changes its audition tempo without changing the saved copy.

## Musical representation and selection

- The library contains 21 curated templates: quarters, spacious half-time, straight eighths, acoustic/folk, country, rock, ballad, straight blues, syncopated pop, muted backbeats, sixteenth funk, waltz, two-beat and compound grooves.
- Other supported meters use conservative grouped pulse, flow and percussive templates. Supported numerators are 2–12; denominators are 2, 4 or 8. Unsupported meters are explained instead of silently converted. Additive defaults include 5-beat 3+2 and 7-beat 2+2+3 groupings; these are suggested arrangements, not inferred recording analysis.
- Events store denominator-beat position, exact slot duration, stroke type, accent strength and optional written chord association. Pattern-level metadata stores meter, subdivision (1, 2 or 4 slots per denominator beat), feel and difficulty. No grid is finer than sixteenth notes.
- Quarter-note BPM is converted using `60 / BPM * 4 / denominator`. A 6/8 bar at quarter-note 120 BPM lasts 1.5 seconds. Changing speed never changes event positions.
- Scoring starts at 100. Difficulty distance costs 32 per tier; tempo-range distance costs 0.35 per BPM. Excess strokes per second cost 18 per stroke above the role's threshold. Supplied style adds 22; appropriate section adds 10; confirmed aligned chord changes add 2 each. Frequent written chord changes penalize rhythmic complexity.
- Complexity includes density, subdivisions, offbeats, beat rests and muted strokes. Simple targets beginner movement, Recommended targets the selected level, and Expressive aims one tier higher, capped at advanced. Tempo penalties may favor an easier alternative at extreme speeds.
- Candidates must have different rhythmic families and different stroke/position sequences; accent-only variants are not treated as three distinct recommendations. Ties use stable template IDs.
- Adaptation emphasizes confirmed chord changes already on the candidate's grid and can replace an on-grid rest/mute with a pitched stroke. The Simple option retains its sparse rhythm. Off-grid changes are never rounded or assigned invented attacks. Titles/artists are never used to infer genre or identify recordings.
- Regeneration deterministically cycles candidates within 16 scoring points of the strongest remaining choice. Narrow template pools may retain the same three options; the UI explains this.

## Persistence and compatibility

`SongV1` gains an optional `strumming` property with its own `schemaVersion: 1`. Existing songs remain valid; no IndexedDB table/index migration is necessary. The feature uses the existing Zustand/Immer song edit path and Dexie persistence, so undo/redo, JSON export, backup and configured song sync retain patterns.

Recommendations are cached per stable measure ID with the engine version, normalized analysis inputs and generation counter. Reopening a song reuses its cached recommendations. Relevant musical changes refresh recommendations. Custom variations live in a separate array and are never rewritten by refresh. Changed inputs produce a review notice; a meter mismatch disables audition of the old-meter variation until a compatible recommendation is selected. Older application versions do not know this optional field and may discard it when re-saving; use this release on devices editing these arrangements.

## Audio

The preview reuses the existing Tone/Web Audio context and metronome timer worker. Absolute event indices anchor scheduling to the audio clock with 120 ms lookahead; animation also follows that clock. Downstrokes sweep a low-to-high neutral guitar-register voicing; upstrokes sweep fewer strings in reverse; short percussive tones represent mutes. Accent controls amplitude. All sounds are synthesized locally.

The optional metronome shares the same clock and uses the current click-sound setting. Score playback and pattern audition are mutually exclusive in Practice. Stop, navigation, input changes, hidden tabs and interrupted scheduling clean up workers, animation frames and scheduled audio nodes. An asynchronous startup token prevents playback after unmount.

## Limitations

- These are suggested one-bar guitar arrangements, not transcriptions or recording recognition.
- Preview audio demonstrates rhythm using a neutral voicing; it does not perform the song's harmonic progression or sound like a sampled acoustic guitar.
- Swing, triplet grids outside compound meter, and inferred additive groupings are not supported. The UI labels straight blues and provisional meter assumptions.
- The feature auditions the selected measure in a loop. It does not automatically perform a changing strumming arrangement across the entire score or share the score player's transport.
- Pause and control changes restart at beat 1. Extreme tempos may still make the Expressive option demanding.
- Offline use requires one completed online load of the production build to install the existing service-worker cache. The feature itself makes no network requests.
- Browser tests exercise Chrome and WebKit at desktop and iPhone-sized viewports; a physical iPhone listening session has not been performed.

## Files

New:
- `src/strumming/schema.ts`, `library.ts`, `engine.ts`, `playback.ts`
- `src/strumming/engine.test.ts`, `playback.test.ts`
- `src/ui/components/StrummingPattern.tsx`, `src/ui/strumming.css`
- `e2e/strumming.spec.ts`
- `scripts/verify-strumming-offline.mjs`
- `pnpm-lock.yaml`, this document

Modified:
- `src/schema/song.v1.ts`: optional versioned strumming payload.
- `src/ui/screens/SongDetail.tsx`, `Practice.tsx`: integrated panel and transport exclusion.
- `package.json`: offline verification command; dependencies unchanged.
- `playwright.config.ts`: optional `E2E_PORT` for conflict-free local verification; the unconfigured test explicitly supplies an invalid URL because the existing app includes a hosted default.
- `src/ui/components/VisionImport.tsx`: scalar effect dependencies resolve the existing hook warning without changing behavior.
- `src/cloud/client.test.ts`: current email-quota wording.
- `e2e/cloud.spec.ts`: select the existing Magic link mode and mock the existing OCR GET status request.
- `e2e/interchange.spec.ts`: single-string test input matches the existing conservative audio importer.
- `e2e/vision.spec.ts`: recognizes the existing sign-in requirement for photo imports.
- `vite.config.ts`: prebundles existing lazy importer dependencies and separates the unconfigured test cache to prevent development-server reloads during browser tests.
- `README.md`: links this release guide.

## Reproduce verification

Use the project's Node version (`.nvmrc`) and install with `pnpm install --frozen-lockfile`.

```sh
pnpm lint
pnpm test
pnpm build
E2E_PORT=5293 pnpm exec playwright test e2e/strumming.spec.ts --project=chromium --project=webkit
pnpm test:offline
```

When running Vitest on Node 26, set `NODE_OPTIONS=--no-experimental-webstorage`; this prevents Node's experimental global storage implementation from shadowing jsdom's browser storage. Run expensive browser and signal-processing suites separately on memory-constrained computers.

The source ZIP excludes dependencies, build caches, browser traces and credentials. Build from source on the existing Vercel project so its existing environment configuration is retained.

## Validation record

- Unit tests: 222 passed in the full suite, then 86 focused rhythm/audio cases passed after adding the invalid-metadata regression (223 total cases).
- ESLint and TypeScript: passed without warnings.
- Production build: passed.
- Rhythm browser checks: 8 passed across Chrome and WebKit, including 375px/390px layouts, light/dark accessibility, save/reload, custom protection, playback and sixteenth-note touch targets.
- Offline production check: passed, including reload, editing, saving, navigation and playback with network disabled.
- Final complete Chromium/unconfigured browser run: 30 passed (2.8 minutes), covering the new feature plus existing song editing, undo/redo, mobile notation, practice sessions, time stretching, import/export, sync, sharing and authentication surfaces.

All original project files are retained. Twelve original files have intentional changes; the rest of the supplied source is preserved.
