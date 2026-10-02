# FretShift open verification and setup

## Human + hardware (never automated claims)

- [ ] Real guitar tuning accuracy, including alternate tunings and A4 reference.
- [ ] Metronome feel and live line tracking on actual instruments.
- [ ] Two-chord drill on real strums and strum timing with device latency.
- [ ] iOS Safari background stability and audio resume behavior.
- [ ] Bluetooth foot pedal and stage view wake lock.
- [ ] Real cross-device sync plus verification-code and optional magic-link delivery.
- [ ] Deploy a URL to Vercel/Netlify; observe GitHub Actions on the pushed repository.

## External setup (last stage; no secrets committed)

- [x] Hosted Supabase project exists and the database migrations are applied. Auth redirect URLs and signed-in smoke testing remain open.
- [ ] Add `VITE_SUPABASE_URL` and preferred `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) to `.env.local` and hosting environment.
- [ ] `vision-import` is deployed and active. Add `OCR_SPACE_API_KEY` plus production `ALLOWED_ORIGINS` as Edge Function secrets before real OCR testing.
- [ ] Configure Supabase SMTP provider credentials for volume email.
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
- [ ] Observe the committed Chromium + WebKit workflow on a remote GitHub Actions run.

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
