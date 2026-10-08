# FretShift debug and hardening pass (2026-09-29)

Base: `fretnow.zip` (post-Phase-3 validation snapshot, 2026-09-27). Node 22.22, pnpm 10.15.1, frozen lockfile.

## Results

| Gate | Before | After |
| --- | --- | --- |
| `tsc -b` / `eslint .` | pass | pass |
| Unit tests (`vitest run`) | 304/304 | 305/305 (+1 regression test) |
| `pnpm build` | pass | pass |
| Entry JS chunk | 1,411 KB (476 KB gzip) | 477 KB (150 KB gzip) |
| Chromium E2E (all specs, incl. unconfigured) | 41 passed, **11 failed**, 1 skipped | **48 passed, 0 failed**, 6 skipped |
| Production-build smoke (preview + SW + offline lazy route) | not run | pass, 0 console errors |

WebKit was not available in this environment, so WebKit E2E was not run. See "Still open".

## Bugs fixed

### 1. Cloud sync re-uploaded the whole library on every sync, and a second device conflicted on every record (critical)

- **Expected:** after a successful sync, the next sync uploads 0 records.
- **Actual:** every record re-uploaded every time; the app auto-syncs every 30 s while visible, bumping every server revision. A second device then sees each record as changed on both sides and raises a conflict for every song. Conflicts also pause auto-sync.
- **Root cause:** `src/sync/engine.ts` compared payloads with `JSON.stringify(a) === JSON.stringify(b)`. `sync_records.payload` is Postgres `jsonb`, which does not keep object key order: it sorts keys by length, then bytewise. The local copy is stored in Zod schema order. The strings never match, so every record looks locally modified. The fake adapter used in tests keeps insertion order, so tests never caught this.
- **Fix:** compare canonically, with keys sorted recursively.
- **Regression test:** `src/sync/engine.test.ts`, "stays stable when the server reorders payload keys like Postgres jsonb". It wraps the fake adapter with jsonb ordering. The test failed before the fix (`uploaded: 2`) and passes after it.

### 2. Sync rewrote every unchanged record locally on every sync

`else if (server)` applied the server copy even when neither side had changed. This caused needless IndexedDB writes every 30 s. The branch now also requires `serverChanged`. The same regression test asserts `applied: 0`.

### 3. Sync cost grew quadratically with library size

`readRecord()` called `capture()`, which read and deep-cloned **every table**, once for each record it checked. It now does a primary-key read for songs, setlists, tunings and sessions, and scans only its own table for heat, pair and strum records. Row→record mapping now lives in one function (`toRecord`), shared by `capture()` and `readRecord()`, so the two can't drift apart.

### 4. Legacy Immersive E2E suite failed (10 tests), so CI could never go green

- **Cause 1:** the tests predate the deliberate beta gate. The fixtures now get minimal valid reviewed-audio provenance, the route users can actually reach. The gate is unchanged.
- **Cause 2:** the selectors predate the visual refresh. Mode buttons now include descriptions, which are hidden at phone width. Speed is now a button group rather than a select. "Finish & see results" is now "Finish visual practice" in visual mode. All three were updated.
- **Obsolete test:** "chord-only … Rhythm" asserted behavior the current design removed on purpose (chord passages are visual-only). It was rewritten to assert the current rule.
- **New test:** "ordinary songs stay behind the beta gate and never request the microphone".
- **Controlled-microphone tests:** now skipped on Chromium, the same device gate `audio-notes.spec.ts` already uses. Root cause, verified here: headless Chromium on this host cannot start *any* AudioWorklet. Even a trivial Blob module on an `OfflineAudioContext` times out. This is an environment limit, not an app bug.

### 5. M4A decode E2E always failed on CI Chromium

Playwright's open-source Chromium, which CI uses (`channel` is unset when `CI` is set), has no AAC support. The test now checks `canPlayType` first. Where AAC is unsupported, it asserts the user-facing "Try WAV or MP3" message instead.

### 6. Launch splash blocked every hard load for ~2 s

