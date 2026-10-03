# YouTube link import — handoff

**Import → YouTube link** turns a public YouTube lesson into an editable chord draft. A signed-in user pastes a link; the `youtube-import` Edge Function asks Google's Gemini API to watch and listen to it; the result opens in the existing Audio Intelligence chord-region and beat review, with an embedded YouTube player, tap-along tempo and optional beat snapping. Nothing is saved until the user chooses Save, and all timing starts unconfirmed.

Branch: `claude/pensive-davinci-npi2av`. Decisions and provider sources: `DECISIONS.md` (2026-10-03). User guide: `AUDIO_IMPORT.md` → "YouTube link import". Function reference: `supabase/functions/youtube-import/README.md`.

## Deploy

Run from the repository with the Supabase CLI linked to the project (`supabase link --project-ref <ref>`).

1. **Quota table.** The function charges one unit per Gemini request through the shared limiter. If migration `supabase/migrations/202610020001_rate_limits.sql` is not applied yet:
   ```sh
   supabase db push
   ```
2. **Gemini key.** Create a key in Google AI Studio for a billing-enabled project. YouTube input is a preview feature; the free tier allows 8 hours of YouTube video per day. Check Google's current Gemini API terms before launch: content sent on the unpaid tier may be used to improve Google's products, so a paid key is the safer choice for users' links and hints.
3. **Secrets** (server-only; never `VITE_`). `ALLOWED_ORIGINS` is shared with `vision-import`, so list every deployed app origin:
   ```sh
   supabase secrets set GEMINI_API_KEY=... \
     ALLOWED_ORIGINS=https://fretshift-current1.vercel.app,https://your-other-origin.example
   # optional:
   supabase secrets set GEMINI_MODEL=gemini-3.8-flash YOUTUBE_CALLS_PER_HOUR=20 YOUTUBE_CALLS_PER_DAY=60 GEMINI_TIMEOUT_MS=120000
   ```
4. **Deploy** (uses `verify_jwt = false` from `supabase/config.toml`; the function checks the session itself):
   ```sh
   supabase functions deploy youtube-import
   ```
5. **Smoke test** without spending quota (GET is unauthenticated and makes no Gemini call):
   ```sh
   curl -s https://<ref>.supabase.co/functions/v1/youtube-import \
     -H "apikey: <publishable key>" -H "Origin: https://fretshift-current1.vercel.app"
   # expect {"status":"ok","providerConfigured":true,"authentication":"required","modelId":"gemini-3.8-flash",...}
   ```
   Then, signed in, import one short public lesson with default options and confirm the review opens.
6. **Frontend.** No new client variables. Deploy the app build as usual (`pnpm build`).

## Default accuracy options

Set in `src/youtube/types.ts` (`DEFAULT_ACCURACY`). They come from a **simulated** benchmark plus cost; no live Gemini run was possible here.

| Option | Default | Why |
|---|---|---|
| (a) send hints | **on** | No extra requests. Assumed helpful; verify live. |
| (b) overlapping windows | **off** | 3 windows cost 2.8× tokens because Google currently bills the whole YouTube audio track on each clipped request, discarded or edge windows added Unknown (13% vs 8%), and the reported offset regressions hit windowed timestamps. Ranges over 10 minutes are still split automatically. |
| (c) close-up 4 fps | **off**, opt-in | 1.9× tokens. Turn it on for lessons where the fretting hand fills the frame. Its benefit in simulation is an assumption. |
| (d) passes | **1** | 3 passes raised precision (0.73 → 0.84) and change recall ±0.5 s (0.69 → 0.79) in simulation but triple quota use. 2 passes cut recall to 0.54, because any disagreement becomes Unknown. Offer 3 passes as "high accuracy". |
| (e) snap to tapped grid | **on**, half-beat grid | Free; acts only when the user applies a tapped grid. Change recall ±0.5 s 0.695 → 0.734, but the median error of matched changes went 290 → 326 ms, because boundaries more than a quarter-beat off snap to the wrong half-beat. Whole-beat snapping was worse on both. |

**Re-decide with real data:** label 5–10 lessons (`test-fixtures/youtube/LABELING.md`), then run, for example:

