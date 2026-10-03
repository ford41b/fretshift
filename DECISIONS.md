# FretShift decisions

## 2026-09-09 — Before feature code

- This is an autonomous, local deliverable. Deployment remains a human step per A4/B21; no hosted Site is registered or deployed. The Sites building/hosting workflow was read for interface and validation guidance. Its generated Cloudflare application is not used because this prompt explicitly requests a Vite SPA, Supabase and human-managed Vercel/Netlify deployment. Preserve the requested React 18 stack and directory layout.
- The repository is `outputs/fretshift/`, so the complete source is a user-facing deliverable. The original prompt is preserved in `BUILD_SPEC.md`.
- Final planned structure: `.github/workflows/ci.yml`, `.nvmrc`, package/lock/config files; `src/{schema,theory,transforms,io/{chordpro,json,midi,musicxml,guitarpro,pdfText,pdfSheet,backup},audio/{metronome,tuner,pitch,onset,playback,timestretch,audioToChords},vision,store,persistence/{dexie,supabase,fakes},sync,ui/{components,screens},samples}`; `supabase/{migrations,functions/vision-import}`; `test-fixtures/{vision-corpus,chordpro}`; `e2e`; `scripts`; `public`. Small related modules may share an index file rather than duplicate wrappers; all schema-derived domain types remain in `src/schema`.
- Use the supplied tokens, dark/light/system modes, SVG diagrams and tab. No external image assets are required for a notation workspace. Fonts are packaged locally to preserve offline use.
- Stage gates will be recorded as actual local check results. GitHub CI cannot be claimed green without a remote repository and an observed Actions run. Commit a matching pipeline and list remote verification separately.
- Ambient host Node is 26.7.0. Pin Node 20 in `.nvmrc`, CI and engines; attempt local execution through an installed Node 20 runtime. No secrets are requested or generated; external integrations will be implemented last behind explicit configuration checks.
- Exact-pitch preservation takes precedence over octave substitution where the prompt conflicts (B3.7/B7.3). A failed exact placement retains the original note and visibly flags the measure; reports identify unresolved notes. No pitches are silently octave-shifted. Frets in the model are relative to the capo; sounding MIDI includes capo.
- Holds inherit the active sounding strike through contiguous hold slots, including the prior measure's last slot. Null or mute ends continuity. This makes cross-measure sustain explicit and validates orphan holds.

## 2026-09-09 — Foundation checkpoint

- Local Vitest: 16 tests passed, including grammar properties, exact-pitch transposition, all built-in tuning pairs, C7 identification, rubric fixtures, seed determinism, migration and ChordPro semantics. TypeScript passed before UI authoring.
- Node 20 download was rejected by automatic approval review because the account usage limit was reached. Continue local checks on installed Node 26; Node 20 remains pinned in CI and unverified locally.
- ChordPro import follows shape+capo convention; export reverses to shape names. The source editor uses an explicit optional `@beat` suffix to retain exact grid positions. Portable export omits that extension; arbitrary lexical spacing/comment round-trip is not claimed. JSON is lossless.
- Difficulty enrichment returns an explicit unchanged result at score 10 or when no available unpinned enrichment raises the measured rubric. This resolves the prompt's impossible strictly-higher requirement at the ceiling.
- Muted strings are reserved during retuning assignment. Curated voicings outrank search rediscoveries; ordinary open chord fingerings are not scored as barres.

## 2026-09-09 — Editor checkpoint

- Local unit suite now 20/20; lint, strict type check and production build pass. Browser tests caught contrast, settings reload timing, an undo timing issue and missing SVG roles. Stage 1 browser gate remains open while those are repaired.
- Both themes and responsive SVG notation were visually inspected in the real in-app browser. Playwright uses the installed Chrome locally, Chromium on CI. Traces are disabled after Chrome teardown stalled while writing large failing axe traces; failure context and screenshots remain available.
- Settings use a synchronous schema-validated local preference cache in addition to the Dexie repository to survive immediate full-page navigation after changing a preference.

