import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "md" | "lg";
  icon?: IconName;
  block?: boolean;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, block, loading, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx("vc-btn", `vc-btn--${variant}`, `vc-btn--${size}`, block && "vc-btn--block", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={20} /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
});

/* ---------- Card ---------- */
export function Card({ children, className, as: As = "div", ...rest }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li" } & Record<string, unknown>) {
  return (
    <As className={cx("vc-card", className)} {...rest}>
      {children}
    </As>
  );
}

/* ---------- Status badges: icon + word + colour, never colour alone ---------- */
export type StatusKind =
  | "open" | "closed" | "in_stock" | "low_stock" | "out_of_stock"
  | "stale" | "delivery" | "pickup_only" | "pickup" | "no_delivery" | "verified" | "unverified" | "info";

const STATUS_STYLE: Record<StatusKind, { tone: string; icon: IconName }> = {
  open: { tone: "open", icon: "check" },
  closed: { tone: "closed", icon: "x" },
  in_stock: { tone: "open", icon: "check" },
  low_stock: { tone: "low", icon: "alert" },
  out_of_stock: { tone: "closed", icon: "x" },
  stale: { tone: "stale", icon: "clock" },
  delivery: { tone: "info", icon: "truck" },
  no_delivery: { tone: "stale", icon: "truck" },
  pickup: { tone: "info", icon: "bag" },
  pickup_only: { tone: "stale", icon: "bag" },
  verified: { tone: "open", icon: "shield" },
  unverified: { tone: "stale", icon: "shield" },
  // Generic neutral badge — the vendor-post-kind label (Phase 9: "New Stock"/"Offer"/"Update"/...),
  // where the icon+colour pair is intentionally the same across kinds and only the text differs.
  info: { tone: "info", icon: "globe" },
};

export function StatusBadge({ kind, label, size = "md" }: { kind: StatusKind; label: string; size?: "sm" | "md" | "lg" }) {
  const s = STATUS_STYLE[kind];
  return (
    <span className={cx("vc-badge", `vc-badge--${s.tone}`, `vc-badge--${size}`)} data-status={kind}>
      <Icon name={s.icon} size={size === "lg" ? 20 : 16} />
      {label}
    </span>
  );
}

/* ---------- Layout: Screen, AppBar, BottomNav ---------- */
export function Screen({ children, withNav, className }: { children: ReactNode; withNav?: boolean; className?: string }) {
  return <main className={cx("vc-screen", withNav && "vc-screen--nav", className)}>{children}</main>;
}

export function AppBar({ title, onBack, backLabel = "Back", right }: { title: ReactNode; onBack?: () => void; backLabel?: string; right?: ReactNode }) {
  return (
    <header className="vc-appbar">
      {onBack ? (
        <button className="vc-iconbtn" onClick={onBack} aria-label={backLabel}>
          <Icon name="back" />
        </button>
      ) : (
        <span className="vc-appbar__spacer" />
      )}
      <h1 className="vc-appbar__title">{title}</h1>
      <div className="vc-appbar__right">{right}</div>
    </header>
  );
}

export type NavItem = { key: string; label: string; icon: IconName; href: string; badge?: number };

export function BottomNav({ items, active, onNavigate }: { items: NavItem[]; active: string; onNavigate: (href: string) => void }) {
  return (
    <nav className="vc-bottomnav" aria-label="Main">
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
          className={cx("vc-bottomnav__item", active === it.key && "is-active")}
          aria-current={active === it.key ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            onNavigate(it.href);
          }}
        >
          <span className="vc-bottomnav__icon">
            <Icon name={it.icon} size={26} />
            {it.badge ? <span className="vc-dot" aria-label={`${it.badge}`}>{it.badge}</span> : null}
          </span>
          <span className="vc-bottomnav__label">{it.label}</span>
        </a>
      ))}
    </nav>
  );
}

/* ---------- Forms ---------- */
type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; prefix?: string };

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField({ label, hint, error, prefix, id, className, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className={cx("vc-field", error && "has-error", className)}>
      <label htmlFor={fid} className="vc-field__label">{label}</label>
      <div className="vc-field__control">
        {prefix ? <span className="vc-field__prefix">{prefix}</span> : null}
        <input ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined} {...rest} />
      </div>
      {hint && !error ? <p id={hintId} className="vc-field__hint">{hint}</p> : null}
      {error ? <p id={errId} className="vc-field__error" role="alert"><Icon name="alert" size={16} /> {error}</p> : null}
    </div>
  );
});

/** Six boxes backed by one input: works with SMS autofill (autocomplete="one-time-code") and paste. */
export function OtpInput({ value, onChange, length = 6, label, error, autoFocus }: { value: string; onChange: (v: string) => void; length?: number; label: string; error?: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const id = useId();
  return (
    <div className={cx("vc-otp", error && "has-error")}>
      <label htmlFor={id} className="vc-field__label">{label}</label>
      <div className="vc-otp__boxes">
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={cx("vc-otp__box", i === value.length && "is-cursor")} aria-hidden="true">
            {value[i] ?? ""}
          </span>
        ))}
        <input
          ref={ref}
          id={id}
          className="vc-otp__input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          aria-invalid={!!error || undefined}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        />
      </div>
      {error ? <p className="vc-field__error" role="alert"><Icon name="alert" size={16} /> {error}</p> : null}
    </div>
  );
}

