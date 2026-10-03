> **Current snapshot: post-Phase-3 production validation, 2026-09-27.** See [validation](AUDIO_INTELLIGENCE_VALIDATION.md) and [cumulative handoff](FRETSHIFT_AUDIO_INTELLIGENCE_VALIDATION_HANDOFF.md). Notes/tab are implemented but experimental; validation does not establish production transcription accuracy. Earlier phase reports are historical evidence.

> Smart strumming release: see [STRUMMING_ENGINE.md](STRUMMING_ENGINE.md) for usage, engine rules, persistence, audio, limitations and verification.

# FretShift

An offline guitar songbook, notation editor and practice companion. The original requirements are in `BUILD_SPEC.md`. Read `TODO.md` for stage status and unverified hardware/service work, and `DECISIONS.md` for explicit tradeoffs.

Audio Intelligence Phase 3 adds opt-in single-note detection, editable source-aligned tablature, constrained fingering suggestions and confirmed-note Immersive Practice. Recognition remains experimental and real-corpus recall is low. See [GUITAR_TAB_TRANSCRIPTION.md](GUITAR_TAB_TRANSCRIPTION.md), [GUITAR_TAB_TEST_RESULTS.md](GUITAR_TAB_TEST_RESULTS.md) and [FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_3_HANDOFF.md](FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_3_HANDOFF.md). The existing chord/rhythm workflow and its validation evidence remain included.

## Run

Use Node 22 (`nvm use`, from `.nvmrc`) and pnpm 10.15.1 with `pnpm install --frozen-lockfile`.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. Five deletable public-domain sample arrangements are seeded only on the first launch. No account is required. Browser storage is origin-specific: use the same local URL to return to your library.

## Validate

