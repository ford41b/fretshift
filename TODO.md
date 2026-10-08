# FretShift open verification and setup

Evidence labels: **live** (observed against the hosted project or site), **local** (this repo's tests and scripts), **emulated** (Playwright browsers), **physical** (real devices and instruments), **reported** (done by the owner, not re-observed here).

## Human + hardware (never automated claims)

- [ ] Real guitar tuning accuracy, including alternate tunings and A4 reference.
- [ ] Metronome feel and live line tracking on actual instruments.
- [ ] Two-chord drill on real strums and strum timing with device latency.
- [ ] iOS Safari background stability and audio resume behavior.
- [ ] Bluetooth foot pedal and stage view wake lock.
- [ ] Two-device sync against the hosted project: a second device's sync downloads only changed rows.
- [ ] Immersive iPhone acceptance checklist ([docs/handoffs/IMMERSIVE_RELEASE_HANDOFF.md](docs/handoffs/IMMERSIVE_RELEASE_HANDOFF.md)); then record it in `src/audio/immersive/evidence/physical-acceptance.json` to remove the BETA badge.
- [ ] Immersive timing calibration on hardware: wired, speaker and Bluetooth/visual results.
- [ ] Record the 78-file chord corpus ([docs/immersive/chord-recording-checklist.md](docs/immersive/chord-recording-checklist.md)) and run `pnpm eval:chords <folder>`; chord scoring stays off until it meets the thresholds.
- [ ] Device acceptance: record a few clean open/fretted single-string notes on iPhone; take a photo directly from the import screen; try the interface-size slider at 85%, 100% and 120%.

## Hosted project (`prftwxtrphgkohflmfsn`) and web app

Done:

- [x] Database migrations through `202610020002_sync_records_updated_at_index.sql` are applied (reported). `consume_rate_limit` and `rate_limit_counters` refuse the publishable key with `42501 permission denied` (live, 2026-10-08).
- [x] `password-signup`, `vision-import` and `youtube-import` redeployed around 2026-10-05 (reported). Each rejects a foreign `Origin` with 403; `password-signup` also rejects a missing `Origin`; `vision-import` and `youtube-import` reject a missing, malformed or unverifiable bearer token with 401 (live, 2026-10-08).
- [x] Function secrets `OCR_SPACE_API_KEY`, `GEMINI_API_KEY` and `ALLOWED_ORIGINS` are set (reported; both health endpoints report `providerConfigured: true`, live). Optional limits (`SIGNUP_*`, `VISION_PAGES_*`, `YOUTUBE_CALLS_*`) use their code defaults unless set.
- [x] Auth: SMTP through Resend, OTP length 8, "Confirm email" on (reported).
- [x] Production web app runs a native Vite build of `main` (built 2026-10-06 02:41 UTC). The 2026-09-14 runtime compatibility layer is gone: `/auth-options.js` now falls through to the SPA, and `index.html` loads only the Vite bundle (live, 2026-10-08). `fretshift-current1.vercel.app` redirects (307) to `fretshift-beta.vercel.app`.
- [x] GitHub Actions observed on the pushed repository (lint/unit/build, Deno, Chromium and WebKit E2E).

Open:

- [ ] Hosted "Confirm signup" email template must contain `{{ .Token }}` (it held only Supabase's default link). Set it from `supabase/templates/confirmation.html` and read it back.
- [ ] Remove the temporary deploy workaround: Edge Functions `deploy-archive` and `deploy-archive-upload` (`verify_jwt = false`, not in this repo) and table `public._fretshift_deploy_chunks` (readable with the publishable key on 2026-10-08, live). Record the drop as a migration.
- [ ] Review `public` table grants and the Supabase security advisor findings.
- [ ] Audit the existing `auth.users` accounts created by the old pre-confirming `password-signup`.
- [ ] Check one `password-signup` log entry: does the per-IP limit see the caller's address (rightmost `X-Forwarded-For`) or one shared gateway address?
- [ ] Signed-in smoke test with a real inbox: new-email sign-up by code; already-registered email gets the same response; password sign-in afterwards; optional magic-link path; iPhone Home Screen sign-up by code and by emailed link (handoff).
- [ ] Review Auth's per-IP OTP rate limit: every password sign-up reaches `/auth/v1/otp` from the function's address.
- [ ] One photo import within quota leaves a `vision:pages:*` counter row; the 11th sign-up request in an hour from one IP gets 429 (needs your OK; consumes real quota).
- [ ] First live YouTube/Gemini import (paid, signed-in token). Expect `youtube-chords-v1` prompt changes afterwards.
- [ ] Replace/augment the provisional vision corpus with real photos, run the OCR.space benchmark, and review chord accuracy ≥80% / lyric CER ≤10% in [test-fixtures/vision-corpus/RESULTS.md](test-fixtures/vision-corpus/RESULTS.md).

## Stage status

- [x] Stage 1 local automated gate; remote CI observed.
- [x] Stage 2 local automated gate; remote CI observed.
- [x] Stage 3 offline gate: MIDI/MusicXML/Guitar Pro, text-layer PDF, printable PDF, and local audio-to-chord drafting.
- [x] Stage 3 network implementation gate: photo/scanned/mixed-PDF preprocessing, validated Edge Function contract, 20-case rendered provisional corpus, benchmark harness, and mocked browser flow. Live provider accuracy remains open above.
- [x] Stage 4 local implementation gate: authentication client, account-pinned sync, conflict handling, settings/tunings/practice migration, share management, SQL migration, PostgREST-shaped contract tests, and mocked browser flows. Real email and cross-device verification remain open above.
- [x] Live database integration: `sync_records`, `song_shares`, RPCs, RLS, grants, trigger hardening and rate limits are deployed to the hosted project.

## Explicit scope follow-ups

- [ ] Exercise 200-measure keyboard traversal across virtualized boundaries on lower-powered mobile devices.
- [ ] Decide whether arbitrary ChordPro comments/spacing need lexical round-trip. Applying edited source now preserves matching tab and per-measure settings, but portable ChordPro still cannot represent every Song field; JSON remains lossless.
- [ ] `ALLOWED_ORIGINS` adds to the built-in origins in `password-signup` but replaces them in `vision-import` and `youtube-import`. Keep the hosted secret listing every production origin, or make the three consistent.
- [ ] Sync against real PostgREST: `Content-Range`, `count=exact` and `updated_at=gte.` were tested only against a PostgREST-shaped mock.

## History

- 2026-09-14 mobile feature pass: sparse single-string audio drafting, rear-camera capture, iPhone standalone-PWA magic-link handoff, interface sizing 85–120%. Its runtime compatibility deployment was replaced by the native build (see above).
- 2026-10-02 debug pass ([docs/reports/DEBUG_REPORT_2026-10-02.md](docs/reports/DEBUG_REPORT_2026-10-02.md)): `password-signup` no longer pre-confirms accounts; per-user quotas through `supabase/functions/_shared/rateLimit.ts`; incremental sync pull; audio draft autosave; Node 25/26 test shim; WebKit strumming fix; CI split into parallel jobs.
- 2026-10-08 hardening pass: Edge Function auth/origin/fail-closed tests for every function with `verify_jwt = false`; root-level reports moved under `docs/`; `fretdebug.zip` removed; audio E2E screenshots go to `test-results/`.
