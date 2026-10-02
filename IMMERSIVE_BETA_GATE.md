# Immersive Practice beta gate

This review build uses `FretShift-Review-Fixes-Immersive-Smart-Import.zip` as its base.

- `/immersive` and existing non-audio songs at `/immersive/:id` retain the `ImmersiveBeta` gate.
- Phase 2 audio transcriptions with `provenance.audioReview` mount the existing `Immersive` room at `/immersive/:id`, as required by the audio import journey. Chord-only targets are visual guidance, not scored note or rhythm targets.
- No microphone, audio clock, or scoring logic starts on the beta-gated routes. The audio-song route uses the existing room and its own controls.
- Sidebar and song-level Immersive entry points remain visible. The sidebar says BETA; the destination says “Immersive practice. Coming soon.”
- If the route identifies an existing song, “Keep practicing” goes to ordinary practice for that song and “Back to song” opens the song. Otherwise the buttons lead to Practice and Songbook.
- The original `Immersive.tsx`, recognition engine, and tests are retained for future restoration.
- Two existing redundant `mode === "visual"` expressions in the retained, now-unmounted component were corrected to avoid pre-existing strict TypeScript TS2367 build failures. No behavior was changed by those two corrections.
- Supabase `vision-import` was not modified. This gate requires no backend changes.

The gate check script now verifies this conditional route. The general release decision for Immersive remains separate from Audio Intelligence.

## Phase 3 update

Audio-review songs may now carry confirmed single-note events. The same audio-song route opens Immersive, with sounding-pitch scoring only for confirmed, nonoverlapping, playable notes. Chord-only audio songs remain visual. General/non-audio routing is unchanged. See `GUITAR_TAB_TRANSCRIPTION.md` for timing, stale-chart and playback safeguards; `GUITAR_TAB_TEST_RESULTS.md` records the current verification scope.
