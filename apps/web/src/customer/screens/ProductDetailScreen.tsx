import { ApiError, useSession, type ListingDetail, type ReviewItem } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ReviewCard } from "../../social/ReviewCard";
import { ReviewReportButton } from "../../social/ReviewReportButton";
import { formatUnit } from "../../shared/units";

/** The real product detail page a post's "View Product" (and any product row) links to (master
 * prompt §12/§15/§33) — public, and the one place `Add to cart` + product-level reviews meet. */
export function ProductDetailScreen() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { api, me, status } = useSession();
  const nav = useNavigate();
  const [item, setItem] = useState<ListingDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cartErr, setCartErr] = useState<string>();
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string>();

  const load = useCallback(() => {
    setErr(null);
    setItem(null);
    api.listings.detail(id).then(setItem).catch(setErr);
  }, [api, id]);
  useEffect(load, [load]);
  useEffect(() => {
    api.reviews.byListing(id, { page_size: 10 }).then((r) => setReviews(r.results)).catch(() => setReviews([]));
  }, [api, id]);

  const back = () => (window.history.length > 1 ? nav(-1) : nav("/"));
  const isOwnShop = !!item && me?.vendor?.handle === item.vendor.handle;

  async function addToCart() {
    if (status !== "authenticated") {
      nav("/login", { state: { from: `/listings/${id}` } });
      return;
    }
    setCartErr(undefined);
    setBusy(true);
    try {
      await api.cart.add({ listing_id: id });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (e) {
      setCartErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function startChat() {
    if (!item) return;
    if (status !== "authenticated") {
      nav("/login", { state: { from: `/listings/${id}` } });
      return;
    }
    setChatErr(undefined);
    setChatBusy(true);
    try {
      const chat = await api.chats.start(item.vendor.handle);
      nav(`/chat/${chat.id}`);
    } catch (e) {
      setChatErr(errorMessage(e, t));
    } finally {
      setChatBusy(false);
    }
  }

  if (err instanceof ApiError && err.status === 404)
    return <Screen><AppBar title="" onBack={back} /><EmptyState icon="box" title={t("social.product_gone_title")} message={t("social.product_gone_body")} /></Screen>;
  if (err) return <Screen><AppBar title="" onBack={back} /><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!item) return <Loading label={t("common.loading")} />;

  return (
    <Screen>
      <AppBar title={item.name} onBack={back} backLabel={t("common.back")} />
      <Card className="vc-stack">
        <div className="c-result__top">
          <span className="c-result__name" style={{ fontSize: "var(--vc-text-xl)" }}>{item.name}</span>
          <span className="c-result__price" style={{ fontSize: "var(--vc-text-xl)" }}>
            ₹{item.price}
            {item.mrp && Number(item.mrp) > Number(item.price) ? <span className="c-result__mrp">₹{item.mrp}</span> : null}
          </span>
        </div>
        <span className="vc-muted">{formatUnit(t, item.unit, item.unit_quantity)}</span>
        <StatusBadge kind={item.availability} label={t(`avail.${item.availability}` as MessageKey)} />
        {item.description ? <p style={{ margin: 0 }}>{item.description}</p> : null}
      </Card>

      <button type="button" className="c-listbtn" onClick={() => nav(`/v/${item.vendor.handle}`)}>
        <Icon name="store" />
        <span>{item.vendor.shop_name}</span>
        <StatusBadge kind={item.vendor.is_open ? "open" : "closed"} size="sm" label={item.vendor.is_open ? t("status.open") : t("status.closed")} />
        <Icon name="chevron" />
      </button>

      {cartErr ? <Banner tone="error" icon="alert">{cartErr}</Banner> : null}
      {chatErr ? <Banner tone="error" icon="alert">{chatErr}</Banner> : null}
      {!isOwnShop ? (
        <div className="vc-grid-2">
          <Button size="lg" icon={added ? "check" : "cart"} disabled={item.availability === "out_of_stock"} loading={busy} onClick={addToCart}>
            {added ? t("products.added") : t("products.add_to_cart")}
          </Button>
          <Button variant="accent" size="lg" icon="chat" loading={chatBusy} onClick={startChat}>{t("v.chat")}</Button>
        </div>
      ) : null}

      <section className="vc-stack" aria-labelledby="pd-reviews-h">
        <h2 id="pd-reviews-h" className="vc-h2">{t("v.tab.reviews")}</h2>
        {reviews === null ? (
          <Loading label={t("common.loading")} />
        ) : reviews.length === 0 ? (
          <EmptyState icon="star" title={t("social.reviews_empty_title")} message={t("social.reviews_empty_body")} />
        ) : (
          <Card>{reviews.map((r) => <ReviewCard key={r.id} review={r} footer={<ReviewReportButton reviewId={r.id} />} />)}</Card>
        )}
      </section>
    </Screen>
  );
}