```sh
pnpm lint
pnpm test
pnpm build
pnpm test:edge          # Deno 2: youtube-import Edge Function tests
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Local Playwright uses installed Google Chrome for the Chromium project and bundled WebKit for the WebKit project. CI installs both engines. The committed GitHub Actions workflow runs all checks, but a local passing check is not an observed remote CI run.

## Playing and editing

- Open a song and switch between Chord, Tab and Combined. Views never alter song data.
- In Edit notation, click a tab cell. Arrows navigate; digits enter frets (two digits within 400ms); H holds; X mutes; Delete clears. Tab/Shift+Tab move between adjacent rendered measures. Cmd/Ctrl+Z undoes; add Shift to redo.
- Chord names store sounding harmony. Shape display subtracts capo. Frets are relative to capo. Retuning preserves exact MIDI wherever possible; flagged pitches must be reviewed, never silently clamped.
- Use the controls in order: key, tuning, then explicit capo suggestion. Key/tuning changes never move the capo.
- Difficulty is recalculated from the specified rubric. Levels 1–4 simplify, 5–6 leave the arrangement alone, 7–10 attempt a measured enrichment. A ceiling or blocked arrangement returns unchanged with a reason.
- The source editor supports `[C@1.5]` for exact beat positions. Portable ChordPro export omits these beat annotations. Standard ChordPro names are played shapes plus a capo directive; JSON is the full-fidelity song format.
- Trash is recoverable. Library backup merges by ID on import; export your current backup before replacing revisions. Reference audio is local and excluded from JSON backups.

## Import and export

- MIDI, MusicXML and Guitar Pro imports require an explicit guitar-track choice when a file contains multiple parts. Unsupported timing/effects fail visibly instead of being rounded or discarded. Independent upstream GP5 and MusicXML fixtures guard basic third-party compatibility.
- Text-layer PDFs are read locally. Suggested page boundaries can be merged or split before saving one or more editable songs. When the optional vision service is configured, photos and scanned or mixed PDFs can be resized, stripped of photo metadata, uploaded transiently, and reviewed as an editable draft.
- Printable chord sheets export as Letter or A4 PDFs with chord diagrams, page numbers, and either sounding names or capo-relative shape names.
- The older single-string audio/microphone draft remains available under Import → Audio recording. The new Audio Intelligence upload supports a separate chord and timing review; see `AUDIO_IMPORT.md`.
- Import → YouTube link turns a public YouTube lesson into the same editable chord/beat review. A signed-in user's link (plus optional title, artist, tuning, capo and time range) is analyzed by Google's Gemini API through the `youtube-import` Edge Function; FretShift never downloads YouTube audio or video and never requests lyrics. Review uses an embedded YouTube player, a tap-along tempo/downbeat control and optional beat snapping; nothing is saved until you choose Save. See `AUDIO_IMPORT.md` and `YOUTUBE_IMPORT_HANDOFF.md`.

### Audio Intelligence Phase 1 (experimental foundation)

Phase 1 added the local analyzer in `src/audio/intelligence/` for beats, downbeat candidates, chord segments, and provisional measures; it was not wired into Import then. Phase 2 now provides upload, review, and explicit Song saving, while retaining the older draft. Run `pnpm bench:audio-intelligence` for the synthetic benchmark and `pnpm bench:audio-real` for the four-clip GuitarSet benchmark. Read `AUDIO_INTELLIGENCE_ARCHITECTURE.md` and `AUDIO_INTELLIGENCE_VALIDATION.md` before extending the analyzer. No stem or trained note model is installed. Phase 3 installs an opt-in local YIN note provider; run `pnpm bench:audio-notes` for its separate evaluation. The real-acoustic benchmark shows the current analyzer needs substantial recognition and timing improvement before automatic transcription claims.

## Practice

Open Practice from a song. Tap Play to enable audio, choose a section or loop brackets, and set the speed. The microphone is optional; automatic clean-pass ramps require it, while “That was clean” allows manual advancement. Reference recordings are prepared in a local worker before playback and stay on this device. Confirm their original tempo and alignment offset. The supported reference rate is 0.1×–8×; a too-short recording gives an actionable error.

Use Tuner & Metronome for a warm-up, Drills for a full 60-second scored exercise, and Progress for saved sessions and practice focus. Stage view supports space/arrows and requests a screen wake lock when supported. Hardware accuracy is not established by synthetic tests.

## Offline and privacy

Songs, setlists, practice data and custom tunings use IndexedDB. Device preferences also use a validated synchronous local cache. Production builds cache the app shell and bundled assets with a service worker, after the first online load. Development requires the local Vite server. Microphone, reference audio and audio analysis never leave the device. Photo/scan upload occurs only after the user chooses files and requires the separately configured vision proxy. A YouTube link, its time range and optional hints are sent to Google's Gemini API only after a one-time notice and an explicit Analyze; the embedded YouTube player (privacy-enhanced host) loads only after that notice.

## Optional network services

The app works without an account. When configured, native Supabase REST integration provides passwordless email authentication (8-digit verification code or magic link), per-record sync with conflict resolution, and revocable public song links. Supabase Edge Functions proxy photo/scanned-PDF transcription and YouTube link analysis. Missing configuration remains explicit; no production fake responses are used. Copy `.env.example` to `.env.local` for local configuration and never commit real secrets.

- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: preferred current Supabase browser key. RLS protects account data.
- `VITE_SUPABASE_ANON_KEY`: legacy browser key; still supported for existing projects.
- `OCR_SPACE_API_KEY`: **server-only**, stored using Supabase Edge Function secrets, never a `VITE_` variable.
- `GEMINI_API_KEY`: **server-only** Edge Function secret for `youtube-import`; optional `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_TIMEOUT_MS`, `YOUTUBE_CALLS_PER_HOUR` (20) and `YOUTUBE_CALLS_PER_DAY` (60).
- `ALLOWED_ORIGINS`: comma-separated deployed app origins for the vision and YouTube functions.

Apply `supabase/migrations/202609120001_sync.sql`, configure the Auth Site URL and `${origin}/settings` redirect, set `OCR_SPACE_API_KEY`, then deploy `supabase/functions/vision-import`. For hosted Auth, set both the **Magic link** and **Confirm signup** email templates to include `{{ .Token }}` and `{{ .ConfirmationURL }}`; `supabase/templates/` contains the ready-to-copy FretShift template. Verification-code sign-in is recommended for installed iPhone web apps because the session is created inside the app instead of depending on Safari-to-PWA storage transfer. The committed `supabase/config.toml` disables Supabase's legacy platform JWT gate for this function because FretShift verifies the bearer session inside the function itself; this also works with current asymmetric Auth signing keys. OCR.space Engine 3 extracts chart text; FretShift converts chord lines and adjacent lyrics into an editable draft. Prepared JPEG pages are compressed below OCR.space's free-plan 1 MB file limit. The provisional rendered corpus contains 20 cases (24 pages). Generate or inspect it with `pnpm generate:vision-corpus`; run the live benchmark with `pnpm bench:vision` only after supplying `VISION_IMPORT_URL`, a Supabase public key (`SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`), and `FRETSHIFT_USER_ACCESS_TOKEN`. Without those variables the benchmark records a skipped run and makes no API call.

Local automated tests cover PostgREST-shaped responses, account isolation, sync conflicts/failures, owner share management, public copies, preprocessing, proxy validation, configured mocked browser flows, and unconfigured behavior. They do not establish a deployed database's RLS/grants, live email/auth recovery, cross-device behavior, OCR.space retention, or OCR accuracy on real charts.
For a non-destructive live smoke test after deployment, run `pnpm verify:live`. It verifies Auth reachability, the public share RPC, and vision CORS without creating records or calling OCR.space. If `FRETSHIFT_USER_ACCESS_TOKEN` is supplied, it also verifies the signed-in sync/RPC path and performs an invalid-body vision request that cannot reach the OCR provider. `FRETSHIFT_USER_ACCESS_TOKEN` means a FretShift user-session JWT; do not put a Supabase CLI personal access token there.


## Deploy (human step)

Commit and push this repository to your own remote, observe Actions, then import into Vercel or Netlify. Both configurations are committed. Build command is `pnpm build`, output is `dist`. HTTPS is required for microphone and wake lock outside localhost.

No deployment, live vision benchmark, SMTP delivery or real cross-device verification is claimed by the local build.
