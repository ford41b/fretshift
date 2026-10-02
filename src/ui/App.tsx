import { startCloud } from "../cloud/store";
import { lazy, Suspense, useCallback, useEffect, useState, Component, type ComponentType, type ReactNode, type ErrorInfo } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useLocation,
  useParams,
} from "react-router-dom";
import {
  Library,
  ListMusic,
  Play,
  AudioLines,
  FolderInput,
  ChartNoAxesCombined,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Music2,
  MoreHorizontal,
  Guitar,
} from "lucide-react";
import { useSongStore } from "../store/songStore";
import { useSettingsStore } from "../store/settingsStore";
import { canOpenImmersive, IMMERSIVE_BETA } from "../audio/immersive/release";
import { ToastProvider, ErrorNotice } from "./components/Common";
import { Songbook } from "./screens/Songbook";
import { SplashScreen } from "./components/SplashScreen";
// The songbook (landing screen) stays in the entry chunk; every other screen,
// and the audio stack behind them (Tone.js, workers), loads on first visit.
// The service worker precaches every chunk, so this stays offline-capable.
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}
const SongDetail = lazyNamed(() => import("./screens/SongDetail"), "SongDetail");
const Setlists = lazyNamed(() => import("./screens/Setlists"), "Setlists");
const Settings = lazyNamed(() => import("./screens/Settings"), "Settings");
const Import = lazyNamed(() => import("./screens/Import"), "Import");
const SharedSong = lazyNamed(() => import("./screens/SharedSong"), "SharedSong");
const ImmersiveBeta = lazyNamed(() => import("./screens/ImmersiveBeta"), "ImmersiveBeta");
const Immersive = lazyNamed(() => import("./screens/Immersive"), "Immersive");
const AudioReviewScreen = lazyNamed(() => import("./screens/AudioReviewScreen"), "AudioReviewScreen");
const Practice = lazyNamed(() => import("./screens/Practice"), "Practice");
const Drills = lazyNamed(() => import("./screens/Drills"), "Drills");
const Progress = lazyNamed(() => import("./screens/Progress"), "Progress");
const Stage = lazyNamed(() => import("./screens/Stage"), "Stage");
const Tuner = lazyNamed(() => import("./components/AudioTools"), "Tuner");
const Metronome = lazyNamed(() => import("./components/AudioTools"), "Metronome");
import { MobileGlass } from "./components/MobileGlass";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(error);
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>That chart hit a snag</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>
          Reload your saved library
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
/** Criteria-based gate (src/audio/immersive/release.ts); ImmersiveBeta is only the fallback when the room is not released. */
function ImmersiveRoute() {
  const { id } = useParams();
  const isAudioSong = useSongStore((state) => state.songs.some((song) =>
    song.id === id && !song.deletedAt && !!song.provenance?.audioReview));
  return canOpenImmersive(isAudioSong) ? <Immersive /> : <ImmersiveBeta />;
}
const SPLASH_SEEN = "fretshift:splash-seen";
function splashSeen() {
  try {
    return sessionStorage.getItem(SPLASH_SEEN) === "1";
  } catch {
    return false;
  }
}
function Shell() {
  // The splash is a launch moment, not a gate: once per browser session, so
  // reloads, deep links and shared-song links open straight to content.
  const [showSplash, setShowSplash] = useState(() => !splashSeen());
  const [moreOpen, setMoreOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 650px)").matches
      : false,
  );
  const completeSplash = useCallback(() => {
    try {
      sessionStorage.setItem(SPLASH_SEEN, "1");
    } catch {
      /* storage unavailable: the splash simply shows again next load */
    }
    setShowSplash(false);
  }, []);
  const settings = useSettingsStore((s) => s.settings),
    ready = useSongStore((s) => s.ready),
    error = useSongStore((s) => s.error);
  const location = useLocation();
  useEffect(() => {
    void useSettingsStore
      .getState()
      .init()
      .then(() => useSongStore.getState().initialize());
  }, []);
  useEffect(() => {
    if (ready) return startCloud();
  }, [ready]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(settings.interfaceScale),
    );
  }, [settings.interfaceScale]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  useEffect(() => {
    window.scrollTo(0, 0);
    setMoreOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 650px)");
    const sync = () => setCompactNav(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useSongStore.temporal.getState().redo();
        else useSongStore.temporal.getState().undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (
          document.querySelector(
            '[aria-label="Search songbook"]',
          ) as HTMLInputElement
        )?.focus();
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const nav = [
    { to: "/", label: "Songbook", mobileLabel: "Songs", icon: Library, mobilePrimary: true },
    { to: "/setlists", label: "Setlists", mobileLabel: "Setlists", icon: ListMusic, mobilePrimary: true },
    { to: "/practice", label: "Practice", mobileLabel: "Practice", icon: Play, mobilePrimary: true },
    { to: "/immersive", label: "Immersive practice", icon: Guitar, mobilePrimary: false },
    { to: "/tools", label: "Tuner & metronome", mobileLabel: "Tuner", icon: AudioLines, mobilePrimary: true },
    { to: "/import", label: "Import", icon: FolderInput, mobilePrimary: false },
    { to: "/progress", label: "Progress", icon: ChartNoAxesCombined, mobilePrimary: false },
    { to: "/settings", label: "Settings", icon: SettingsIcon, mobilePrimary: false },
  ];
  const moreNav = nav.filter((item) => !item.mobilePrimary);
  const mainNav = compactNav ? nav.filter((item) => item.mobilePrimary) : nav;
  const moreActive = moreNav.some((item) =>
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  );
  return (
    <>
      {showSplash ? <SplashScreen onComplete={completeSplash} /> : null}
      <a className="skip-link" href="#main">
        Skip to music
      </a>
      <aside className="rail">
        <MobileGlass
          className="nav-rail-glass"
          radius={30}
          effect={false}
        />
        <NavLink to="/" aria-label="FretShift home" className="brand-symbol">
          <Music2 size={27} />
        </NavLink>
        <nav aria-label="Main navigation">
          {mainNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `nav-item ${n.mobilePrimary ? "mobile-primary" : "mobile-more-only"} ${isActive ? "active" : ""}`
              }
              title={n.to === "/immersive" && IMMERSIVE_BETA ? "Immersive practice · Beta" : n.label}
            >
              <n.icon size={22} />
              <span data-mobile-label={n.mobileLabel ?? n.label}>{n.label}</span>
              {n.to === "/immersive" && IMMERSIVE_BETA ? <span className="imm-beta-nav-badge">BETA</span> : null}
            </NavLink>
          ))}
          {compactNav ? (
            <button
              type="button"
              className={`nav-item mobile-more-button ${moreOpen || moreActive ? "active" : ""}`}
              aria-label="More navigation"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreHorizontal size={22} />
              <span data-mobile-label="More">More</span>
            </button>
          ) : null}
        </nav>
        {compactNav && moreOpen ? (
          <>
            <button
              type="button"
              className="mobile-more-backdrop"
              aria-label="Close navigation menu"
              onClick={() => setMoreOpen(false)}
            />
            <div className="mobile-more-menu" role="menu" aria-label="More navigation">
              {moreNav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `mobile-more-menu-item ${isActive ? "active" : ""}`
                  }
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                >
                  <n.icon size={21} />
                  <span data-mobile-label={n.mobileLabel ?? n.label}>{n.label}</span>
                  {n.to === "/immersive" && IMMERSIVE_BETA ? <span className="imm-beta-nav-badge">BETA</span> : null}
                </NavLink>
              ))}
            </div>
          </>
        ) : null}
        <div className="rail-bottom">
          <button
            className="nav-item"
            title="Toggle theme"
            aria-label="Toggle theme"
            onClick={() =>
              void useSettingsStore.getState().update({
                theme:
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark",
              })
            }
          >
            {settings.theme === "dark" ? <Sun size={21} /> : <Moon size={21} />}
            <span>Theme</span>
          </button>
          <NavLink to="/settings" className="avatar" aria-label="Your account">
            F
          </NavLink>
        </div>
      </aside>
      <div className="app-frame">
        <div className="topbar">
          <NavLink to="/" className="wordmark">
            fret<span>shift</span>
          </NavLink>
          <div className="topbar-note">
            <span className="local-dot" />
            Your songs. Your way.
          </div>
        </div>
        <main id="main">
          <ErrorNotice error={error} />
          {!ready ? (
            <div
              className="skeleton"
              role="status"
              aria-label="Loading your songbook"
            >
              <div />
              <div />
              <div />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="skeleton" role="status" aria-label="Loading">
                  <div />
                  <div />
                  <div />
                </div>
              }
            >
            <Routes>
              <Route path="/" element={<Songbook />} />
              <Route path="/song/:id" element={<SongDetail />} />
              <Route path="/audio-review/:id" element={<AudioReviewScreen />} />
              <Route path="/setlists" element={<Setlists />} />
              <Route path="/share/:token" element={<SharedSong />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/import" element={<Import />} />
              <Route path="/immersive" element={<ImmersiveRoute />} />
              <Route path="/immersive/:id" element={<ImmersiveRoute />} />
              <Route path="/practice" element={<Practice />} />
              <Route path="/practice/:id" element={<Practice />} />
              <Route
                path="/tools"
                element={
                  <>
                    <header className="page-title">
                      <div>
                        <span className="eyebrow">GET INTO THE GROOVE</span>
                        <h1>Tune in. Settle in.</h1>
                        <p>Your daily essentials, always within reach.</p>
                      </div>
                    </header>
                    <div className="audio-tools-grid">
                      <Tuner />
                      <Metronome />
                    </div>
                  </>
                }
              />
              <Route path="/drills" element={<Drills />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/stage/:id" element={<Stage />} />
              <Route path="*" element={<Songbook />} />
            </Routes>
            </Suspense>
          )}
        </main>
      </div>
    </>
  );
}
export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
