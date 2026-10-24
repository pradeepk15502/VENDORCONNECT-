import type { VendorListItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { Icon, StatusBadge } from "@vc/ui";
import { formatDistance } from "./format";

/** A nearby-vendor card — shared by Home's "Shops near you" and the Vendors tab (ARCHITECTURE D22). */
export function VendorCard({ item, onOpen }: { item: VendorListItem; onOpen: () => void }) {
  const { t } = useI18n();
  const loc = item.location;
  return (
    <button type="button" className="c-vcard" onClick={onOpen}>
      <span className="c-vcard__top">
        <span className="c-vcard__name">{item.shop_name}</span>
        <span className="c-vcard__dist">
          <Icon name="pin" size={16} />
          {formatDistance(t, item.distance_km)}
        </span>
      </span>
      {loc ? <span className="c-vcard__addr">{[loc.locality, loc.city].filter(Boolean).join(", ")}</span> : null}
      <span className="c-vcard__badges">
        <StatusBadge kind={item.is_open ? "open" : "closed"} size="sm" label={item.is_open ? t("status.open") : t("status.closed")} />
        {item.verified ? <StatusBadge kind="verified" size="sm" label={t("v.verified")} /> : null}
        {item.delivery.delivery_enabled ? <StatusBadge kind="delivery" size="sm" label={t("v.delivery_on")} /> : <StatusBadge kind="pickup_only" size="sm" label={t("v.pickup_only")} />}
      </span>
    </button>
  );
}
