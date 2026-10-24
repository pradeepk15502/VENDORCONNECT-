import { ApiError, useSession, type OrderAction, type OrderDetail } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Loading, Modal, Screen } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { OrderTimeline } from "../../orders/OrderTimeline";
import { actionLabel, vendorActions } from "../../orders/orderHelpers";

export function OrderDetailScreen() {
  const { orderId = "" } = useParams();
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<OrderAction | null>(null);
  const [actionErr, setActionErr] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState<string>();

  const load = useCallback(() => {
    setErr(null);
    api.orders.get(orderId).then(setOrder).catch(setErr);
  }, [api, orderId]);
  useEffect(load, [load]);

  async function act(action: OrderAction, actionReason?: string) {
    setBusy(action);
    setActionErr(undefined);
    try {
      const updated = await api.orders.transition(orderId, { action, reason: actionReason });
      setOrder(updated);
      setRejecting(false);
      setReason("");
    } catch (e) {
      setActionErr(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  function submitReject() {
    if (!reason.trim()) {
      setReasonErr(t("v.orders.reject_reason_required"));
      return;
    }
    setReasonErr(undefined);
    act("reject", reason.trim());
  }

  if (err instanceof ApiError && (err.status === 404 || err.status === 403))
    return <Screen withNav={false}><AppBar title="" onBack={() => nav("/vendor/orders")} backLabel={t("common.back")} /><EmptyState icon="orders" title={t("common.error_title")} /></Screen>;
  if (err) return <Screen withNav={false}><AppBar title="" onBack={() => nav("/vendor/orders")} backLabel={t("common.back")} /><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!order) return <Loading label={t("common.loading")} />;

  const actions = vendorActions(order);
  const addr = order.delivery_address;

  return (
    <Screen>
      <AppBar title={t("order.number_label", { number: order.number })} onBack={() => nav("/vendor/orders")} backLabel={t("common.back")} />

      <Card className="vc-stack">
        <OrderTimeline order={order} />
      </Card>

      <Card className="vc-stack">
        <h2 className="vc-h2">{order.customer.name || t("v.orders.customer_title")}</h2>
        <ul className="o-items">
          {order.items.map((i, idx) => (
            <li key={idx}>
              <span>{i.name} × {i.quantity}</span>
              <span>₹{i.line_total}</span>
            </li>
          ))}
        </ul>
        <div className="o-summary-line"><span>{t("cart.subtotal")}</span><span>₹{order.subtotal}</span></div>
        {order.fulfilment === "delivery" ? <div className="o-summary-line"><span>{t("checkout.delivery_fee")}</span><span>₹{order.delivery_fee}</span></div> : null}
        <div className="o-summary-line o-summary-line--total"><span>{t("checkout.total")}</span><span>₹{order.total}</span></div>
        <p className="vc-muted" style={{ margin: 0 }}>{t("order.payment_title")}: {t(`checkout.payment.${order.payment_method}`)} · {t(`order.payment_status.${order.payment_status ?? "pending"}`)}</p>
      </Card>

      {order.fulfilment === "delivery" && addr ? (
        <Card className="vc-stack">
          <h2 className="vc-h2">{t("order.address_title")}</h2>
          <p style={{ margin: 0 }}>{[addr.label, addr.line1, addr.line2, addr.landmark, addr.city, addr.pincode].filter(Boolean).join(", ")}</p>
        </Card>
      ) : null}

      {order.customer_note ? (
        <Card className="vc-stack"><p className="vc-muted" style={{ margin: 0 }}>{t("order.note_label")}: {order.customer_note}</p></Card>
      ) : null}

      {actionErr ? <Banner tone="error" icon="alert">{actionErr}</Banner> : null}

      {actions.length > 0 ? (
        <div className="o-actions">
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === "reject" ? "danger" : "primary"}
              loading={busy === a}
              disabled={busy !== null}
              onClick={() => (a === "reject" ? setRejecting(true) : act(a))}
            >
              {actionLabel(t, a)}
            </Button>
          ))}
        </div>
      ) : null}

      <Modal open={rejecting} onClose={() => setRejecting(false)} title={t("v.orders.reject")} closeLabel={t("common.close")}>
        <label className="vc-field">
          <span className="vc-field__label">{t("v.orders.reject_reason_label")}</span>
          <textarea className="c-note" rows={3} maxLength={200} placeholder={t("v.orders.reject_reason_ph")} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {reasonErr ? <Banner tone="error" icon="alert">{reasonErr}</Banner> : null}
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setRejecting(false)}>{t("common.close")}</Button>
          <Button variant="danger" loading={busy === "reject"} onClick={submitReject}>{t("v.orders.reject")}</Button>
        </div>
      </Modal>
    </Screen>
  );
}
