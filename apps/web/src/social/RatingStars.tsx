import { Icon } from "@vc/ui";
import { useId } from "react";

/** Read-only display: 5 stars, partially filled to `value` (e.g. 4.5 → the 5th star is 50% filled).
 * Used for a vendor's aggregate rating and for one review's own rating. */
export function RatingStars({ value, size = 20, label }: { value: number; size?: number; label: string }) {
  const pct = Math.max(0, Math.min(5, value)) / 5;
  return (
    <span className="soc-stars" role="img" aria-label={label} style={{ width: size * 5, height: size }}>
      <span className="soc-stars__track" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => <Icon key={i} name="star" size={size} />)}
      </span>
      <span className="soc-stars__fill" aria-hidden="true" style={{ width: `${pct * 100}%` }}>
        {Array.from({ length: 5 }).map((_, i) => <Icon key={i} name="star" size={size} />)}
      </span>
    </span>
  );
}

/** Interactive 1–5 star picker for writing a review (master prompt §19/§41). Built from real radio
 * inputs — not click handlers on `<span>`s — so arrow keys, Tab, and screen readers all work for
 * free, and the group has one accessible name via `aria-label` on the `radiogroup`. */
export function RatingInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const name = useId();
  return (
    <div className="soc-ratepick" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => {
        const id = `${name}-${n}`;
        return (
          <span key={n} className="soc-ratepick__item">
            <input
              type="radio"
              id={id}
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="soc-ratepick__input"
            />
            <label htmlFor={id} className={value >= n ? "is-filled" : ""}>
              <Icon name="star" size={32} />
              <span className="vc-sr-only">{n}</span>
            </label>
          </span>
        );
      })}
    </div>
  );
}
