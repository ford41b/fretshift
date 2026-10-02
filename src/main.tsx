import "./ui/audio.css";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./ui/App";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./ui/tokens.css";
import "./ui/mobile-glass.css";
// The shell scrolls to the top on every route change. Browser reload
// restoration would instead jump to an old offset after async content loads
// (seen in WebKit), moving controls out from under the pointer.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <App />
    {import.meta.env.VITE_VERCEL_ANALYTICS ? <Analytics /> : null}
  </>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker
    .register("/sw.js")
    .catch((error) =>
      console.error(
        "Offline cache could not be installed. Reload online to retry.",
        error,
      ),
    );
