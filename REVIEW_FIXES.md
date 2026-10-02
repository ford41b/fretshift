# FretShift review fixes — local review build

Based on `FretShift-Smart-Import-iPhone-Glass-Fix.zip`; existing app, audio engine, sync and Supabase function files remain included. No Supabase redeployment is required by these UI/parser changes (the previously deployed function is separate from Vercel ZIP uploads).

## What changed

- **Quiet visual:** removes microphone and performance grading presentations; pause offers Resume, Restart passage, Previous target (visual only), Change passage/speed, Finish. Finishing shows elapsed time and passage progress. Existing Progress view now shows visual progress instead of zero assessed targets. Restart or changing passage/speed discards the in-progress session and starts a new session on Start.
- **Supported scoring:** song passages with guided chord/muted or unsupported targets default to Quiet visual; score modes are disabled for those passages with a target-count explanation. Scored Learn remains available for supported single-note-only passages. No chord accuracy is claimed.
- **Setup:** shortened introduction, compact mode choice, sticky Start, microphone controls only for scored modes, timing adjustment and technical details collapsed under Advanced.
- **Import:** one Photo or PDF chooser (retains legacy PDF code for internal compatibility); sign-in needs disclosed before preparation; page navigation thumbnails and an exact JPEG preview approval step.
- **Crop:** independent top/right/bottom/left edge sliders, source crop rectangle, exact post-rotation/post-compression OCR image displayed before sending. Text-layer pages do not display irrelevant crop sliders.
- **Timing:** explicit text barlines become separate measures. Original parsed chord line is kept on the measure. Every imported attack beat remains marked **timing unconfirmed**, even if a visual placeholder is shown. Measure editor in import preview allows editing individual chord beat positions; editing resets confirmation. Rhythm practice refuses unconfirmed imported measures. Any text-only PDF lacking visible barline geometry must be reviewed manually; this is *not* reliable full score-layout transcription.
- **Unknown chords:** chord-like tokens that cannot be parsed are shown beside the source, with source line and an optional, never-applied automatically suggestion. Draft construction is stopped until the flagged items are corrected. This is a conservative heuristic; some chart typography can still need manual review.
- **Small glyphs:** render PDFs up to 2100px source edge when browser/page permits; optionally split dense pages into overlapping upper/lower tiles and preview each compressed upload. **Tile overlap is not automatically merged**: users must reconcile repeated chord/lyric text and remove the tile-boundary marker before building a draft. Compression can still lose fine details at the provider's 1MB/page limit.

## Validation

Run from project root:

```
node scripts/verify-review-fixes-offline.mjs
node scripts/verify-smart-import-offline.mjs
node scripts/verify-smart-ocr-offline.mjs
node scripts/verify-iphone-decode-offline.mjs
node scripts/verify-iphone-ui-syntax.mjs
```

These are targeted offline/deterministic checks and syntax/CSS parsing; they are **not** a complete React runtime/Vercel build, physical iPhone test, authenticated OCR call, or measured chart recognition benchmark. `verify-immersive-offline.mjs` depends on `@playwright/test`, which is not installed in this environment. The configured package registry was unavailable, so no full repository build was run.

## Manual acceptance checklist

1. Import a known-correct 2–7 page chart; inspect source crop rectangle and actual processed JPEG before choosing OCR; crop each edge independently and confirm high-detail mode preserves accidentals. Test Safari portrait and landscape.
2. Check one text-layer PDF, one scanned PDF, mixed PDF, permission denied, network failure, and partial-page retry. Check highlighted unknown chord suggestions **before** saving.
3. Check printed barlines become separate measures; change an attack beat and verify timing-confirmation resets. Check unconfirmed imports are not graded in Rhythm mode.
4. On a chord-only song, verify Quiet visual default, scorer disabled, no microphone on setup/pause, no matched/wrong legend, visual time/progress after finishing and in Progress.
5. On a supported single-note passage, verify Learn/Rhythm, microphone cleanup on pause, Restart/Change passage, and no double-credit across resumes or loops.
6. Install project dependencies and run full build, tests and browser validation before a production deployment. No production deployment is performed by packaging this ZIP.