## 2026-09-09 — Stage 1 local gate

- 20 unit/property/persistence tests and 5 real-Chrome end-to-end tests passed. Axe reports zero serious/critical findings on Songbook, Song Detail, Setlists and Settings in light and dark. Mobile width390 and left-handed diagram/tab separation passed.
- Lint, strict TypeScript and production build pass. Added production app-shell caching for offline navigation. GitHub CI is configured but not remotely observed.
- SVG cells now have valid roles; duplicate semantic history entries are suppressed; no-op edits do not change timestamps. Fixed the observed contrast pairings by using white text and a darker featured-card pill.
- Remaining known Stage 1 scope limitations: arbitrary ChordPro character offsets and measure-specific metadata cannot fully round-trip through standard ChordPro; JSON is lossless. Full phrase-level hold reassignment on an impossible retune needs the atomic fallback review below. The capo planner optimizes per-song shapes while preserving tunings; it does not globally minimize the number of capo transitions.

## 2026-09-10 — Audio DSP checkpoint

- 27 unit/property/persistence tests pass, including every semitone E2–E6 at five cents offsets, tuner state transitions, synthetic onset and G/D fingerprint discrimination, five-minute scheduling drift, clean-pass rules and meter-aware sustain compilation. Stage 2 browser gate is still open.
- Added worker-clock playback, tuner, metronome, practice/session/heat UI, drills, progress and Stage view. Reference processing is under review: SoundTouch's live worklet adds latency and cuts the tail if disconnected with its input, so alignment is not yet verified.
- Automatic ramps use complete audio-clock-confirmed passes. Because the next loop is already scheduled, a earned ramp applies to the next unscheduled loop; microphone evidence is kept per actual cycle.
- macOS offloaded repository dependencies during the pause. Hydrated source/control files and reinstalled the frozen lockfile into `/private/tmp/fretshift-runtime`; local `node_modules` is an ignored symlink. Original offloaded dependencies are preserved in ignored `.node_modules-offloaded`. A normal clone still uses `pnpm install`.

## 2026-09-10 — Workspace continuation

- Continued in `/Users/gaultneyfamily/Documents/ChatGPT/Fretshift` after the app supplied an empty replacement workspace. Copied all 71 source/config/test files and imported the four existing commits from the previous checkout; retained the three uncommitted test files. Original checkout remains intact.
- Continuation unit run: 33/33 pass, including loop lookahead, short-loop retention, mixed meter/tempo, leading holds and persisted Song/practice separation.

## 2026-09-10 — Aligned reference preparation

- Replaced live SoundTouch worklet reference processing with the same library's WSOLA core in a Web Worker. Preparation completes before a buffer is scheduled against the notation clock, avoiding the measured 116–151 ms live processor startup gap and flushing buffered tails. Each measure's source interval is rendered at its own tempo ratio; negative offsets create explicit leading silence. Regions beyond the recording and unsupported ratios (outside 0.1–8) produce errors, never silent clamping.
- Thirty-six unit/property/persistence/DSP tests, lint, strict TypeScript and production build pass. Real WSOLA tests cover exact duration, ±10-cent pitch tolerance, onset/tail displacement below60 ms for tested 0.5–2 ratios, and no startup buffering gap. Small transient shifts inherent to WSOLA remain subject to instrument/listening review.
- Reference ramps prepare the next speed asynchronously, continuing the current speed until that buffer is ready. Live recordings never leave IndexedDB/the worker.

## 2026-09-10 — Stage 2 local gate

- All 11 browser tests pass (5 Stage1 +6 Stage2). Axe found zero serious/critical violations on practice hub/song, tuner/metronome, drills, progress and stage in both themes. Actual worker time-stretch passes pitch/duration checks in Chrome. Playback highlights cells and persists a session without changing its Song.
- Fixed Vite's first-use dependency reoptimization reload by prebundling SoundTouch core; the isolated browser DSP test uses an OfflineAudioContext because no device output is needed.
- Added history-driven practice nudges, focused-measure links, section loops, draggable/native keyboard loop brackets, a beat indicator and matching live-note cell outlines.
- Stage1/2 local gates pass; remote CI remains unobserved. Real guitar, device timing/background audio, wake lock and pedal verification remain open in TODO.