The splash showed on every reload, deep link, shared-song link and PWA reopen, covering the UI (z-index 9999). Recorded WebKit failures show it intercepting clicks. It now shows once per browser session (`sessionStorage`, with try/catch fallback).

### 7. Reload scroll restoration fought the app's own scroll-to-top

The shell already calls `scrollTo(0, 0)` on every route change. Browser restoration after reload can jump the page after async content loads, which moves controls out from under the pointer. `history.scrollRestoration = "manual"` makes reload match the shell's behavior. This is the most likely cause of the open WebKit 1280 px strumming failure, where the click is intercepted by the card, select or main that has moved under the pointer. **It is unverified until run in WebKit.**

### 8. Service worker precache gaps

- `/icons/*` (the PWA and apple-touch icons) were not precached. All `public/` files are now listed automatically.
- About 600 KB of legacy `.woff` fonts were precached, but no service-worker-capable browser fetches them. They are now excluded.
- Every precache URL was verified to exist in `dist/`.

### 9. Dependency and deploy hygiene

- `@vercel/analytics` was declared as `"latest"`. It is now pinned to the version the lockfile already resolved (`2.0.1`).
- `<Analytics/>` now mounts only on Vercel builds (`VERCEL=1`). On Netlify and local preview its script URL fell through the SPA fallback and logged errors, which earlier validation had to filter out.

### 10. Entry bundle

Every screen other than the Songbook is now lazy-loaded with `React.lazy`, along with Tone.js and the audio stack behind them. First load drops 66%. The service worker still precaches every chunk; offline navigation to a lazy route was verified.

## Still open (needs you or hardware)

1. **Security: `password-signup` creates pre-confirmed accounts for any email (recommend fixing before wider use).**
   - The function calls the admin API with `email_confirm: true` and no proof that the caller owns the address.
   - Because a missing `Origin` is allowed and the `apikey` it checks is public, anyone can call it directly.
   - **Account pre-hijacking:** an attacker can register a victim's email with a password they know. If the victim later signs in by code or magic link, they land in the attacker's account, and the attacker can read everything the victim syncs.
   - **Other effects:** it blocks the real owner's signup (409 reveals which emails are registered) and mints unlimited authenticated users who can spend the OCR.space quota through `vision-import`.
   - **Options:**
     - Use normal `/auth/v1/signup` with email confirmation, which needs the SMTP setup already in TODO.
     - Or keep password signup but create the user unconfirmed and require the six-digit code before first sign-in.
   - Either way, add rate limiting.
   - Not changed here, because it alters the sign-in flow and needs a redeploy.
2. **WebKit E2E not run here.** Run `pnpm exec playwright test --project=webkit`, especially `strumming.spec.ts` at 1280 px (fixes 6 and 7) and the updated `immersive.spec.ts` controlled-microphone tests, which only run in WebKit.
3. **Sync bandwidth.**
   - Each sync pulls every `sync_records` row. Auto-sync runs every 30 s, and audio-review songs carry about 4 MB of evidence each.
   - **Next step:** an incremental pull, with an `updated_at` cursor plus an overlap window. The engine already tolerates partial pulls once a baseline exists.
   - **Related:** `pull()` stops when a page returns fewer than 1000 rows. If the project's PostgREST `max-rows` is set lower, the pull silently truncates. Use `Content-Range` instead.
4. **Node 25/26:** `engines` allows `<27`, but earlier passes recorded 14 cloud-test failures on Node 26 (Node's experimental global `localStorage`). Only Node 20 and 22 were available here. Either narrow `engines` or add a test-setup shim once verified.
5. Everything already listed in `TODO.md` and the validation handoff: physical devices, live multi-device sync, recognition accuracy gates.

## Files changed

- `src/sync/engine.ts`, `src/sync/engine.test.ts`: fixes 1–3
- `src/ui/App.tsx`: fixes 6 and 10
- `src/main.tsx`: fixes 7 and 9
- `vite.config.ts`: fixes 8 and 9
- `package.json`, `pnpm-lock.yaml`: fix 9, specifier only (same resolved version)
- `e2e/immersive.spec.ts`, `e2e/audio-intelligence.spec.ts`: fixes 4 and 5
