import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readdirSync, realpathSync, statSync } from "node:fs";

const workspaceRoot = new URL(".", import.meta.url).pathname;
const dependenciesRoot = realpathSync(
  new URL("./node_modules", import.meta.url),
);
export default defineConfig({
  cacheDir:
    process.env.VITE_SUPABASE_URL === "unconfigured"
      ? "node_modules/.vite-unconfigured"
      : "node_modules/.vite",
  optimizeDeps: {
    include: [
      "@soundtouchjs/core",
      "tone",
      "pdfjs-dist/legacy/build/pdf.mjs",
      "pdf-lib",
      "@coderline/alphatab",
      "@tonejs/midi",
      "heic2any",
      "fflate",
      "midi-file",
    ],
  },
  server: { fs: { allow: [workspaceRoot, dependenciesRoot] } },
  // Vercel sets VERCEL=1 for its builds. Elsewhere (Netlify, local preview) the
  // analytics script URL falls through to the SPA fallback and logs errors.
  define: {
    "import.meta.env.VITE_VERCEL_ANALYTICS": JSON.stringify(
      process.env.VERCEL === "1" ? "on" : "",
    ),
  },
  plugins: [
    react(),
    {
      name: "offline-shell",
      generateBundle(_options, bundle) {
        // Every public/ file (icons, manifest) plus bundle output. Legacy .woff
        // fonts are skipped: every service-worker browser takes the .woff2 source.
        const publicDir = new URL("./public/", import.meta.url);
        const publicFiles = readdirSync(publicDir, { recursive: true })
          .map(String)
          .filter((file) => statSync(new URL(file, publicDir)).isFile())
          .map((file) => "/" + file.replaceAll("\\", "/"));
        const assets = [
          "/",
          "/index.html",
          ...publicFiles,
          ...Object.keys(bundle)
            .filter((n) => !n.endsWith(".woff"))
            .map((n) => "/" + n),
        ];
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const CACHE='fretshift-${Date.now()}';const ASSETS=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fretshift-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));else e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));});`,
        });
      },
    },
  ],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "supabase/**/*.test.ts"],
    setupFiles: ["./src/testSetup.ts"],
  },
  build: { chunkSizeWarningLimit: 1600 },
});