## 2026-09-10 — MIDI interchange

- MIDI fixture tests pass for sounding pitch/onset/duration, tempo and meter changes, multitrack selection and explicit rejection of non-grid rhythm. Grid placement never quantizes or drops notes. MIDI cannot represent muted guitar attacks as a single pitched guitar track; export directs those scores to MusicXML/GP.
- Found and reproduced @tonejs/midi2.0.28's key-signature encoder bug (`keyIndex +7` rather than `-7`). Write that standard MIDI meta event through its `midi-file` codec and interpret minor signatures by their relative-major fifth count. No dependency source is patched.
- Pinned PDF.js4.10.38 because current6.3 requires Node22 and conflicts with the required Node20 stack. Other interchange packages are pinned in package/lock.

## 2026-09-12 — Offline Stage 3 and correctness checkpoint

- The user explicitly deferred API-reliant work. Supabase/auth/sync/sharing, deployment verification, and photo/scanned-PDF vision remain outside this checkpoint; the broken placeholder `bench:vision` script was removed until a real corpus and implementation exist.
- Structured imports now share size limits, explicit track selection, persisted imported tunings, and lossless rejection for unsupported timing/effects. GP and compressed MusicXML expansion is bounded at 64 MB. Real upstream alphaTab GP5 and MusicXML tablature files supplement FretShift-generated round trips. MusicXML remote DTD declarations are removed before parsing, while entity declarations remain rejected.
- MIDI tempos are normalized to millibpm precision to prevent floating-point artifacts such as 108.000108. Pinned voicings are rebuilt safely through key/tuning/capo transforms; nut barres and invalid fingering metadata are dropped instead of creating invalid Songs. ChordPro source application preserves matching tab and measure metadata. Voicing search uses the full four-fret window.
- Setlist capo planning is one atomic dynamic-programming edit that minimizes transitions among equally easy candidates. Repeated Song IDs retain their shared capo because capo is Song-owned rather than setlist-entry-owned.
- Text-layer PDF import, page-boundary review, Letter/A4 printable sheets, and Worker-based offline audio chord drafting are implemented. The PDF output was rendered to PNG and visually inspected. Audio deliberately estimates only major/minor harmony and requires user correction; it does not claim melody or tab transcription.
- Node 20.20.2 passed strict TypeScript and all 88 unit/integration tests. Chrome PDF/audio browser flows pass. Playwright WebKit downloaded twice but stalled during extraction on this host, so WebKit remains an honest open verification item rather than a claimed pass.
- Applied repository-wide Prettier formatting to `src` and `e2e` after the feature work, eliminating the prior 61-file formatting backlog without changing intended behavior.

## 2026-09-13 — Cloud, sharing and vision implementation checkpoint

