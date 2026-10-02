import "fake-indexeddb/auto";

// Node >= 25 defines its own experimental global `localStorage` /
// `sessionStorage`. Without --localstorage-file they are unusable (undefined
// with an ExperimentalWarning), and because the globals already exist Vitest's
// jsdom environment does not replace them with jsdom's working Storage. Point
// both globals back at jsdom's. A no-op on Node 20/22, where jsdom's are
// already installed. Verified on Node 22.22, 25.9 and 26.10.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom)
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const storage = dom.window[name];
    if (globalThis[name] !== storage)
      Object.defineProperty(globalThis, name, {
        configurable: true,
        enumerable: true,
        get: () => storage,
      });
  }
