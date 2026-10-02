import { useEffect, useState } from "react";

import splashLogo from "../../assets/fretshift-wordmark-transparent.png";

type SplashScreenProps = {
  onComplete: () => void;
};

const EXIT_AT_MS = 1600;
const REMOVE_AT_MS = 1950;

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const exitTimer = window.setTimeout(() => setLeaving(true), EXIT_AT_MS);
    const removeTimer = window.setTimeout(onComplete, REMOVE_AT_MS);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(removeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`launch-splash${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-label="Opening FretShift"
    >
      <div className="splash-guitar" aria-hidden="true">
        <div className="splash-backdrop" />
        <div className="splash-ambient-glow" />
        <div className="splash-fretboard">
          <span className="splash-fretboard-highlight" />
          <span className="splash-fretboard-strings" />
        </div>
        <div className="splash-soundhole">
          <span className="splash-soundhole-fill" />
          <span className="splash-soundhole-rim" />
          <span className="splash-burst" />
          <div className="splash-logo-wrap">
            <img className="splash-logo" src={splashLogo} alt="FretShift" />
          </div>
        </div>
      </div>
    </div>
  );
}
