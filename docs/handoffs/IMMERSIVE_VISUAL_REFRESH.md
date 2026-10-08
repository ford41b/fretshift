# Immersive Practice — visual refresh

This archive is based on the user-supplied **FretShift-Immersive-Practice.zip** (Astra implementation). It does not substitute the earlier ImmersivePractice recognition/scoring system for Astra's.

## Visual changes

- The Immersive Practice entry in the sidebar / mobile More menu uses the same Lucide `Guitar` icon as the earlier FretShift implementation, replacing `Sparkles`.
- The song picker has a matching guitar badge, atmospheric violet background, and responsive premium song cards.
- The per-song immersive screen uses a focused, full-screen dark-violet shell (including light-mode users), safe-area padding, brighter guitar branding, and a setup hero.
- Setup places two clear panels (flow and microphone) before the live lane; learn/rhythm/quiet-visual choices are descriptive cards; speed is a group of selectable pill buttons instead of a select element.
- Active practice uses the six-string lane with mint play line, lit fret badges, large target cue, progress indicator, compact transport controls, and text plus color feedback legend.
- Results follow the same visual language. Portrait, short landscape, left-handed mirroring, reduced motion and existing fullscreen fallbacks remain in place.

## Unchanged

Astra's `src/audio/immersive` recognition, score compilation, event matching and clock; song schemas and persistence; song editing, imports, strumming, offline cache and sync. This patch changes only `src/ui/App.tsx`, `src/ui/screens/Immersive.tsx` and `src/ui/immersive.css`, plus this note.

## Validation

The two changed TSX files passed a TypeScript transpile/syntax diagnostic check, the stylesheet parsed with PostCSS, and the final ZIP integrity check passed. The full app build / browser screenshot tests could **not** be run in this environment because the project's dependencies are not installed and npm registry access is unavailable. Re-run `pnpm install --frozen-lockfile`, `pnpm build`, and the included immersive Playwright suite in a fully provisioned environment. Test portrait/landscape, chart selection, three modes, a microphone denial, setup/resume/results and each guitar navigation link on real devices before production rollout.

No deployment or publication was performed.
