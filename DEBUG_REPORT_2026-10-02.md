# FretShift debug and hardening pass (2026-10-02)

Base: `fretdebug.zip` → `FretShift-Audio-Intelligence-Validated` (the 2026-09-29 debug pass), imported unchanged as commit `eaedb7e` on branch `claude/epic-wozniak-8xgmdt` so every fix below is a reviewable diff. Node 22.22, pnpm 10.15.1, frozen lockfile.

## Evidence types used in this report

- **Local**: run in this cloud container. Supabase, Auth, OCR.space and PostgREST were **mocked or faked**. SQL migrations ran on PGlite (Postgres 17 compiled to WASM), not on the hosted project. Edge Functions were type-checked with Deno 2.9.
- **CI**: real GitHub Actions runs on `ubuntu-latest` with Playwright's own Chromium and WebKit builds. WebKit could only be run there: this container's egress policy blocks Playwright's browser CDN.
- **Live/hardware**: **none**. No hosted Supabase project, email, OCR provider, deployed site, iPhone, or Safari on Apple hardware was used. Nothing below is claimed as live-verified.

## Results

| Gate | Before | After |
| --- | --- | --- |
| `eslint .` / `tsc -b` | pass | pass |
| Unit tests (`vitest run`, Node 22) | 305/305 | **326/326** (+21 regression/contract tests) |
| Unit tests on Node 25.9 / 26.10 | 309/325 (16 failed: `localStorage`) | 326/326 on both; also 326/326 on Node 20.20 and 24.21 |
| `pnpm build` | pass | pass |
| Chromium E2E, local (`chromium` + `chromium-unconfigured`) | 48 passed, 0 failed, 6 skipped | **51 passed, 0 failed, 6 skipped** (+3 new tests); CI identical ([run 3](https://github.com/ford41b/fretshift/actions/runs/36953856047)) |
| WebKit E2E, CI | 52 passed, **1 failed** (`strumming.spec.ts` 1280 px), 0 skipped ([run 1](https://github.com/ford41b/fretshift/actions/runs/36951794560)) | **56 passed, 0 failed, 0 skipped** (+3 new tests, including the 1280 px strumming test) ([run 3](https://github.com/ford41b/fretshift/actions/runs/36953856047)) |
| Edge Functions `deno check` | pass | pass (both functions) |
| CI workflow | single job; red on WebKit | 3 parallel jobs, **all green** on [run 3](https://github.com/ford41b/fretshift/actions/runs/36953856047); final head re-run noted below |

The 6 Chromium skips are unchanged and deliberate: the AudioWorklet controlled-microphone tests skip on Chromium, as documented in the 2026-09-29 report. They run in WebKit.

Local Chromium is the container's preinstalled Chromium 141 (Playwright build 1194), linked in for Playwright 1.55, which expects build 1187 (Chromium 140). CI uses the exact pinned builds.

## Bugs fixed

### 1. `password-signup` created pre-confirmed accounts for any email (security, critical)

- **Expected:** creating an account proves ownership of the email before it can be used. Unauthenticated callers can't tell whether an address is registered. The endpoint can't be scripted for unlimited accounts.
- **Actual:**
  - The function called `POST /auth/v1/admin/users` with `email_confirm: true` and the caller's password.
  - A missing `Origin` was allowed, and the only other check was the public `apikey`.
  - So anyone could create a confirmed account for someone else's address with a password they knew (account pre-hijacking).
  - Registered emails got `409`, unregistered ones `201` (enumeration). There was no rate limit, so every minted user could spend the OCR quota.
- **Root cause:** the endpoint trusted the caller's claim to the email address. It existed so password sign-up wouldn't need email delivery.
- **Fix:**
  - **No password before proof.** The function no longer receives a password and never confirms anyone. It asks Supabase Auth to email the existing verification code (`/auth/v1/otp`, `create_user: true`). A new account is unconfirmed and has a random password nobody knows.
  - **Password set after the code.** The client verifies the code (`/auth/v1/verify`) and only then saves the chosen password from that session (`PUT /auth/v1/user`).
  - Simply creating the account unconfirmed *with* the caller's password would still be hijackable. GoTrue keeps the stored password when an unconfirmed user later confirms by code, so an attacker who pre-registered the address could sign in once the real owner confirmed it.
  - **Origin.** A missing or disallowed `Origin` returns `403` before any backend work. The existing exact list and preview-URL pattern still apply, plus optional `ALLOWED_ORIGINS`.
  - **Uniform response.** New, unconfirmed and confirmed emails all get the same `202 {status:"code_sent"}`.
  - **Rate limits.** The IP is the *rightmost* `X-Forwarded-For` entry, the one the platform's proxy appended; a client-supplied leftmost entry is ignored. Per IP: 10 per hour. Per email: 3 per hour. Both use SHA-256-hashed keys in a new service-role-only table and RPC (`supabase/migrations/202610020001_rate_limits.sql`). The function returns `429` with `Retry-After` when a limit is hit, and fails closed (`503`) if the limiter can't be reached.
  - **iPhone handoff.** For the standalone PWA the client still creates the handoff and passes a same-origin `/settings` `redirect_to`, which the function validates. Users can enter the code inside the app, or open the emailed link in Safari and let the existing handoff transfer the session.
  - `supabase/config.toml` now records `verify_jwt = false` for `password-signup`; it is called before a session exists. Previously this lived only in the deployed function's settings.
- **Note on the code length:** your request said "six-digit code", but the app and its docs use the **8-digit** code that already exists (`verifyEmailCode` requires `^\d{8}$`). That flow is reused unchanged. The hosted project's OTP length must stay 8.
- **Behaviour note:** "Create account" with an email that already has an account emails a code to that inbox. After the code is entered, the chosen password becomes that account's password. Only the inbox owner can do this, so it works like a password reset.
- **Regression test:** `supabase/functions/password-signup/handler.test.ts`, 5 tests against a fake GoTrue and a fake limiter. All 5 **failed against the original logic** (extracted unchanged first):
  - `201` instead of `202`;
  - missing Origin accepted (`201`, not `403`);
  - `409` vs `201` for registered vs new emails;
  - no `429` at all (`[400,400,400,400]`).

  All pass after the fix. A sixth test, added after a self-review, checks that rotating a spoofed leftmost `X-Forwarded-For` entry doesn't reset the IP limit. It fails with leftmost-entry keying (`202` instead of `429`). Supporting tests:
  - `src/cloud/client.test.ts`: the password is never sent before verification; the order is signup → verify → set password; server 429 is honoured.
  - `e2e/cloud.spec.ts`, "password sign-up confirms the emailed code before saving the password".
  - Migration exercised on PGlite: atomic consume, over-limit requests consume nothing, `anon` and `authenticated` are denied the table and RPC, `service_role` is allowed, invalid parameters are rejected.

### 2. Paid-API functions had no per-user quota

- **Expected:** one account can't spend the OCR.space quota without limit.
- **Actual:** `vision-import` only checked that the bearer token was valid.
- **Fix:**
  - New reusable helper `supabase/functions/_shared/rateLimit.ts` (`consumeRateLimits`, `hashKey`, `clientIp`, `envLimit`) on the same `consume_rate_limit` RPC. Future paid-API functions import it.
  - `vision-import` now takes the verified user id from `/auth/v1/user`. Before any provider request it charges one unit per page against per-user hourly (default 60) and daily (default 200) buckets. Both are tunable with `VISION_PAGES_PER_HOUR` / `VISION_PAGES_PER_DAY`.
  - Exhausted quota returns `429` with `Retry-After`; an unreachable limiter returns `503` with no provider call. Invalid and unauthenticated requests consume nothing.
  - Quota is charged before the provider call, so pages that OCR.space then fails on still count. This is deliberately conservative.
  - The logic moved to `handler.ts`; `index.ts` is now a one-line `Deno.serve`.
- **Regression test:** `supabase/functions/vision-import/handler.test.ts`. The quota and fail-closed tests **failed before** (the 6th page still returned `200`; limiter down still returned `200`) and pass after.

### 3. Sync downloaded every row every 30 s, and a lower PostgREST `max-rows` silently truncated the pull

- **Expected:** a quiet library costs almost nothing to sync, and a pull is never silently incomplete.
- **Actual:** `pull()` fetched every `sync_records` row (audio-review songs are about 4 MB each) on every auto-sync. It also stopped as soon as a page held fewer than 1000 rows, so with `max-rows = 500` it returned 500 of 1,200 rows and reported success.
- **Fix:**
  - **Cursor.** Per-account cursor `sync:cursor:<account>`, holding a *server* `updated_at`, never the client clock. Pulls send `updated_at=gte.<cursor − 60 s>`. The overlap covers rows whose transaction started before the cursor but committed after a pull.
  - **Cursor advance rule.** The cursor only moves past records settled in the baseline at or beyond the pulled revision. Conflicts, failed applies and edits made during a sync hold it, so they are re-pulled and re-evaluated exactly as before. An invalid envelope keeps the old cursor. Accepted uploads also advance it.
  - **Full-pull fallbacks.** A full pull still happens with no cursor or baseline (first sync, new device), after a relink, or when a settled record is missing locally. The last case is a backup restore, where the old full pull re-offered server copies; that behaviour is preserved.
  - **Content-Range paging.** `SupabaseSyncAdapter` pages with `Range`, `Prefer: count=exact` and `Content-Range`. A response without a consistent `Content-Range` is an error, not "done". Rows duplicated when pages shift are collapsed.
  - New index `(owner_id, updated_at)` in `202610020002_sync_records_updated_at_index.sql`.
  - Canonical-JSON comparison and conflict choices are unchanged.
- **Regression tests:**
  - `src/sync/engine.test.ts` "incremental pull" (5 tests, all through the jsonb key-reordering fake adapter). "downloads only records changed since the last sync" **failed before**: the old code pulled `[4]` rows where `[0]` changed. "re-reads the overlap window" also failed before: there was no cursor.
  - The conflict, restore and relink tests passed before and after. They guard against behaviour changes.
  - `src/persistence/supabase/index.test.ts` "follows Content-Range…" **failed before** (`got 500` of 1200) and passes after.
  - Two older test fixtures wrote server rows with hard-coded 2026-09-13 timestamps, older than any cursor. A real server can't do that (`updated_at` comes from `now()`), so they now use current timestamps. No assertions changed.

### 4. Audio Intelligence review: unsaved work was lost, and cancel could hang

- **Expected:** leaving or reloading the review doesn't lose corrections, and Cancel returns control promptly.
- **Actual:**
  - Review edits lived only in React state.
  - Cancelling during "Preparing audio" waited for `decodeAudioData` to finish. The UI showed "Finishing cancellation" with the file picker disabled for as long as the browser took to decode up to 30 MB.
- **Fix:**
  - **Drafts.** `src/audio/intelligence/drafts.ts` autosaves unsaved reviews to IndexedDB (Dexie `meta`, not localStorage, since drafts can be several MB). It saves 400 ms after a change and on pagehide, hidden visibility and unmount. Drafts are schema-validated on load; a corrupt one is discarded.
  - **Restore.** Returning shows "Restored unsaved changes…". A restored new-analysis draft reattaches audio rather than re-analyzing. **Save** or the new **Discard unsaved changes** button deletes the draft.
  - **Cancel.** `BrowserAudioDecoder` now stops waiting on abort: it rejects with `AbortError` immediately, closes the `AudioContext` without awaiting it, and ignores any late decode result unread.
  - **Documented** in `AUDIO_IMPORT.md`: browsers can't interrupt `decodeAudioData`. After a cancel the browser may keep decoding in the background until it finishes. FretShift only stops waiting and discards the result.
- **Regression tests:**
  - `src/audio/intelligence/lifecycle.test.ts` "returns from cancel immediately…" **failed before**: still waiting on `decodeAudioData` 200 ms after abort.
  - `src/audio/intelligence/drafts.test.ts` (2 tests).
  - `e2e/audio-intelligence.spec.ts` "unsaved review edits are autosaved, restored after reload, and cleared on discard or save".

### 5. Unit tests failed on Node 25/26

- **Expected:** `engines: ">=20 <27"` is true.
- **Actual:** 16 failures in `src/cloud/*` on Node 25.9 and 26.10: the 14 recorded on 2026-09-29 plus the 2 new client tests.
- **Root cause:** Node ≥ 25 defines its own global `localStorage` and `sessionStorage`. They are unusable without `--localstorage-file` (undefined, with an `ExperimentalWarning`). Because the globals already exist, Vitest's jsdom environment doesn't replace them.
- **Fix:** `src/testSetup.ts` points both globals at jsdom's Storage. On Node 20 and 22 it does nothing.
- **Verified locally:** 326/326 on Node 20.20.2, 22.22.0, 24.21.0, 25.9.0 and 26.10.0. Lint, types and build also pass on 26.10. `engines` is unchanged. Node 26 still prints a harmless `ExperimentalWarning` when its own getter is first touched.
- **Regression evidence:** the same suite **before** the shim: 16 failed on Node 25 and on Node 26.

### 6. WebKit: strumming controls moved under the pointer at 1280 px

- **Expected:** `strumming.spec.ts` at 1280 px passes in WebKit, and the page doesn't jump while scrolling the song screen.
- **Actual (CI run 1, real WebKit):** clicking the "Simple" pattern timed out. The element intercepting the click changed on every retry: the strumming card, `.transform-bar`, `.strumming-pattern-title`, `.strumming-assumption`. The button kept moving.
- **Root cause:**
  - `Notation` virtualizes measures. A measure more than 800 px offscreen became a fixed 120 or 250 px placeholder, but rendered measures are taller (385 px on `sample-1`).
  - Scrolling to the strumming card, which sits below the score, shrank the content above it by 135 px per measure.
  - Chromium's CSS scroll anchoring silently compensates. WebKit doesn't, so the card jumped, which changed which measures intersected, which moved it again.
  - Real Safari users at desktop or iPad widths would see the same jumping.
  - This was not the splash or scroll-restoration issue suspected on 2026-09-29.
- **Fix:** offscreen placeholders keep the measure's last rendered height. The stored height resets when the view or edit mode changes.
- **Regression test:** `e2e/strumming.spec.ts`, "content above the strumming card does not shift after scrolling to it". It disables scroll anchoring in every engine and asserts that the card's page position is unchanged after scrolling to it, then clicks. It **failed before** in Chromium (3382 → 3247 px) and passes after. The original 1280 px test is unchanged and is the WebKit check.
- **Immersive controlled-microphone tests:** they already **passed in WebKit on CI before any change** (run 1, tests #72–#81), so nothing was changed there. They remain skipped on Chromium by design.

### 7. CI

- **Before:** one serial job (lint, unit, build, then every Playwright project, about 17 minutes) on Node 20, which is end-of-life. It was red on WebKit.
- **After:**
  - `.github/workflows/ci.yml` has a "Lint, unit tests, build" job and parallel "E2E (chromium)" (`chromium` + `chromium-unconfigured`) and "E2E (webkit)" jobs. Each installs only its own browser.
  - Node 22 (`.nvmrc`), `contents: read`, cancel-superseded concurrency, and per-browser failure artifacts.
  - My first push of the new file had a YAML flow-mapping error (`{ name: e2e-${{ … }} }`) and failed to parse ([run 2](https://github.com/ford41b/fretshift/actions/runs/36953802808)). It was fixed in `f1f2ee2`.
- **Result:** [run 3](https://github.com/ford41b/fretshift/actions/runs/36953856047) is green on all three jobs: lint/unit/build, E2E chromium (51 passed, 6 skipped), and E2E webkit (56 passed). The final commit (X-Forwarded-For hardening plus this report) was pushed afterwards; see the last line of this report for its run.

## Still open (needs you, the hosted project, or hardware)

### Supabase steps you must run, in this order

1. **Apply the two new migrations** to the hosted project (`prftwxtrphgkohflmfsn`), with `supabase db push` or by pasting them into the SQL editor:
   - `supabase/migrations/202610020001_rate_limits.sql`: `rate_limit_counters` plus `consume_rate_limit`, service role only.
   - `supabase/migrations/202610020002_sync_records_updated_at_index.sql`: index only, safe at any time.

   Then confirm the RPC is not callable anonymously:

   ```sh
   curl -X POST "$URL/rest/v1/rpc/consume_rate_limit" -H "apikey: <publishable key>" -H "Content-Type: application/json" -d '{"p_bucket":"x","p_cost":1,"p_limit":1,"p_window_seconds":60}'
   ```

   It must return a permission error.
2. **Redeploy both Edge Functions** (both have `verify_jwt = false` in `config.toml`):

   ```sh
   supabase functions deploy password-signup
   supabase functions deploy vision-import
   ```

   Without step 1 they fail closed with `503`. They use the automatically provided `SUPABASE_SERVICE_ROLE_KEY`. Do not put it in any `VITE_` variable.
3. **Optional function secrets** (defaults in brackets): `SIGNUP_IP_LIMIT_PER_HOUR` [10], `SIGNUP_EMAIL_LIMIT_PER_HOUR` [3], `VISION_PAGES_PER_HOUR` [60], `VISION_PAGES_PER_DAY` [200], `ALLOWED_ORIGINS` (add the production origin if it isn't one of the hard-coded Vercel origins).
4. **Auth settings to confirm** in the dashboard:
   - "Confirm email" is on.
   - The OTP length is **8**.
   - The hosted *Confirm signup* and *Magic link* templates contain `{{ .Token }}`, like `supabase/templates/*.html`. New unconfirmed users receive the confirmation template.
5. **Email delivery:** password sign-up now sends an email. Configure SMTP (already in TODO); the built-in mailer allows only a few emails per hour.
6. **Auth's per-IP OTP limit is shared by all password sign-ups.** The function calls `/auth/v1/otp` from Supabase's edge, so every password sign-up counts against one IP. Check Authentication → Rate Limits.
7. **Deploy the web app** right after steps 1–2. A previously deployed client sends the password and then tries password sign-in immediately, which will now fail with "Email not confirmed".
8. **Audit existing accounts.** Users created by the old function were confirmed without proof of ownership. In a private beta the list should be short: review `auth.users` for accounts nobody recognises.
9. **Live smoke test (not done here):**
   - New email: code arrives, account confirms, password sign-in works afterwards.
   - Already-registered email: identical response, and the code signs into that account.
   - A request without `Origin` gets `403`.
   - The 11th request in an hour from one IP gets `429`.
   - One photo import succeeds and leaves a `vision:pages:*` counter row.
   - On the installed iPhone app: complete sign-up by entering the code, and separately by opening the emailed link in Safari (handoff).

### Not verified, and why

- **GoTrue behaviour I relied on but could not observe live:**
  - `/otp` with `create_user: true` emails a code for new, unconfirmed and confirmed users alike, with the same `200`.
  - `/verify` with `type: "email"` accepts a signup-confirmation code.

  Both match GoTrue's documented and source behaviour, but only fakes were used here. If the project has sign-ups disabled, GoTrue rejects only *new* emails, which would make responses differ again.
- **Client IP header on Supabase's edge:** the per-IP limit assumes the platform appends the caller's address as the rightmost `X-Forwarded-For` entry. If the hosted gateway adds further internal hops, every caller shares one bucket: safe but stricter. Check one function log after deploying.
- **Sync against real PostgREST:** the `Content-Range`, `count=exact` and `updated_at=gte.` behaviour was tested against a PostgREST-shaped mock, not the hosted API. The first sync after updating is a one-off full pull (no cursor yet). Rows changed in the last 60 s are re-downloaded on each sync until they age out of the overlap window. A two-phase pull (list revisions, then fetch only changed payloads) would cut that further.
- **WebKit ≠ Safari:** the WebKit passes are Playwright's WebKit on Linux in CI, not Safari on macOS or iOS. iPhone checks remain in TODO.
- **Audio:** draft restore and immediate cancel were verified in browsers (local Chromium; WebKit via CI). Cancel behaviour during a real long decode on a phone wasn't measured.
- **E2E on other Node versions:** E2E ran on Node 22 only; Node 20/24/25/26 coverage is unit tests (plus lint and build on 26).

### Environment notes

- `AGENTS.md` asks for Headroom and a host-specific `rtk-codex` binary. Neither exists in this container, so neither was used.
- This container's egress policy blocks Playwright's browser CDN and GitHub's artifact storage. WebKit therefore ran only in CI, and CI failure traces couldn't be downloaded; the WebKit root cause was found from the CI log plus a local reproduction with scroll anchoring disabled.
- `e2e/audio-notes.spec.ts` and `audio-intelligence.spec.ts` overwrite committed screenshots under `docs/post-phase-3-validation/` on every run. That churn was not committed. Consider writing them to `test-results/`.

### Carried over

Everything already listed in `TODO.md`: physical devices, live multi-device sync, recognition accuracy gates, the OCR provider benchmark.

## Files changed

- `supabase/functions/_shared/rateLimit.ts` (new); `supabase/functions/password-signup/{handler.ts,handler.test.ts,index.ts}`; `supabase/migrations/202610020001_rate_limits.sql` (new); `supabase/config.toml`; `src/cloud/client.ts`, `src/cloud/client.test.ts`; `src/ui/components/AccountSync.tsx`; `PASSWORD_AUTH_DEPLOY.md`: fix 1
- `supabase/functions/vision-import/{handler.ts,handler.test.ts,index.ts}`: fix 2
- `src/sync/{adapter.ts,engine.ts,engine.test.ts}`; `src/persistence/supabase/{index.ts,index.test.ts}`; `src/persistence/fakes/sync.ts`; `supabase/migrations/202610020002_sync_records_updated_at_index.sql` (new): fix 3
- `src/audio/intelligence/{index.ts,lifecycle.test.ts,drafts.ts,drafts.test.ts}`; `src/ui/components/AudioIntelligenceReview.tsx`; `AUDIO_IMPORT.md`: fix 4
- `src/testSetup.ts`: fix 5
- `src/ui/components/Notation.tsx`: fix 6
- `.github/workflows/ci.yml`, `.nvmrc`: fix 7
- `e2e/cloud.spec.ts`, `e2e/audio-intelligence.spec.ts`, `e2e/strumming.spec.ts`: browser tests for fixes 1, 3 (PostgREST-shaped mock), 4 and 6
