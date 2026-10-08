## 2026-09-14 live integration update

- Hosted Supabase project identified as `prftwxtrphgkohflmfsn` and is ACTIVE_HEALTHY.
- Applied hosted migrations for sync/share plus `harden_sync_record_timestamp`; database now has `sync_records`, `song_shares`, five FretShift functions, and the intended RLS/grants.
- Supabase security advisor's mutable-search-path warning was fixed. Remaining SECURITY DEFINER advisor warnings correspond to deliberately exposed RPCs (`read_song_share` for public links; authenticated create/revoke/sync RPCs).
- Deployed `vision-import`; it is ACTIVE and uses `verify_jwt = false` because the function performs its own bearer-session check against Supabase Auth.
- Live signed-in verification is not yet possible: the project currently has zero Auth users. `OCR_SPACE_API_KEY`, production `ALLOWED_ORIGINS`, and Auth redirect URLs still require service configuration.
- The local execution environment cannot reach external HTTPS, so `pnpm verify:live` could not be run from this container; hosted schema/function state was verified through the connected Supabase management interface instead.

# FretShift — development handoff

## Goal and authoritative snapshot

Offline-first, six-string guitar songbook/editor/practice web app defined in `BUILD_SPEC.md`. **Current scope includes the remaining API-dependent features**: the user explicitly resumed photo/scanned-PDF vision and accounts/sync/sharing. The cloud/vision implementation and project records were refreshed in the recovered working tree; distinguish live-service and hardware verification from mocked tests.

Original working root: `/Users/gaultneyfamily/Documents/ChatGPT/Fretshift`. The previous committed checkpoint was `e12318d` (format/handoff), following `d4fe6d8` (offline Stage 3). The 2026-09-14 recovered tree consolidates the later cloud/vision work into the authoritative continuation snapshot. Clean packages exclude nested `FretShift/` duplicate extractions, prior archives, dependencies, builds, test output and unrelated artifacts. Do not replace this code with the older checkpoint.

Build work was interrupted for the original handoff. Application code was not repaired during packaging. That packaging-time status is superseded by the completion update below; live cloud/vision services still require deployment and verification.

## 2026-09-14 recovery update

- The active Work/Codex filesystem was recovered after the prior session exhausted its usage allowance. The outer project tree is authoritative; adjacent nested `FretShift/`, archive, build/test-output, `.openai`, and unrelated artifact directories are recovery debris rather than source.
- The 2026-09-13 cloud/sync/share/vision work has been consolidated into a clean continuation checkpoint. `.env.example` now documents the implemented OCR.space secret names. Live credentials remain outside source control.
- This recovery pass did not rerun dependency-based test/build gates or contact external services. Preserve the 2026-09-13 recorded green evidence as historical evidence only until a fresh Node 20 install reruns it.


## 2026-09-14 live-integration preparation update

- Added current Supabase publishable-key support while preserving legacy anon-key configuration.
- Added explicit `vision-import` function config for current asymmetric Auth signing keys; the function remains user-authenticated via its own `/auth/v1/user` check.
- Added `LIVE_INTEGRATION.md` and `pnpm verify:live` so migration/function/CORS/auth wiring can be checked without creating sync/share records or making OCR.space calls.
- Remote project mutation and live verification are still pending; do not convert this preparation into a claim that the migration/function/secrets/Auth redirects are already deployed.

## 2026-09-13 completion update

