# Deploy FretShift to Vercel

This package includes the 2026-09-16 production build fix.

## What was fixed
The normal production build no longer includes the Playwright `e2e/` specs in TypeScript's app build. Those tests remain in the project and still run with `npm run test:e2e`, but they cannot block `npm run build` with Playwright `Page` type-version errors.

## Deploy
From this folder:

```bash
npm install
npm run build
npx vercel link
npx vercel --prod
```

When linking, choose the existing `fretshift-current1` Vercel project.

The `npm warn allow-scripts` line about `esbuild` is a warning; the prior deployment failure was caused by the red TypeScript errors from `e2e/*.spec.ts`.
