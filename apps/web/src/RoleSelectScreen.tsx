import { useI18n, type MessageKey } from "@vc/i18n";
import { Icon, Screen, type IconName } from "@vc/ui";
import type { ActiveRole } from "./role";

const BULLET_KEYS: Record<ActiveRole, MessageKey[]> = {
  customer: ["role.customer.b1", "role.customer.b2", "role.customer.b3", "role.customer.b4"],
  vendor: ["role.vendor.b1", "role.vendor.b2", "role.vendor.b3", "role.vendor.b4"],
};

/**
 * Shown once per device, right after language, before login (see ARCHITECTURE D4/D20). VendorConnect
 * is one app — this screen just decides which half of it to show first; either can switch to the
 * other later without logging out (Profile "Become a Vendor" / Shop "Switch to Customer").
 */
export function RoleSelectScreen({ onSelect }: { onSelect: (role: ActiveRole) => void }) {
  const { t } = useI18n();
  return (
    <Screen className="vc-center-screen">
      <h1 className="vc-h1">{t("role.title")}</h1>
      <p className="vc-muted" style={{ margin: 0 }}>{t("role.subtitle")}</p>
      <div className="vc-stack">
        <RoleCard kind="customer" icon="bag" title={t("role.customer.title")} tagline={t("app.tagline")} onSelect={onSelect} />
        <RoleCard kind="vendor" icon="store" title={t("role.vendor.title")} tagline={t("vendor.tagline")} onSelect={onSelect} />
      </div>
    </Screen>
  );
}

function RoleCard({
  kind,
  icon,
  title,
  tagline,
  onSelect,
}: {
  kind: ActiveRole;
  icon: IconName;
  title: string;
  tagline: string;
  onSelect: (role: ActiveRole) => void;
}) {
  const { t } = useI18n();
  return (
    <button type="button" className={`vc-rolecard vc-rolecard--${kind}`} data-testid={`role-${kind}`} onClick={() => onSelect(kind)}>
      <span className="vc-rolecard__head">
        <span className="vc-rolecard__icon" aria-hidden="true">
          <Icon name={icon} size={28} />
        </span>
        <span className="vc-rolecard__headtext">
          <span className="vc-rolecard__title">{title}</span>
          <span className="vc-rolecard__tagline">{tagline}</span>
        </span>
        <Icon name="chevron" size={22} className="vc-rolecard__chevron" />
      </span>
      <span className="vc-rolecard__bullets">
        {BULLET_KEYS[kind].map((k) => (
          <span className="vc-rolecard__bullet" key={k}>
            <Icon name="check" size={14} />
            {t(k)}
          </span>
        ))}
      </span>
    </button>
  );
}