- Fixed the PDF.js compile error and sync lint error. Node 20.20.2 now passes ESLint, strict TypeScript, the production build, 123/123 Vitest tests, and Deno checking of the Edge Function.
- Reconciled the REST/SQL table-return contract and added PostgREST-shaped adapter tests. Sync now pins account identity, binds a workspace before its first request, applies server timestamps locally, installs remote tunings before dependent songs, validates/quarantines envelopes, preserves local reference metadata, and covers stable second sync, partial failures, in-flight edits, deletes, all conflict choices and all record kinds.
- Hardened store recovery so partial remote changes hydrate safely before persistence resumes. Owner share links persist across reopening and can be revoked; public snapshots exclude owner/reference metadata and support recipient-local display, transpose and save-copy flows.
- Hardened photo/scanned/mixed-PDF preprocessing and the Edge Function request/provider-response contract, including bounded streaming bodies, exact page identity, authentication timeout, origin rejection, malicious-hint framing and schema validation.
- Replaced the placeholder corpus with 20 readable rendered provisional cases (24 JPEG pages) and goldens. Repaired and wired `generate:vision-corpus` and `bench:vision`; the no-credential run recorded a skip and made no paid call. No live accuracy result is claimed.
- Added configured mocked account/share/vision browser flows and a separate unconfigured project. CI installs Chromium and WebKit. The exact snapshot passed 51/51 browser tests across Chromium, WebKit and unconfigured Chromium, including both themes and mobile axe checks. Account and photo/scan UI were also visually inspected in the dark theme.
- No deployment, real Postgres/RLS/grant execution, live authentication/email recovery, paid vision provider call, observed remote CI, cross-device sync or hardware verification was performed. The SQL migration is statically audited and mock-contract tested only.
- During the final combined browser run macOS offloaded this cloud-backed workspace and Vite received `ETIMEDOUT` reading ordinary source files. A fully local copy of the same working snapshot under `/private/tmp` passed the complete matrix; the storage-interrupted failures are not counted as application failures.

## Architecture and navigation

- React 18 + strict TypeScript, Vite 6, React Router; Zustand/Immer/zundo stores; Dexie IndexedDB; Zod schemas/migrations. pnpm 10.15.1; `.nvmrc` pins Node 20.
- Tone.js playback, Worker metronome/audio analysis, SoundTouch/WSOLA time stretching; alphaTab 1.8.4, `@tonejs/midi` 2.0.28, fflate, PDF.js 4.10.38 and pdf-lib. Vitest, Playwright 1.55, axe. Fonts are bundled locally.
- `src/schema/`: Song, tuning, preferences, setlist/practice schemas; `migrations.ts` owns `loadSong` validation/migration.
- `src/theory/`, `src/transforms/`: parsing, pitch/voicing search, musical transformations and difficulty.
- `src/persistence/dexie/index.ts`: repositories and `FretDB`; tables songs/setlists/settings/tunings/sessions/heat/pairs/strums/blobs/meta/quarantine.
- `src/store/songStore.ts`: edits, undo/redo and queued full-table persistence; `pauseLibraryPersistence()` protects reconciliation while the cloud sync bridge applies remote/local changes.
- `src/audio/`, `src/io/`: practice/DSP and ChordPro/JSON/backup/MIDI/MusicXML/GP/PDF import/export.
- `src/ui/App.tsx`: routes, startup, theme, navigation; new cloud startup and `/share/:token` route. `src/ui/screens/Import.tsx` integrates vision; Settings and SongDetail integrate account/share components.
- `src/cloud/client.ts`: native Supabase Auth REST, magic-link callback, refresh/sign-out/session subscription. `src/cloud/store.ts`: adapter creation, sync scheduling, store/DB merge, status/conflicts.
- `src/sync/{adapter,engine,conflicts}.ts`: per-record sync contract/engine; `src/persistence/{supabase,fakes}/`: real REST adapter and in-memory contract fake.
- `src/ui/components/{AccountSync,ShareSong}.tsx`, `src/ui/screens/SharedSong.tsx`: new account/conflict/share flows.
- `src/vision/`, `src/ui/components/VisionImport.tsx`: OCR.space-sized preprocessing, validated response/retry, text-chart parsing, and photo/scan review; `supabase/functions/vision-import/`: authenticated OCR.space proxy.
- `supabase/migrations/202609120001_sync.sql`: owner RLS, revision/timestamp CAS, share tables/RPCs. **Not applied or verified against Postgres.**
- `scripts/{generate-vision-corpus,bench-vision}.mjs`: unfinished corpus/benchmark. `e2e/`, `test-fixtures/interchange/`: browser tests and independently sourced GP5/MusicXML fixtures.

