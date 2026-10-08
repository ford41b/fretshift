# FretShift mobile Liquid Glass — React 19 deployment fix

This project is based on the newer `fretshift-mobile-floating-nav-2026-09-16 (2) (1).zip` with only the Liquid Glass components and mobile styling brought over from the older Liquid Glass build.

## Vercel `ERESOLVE` fix

The previous merge combined `react` and `react-dom` 18.3.1 with `liquid-glass-react` 1.1.1, whose npm peer requirement is React 19 or newer. Vercel's `npm install` correctly refused that combination.

This archive updates `react` and `react-dom` together to 19.1.1 and updates the corresponding TypeScript types to the React 19 series. The obsolete pnpm React 18 peer exception is removed. No `--force` or `--legacy-peer-deps` install flags are needed for this particular conflict.

The mobile Liquid Glass layer, newer five-tab floating bar with More, launch splash, icons/PWA assets, custom authentication, Vercel Analytics, UI scale setting, compact chord notation and all remaining application files are preserved.

## Deploy

Upload **this corrected ZIP**, not an older deployment, to the existing `fretshift-current1` Vercel project. A fresh install should use `npm install` and the build command `npm run build`. Do not click Redeploy on the failed build: that would rerun the original, incompatible source.

The archive was checked for integrity and source preservation. A live `npm install` / Vite build could not run in the archive-building environment because registry.npmjs.org could not be resolved; Vercel must complete those checks.


2026-09-19 follow-up polish:
- fixed MobileGlass positioning so the effect fills its container instead of offsetting down-right
- refined the mobile floating rail to read as glass rather than a flat grayscale bar
- resized and realigned the glass switch thumb/track
- tightened mobile empty-state CTA sizing
- normalized mobile library toolbar sizes and proportions

- moved mobile nav filtering into React so only the 4 primary tabs plus More render in the compact bar
- reduced nav rail distortion and increased opacity so the border stays more consistent over different song cards
- refined switch proportions and simplified thumb glass settings

- removed the distortion-heavy effect from the segment control and switch thumb, keeping those on a cleaner CSS glass fallback
- lowered nav-rail displacement and highlight intensity to eliminate the top-left frosted patch

- removed the live Liquid Glass effect from the bottom nav rail too, replacing it with a stronger CSS glass fallback to eliminate the remaining top strip / notch artifact

- added dark-mode-specific CSS glass fallbacks for the bottom rail and segmented controls so they stop appearing milky/washed out in dark theme

2026-09-20 mobile glass clarity pass:
- reduced opaque light/dark tint on floating navigation and segmented controls to reveal the page underneath
- lowered CSS fallback blur to 4–5px and saturation to 115% instead of the 14–18px frosted look
- kept glass borders, shadows, purple selection states, accessibility and existing navigation behavior
- no changes to the offline smart strumming engine or authentication