- The user resumed the API-dependent scope, superseding the 2026-09-12 deferral. The app remains useful offline and exposes cloud/vision features only when explicitly configured.
- Supabase remains a native-fetch integration with no SDK dependency. PostgREST table-returning RPCs are parsed as arrays; sync requests are pinned to the initiating account before and after token acquisition. The workspace account is bound before its first network request so a partial first sync cannot later be adopted by another account.
- Server timestamps and revisions are authoritative. Successful uploads update the unchanged local record as well as the baseline, preventing a stable second sync from appearing edited. Remote tunings install before dependent songs. Incoming envelopes, payload IDs and resolution choices are validated; invalid remote records are quarantined.
- Library hydration now runs after partial failures, merges edits made while a request is in flight, reconciles settings and tunings, and resumes queued persistence only after the store reflects the database. Remote songs retain device-local reference-recording metadata.
- The SQL migration prevents direct client writes to synchronized/share tables, uses security-definer RPCs with fixed search paths and authenticated ownership checks, and assigns server-side timestamps/revisions. This migration has been audited and contract-tested against PostgREST-shaped responses but has not been applied to a live Postgres instance.
- Share links are listed and revoked after reopening. Public snapshots exclude owner and local reference metadata on both client and server paths; recipient display preferences remain local, and transpose/save-copy behavior is covered in browser tests.
- Photo/scanned import strictly validates file/page media, dimensions, page IDs, hints, and response identity. Mixed PDFs rasterize every page to preserve ordering. The Edge Function bounds streamed bodies even without Content-Length, authenticates with a timeout, rejects origins before provider work, and validates OCR.space output before returning it. OCR.space does not report field confidence, so the UI requires review without inventing a score.
- The provisional vision corpus now contains 20 readable rendered charts across 24 JPEG pages and matching goldens, with synthetic limitations documented. The benchmark validates media and Song/page contracts, counts failed-case lyric error honestly, creates its output directory, and makes no request when credentials are absent. No live accuracy result is claimed.
- Node 20.20.2 passed lint, strict TypeScript, production build, 123 unit/integration tests and Deno checking of the Edge Function. The exact snapshot passed 51 browser tests across Chromium, WebKit and a separate unconfigured build. Because macOS offloaded the cloud-backed workspace during the final matrix and produced `ETIMEDOUT` source reads, the clean 51-test run used a byte-for-byte working snapshot copied to `/private/tmp`; the application results were green once storage reads were local.
- Account and photo/scan surfaces were visually inspected in the in-app browser in the dark theme. Remote CI, deployed Postgres/RLS, live magic-link email/session recovery, paid vision accuracy, provider retention settings, cross-device behavior and hardware checks remain explicitly unverified.

## 2026-09-14 — Recovered working-tree checkpoint

- Recovered the active project from the local Work/Codex filesystem after the agent session hit its usage limit. The recovered tree contains the 2026-09-13 cloud/sync/sharing/vision implementation that was still uncommitted on top of `e12318d`; it is treated as the authoritative continuation snapshot rather than the older nested/archive copies found beside it.
- Clean continuation packaging excludes `.env.local`, build output, test output, nested duplicate extractions, prior handoff archives, `.openai` hosting metadata, and unrelated agent artifacts. These are not required to rebuild the application and should not enter source control.
- `.env.example` now matches the implemented OCR.space proxy: `OCR_SPACE_API_KEY` and plural `ALLOWED_ORIGINS` replace the earlier generic `LLM_API_KEY` / `LLM_MODEL` placeholders. `BUILD_SPEC.md` remains the untouched original specification; this decision records the implemented provider/configuration deviation.
- No live Supabase, SMTP, OCR.space, remote CI, deployment, or hardware verification was performed while recovering the repository. The last recorded green local gates remain the 2026-09-13 evidence above until they are rerun in a dependency-hydrated Node 20 environment.

## 2026-09-14 — Live integration preparation

- Current Supabase guidance supports publishable keys alongside legacy anon keys and warns that the platform Edge Function JWT gate can reject current asymmetric Auth tokens. FretShift now accepts `VITE_SUPABASE_PUBLISHABLE_KEY` as the preferred client key while retaining `VITE_SUPABASE_ANON_KEY` compatibility.
- `vision-import` now has an explicit `supabase/config.toml` entry with `verify_jwt = false`. This does **not** make the endpoint public: the function continues to require a bearer token and verifies it against `/auth/v1/user` before parsing image input or calling OCR.space. The function also accepts the current publishable-key environment forms when the legacy anon variable is absent.
- Added `pnpm verify:live`, a non-destructive hosted-service smoke test. Its public path verifies Auth reachability, the share RPC and CORS. Optional signed-in checks verify the real user session, RLS read path, a compare-and-swap miss that cannot create a row, and an invalid vision request that stops before the OCR provider.
- Renamed the benchmark user-session variable from ambiguous `SUPABASE_ACCESS_TOKEN` to `FRETSHIFT_USER_ACCESS_TOKEN` so it cannot be confused with the Supabase CLI personal access token. Added `LIVE_INTEGRATION.md` as the authoritative remote setup/verification runbook.
- This checkpoint improves live-service readiness only. No remote migration, Auth setting, Edge Function deployment, secret, email, OCR provider call, or cross-device result is claimed until observed against the hosted project.