## Implemented baseline and current evidence

Offline Stages 1–3 were previously verified: library/search/tags/trash, samples/tour, notation/editing, diagrams, tuning/capo/key/difficulty transforms, setlists, backups; tuner/metronome/playback/loops/ramps/reference recordings/drills/progress/stage view; structured interchange, PDF text extraction with boundary review, printable sheets, local audio chord drafts with waveform/correction.

Prior checkpoint evidence: 88 unit/integration tests, 19 Chrome browser tests including both themes/mobile axe, lint/types/build passed. An A4 shape-name PDF was visually checked. Those browser/build claims apply to the **offline checkpoint**, not this unfinished snapshot.

Original packaging checks under Node **20.20.2** (superseded by the completion update):

- **102/102 Vitest tests pass**, including newly added auth, sync and vision tests. Coverage is insufficient to establish real adapter correctness (see below).
- **TypeScript fails**: `src/vision/preprocess.ts:141`, TS2353: `'canvas' does not exist in type 'RenderParameters'` (PDF.js render call).
- **ESLint fails**: unused `kinds` at `src/sync/engine.ts:10`.
- Production build consequently blocked by TypeScript. New account/share/vision UI has not received full browser or visual acceptance. `e2e/vision.spec.ts` only checks introductory/configuration text.
- No deployment, real authentication/email, Postgres/RLS integration, paid vision call, observed remote CI, or hardware verification was performed.

## Preserve these decisions

- `chordName` is sounding harmony; Shape display subtracts capo; tab frets are capo-relative; string 0 is high E. Left-handed mode mirrors diagrams/fretboard only, never tab.
- Preserve exact pitch/timing; do not silently clamp, quantize, octave-shift or drop notes. Validate external/persisted songs with `loadSong`; register custom tunings before their songs; quarantine bad data.
- Practice records remain outside Song; microphone/reference audio and blobs stay local. JSON is full fidelity; portable ChordPro cannot preserve every field/comment/spacing. Source application preserves matching tab and measure metadata.
- Keep MIDI key-signature workaround, PDF.js 4.10.38 for Node 20, configured PDF Worker URL, and `optimizeDeps.include: ['@soundtouchjs/core']`.
- Keep pinned-voicing schema safety, full four-fret search and atomic setlist capo planning. Repeated song IDs share Song-owned capo.
- UI: soft rounded cards/pills, purple accent, dark/light/system theme, Space Grotesk/Inter, large readable data, responsive navigation, keyboard/focus access, reduced motion. Reuse tokens/components; retain AA/axe checks. The unsupported registered-trademark glyph was removed from the wordmark.
- Native fetch was chosen for Supabase integration, avoiding a new SDK dependency. No new dependency/lockfile changes were made. CAS revisions are intended to protect concurrent writes; server time, not client clocks, must determine cloud timestamps.

## Original continuation risk list

This list is retained as audit context. Its implementation and mocked-test items were addressed as summarized above; deployment/live-service/hardware items remain open.

### Sync/account/share (highest risk)

