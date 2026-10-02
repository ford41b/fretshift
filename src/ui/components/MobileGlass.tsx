import {
  lazy,
  Suspense,
  useSyncExternalStore,
  type CSSProperties,
  type InputHTMLAttributes,
} from "react";

const LiquidGlass = lazy(() => import("liquid-glass-react"));
const mobileQuery =
  typeof window !== "undefined"
    ? window.matchMedia("(max-width: 650px)")
    : null;
const subscribe = (onChange: () => void) => {
  if (!mobileQuery) return () => undefined;
  mobileQuery.addEventListener("change", onChange);
  return () => mobileQuery.removeEventListener("change", onChange);
};
const getSnapshot = () => mobileQuery?.matches ?? false;
const getServerSnapshot = () => false;
const stationary = { x: 0, y: 0 };

// A decorative layer: the existing links, buttons and inputs own interaction.
// Keep the library off the desktop path and avoid mouse tracking on touch UI.
export function MobileGlass({
  radius = 30,
  className = "",
  style,
  displacementScale = 2,
  blurAmount = 0.14,
  saturation = 138,
  aberrationIntensity = 0.04,
  mode = "standard",
  effect = true,
}: {
  radius?: number;
  className?: string;
  style?: CSSProperties;
  displacementScale?: number;
  blurAmount?: number;
  saturation?: number;
  aberrationIntensity?: number;
  mode?: "standard" | "polar";
  effect?: boolean;
}) {
  const isMobile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!isMobile) return null;
  return (
    <span className={`mobile-glass ${className}`.trim()} aria-hidden="true" style={style}>
      {effect ? (
        <Suspense fallback={null}>
          <LiquidGlass
            className="mobile-glass-effect"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
            cornerRadius={radius}
            padding="0"
            displacementScale={displacementScale}
            blurAmount={blurAmount}
            saturation={saturation}
            aberrationIntensity={aberrationIntensity}
            elasticity={0}
            globalMousePos={stationary}
            mouseOffset={stationary}
            mode={mode}
          >
            {null}
          </LiquidGlass>
        </Suspense>
      ) : null}
    </span>
  );
}

export function GlassSwitch(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  return (
    <span className="glass-switch">
      <input {...props} type="checkbox" />
      <span className="glass-switch-track" aria-hidden="true" />
      <span className="glass-switch-thumb" aria-hidden="true">
        <MobileGlass radius={13} effect={false} className="switch-thumb-glass" />
      </span>
    </span>
  );
}
