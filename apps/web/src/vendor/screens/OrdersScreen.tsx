import { useSession, type OrderDetail } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, EmptyState, ErrorState, Screen, Skeleton } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OrderStatusBadge } from "../../orders/OrderStatusBadge";
import { formatOrderTime, isTerminalStatus } from "../../orders/orderHelpers";

type Tab = "active" | "history";

export function OrdersScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [orders, setOrders] = useState<OrderDetail[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("active");

  const load = useCallback(() => {
    setErr(null);
    api.orders.list({ role: "vendor", page_size: 100 }).then((r) => setOrders(r.results)).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  const shown = orders?.filter((o) => (tab === "active" ? !isTerminalStatus(o.status) : isTerminalStatus(o.status))) ?? null;

  return (
    <Screen withNav>
      <AppBar title={t("nav.orders")} />
      <div className="c-tabs" role="tablist" aria-label={t("nav.orders")}>
        {(["active", "history"] as const).map((tb) => (
          <button key={tb} type="button" role="tab" aria-selected={tab === tb} className={`c-tabs__btn${tab === tb ? " is-active" : ""}`} onClick={() => setTab(tb)}>
            {t(`v.orders.tab.${tb}`)}
          </button>
        ))}
      </div>

      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
      ) : shown === null ? (
        <Skeleton lines={4} />
      ) : shown.length === 0 ? (
        <EmptyState icon="orders" title={t(tab === "active" ? "v.orders.empty_active" : "v.orders.empty_history")} message={tab === "active" ? t("v.orders.empty_active_body") : undefined} />
      ) : (
        <ul className="c-order-list">
          {shown.map((o) => (
            <li key={o.id}>
              <button type="button" className="c-order-card" onClick={() => nav(`/vendor/orders/${o.id}`)}>
                <div className="c-order-card__top">
                  <span className="c-order-card__number">{o.customer.name || t("v.orders.customer_title")}</span>
                  <OrderStatusBadge status={o.status} size="sm" />
                </div>
                <span className="vc-muted">{t("order.number_label", { number: o.number })} · {formatOrderTime(o.created_at, lang)}</span>
                <span>₹{o.total} · {t(`order.fulfilment.${o.fulfilment}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
