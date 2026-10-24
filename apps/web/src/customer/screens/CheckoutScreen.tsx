import { ApiError, useSession, type AddressItem, type CheckoutSummary, type PaymentMethod } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, ErrorState, Icon, Loading, Screen } from "@vc/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatUnit } from "../../shared/units";

type ChangeRow = { listing_id: string; name: string | null; field: string; old: string | null; new: string | null };

const DELIVERY_REASON_KEY: Record<string, MessageKey> = {
  delivery_disabled: "checkout.err.delivery_disabled",
  address_missing_location: "checkout.err.address_missing_location",
  outside_radius: "checkout.err.outside_radius",
  below_minimum: "checkout.err.below_minimum",
};

const PAYMENT_LABEL_KEY: Record<PaymentMethod, MessageKey> = {
  cash: "checkout.payment.cash",
  upi: "checkout.payment.upi",
  online: "checkout.payment.online",
};

export function CheckoutScreen() {
  const { vendor = "" } = useParams();
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">("pickup");
  const [addresses, setAddresses] = useState<AddressItem[] | null>(null);
  const [addressId, setAddressId] = useState<string>();
  const [pickupSummary, setPickupSummary] = useState<CheckoutSummary | null>(null);
  const [deliverySummary, setDeliverySummary] = useState<CheckoutSummary | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [changes, setChanges] = useState<ChangeRow[] | null>(null);
  const [submitErr, setSubmitErr] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const loadPickup = useCallback(() => {
    setLoadErr(null);
    api.checkout.summary({ vendor, fulfilment: "pickup" }).then(setPickupSummary).catch(setLoadErr);
  }, [api, vendor]);
  useEffect(loadPickup, [loadPickup]);

  useEffect(() => {
    api.addresses.list().then((list) => {
      setAddresses(list);
      const def = list.find((a) => a.is_default) ?? list[0];
      if (def) setAddressId(def.id);
    }).catch(() => setAddresses([]));
  }, [api]);

  useEffect(() => {
    if (fulfilment !== "delivery" || !addressId) return;
    setDeliverySummary(null);
    api.checkout.summary({ vendor, fulfilment: "delivery", address_id: addressId }).then(setDeliverySummary).catch(setLoadErr);
  }, [api, vendor, fulfilment, addressId]);

  const activeSummary = fulfilment === "pickup" ? pickupSummary : deliverySummary;

  const paymentMethods = pickupSummary?.payment_methods ?? ["cash"];
  useEffect(() => {
    if (!paymentMethods.includes(paymentMethod)) setPaymentMethod(paymentMethods[0] ?? "cash");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupSummary?.payment_methods.join(",")]);

  const refreshAll = useCallback(() => {
    setChanges(null);
    loadPickup();
    if (fulfilment === "delivery" && addressId) {
      api.checkout.summary({ vendor, fulfilment: "delivery", address_id: addressId }).then(setDeliverySummary).catch(setLoadErr);
    }
  }, [api, vendor, fulfilment, addressId, loadPickup]);

  const expectedItems = useMemo(
    () => (activeSummary?.items ?? []).map((i) => ({ listing_id: i.listing_id, price: i.price, availability: i.availability })),
    [activeSummary],
  );

  async function placeOrder() {
    if (!activeSummary) return;
    setSubmitErr(undefined);
    setChanges(null);
    setSubmitting(true);
    try {
      const order = await api.checkout.submit({
        vendor,
        fulfilment,
        address_id: fulfilment === "delivery" ? addressId : undefined,
        payment_method: paymentMethod,
        customer_note: note.trim() || undefined,
        idempotency_key: idempotencyKey,
        expected_items: expectedItems,
        simulate_failure: simulateFailure || undefined,
      });
      nav(`/orders/${order.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "cart_changed") {
        setChanges((e.details.changes as ChangeRow[]) ?? []);
      } else {
        setSubmitErr(errorMessage(e, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadErr) return <Screen><AppBar title={t("checkout.title")} onBack={() => nav(-1)} backLabel={t("common.back")} /><ErrorState title={t("common.error_title")} message={errorMessage(loadErr, t)} onRetry={loadPickup} retryLabel={t("common.retry")} /></Screen>;
  if (!pickupSummary) return <Loading label={t("common.loading")} />;

  const canPlace = !!activeSummary?.can_place_order && !submitting;

  return (
    <Screen>
      <AppBar title={t("checkout.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />

      <Card className="vc-stack">
        <h2 className="vc-h2">{pickupSummary.vendor.shop_name}</h2>
        <ul className="o-items">
          {pickupSummary.items.map((i) => (
            <li key={i.listing_id}>
              <span>{i.name} × {i.quantity} {formatUnit(t, i.unit, i.unit_quantity)}</span>
              <span>₹{i.line_total}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="vc-stack">
        <h2 className="vc-h2">{t("checkout.fulfilment_title")}</h2>
        <button type="button" className={`c-checkout__option${fulfilment === "pickup" ? " is-selected" : ""}`} disabled={!pickupSummary.pickup_available} onClick={() => setFulfilment("pickup")}>
          <Icon name="bag" />
          <span className="c-checkout__option-text">
            <span className="c-checkout__option-title">{t("checkout.pickup")}</span>
            <span className="c-checkout__option-hint">{pickupSummary.pickup_available ? t("checkout.pickup_hint") : t("checkout.err.pickup_unavailable")}</span>
          </span>
        </button>
        <button type="button" className={`c-checkout__option${fulfilment === "delivery" ? " is-selected" : ""}`} disabled={!pickupSummary.delivery_available} onClick={() => setFulfilment("delivery")}>
          <Icon name="truck" />
          <span className="c-checkout__option-text">
            <span className="c-checkout__option-title">{t("checkout.delivery")}</span>
            <span className="c-checkout__option-hint">{pickupSummary.delivery_available ? t("checkout.delivery_hint") : t("checkout.err.delivery_disabled")}</span>
          </span>
        </button>
      </div>

      {fulfilment === "delivery" ? (
        <div className="vc-stack">
          <h2 className="vc-h2">{t("checkout.address_title")}</h2>
          {addresses === null ? null : addresses.length === 0 ? (
            <Banner tone="info" icon="pin">{t("addr.empty_body")}</Banner>
          ) : (
            <div className="vc-stack">
              {addresses.map((a) => (
                <button key={a.id} type="button" className={`c-addr-card${addressId === a.id ? " is-selected" : ""}`} onClick={() => setAddressId(a.id)}>
                  <div className="c-addr-card__text">
                    <span className="c-addr-card__label">{a.label || t("addr.title")}</span>
                    <span className="c-addr-card__body">{[a.line1, a.city, a.pincode].filter(Boolean).join(", ")}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <Button variant="secondary" icon="plus" onClick={() => nav("/addresses/new", { state: { from: `/checkout/${vendor}` } })}>{t("checkout.address_add")}</Button>
          {deliverySummary?.delivery_eligible === false ? (
            <Banner tone="error" icon="alert">{t(DELIVERY_REASON_KEY[deliverySummary.delivery_ineligible_reason ?? ""] ?? "checkout.err.outside_radius")}</Banner>
          ) : null}
          {deliverySummary?.distance_km != null ? <p className="vc-muted" style={{ margin: 0 }}>{t("checkout.distance_km", { km: deliverySummary.distance_km })}</p> : null}
        </div>
      ) : null}

      {changes ? (
        <Banner tone="error" icon="alert">
          <p style={{ fontWeight: 700, margin: "0 0 6px" }}>{t("checkout.changed_title")}</p>
          <p style={{ margin: "0 0 6px" }}>{t("checkout.changed_body")}</p>
          <ul className="c-checkout__changes">
            {changes.map((c, i) => (
              <li key={i}>
                {c.name ? `${c.name}: ` : ""}
                {c.field === "price" ? t("checkout.change.price", { old: c.old ?? "", new: c.new ?? "" })
                  : c.field === "availability" ? t("checkout.change.availability")
                  : c.field === "removed" ? t("checkout.change.removed")
                  : t("checkout.change.added_elsewhere")}
              </li>
            ))}
          </ul>
          <Button size="md" variant="secondary" icon="refresh" onClick={refreshAll}>{t("checkout.refresh_and_review")}</Button>
        </Banner>
      ) : null}

      {activeSummary && !changes ? (
        <Card className="vc-stack">
          <h2 className="vc-h2">{t("checkout.review_title")}</h2>
          <div className="o-summary-line"><span>{t("cart.subtotal")}</span><span>₹{activeSummary.subtotal}</span></div>
          {fulfilment === "delivery" ? <div className="o-summary-line"><span>{t("checkout.delivery_fee")}</span><span>₹{activeSummary.delivery_fee}</span></div> : null}
          <div className="o-summary-line o-summary-line--total"><span>{t("checkout.total")}</span><span>₹{activeSummary.total}</span></div>

          <label className="vc-field">
            <span className="vc-field__label">{t("checkout.note_label")}</span>
            <textarea className="c-note" rows={2} maxLength={300} placeholder={t("checkout.note_ph")} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <h2 className="vc-h2">{t("checkout.payment_title")}</h2>
          <div className="vc-row" role="radiogroup" aria-label={t("checkout.payment_title")}>
            {paymentMethods.map((m) => (
              <button key={m} type="button" className={`vc-chip${paymentMethod === m ? " is-selected" : ""}`} role="radio" aria-checked={paymentMethod === m} onClick={() => setPaymentMethod(m)}>
                {t(PAYMENT_LABEL_KEY[m])}
              </button>
            ))}
          </div>
          {paymentMethod !== "cash" ? (
            <>
              <p className="vc-muted" style={{ margin: 0 }}>{t("checkout.payment_test_hint")}</p>
              <label className="vc-row">
                <input type="checkbox" checked={simulateFailure} onChange={(e) => setSimulateFailure(e.target.checked)} />
                {t("checkout.simulate_failure")}
              </label>
            </>
          ) : null}

          {submitErr ? <Banner tone="error" icon="alert">{submitErr}</Banner> : null}
          {!activeSummary.can_place_order ? (
            <Banner tone="warn" icon="alert">
              {activeSummary.items.some((i) => i.problem) ? t("checkout.err.items_unavailable")
                : fulfilment === "delivery" && deliverySummary?.delivery_ineligible_reason ? t(DELIVERY_REASON_KEY[deliverySummary.delivery_ineligible_reason] ?? "checkout.err.outside_radius")
                : fulfilment === "pickup" && !pickupSummary.pickup_available ? t("checkout.err.pickup_unavailable")
                : t("checkout.err.vendor_closed")}
            </Banner>
          ) : null}
          <Button size="lg" block icon="check" onClick={placeOrder} loading={submitting} disabled={!canPlace}>{t("checkout.place_order")}</Button>
        </Card>
      ) : null}

      {fulfilment === "delivery" && !addressId ? (
        <Banner tone="info" icon="pin">{t("addr.choose")}</Banner>
      ) : null}
    </Screen>
  );
}
