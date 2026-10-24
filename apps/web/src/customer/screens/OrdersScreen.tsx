import { useSession, type OrderDetail } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, EmptyState, ErrorState, Screen, Skeleton } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OrderStatusBadge } from "../../orders/OrderStatusBadge";
import { formatOrderTime } from "../../orders/orderHelpers";

export function OrdersScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null);
    api.orders.list({ role: "customer", page_size: 50 }).then((r) => setOrders(r.results)).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  return (
    <Screen>
      <AppBar title={t("orders.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
      ) : orders === null ? (
        <Skeleton lines={4} />
      ) : orders.length === 0 ? (
        <EmptyState icon="orders" title={t("orders.empty_title")} message={t("orders.empty_body")} />
      ) : (
        <ul className="c-order-list">
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" className="c-order-card" onClick={() => nav(`/orders/${o.id}`)}>
                <div className="c-order-card__top">
                  <span className="c-order-card__number">{o.vendor.shop_name}</span>
                  <OrderStatusBadge status={o.status} size="sm" />
                </div>
                <span className="vc-muted">{t("order.number_label", { number: o.number })} · {formatOrderTime(o.created_at, lang)}</span>
                <span>₹{o.total}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