/* ---------- Big shop toggle ---------- */
export function ShopStatusToggle({ isOpen, onToggle, busy, labels }: { isOpen: boolean; onToggle: () => void; busy?: boolean; labels: { title: string; open: string; closed: string; openAction: string; closeAction: string } }) {
  return (
    <section className={cx("vc-shopstatus", isOpen ? "is-open" : "is-closed")} aria-live="polite">
      <p className="vc-shopstatus__title">{labels.title}</p>
      <p className="vc-shopstatus__state" data-testid="shop-state">
        <span className="vc-shopstatus__dot" aria-hidden="true" />
        {isOpen ? labels.open : labels.closed}
      </p>
      <Button variant={isOpen ? "danger" : "primary"} size="lg" block icon="power" onClick={onToggle} loading={busy}>
        {isOpen ? labels.closeAction : labels.openAction}
      </Button>
    </section>
  );
}

/* ---------- Choice chips (categories, language) ---------- */
export function Chip({ selected, onClick, icon, children }: { selected?: boolean; onClick?: () => void; icon?: IconName; children: ReactNode }) {
  return (
    <button type="button" className={cx("vc-chip", selected && "is-selected")} aria-pressed={selected} onClick={onClick}>
      {icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

/* ---------- Settings-style list row (shop settings, account menus) ---------- */
export function ListRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
  trailing,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button type="button" className={cx("vc-listrow", disabled && "is-disabled")} onClick={onClick} disabled={disabled}>
      <span className="vc-listrow__icon"><Icon name={icon} size={22} /></span>
      <span className="vc-listrow__text">
        <span className="vc-listrow__label">{label}</span>
        {hint ? <span className="vc-listrow__hint">{hint}</span> : null}
      </span>
      {trailing ?? <Icon name="chevron" size={20} className="vc-listrow__chevron" />}
    </button>
  );
}

export function Tile({ icon, label, onClick, tone = "green" }: { icon: IconName; label: string; onClick?: () => void; tone?: "green" | "orange" }) {
  return (
    <button type="button" className={cx("vc-tile", `vc-tile--${tone}`)} onClick={onClick}>
      <span className="vc-tile__icon"><Icon name={icon} size={30} /></span>
      <span className="vc-tile__label">{label}</span>
    </button>
  );
}

/* ---------- Feedback states ---------- */
export function Spinner({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <span className="vc-spinner" role={label ? "status" : undefined} aria-label={label} style={{ width: size, height: size }} />
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="vc-state" role="status" aria-live="polite">
      <Spinner size={40} />
      <p>{label}</p>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="vc-skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => <span key={i} style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}

export function EmptyState({ icon = "box", title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="vc-state">
      <span className="vc-state__icon"><Icon name={icon} size={40} /></span>
      {/* h2, not p — the AppBar above already owns the page's h1, and a real heading (not just
       * heading-styled text) lets screen-reader users jump straight to "no results" state via
       * heading navigation instead of reading the whole screen. */}
      <h2 className="vc-state__title">{title}</h2>
      {message ? <p className="vc-state__msg">{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, message, onRetry, retryLabel = "Try again", icon = "alert" }: { title: string; message?: string; onRetry?: () => void; retryLabel?: string; icon?: IconName }) {
  return (
    <div className="vc-state vc-state--error" role="alert">
      <span className="vc-state__icon"><Icon name={icon} size={40} /></span>
      <h2 className="vc-state__title">{title}</h2>
      {message ? <p className="vc-state__msg">{message}</p> : null}
      {onRetry ? <Button variant="secondary" icon="refresh" onClick={onRetry}>{retryLabel}</Button> : null}
    </div>
  );
}

export function Banner({ tone = "info", icon, children }: { tone?: "info" | "warn" | "error" | "success"; icon?: IconName; children: ReactNode }) {
  return (
    <div className={cx("vc-banner", `vc-banner--${tone}`)} role={tone === "error" ? "alert" : "status"}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <div>{children}</div>
    </div>
  );
}

/* ---------- Modal (native <dialog>: focus trap + Esc for free) ---------- */
export function Modal({ open, onClose, title, children, closeLabel = "Close" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className="vc-modal" onClose={onClose} aria-labelledby="vc-modal-title">
      <div className="vc-modal__head">
        <h2 id="vc-modal-title">{title}</h2>
        <button className="vc-iconbtn" onClick={onClose} aria-label={closeLabel}><Icon name="x" /></button>
      </div>
      <div className="vc-modal__body">{children}</div>
    </dialog>
  );
}

export function OfflineBanner({ label }: { label: string }) {
  return (
    <Banner tone="warn" icon="offline">
      {label}
    </Banner>
  );
}