## 2026-09-14 — Live Supabase deployment

- Applied the sync/share schema to hosted project `prftwxtrphgkohflmfsn`.
- Added a follow-up migration to set `search_path = public` on `sync_record_timestamp()` after the Supabase security advisor identified a mutable search path.
- Deployed `vision-import` with platform JWT verification disabled because the function independently validates the caller bearer token against `/auth/v1/user`; this preserves compatibility with current asymmetric Auth signing while still requiring a valid session.
- SECURITY DEFINER advisor warnings for the four application RPCs are intentional: their exposed roles match product behavior and each function constrains access in its body / token model.
- Real OCR remains disabled until `OCR_SPACE_API_KEY` is configured; production CORS and Auth redirect origins remain environment-specific setup rather than hard-coded values.

- **2026-09-14 — Compact chord-line layout + quarantine hygiene:** In chord view, the chord grid now sizes itself to the lyric line instead of stretching across the whole score card, so imported chord names stay visually close to the words they describe. Cloud quarantine IDs are deterministic per record, resolved legacy notices are removed, and the known Supabase offset-timestamp false positives are cleaned automatically on startup.

## 2026-09-14 — Mobile import, iPhone auth, and accessibility pass

- Audio-to-chord import is intentionally conservative now: assume one guitar string/note is sounding at a time, detect stable pitch regions in E2–E6, and emit only the root as an editable provisional chord. Short/noisy pitch flips are rejected or merged instead of creating dense chord guesses. This is an accuracy-first drafting mode, not polyphonic chord recognition.
- Photo/scanned-chart import now offers a dedicated device-camera input (`capture="environment"`) alongside the existing picker. Captured photos use the same local resize/metadata stripping and transient vision path as selected images.
- iPhone Home Screen magic-link auth uses a short-lived, single-use server handoff because Safari and an installed standalone PWA can have separate storage contexts. The PWA stores a random secret locally; Safari completes the handoff only after Supabase verifies the user; the PWA claims the refresh token once, refreshes it immediately, stores its own session, and syncs. Direct access to the handoff table is revoked; callback completion is authenticated-only.
- Settings now include an 85–120% interface-size preference. Source UI uses `--ui-scale` for common typography and controls; the preference is schema-validated and therefore participates in the existing settings persistence/sync path.
- Production was preview-tested before promotion. The currently live Vercel build uses a guarded runtime patch copied from the last known-good production bundle so CSS/static assets cannot regress while local dependencies are unavailable. The full source implementation is preserved here and should replace that compatibility patch on the next ordinary dependency-restored Vite build.

## 2026-09-26 — Audio Intelligence Phase 3

- Continued the verified validation-complete snapshot in a separate Phase 3 directory. Preserved original chord analyzer, baseline archives and historical evidence.
- Selected the existing local YIN/FFT path for an opt-in single-note provider; evaluated on deterministic signals and five independent labeled GuitarSet recordings. Real solo event recall is 28.0%, so retain experimental wording, uncertainty and explicit confirmation.
- Store raw frame/note evidence separately from user pitch/timing, chart quantization and suggested/user fingering. Use constrained path optimization with manual anchors; no observed string, articulation or voicing claim.
- Project only confirmed notes into normal Song tab; source-time practice adapters reject uncertain, overlapping, unplayable and stale chart data. Ordinary guide playback does not collect microphone performance evidence for note transcriptions.
- Final evidence: 283 units, 19 audio browser passes plus one deliberate Chrome microphone skip, lint/types/build and beta gate. Node 24 avoids this host's Node 26 test/trace problems. No deployment or new dependency/service.
- Current authoritative continuation: FRETSHIFT_AUDIO_INTELLIGENCE_PHASE_3_HANDOFF.md and GUITAR_TAB_TRANSCRIPTION.md. Physical devices, production recognition, sync payload stress, articulation/polyphony and human fingering ratings remain open.