1. **Real REST/SQL contract mismatch:** SQL `RETURNS TABLE` RPCs return arrays, but `SupabaseSyncAdapter.cas/createShare/readShare` parse single objects. Fix the adapter or SQL consistently and test actual PostgREST-shaped responses; fake adapter tests hide this.
2. `SyncEngine` normalizes server timestamps into baseline payloads but does not update the corresponding local payload after upload. JSON comparisons can classify unchanged records as edits repeatedly. Test stable second sync, two clients, clock skew, delete conflicts and all resolution choices.
3. Incoming tunings are sorted in the remote list, but the captured-local loop applies existing songs before installing new remote tunings. Fix dependency order and test updates to existing songs referencing new tunings.
4. `cloud/store.ts:updateLibrary` hydrates only after a successful operation; `finally` always resumes full-table writes. Partial remote changes followed by failure can be overwritten by stale store state. Make failure handling/merge safe and test edits during network requests, partial failures, settings changes, undo and persistence errors.
5. Pin an in-flight adapter to the expected account; it currently obtains whichever session is current for each request. Cross-tab sign-out/account switch must not redirect pending sync to another account. Workspace binding (`meta['sync:account']`) occurs only at successful sync end; `resolve` also needs ownership checks. No separate-workspace UI exists despite mismatch error wording.
6. Audit SQL column ambiguity in `sync_cas`, grants/RLS, server-owned insert timestamps/revisions, direct-write bypass of CAS, stable pagination ordering and concurrent creation. No real SQL tests yet. Validate remote envelope/record ID vs payload ID, and quarantine invalid input before trusting conflict choices.
7. `resolve` and full-data migration need broader tests (currently four engine tests). Verify both-copy original/copy semantics and failure paths, soft deletes, preferences/tunings/practice records, preservation of local reference metadata.
8. Share UI keeps revocation token only in component state; reopening cannot manage earlier links. Add persistent owner share management. Ensure public responses exclude owner/reference/private metadata, respect recipient theme/handedness, transpose/save-copy safely, and cover revoked/missing/configuration/error states.
9. Auth unit tests cover callback identity, URL credential removal, deduplicated refresh and sign-out race; live magic-link delivery, expiry/session recovery, cross-tab behavior and end-to-end account flow remain unverified.

### Vision/benchmark

- Fix the known PDF.js type error first. Review preprocessing/rendering/EXIF stripping/HEIC/rotation/crop/page ordering and photo/scanned/mixed PDF paths in a browser. Client validates OCR text/page IDs, parses an editable Song, and retries once; proxy has not been independently validated against the live service.
- Edge proxy must provide exact page IDs to the model and validate response/schema before returning. Audit current prompt assembly (images and hints), bounds when Content-Length is absent, authentication timeout, malicious hints, CORS, response errors and provider schema compatibility.
- **Corpus does not exist yet.** Generator draws bars/lines rather than readable matching chord/lyric text; replace it with actual rendered charts and goldens before claiming a transcription benchmark. Generate ≥20 useful provisional cases, then document limitations.
- Benchmark currently labels PNG bytes as JPEG, performs only shallow Song validation, mishandles aggregate lyric errors on failed cases, and writes into a potentially absent directory. Repair scoring/validation/media contract before running. Neither script is wired in package.json; `pnpm bench:vision` is not yet defined. No measured vision accuracy exists.

### Release/documentation

- Playwright now defines Chromium + WebKit, but CI still installs Chromium only. Test server injects mock Supabase configuration; add real mocked account/share/vision flows and separate unconfigured coverage. Avoid accidentally reusing a dev server with different env.
- README/TODO/DECISIONS have been refreshed for the resumed API work. Keep them aligned with observed results and do not turn mocked/local evidence into live-service claims.
- Hardware tasks remain: real guitar tuning/drills, latency/metronome feel, live tracking, iOS background/resume, pedal/wake lock and long-song mobile keyboard traversal. Storage-pressure/update lifecycle and broad real-world interchange remain follow-ups.

## Configuration and runtime

`.env.example` contains placeholders only. Client: `VITE_SUPABASE_URL` plus preferred `VITE_SUPABASE_PUBLISHABLE_KEY` or legacy `VITE_SUPABASE_ANON_KEY`. Configure Auth Site URL and allowed redirect `${origin}/settings`; magic-link flow uses `/auth/v1/otp`, fragment callback and token refresh. Session is stored in localStorage `fretshift-cloud-session`; sync baselines/account binding in Dexie meta. Do not package live sessions or database exports.

