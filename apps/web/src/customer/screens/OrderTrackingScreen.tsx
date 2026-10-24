import { ApiError, useSession, type OrderDetail, type VendorPublic } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Loading, Modal, Screen } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { customerCanCancel } from "../../orders/orderHelpers";
import { OrderTimeline } from "../../orders/OrderTimeline";
import { ReviewForm } from "../../social/ReviewForm";
import { directionsUrl } from "../format";

function ReviewCard({ order, onReviewed }: { order: OrderDetail; onReviewed: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [justSubmitted, setJustSubmitted] = useState(false);

  if (order.status !== "completed") return null;
  if (order.review_id || justSubmitted) {
    return (
      <Card>
        <Banner tone="success" icon="star">{t("social.review.thanks")}</Banner>
      </Card>
    );
  }
  return (
    <Card>
      <ReviewForm
        vendorName={order.vendor.shop_name}
        listingOptions={order.items.filter((i) => i.listing).map((i) => ({ id: i.listing as string, name: i.name }))}
        onSubmit={async (input) => {
          await api.orders.review(order.id, input);
          setJustSubmitted(true);
          onReviewed();
        }}
      />
    </Card>
  );
}

export function OrderTrackingScreen() {
  const { orderId = "" } = useParams();
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shopLocation, setShopLocation] = useState<VendorPublic["location"]>(null);
  const [err, setErr] = useState<unknown>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string>();

  const load = useCallback(() => {
    setErr(null);
    api.orders.get(orderId).then(setOrder).catch(setErr);
  }, [api, orderId]);
  useEffect(load, [load]);

  // The order's own vendor reference has no coordinates (it never needs them for the vendor side of
  // things) — the public shop profile is the one place they're published, so it's fetched
  // separately, purely to power the pickup "Directions" link below.
  useEffect(() => {
    if (!order || order.fulfilment !== "pickup") return;
    api.vendors.byHandle(order.vendor.handle).then((v) => setShopLocation(v.location)).catch(() => undefined);
  }, [api, order]);

  async function cancel() {
    setBusy(true);
    setActionErr(undefined);
    try {
      const updated = await api.orders.transition(orderId, { action: "cancel" });
      setOrder(updated);
      setConfirmCancel(false);
    } catch (e) {
      setActionErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function startChat() {
    if (!order) return;
    const chat = await api.chats.start(order.vendor.handle);
    nav(`/chat/${chat.id}`);
  }

  if (err instanceof ApiError && (err.status === 404 || err.status === 403))
    return <Screen><AppBar title="" onBack={() => nav("/orders")} backLabel={t("common.back")} /><EmptyState icon="orders" title={t("common.error_title")} /></Screen>;
  if (err) return <Screen><AppBar title="" onBack={() => nav("/orders")} backLabel={t("common.back")} /><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!order) return <Loading label={t("common.loading")} />;

  const addr = order.delivery_address;
  const deliveryDirections = addr?.lat != null && addr.lng != null ? directionsUrl(addr.lat, addr.lng) : undefined;
  const pickupDirections = shopLocation ? directionsUrl(shopLocation.lat, shopLocation.lng) : undefined;

  return (
    <Screen>
      <AppBar title={t("order.number_label", { number: order.number })} onBack={() => nav("/orders")} backLabel={t("common.back")} />

      <Card className="vc-stack">
        <OrderTimeline order={order} />
      </Card>

      <Card className="vc-stack">
        <h2 className="vc-h2">{order.vendor.shop_name}</h2>
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

      <ReviewCard order={order} onReviewed={load} />

      {actionErr ? <Banner tone="error" icon="alert">{actionErr}</Banner> : null}

      <div className="o-actions">
        <a className="vc-btn vc-btn--secondary" href={`tel:${order.vendor.public_phone}`}><Icon name="phone" /> <span>{t("common.call")}</span></a>
        <Button variant="secondary" icon="chat" onClick={startChat}>{t("v.chat")}</Button>
        {order.fulfilment === "pickup" && pickupDirections ? (
          <a className="vc-btn vc-btn--secondary" href={pickupDirections} target="_blank" rel="noopener noreferrer"><Icon name="directions" /> <span>{t("common.directions")}</span></a>
        ) : null}
        {order.fulfilment === "delivery" && deliveryDirections ? (
          <a className="vc-btn vc-btn--secondary" href={deliveryDirections} target="_blank" rel="noopener noreferrer"><Icon name="directions" /> <span>{t("common.directions")}</span></a>
        ) : null}
        {customerCanCancel(order) ? (
          <Button variant="danger" icon="x" onClick={() => setConfirmCancel(true)}>{t("order.cancel")}</Button>
        ) : null}
      </div>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title={t("order.cancel_confirm_title")} closeLabel={t("common.close")}>
        <p>{t("order.cancel_confirm_body")}</p>
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setConfirmCancel(false)}>{t("common.close")}</Button>
          <Button variant="danger" loading={busy} onClick={cancel}>{t("order.cancel")}</Button>
        </div>
      </Modal>
    </Screen>
  );
}