## 2026-10-03 — YouTube link import (Gemini)

- **Base.** Built on repository HEAD `1f3d3d5`, not the attached `FretShift-Audio-Intelligence-Validated` zip. The zip (2026-09-29) predates the 2026-10-01/02 commits already in the repo, including `supabase/functions/_shared/rateLimit.ts` and migration `202610020001_rate_limits.sql`, which this feature reuses.
- **Provider docs checked 2026-10-03.** `ai.google.dev` and Google's forum were blocked by this environment's egress policy, so I read Google's own SDK and cookbook sources via GitHub raw and treated search-result snippets of the docs pages as secondary:
  - `googleapis/js-genai` `src/types.ts` (npm `@google/genai` 2.27.0, published 2026-10-02): `Part.fileData.fileUri`, `Part.videoMetadata { startOffset, endOffset, fps }` (fps "valid range (0.0, 24.0]", default 1.0), `GenerationConfig.responseMimeType` + `responseSchema` (OpenAPI 3.0 subset: `type`, `enum`, `nullable`, `required`, `propertyOrdering`, …) or `responseJsonSchema`, and "starting from Gemini 3.5 models … thinking_budget … will result in a user error", so FretShift sends no thinking settings. `src/converters/_models_converters.ts` confirms the Gemini Developer API forwards `responseSchema` and `videoMetadata` for `generateContent`.
  - `google-gemini/cookbook` `quickstarts/Video_understanding.ipynb`: current model list `gemini-3.8-flash` (default), `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`; static processing samples 1 fps; "Video metadata features (`fps` and clipping offsets) are not yet supported in the Interactions API … use `generate_content`". `quickstarts/Get_started.ipynb`: YouTube links are processed with audio and visual information; video tokens per frame 70 (default/medium/low) or 280 (high); Gemini 3 guidance to keep the default temperature 1.0.
  - Search snippets of `ai.google.dev/gemini-api/docs/video-understanding` and `/models`: YouTube URL input is a preview feature at no charge; public videos only (not private or unlisted); free tier at most 8 hours of YouTube video per day, paid tier no length limit; up to 10 videos per request on Gemini 2.5+; offsets written as seconds with an `s` suffix; Google recommends 3.5 Flash-Lite or 3.8 Flash for new projects. Structured output: `responseMimeType: "application/json"` plus a schema.
  - Reported regressions (secondary, not Google statements): a Google AI Developers Forum thread ("videoMetadata clipping on YouTube URLs no longer clips audio (frames still clipped) — ~20× token inflation") says since about 2026-08-18 YouTube offsets clip frames but the whole audio track is billed on every request; `dzivkovi/video-intel#141` reports `gemini-3.7-flash` ignoring `start_offset` and re-stamping timestamps from it. Another forum thread reports intermittent `400 INVALID_ARGUMENT` for valid public YouTube URLs that succeed on retry.