Vision Edge Function: Supabase-provided `SUPABASE_URL` plus current/legacy public-key environment values; server-only `OCR_SPACE_API_KEY` and **`ALLOWED_ORIGINS` (plural)**. `supabase/config.toml` disables the platform legacy JWT gate because the function verifies the bearer session itself against Supabase Auth. Current proxy uses OCR.space Engine 3; provider retention settings still require review. Never call an external API merely to verify packaging. No credentials are committed. Benchmark expects `VISION_IMPORT_URL`, a Supabase public key, and `FRETSHIFT_USER_ACCESS_TOKEN` server-side. `pnpm verify:live` provides a non-destructive hosted-service smoke test before any paid OCR benchmark. Deployment config exists for Vercel/Netlify; SMTP and real services need human configuration.

## Historical continuation order

Steps 1–4 were completed locally. Step 5 remains an authorized human/service-configuration stage.

1. Read this handoff; inspect only the affected files. Fix compile/lint errors and the REST/SQL mismatch.
2. Harden sync/account isolation, timestamps, tunings, reconciliation and failure recovery with targeted tests before enabling live use.
3. Complete share/account UI and mocked browser coverage; finish vision response/preprocessing validation and meaningful corpus/benchmark.
4. Run full Node 20 gates, Chrome/WebKit and both-theme/mobile axe; inspect new UI. Update CI, scripts and project records to observed results.
5. Only then configure/deploy external services as authorized; report hardware/live-service checks separately and update this handoff.

## Commands

```sh
nvm use                         # or any Node 20 installation
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e --project=chromium
pnpm test:e2e --project=webkit
pnpm dev
```

Local-only conveniences (not shipped): Node 20 binary `/private/tmp/node-v20.20.2-darwin-arm64/bin/node`; prepend its `bin` directory to PATH for child tools. Ambient Node 26 causes jsdom localStorage failures; `NODE_OPTIONS=--no-experimental-webstorage` worked around that, but prefer Node 20. `node_modules` is a symlink into `/private/tmp/fretshift-runtime/node_modules`; a fresh machine must install dependencies.


User coding preferences: use Headroom if available (it was available here), targeted fresh reads, RTK for supported verbose commands, concise evidence-based updates, no external paid agent routing. Astra Orchestrator was explicitly invoked for this build; delegate only bounded worthwhile work, no duplicate scans. Preserve the selected model; do not claim unverified routing or usage savings.

## 2026-09-14 mobile/live continuation checkpoint

Four user-requested changes are implemented in source and corresponding live compatibility behavior is deployed: conservative single-string audio drafting, direct camera capture for photo import, Safari→standalone-iPhone auth handoff, and interface scaling. Live Supabase migrations `202609140003_auth_handoff.sql`, `202609140004_auth_handoff_single_use.sql`, and `202609140005_auth_handoff_grants.sql` are applied. The handoff is secret-bound, expires after ten minutes, and is deleted on successful claim. Production Vercel deployment was validated for intact CSS/static routing before promotion. Once dependencies are hydrated, prefer a normal full Vite build from this source and remove the runtime compatibility shim rather than extending it further.

## 2026-09-15 passwordless auth update
- Account UI now offers **Verification code (recommended)** and **Magic link**. The code path calls Supabase `/auth/v1/verify` in the same browser/PWA, persists the access + refresh session to `fretshift-cloud-session`, and immediately starts sync. This avoids Safari/Home-Screen storage separation on iPhone.
- `src/cloud/client.ts` now exposes `sendSignInEmail`, `sendVerificationCode`, and `verifyEmailCode`; the existing magic-link/iPhone handoff remains as the alternate path.
- Supabase uses one Magic Link / OTP email template. `supabase/templates/magic_link.html` and `confirmation.html` intentionally include both `{{ .Token }}` and `{{ .ConfirmationURL }}` so the same email can support either in-app choice. The hosted project template still requires a dashboard/Management-API update; the current connector does not expose Auth template mutation.
- Production Vercel deployment `dpl_6CeF2XxRUSzUwnMZQGWJstGeGTfP` adds `/auth-options.js` as a compatibility layer over the known-good compiled bundle. Production CSS was re-verified as `text/css`, and `/auth-options.js` is served as JavaScript. The permanent React/TypeScript implementation is in this source tree and should replace the compatibility layer on the next normal full Vite build.
