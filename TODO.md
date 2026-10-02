# FretShift open verification and setup

## Human + hardware (never automated claims)

- [ ] Real guitar tuning accuracy, including alternate tunings and A4 reference.
- [ ] Metronome feel and live line tracking on actual instruments.
- [ ] Two-chord drill on real strums and strum timing with device latency.
- [ ] iOS Safari background stability and audio resume behavior.
- [ ] Bluetooth foot pedal and stage view wake lock.
- [ ] Real cross-device sync plus verification-code and optional magic-link delivery.
- [ ] Deploy a URL to Vercel/Netlify; observe GitHub Actions on the pushed repository.
- [ ] Immersive iPhone acceptance checklist (IMMERSIVE_RELEASE_HANDOFF.md); then record it in `src/audio/immersive/evidence/physical-acceptance.json` to remove the BETA badge.
- [ ] Immersive timing calibration on hardware: wired, speaker and Bluetooth/visual results.
- [ ] Record the 78-file chord corpus (docs/immersive/chord-recording-checklist.md) and run `pnpm eval:chords <folder>`; chord scoring stays off until it meets the thresholds.

## External setup (last stage; no secrets committed)

- [x] Hosted Supabase project exists and the database migrations are applied. Auth redirect URLs and signed-in smoke testing remain open.
- [ ] Add `VITE_SUPABASE_URL` and preferred `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) to `.env.local` and hosting environment.
- [ ] `vision-import` is deployed and active. Add `OCR_SPACE_API_KEY` plus production `ALLOWED_ORIGINS` as Edge Function secrets before real OCR testing.
- [ ] Configure Supabase SMTP provider credentials for volume email. (Now required for password sign-up too: it sends a verification code.)
- [ ] Replace/augment provisional vision corpus with real photos, run the OCR.space benchmark, and review chord accuracy ≥80% / lyric CER ≤10% in `RESULTS.md`.

## Stage status

- [x] Stage 1 local automated gate; remote CI pending.
- [x] Stage 2 local automated gate; remote CI pending.
- [x] Stage 3 offline gate: MIDI/MusicXML/Guitar Pro, text-layer PDF, printable PDF, and local audio-to-chord drafting.
- [x] Stage 3 network implementation gate: photo/scanned/mixed-PDF preprocessing, validated Edge Function contract, 20-case rendered provisional corpus, benchmark harness, and mocked browser flow. Live provider accuracy remains in External setup.
- [x] Stage 4 local implementation gate: authentication client, account-pinned sync, conflict handling, settings/tunings/practice migration, share management, SQL migration, PostgREST-shaped contract tests, and mocked browser flows. Real Supabase/Postgres/RLS/email/cross-device verification remains open above.

- [x] Live-integration preparation: current/legacy Supabase public-key support, explicit `vision-import` function auth configuration for asymmetric JWT projects, and a non-destructive `pnpm verify:live` smoke test.
- [x] Live database integration: `sync_records`, `song_shares`, RPCs, RLS, grants, and trigger hardening are deployed to the hosted Supabase project; `vision-import` is deployed and active.
- [ ] Signed-in hosted smoke test remains open because the Supabase project has no Auth users yet; OCR provider secret and production CORS origin are also not configured yet.

- [x] Node 20.20.2 local lint, strict TypeScript, production build, Deno Edge Function check, and full 123-test run.
- [x] Full local browser matrix: 51/51 across Chromium, WebKit, and a separate unconfigured build, including both themes, mobile axe, account/share/vision mocks, and imported-file flows.
- [x] Observe the committed Chromium + WebKit workflow on a remote GitHub Actions run (2026-10-02, https://github.com/ford41b/fretshift/actions/runs/36953856047: lint/unit/build, Chromium and WebKit E2E all green).

## Explicit scope follow-ups

- [ ] Exercise 200-measure keyboard traversal across virtualized boundaries on lower-powered mobile devices.
- [ ] Decide whether arbitrary ChordPro comments/spacing need lexical round-trip. Applying edited source now preserves matching tab and per-measure settings, but portable ChordPro still cannot represent every Song field; JSON remains lossless.

## 2026-09-14 follow-up after mobile feature pass

- [x] Change audio drafting to sparse single-string/root-note detection rather than dense major/minor chord inference.
- [x] Add direct rear-camera capture to Photos & scans.
- [x] Add an iPhone standalone-PWA/Safari magic-link handoff and make the claim single-use.
- [x] Add user-adjustable interface sizing (85–120%).
- [x] Preview-test and promote the guarded production compatibility deployment; verify root HTML, CSS MIME/type, service-worker cache revision, feature patch, and monophonic audio worker.
- [ ] After dependencies are available again, run the complete source tree through `pnpm test`, `pnpm lint`, `pnpm build`, Chromium/WebKit E2E, then deploy the native source build and retire the runtime compatibility patch.
- [ ] Device acceptance: record a few clean open/fretted single-string notes on iPhone; take a photo directly from the import screen; complete one six-digit verification-code sign-in inside the installed Home Screen app and confirm account songs arrive; separately smoke-test the optional magic-link path; try the interface-size slider at 85%, 100%, and 120%.

## 2026-10-02 debug pass (see DEBUG_REPORT_2026-10-02.md)

Done locally / in CI (no live Supabase, email, or device verification):

- [x] `password-signup`: no pre-confirmed accounts, no password before code verification, Origin required, uniform response, per-IP/per-email rate limits.
- [x] Reusable per-user quota helper (`supabase/functions/_shared/rateLimit.ts`) enforced in `vision-import`.
- [x] Incremental sync pull (per-account `updated_at` cursor, 60 s overlap) and `Content-Range` paging.
- [x] Audio review drafts autosave/restore/discard; cancel no longer waits for `decodeAudioData`.
- [x] Node 25/26 test shim; unit suite verified on Node 20, 22, 24, 25, 26.
- [x] WebKit 1280 px strumming failure fixed (notation placeholder height). Immersive controlled-microphone tests already passed in WebKit on CI.
- [x] CI split into lint/unit/build plus parallel Chromium and WebKit E2E jobs.

You must do (in order):

- [ ] Apply migrations `202610020001_rate_limits.sql` and `202610020002_sync_records_updated_at_index.sql` to the hosted project; confirm `consume_rate_limit` is not callable with the publishable key.
- [ ] `supabase functions deploy password-signup` and `supabase functions deploy vision-import`.
- [ ] Optional secrets: `SIGNUP_IP_LIMIT_PER_HOUR`, `SIGNUP_EMAIL_LIMIT_PER_HOUR`, `VISION_PAGES_PER_HOUR`, `VISION_PAGES_PER_DAY`, `ALLOWED_ORIGINS`.
- [ ] Auth dashboard: "Confirm email" on, OTP length 8, hosted Confirm-signup and Magic-link templates include `{{ .Token }}`; review Auth per-IP OTP rate limit (all password sign-ups now share the function's IP).
- [ ] Deploy the web app immediately after the functions (old clients try password sign-in before confirmation).
- [ ] Audit existing `auth.users` created by the old pre-confirming function.
- [ ] Live smoke test: new-email sign-up by code; existing-email sign-up (same response); missing-Origin 403; 11th request/hour 429; one photo import within quota; iPhone Home Screen sign-up by code and by emailed link (handoff).
- [ ] Observe incremental sync against hosted PostgREST (two devices; second sync downloads only changed rows).
