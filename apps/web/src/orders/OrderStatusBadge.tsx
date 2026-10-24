import type { OrderStatus } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { Icon } from "@vc/ui";
import { ORDER_STATUS_META, orderStatusLabel } from "./orderHelpers";

/** Same visual language as `@vc/ui`'s `StatusBadge` (same CSS classes), but for the broader set of
 * order statuses that component's `StatusKind` union doesn't cover. */
export function OrderStatusBadge({ status, size = "md" }: { status: OrderStatus; size?: "sm" | "md" | "lg" }) {
  const { t } = useI18n();
  const meta = ORDER_STATUS_META[status];
  return (
    <span className={`vc-badge vc-badge--${meta.tone} vc-badge--${size}`} data-status={status}>
      <Icon name={meta.icon} size={size === "lg" ? 20 : 16} />
      {orderStatusLabel(t, status)}
    </span>
  );
}
