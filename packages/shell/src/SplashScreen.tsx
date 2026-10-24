import { Icon } from "@vc/ui";
import { useEffect } from "react";

const AUTO_ADVANCE_MS = 1300;

/**
 * Brand-forward launch screen shown once per browser session (the host app decides that with
 * sessionStorage — see App.tsx). Auto-advances; tapping anywhere skips ahead sooner.
 */
export function SplashScreen({ brand, tagline, onDone }: { brand: string; tagline: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, AUTO_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div className="vc-splash">
      {/* A real <button>, not a click handler on a non-interactive landmark, so this stays
          keyboard- and screen-reader-friendly without extra role/keydown plumbing. */}
      <button type="button" className="vc-splash__tap" onClick={onDone} aria-label={brand}>
        <span className="vc-splash__orb vc-splash__orb--a" aria-hidden="true" />
        <span className="vc-splash__orb vc-splash__orb--b" aria-hidden="true" />
        <span className="vc-splash__content">
          <span className="vc-splash__mark" aria-hidden="true">
            <Icon name="store" size={52} />
          </span>
          <span className="vc-splash__brand">{brand}</span>
          <span className="vc-splash__tagline">{tagline}</span>
        </span>
      </button>
    </div>
  );
}
