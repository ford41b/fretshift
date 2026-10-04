# YouTube import Edge Function

Authenticated proxy from FretShift to Google's Gemini API for **Import → YouTube link**. The browser sends a public YouTube URL, a time range, a frame rate and optional hints; the function asks Gemini (`generateContent` with `fileData.fileUri`, `videoMetadata` and `responseSchema`) for tempo, meter, key, capo guess, section labels and chord changes, validates the answer, and returns it. Nothing is stored. No YouTube media is downloaded; Google fetches the public video itself. The schema has no free-text field and lyrics are never requested.

```sh
supabase secrets set GEMINI_API_KEY=... ALLOWED_ORIGINS=https://your-app.example
supabase functions deploy youtube-import
```

Optional secrets: `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_TIMEOUT_MS` (10000–140000, default 120000), `YOUTUBE_CALLS_PER_HOUR` (20) and `YOUTUBE_CALLS_PER_DAY` (60) per user. `SUPABASE_URL`, the public key and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase. The quota needs migration `202610020001_rate_limits.sql`; without it the function fails closed.

`supabase/config.toml` sets `verify_jwt = false` for the same reason as `vision-import`: the function verifies the bearer session against `/auth/v1/user` itself.

Request (`POST`, JSON, at most 16 KB):

```json
{ "url": "https://youtu.be/<id>", "segment": { "startSeconds": 0, "endSeconds": 180 }, "fps": 1, "pass": 1,
  "videoDurationSeconds": 245, "hints": { "title": "…", "artist": "…", "tuning": "Drop D", "capo": 2 } }
```

Limits: one video per request; only `youtube.com/watch`, `youtu.be` and `youtube.com/shorts` links; 5 s to 10 min per request; videos up to 60 min (Google currently bills the whole audio track on every clipped YouTube request); fps 0.25–8 and at most 2400 frames. A free YouTube oEmbed lookup rejects private, non-embeddable and removed videos before quota or Gemini are used.

Errors are JSON `{ error, code, retryable }`: `invalid-url`, `bad-request` (400), `sign-in` (401), `not-found` (404), `too-long` (413), `private-video`, `blocked` (422), `quota` and `provider-quota` (429, `Retry-After`), `provider-rejected`, `provider-unavailable`, `invalid-response`, `truncated` (502), `not-configured`, `quota-unavailable` (503), `timeout` (504). Gemini's own error text is never echoed.

Tests: `deno test --no-lock supabase/functions/youtube-import/` (`core_test.ts`, `handler_test.ts`, mocked fetch only).
