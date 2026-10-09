# Smart photo & PDF import — local review build

This release is based on FretShift-Premium-Practice-Buttons.zip. The existing
practice and Immersive Practice modules are unchanged. No new dependencies or
song schema changes are required.

## What changed

- Photo import now accepts scanned, mixed, or text-layer PDFs; a PDF is no
  longer rejected just because its pages have a text layer.
- The existing Text-layer PDF import remains local and preserves its proposed
  song boundaries. When it cannot find chords or a page has no text, the user
  can select **Analyze PDF visually / edit pages**, using the same file without
  switching to another import source.
- PDF pages with recognized chord symbols default to local text. Pages with
  no chord evidence default to image OCR, which can be overridden per page or
  by the **Force visual analysis of every PDF page** control.
- OCR is sent as one page per request. Each page has its own success/error
  state, one retry per failed request, and an explicit Retry failed pages
  action. Completed pages stay in the UI until the selection changes or the
  page is refreshed. The user can cancel in-flight recognition.
- Original page previews and editable extracted text appear in page order.
  Users can correct text before building the draft, and adjust song boundaries
  before rebuilding. Failed/unread pages block assembling a draft until
  retried or manually filled; they are never silently omitted.
- Parsing recognizes common chord-only lines, punctuation-separated chords,
  and inline bracketed chords. Continuation lyrics on chordless pages are
  retained with the preceding musical passage for explicit review.
- The Supabase function returns more informative provider HTTP/rate-limit
  failures; its fallback CORS list includes `https://fretshift-beta.vercel.app`.

## Deployment

The ZIP includes both frontend code and `supabase/functions/vision-import/`.
Updating Vercel alone does **not** deploy the revised Supabase Edge Function;
apply that function separately if you want its improved error/status behavior.
If Supabase has `ALLOWED_ORIGINS` configured, include all your actual Vercel
production/beta origins there; the hardcoded fallback only applies if the
secret is absent. Keep `OCR_SPACE_API_KEY` in Supabase secrets, never the client.

## Important limitations and evidence

- Local PDF extraction remains device-only. Visual OCR still sends prepared
  JPEGs transiently to the existing OCR.space provider via Supabase.
- OCR.space's service tier, provider quotas, latency, and accuracy were not
  independently verified. A provider rate limit may still need a later retry.
- Auto-selection is a heuristic. Verify charts, lyrics, key, capo and page
  boundaries before saving. Chord diagrams and unusual fonts may still need
  user corrections or provider improvements.
- Page progress is preserved **in the current import session**, not after
  browser reload/navigation. Visual OCR does not run offline.
- The existing format's approximate chord beat placement is not evidence of
  an explicitly notated rhythm; inspect musical timing before scored practice.
- Full project TypeScript/Vite build and browser tests were not possible here:
  node_modules are absent and the npm registry was unreachable. The modified
  TS/TSX files passed syntax transpilation. Two dependency-free module
  harnesses passed (parser behavior, one-page OCR retry and cancel). The
  Vitest test additions must still be run with installed dependencies.

## Acceptance checklist

1. On beta, import the original seven-page PDF through Photos & scans and
   verify all seven ordered previews. Force visual analysis if text misses chords.
2. Repeat through Text-layer PDF; confirm that failure offers visual fallback
   with the **same selected PDF** rather than trapping you between importers.
3. Import several photos; interrupt/force an OCR failure on page 3, retry it,
   and confirm pages 1–2 are not sent again.
4. Correct an OCR chord in the editable page text, rebuild, and verify the
   saved song's lyrics/chords. Check multiple-song page boundaries.
5. Check iPhone Safari/PWA, beta-origin CORS, sign-in, per-page provider
   rate limits, offline local PDF handling, existing song editing and practice.