- **Request.** `POST v1beta/models/{GEMINI_MODEL}:generateContent` with the key in `x-goog-api-key` (never in the URL), `fileData.fileUri = https://www.youtube.com/watch?v=<id>`, `videoMetadata` start/end/fps, a fixed prompt (`youtube-chords-v1`) and `responseSchema`. Default model `gemini-3.8-flash`, overridable by the server-only `GEMINI_MODEL`. The schema has no free-text field; the server converts any chord value that is not a chord symbol, `N.C.` or `Unknown` into Unknown, so lyrics cannot pass through. The prompt forbids lyrics, speech and on-screen text.
- **Server checks.** Same Origin allow-list, CORS, `/auth/v1/user` check, `no-store` and body streaming limit (16 KB) as `vision-import`. The free YouTube oEmbed endpoint pre-checks each video (metadata only, no media) so private, non-embeddable and removed videos fail before quota or paid calls. One quota unit per Gemini request (`YOUTUBE_CALLS_PER_HOUR` 20, `YOUTUBE_CALLS_PER_DAY` 60 per user), fail-closed. Limits: ≤ 10 min of frames per request, ≤ 60 min videos (the whole audio track is billed per request), ≤ 2400 frames, 120 s upstream timeout (under the 150 s Edge idle limit). Answers whose timestamps mostly fall outside the requested window are flagged `timingSuspect` and discarded by the client.
- **Client and UI.** `src/youtube/` converts responses into the existing `AudioReview` via `createAudioReview`, so the Audio Intelligence region, beat and save path is reused. Songs get `provenance.source = "youtube"` with `modelId`, `promptVersion`, `processedAt` and `provenance.youtube` (video ID, range, options, request count, key/capo guesses, sections). `hasMediaTimeline()` extends every audio-only timing guard (Practice scoring, Immersive, playback, strumming) to YouTube. Older app versions quarantine `youtube` songs during sync instead of crashing. All regions start unreviewed, timing unconfirmed, nothing auto-saves; review drafts autosave locally in a separate `youtube-new` slot. Playback uses YouTube's IFrame API on `youtube-nocookie.com` behind the same media interface as `<audio>`. No YouTube audio or video is downloaded anywhere.
- **Accuracy options, measured (SIMULATED evidence only).** No Gemini key exists in this environment, so `pnpm bench:youtube` was run in simulated mode: 6 synthetic timelines × 5 seeds, a seeded noise model of stated assumptions (`YOUTUBE_IMPORT_SIMULATED_BENCHMARK_RESULTS.json`). Effects of (a) hints and (c) close-up fps are assumptions fed into that model, not findings. What it does measure is FretShift's own merge, vote and snap code and request/token cost:

  | Variant | Chord precision | Chord recall | Unknown share | Change recall ±0.5 s | Median change error | Requests | Tokens per case |
  |---|---|---|---|---|---|---|---|
  | baseline | 0.733 | 0.677 | 0.080 | 0.695 | 290 ms | 1 | 26.5k |
  | (a) hints | 0.786 | 0.728 | 0.068 | 0.745 | 277 ms | 1 | 26.5k |
  | (b) 60 s windows | 0.762 | 0.659 | 0.132 | 0.675 | 283 ms | 3 | 73.1k |
  | (c) close-up 4 fps | 0.816 | 0.747 | 0.081 | 0.850 | 202 ms | 1 | 49.6k |
  | (d) 2 passes | 0.820 | 0.544 | 0.323 | 0.727 | 234 ms | 2 | 53.0k |
  | (d) 3 passes | 0.839 | 0.726 | 0.122 | 0.793 | 231 ms | 3 | 79.5k |
  | (e) snap, half-beats | 0.734 | 0.678 | 0.082 | 0.734 | 326 ms | 1 | 26.5k |
  | (e) snap, whole beats | 0.737 | 0.679 | 0.083 | 0.671 | 307 ms | 1 | 26.5k |
  | a+c+d3+e | 0.926 | 0.857 | 0.069 | 0.943 | 228 ms | 3 | 148.8k |
  | a+e (defaults) | 0.789 | 0.730 | 0.070 | 0.784 | 289 ms | 1 | 26.5k |

- **Defaults.** (a) on: no extra requests, user-entered text only. (b) off: in the cost model each window bills the whole audio track (2.8× tokens for 3 windows), windows add Unknown at discarded or edge regions, and the reported offset regressions make windowed timestamps the riskiest part. Ranges over 10 minutes are still split automatically. (c) off by default and offered for close-up lessons (1.9× tokens). (d) 1 pass: 3 passes raised precision and change recall but triples quota use (the default hourly quota allows about 6 such imports), and 2 passes cut recall to 0.54 because any disagreement becomes Unknown. (e) on, half-beat grid: free, only runs when the player applies a tapped grid; it raised change recall ±0.5 s (0.695 → 0.734) but raised the median error of matched changes (290 → 326 ms) because boundaries more than a quarter-beat off snap to the wrong half-beat. Whole-beat snapping was worse on both measures. Re-decide every default from a live or replayed run on the player's hand-labeled lessons.