```sh
YOUTUBE_BENCH_LIVE=1 GEMINI_API_KEY=... YOUTUBE_BENCH_VARIANTS=baseline,a-hints,c-close-up-fps,d-passes-3,e-snap-to-grid pnpm bench:youtube
YOUTUBE_BENCH_REPLAY=test-fixtures/youtube/recordings/<file>.json pnpm bench:youtube   # re-score for free
```

Change a default only when the live table shows the gain is worth the request cost.

## Evidence

MOCKED evidence covers FretShift's code paths only. SIMULATED evidence comes from an invented noise model. Neither says anything about Gemini's accuracy on real videos. No live Gemini or YouTube request was made.

| Check | Kind | Result (2026-10-03) |
|---|---|---|
| `deno check` + `deno test --no-lock supabase/functions/youtube-import/` (Deno 2.9.6) | MOCKED fetch for Auth, limiter, oEmbed and Gemini | 14/14 pass: URL rules, body/segment/fps/hint validation, request shape (`fileData`, `videoMetadata`, `responseSchema`, key in header), strict response validation, lyric/prose rejection, timestamp-window check, error mapping, quota per user, fail-closed limiter, private-video short-circuit, timeout |
| `pnpm lint`, `pnpm build` | static | pass |
| `pnpm test` (Vitest) | MOCKED transport | 399/399 pass, including 16 new YouTube tests (planning, voting, window merge, snapping, chord normalization, tap tempo, retry/cache, account switch, cancel, review draft and Song provenance) |
| `e2e/youtube.spec.ts` + `e2e/unconfigured.spec.ts`, local Chromium | MOCKED Edge Function and a fake IFrame API (no YouTube or Google request) | 4/4 pass: privacy notice once, hints and canonical URL sent, 2-pass vote with an Unknown disagreement, timeline seeks the player, tap-along ≈120 BPM, snap, save, reopen, stored `youtube` provenance, cancel, private-video error, retry, draft restore, timeline origin, signed-out and unconfigured states |
| Full local Chromium E2E suite | MOCKED | 64/64 pass (no regressions in Audio Intelligence and other flows) |
| GitHub Actions run 19 (`ca63a1d`) | MOCKED | Lint/unit/build ✓, E2E Chromium ✓, E2E WebKit ✓ (WebKit could not be installed in this container; CI is the WebKit evidence) |
| `pnpm bench:youtube` | SIMULATED | `YOUTUBE_IMPORT_SIMULATED_BENCHMARK_RESULTS.json`; table in `DECISIONS.md` |
| Live Gemini / deployed function | LIVE | **Not run.** No Gemini key or deployed function was available. |

## Known limits and risks

- **Unverified against Gemini.** Prompt, schema and limits follow Google's SDK/cookbook as of 2026-10-03, but no real response was observed. Expect to adjust `youtube-chords-v1` after the first live run. The function rejects answers that break the schema rather than guessing.
- **YouTube clipping regression (reported, not confirmed by Google).** Offsets may clip frames but not audio, and `gemini-3.7-flash` was reported to re-stamp timestamps from `start_offset`. FretShift flags and discards answers whose timestamps mostly fall outside the request. This is another reason (b) is off.
- **Preview feature.** YouTube URL input is preview: pricing, limits and availability may change. Intermittent `400 INVALID_ARGUMENT` responses for valid videos are retried once by the client.
- **Embedding.** Videos whose owners disable embedding are rejected up front (oEmbed), because the review player needs them. Private, unlisted, age-restricted and region-blocked videos fail with a clear message.
- **Timing.** The IFrame API reports time coarsely; FretShift extrapolates between player updates, so tapped downbeats may carry tens of milliseconds of bias. Users still confirm timing explicitly. FretShift supports 3/4 and 4/4 only.
- **Capo.** A capo hint or guess above fret 7 (FretShift's limit) is kept only in provenance.
- **Long ranges.** The shared beat-grid builder stops at 2000 beats (15 minutes at 133 BPM). A faster 15-minute range cannot be saved until the player shortens the range.
- **Agentic video understanding** (3.7/3.6/3.5-lite) was not used: Google's cookbook shows it only through the Interactions API, which does not yet support fps or clipping offsets.
- **Sync compatibility.** An older app build quarantines a synced `youtube` song (unknown source) instead of crashing. Its sync cursor holds at that record, so the song applies once the device runs a build with this change.
