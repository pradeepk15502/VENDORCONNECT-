import { useSession, type CartItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Screen, Skeleton, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { groupCartByVendor } from "../../cart/cartHelpers";
import { formatUnit } from "../../shared/units";

function Row({ item, onQuantity, onRemove, busy }: { item: CartItem; onQuantity: (q: number) => void; onRemove: () => void; busy: boolean }) {
  const { t } = useI18n();
  const qty = Number(item.quantity);
  const problem = item.listing_status !== "active" ? "removed" : item.availability === "out_of_stock" ? "out_of_stock" : null;
  return (
    <li className="c-cart-row">
      <div className="c-cart-row__main">
        <span className="c-cart-row__name">{item.name}</span>
        <span className="c-cart-row__unit vc-muted">₹{item.price} / {formatUnit(t, item.unit, item.unit_quantity)}</span>
        {problem ? <StatusBadge kind="out_of_stock" size="sm" label={t(problem === "removed" ? "cart.unavailable" : "avail.out_of_stock")} /> : null}
      </div>
      <div className="c-cart-row__controls">
        <div className="c-qty" role="group" aria-label={t("cart.qty_label")}>
          <button type="button" className="c-qty__btn" onClick={() => onQuantity(qty - 1)} disabled={busy || qty <= 1} aria-label="-">−</button>
          <span className="c-qty__value" data-testid="cart-qty">{item.quantity}</span>
          <button type="button" className="c-qty__btn" onClick={() => onQuantity(qty + 1)} disabled={busy} aria-label="+">+</button>
        </div>
        <span className="c-cart-row__total">₹{item.line_total}</span>
        <button type="button" className="vc-iconbtn" onClick={onRemove} disabled={busy} aria-label={t("cart.remove_label")}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}

export function CartScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<CartItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string>();
  const [actionErr, setActionErr] = useState<string>();

  const load = useCallback(() => {
    setErr(null);
    api.cart.list().then(setItems).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  async function updateQuantity(item: CartItem, quantity: number) {
    setBusyId(item.id);
    setActionErr(undefined);
    try {
      const updated = await api.cart.update(item.id, { quantity });
      setItems((prev) => prev?.map((x) => (x.id === item.id ? updated : x)) ?? prev);
    } catch (e) {
      setActionErr(errorMessage(e, t));
    } finally {
      setBusyId(undefined);
    }
  }

  async function removeItem(item: CartItem) {
    setBusyId(item.id);
    setActionErr(undefined);
    try {
      await api.cart.remove(item.id);
      setItems((prev) => prev?.filter((x) => x.id !== item.id) ?? prev);
    } catch (e) {
      setActionErr(errorMessage(e, t));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <Screen withNav>
      <AppBar title={t("nav.cart")} />
      {actionErr ? <Banner tone="error" icon="alert">{actionErr}</Banner> : null}
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="cart" title={t("cart.empty")} message={t("cart.empty_body")} action={<Button icon="search" onClick={() => nav("/search")}>{t("nav.search")}</Button>} />
      ) : (
        <div className="vc-stack">
          {groupCartByVendor(items).map((group) => {
            const vendor = group.items[0].vendor;
            return (
              <Card key={group.vendorHandle} className="vc-stack" data-testid="cart-group">
                <div className="c-cart-group__head">
                  <button type="button" className="c-cart-group__shop" onClick={() => nav(`/v/${vendor.handle}`)}>
                    <Icon name="store" size={18} /> {vendor.shop_name}
                  </button>
                  {!vendor.is_open ? <StatusBadge kind="closed" size="sm" label={t("cart.vendor_closed")} /> : null}
                </div>
                <ul className="c-cart-list">
                  {group.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      busy={busyId === item.id}
                      onQuantity={(q) => updateQuantity(item, q)}
                      onRemove={() => removeItem(item)}
                    />
                  ))}
                </ul>
                <div className="c-cart-group__foot">
                  <span className="c-cart-group__subtotal">{t("cart.subtotal")}: <strong>₹{group.subtotal.toFixed(2)}</strong></span>
                  <Button icon="cart" disabled={!group.canCheckout} onClick={() => nav(`/checkout/${group.vendorHandle}`)}>
                    {t("cart.checkout")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
