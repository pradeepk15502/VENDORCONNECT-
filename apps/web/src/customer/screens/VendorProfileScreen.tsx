import { ApiError, useSession, type Category, type Post, type ReviewItem, type VendorProductPublicItem, type VendorPublic } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FollowButton } from "../../social/FollowButton";
import { PostCard } from "../../social/PostCard";
import { ReviewCard } from "../../social/ReviewCard";
import { ReviewReportButton } from "../../social/ReviewReportButton";
import { formatUnit } from "../../shared/units";
import { directionsUrl } from "../format";

function ProductRow({ item, isOwnShop, onAdded }: { item: VendorProductPublicItem; isOwnShop: boolean; onAdded: (listingId: string) => Promise<void> }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  return (
    <li className="c-result">
      <button type="button" className="c-result__top" style={{ border: 0, background: "transparent", padding: 0, width: "100%", cursor: "pointer", textAlign: "left" }} onClick={() => nav(`/listings/${item.id}`)}>
        <span className="c-result__name">{item.name}</span>
        <span className="c-result__price">
          ₹{item.price}
          {item.mrp && Number(item.mrp) > Number(item.price) ? <span className="c-result__mrp">₹{item.mrp}</span> : null}
        </span>
      </button>
      <span className="vc-muted">{formatUnit(t, item.unit, item.unit_quantity)}</span>
      <div className="c-result__badges">
        <StatusBadge kind={item.availability} size="sm" label={t(`avail.${item.availability}` as MessageKey)} />
      </div>
      {!isOwnShop ? (
        <Button
          size="md"
          variant="secondary"
          icon={added ? "check" : "cart"}
          disabled={item.availability === "out_of_stock"}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdded(item.id);
              setAdded(true);
              setTimeout(() => setAdded(false), 2000);
            } finally {
              setBusy(false);
            }
          }}
        >
          {added ? t("products.added") : t("products.add_to_cart")}
        </Button>
      ) : null}
    </li>
  );
}

type Tab = "products" | "posts" | "reviews" | "about";
const TABS: Tab[] = ["products", "posts", "reviews", "about"];

/* Deep link target: /v/SHARMA001 or /v/@sharma001. Products (Phase 8), Posts and Reviews
 * (Phase 9) are all real, backend-driven tabs — GET /vendors/{handle}/products|posts|reviews. */
export function VendorProfileScreen() {
  const { handle = "" } = useParams();
  const { t, lang } = useI18n();
  const { api, me, status } = useSession();
  const nav = useNavigate();
  const [v, setV] = useState<VendorPublic | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("products");
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string>();
  const [products, setProducts] = useState<VendorProductPublicItem[] | null>(null);
  const [productsErr, setProductsErr] = useState<unknown>(null);
  const [cartErr, setCartErr] = useState<string>();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [postsErr, setPostsErr] = useState<unknown>(null);
  const [postsNext, setPostsNext] = useState(false);
  const [postsPage, setPostsPage] = useState(1);
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [reviewsErr, setReviewsErr] = useState<unknown>(null);
  const [reviewsNext, setReviewsNext] = useState(false);
  const [reviewsPage, setReviewsPage] = useState(1);

  const load = useCallback(() => {
    setErr(null);
    setV(null);
    api.vendors.byHandle(handle).then(setV).catch(setErr);
  }, [api, handle]);
  const loadProducts = useCallback(() => {
    setProductsErr(null);
    api.vendors.products(handle, { page_size: 100 }).then((r) => setProducts(r.results)).catch(setProductsErr);
  }, [api, handle]);
  useEffect(() => {
    if (tab === "products" && products === null) loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadProducts]);

  const loadPosts = useCallback((page: number) => {
    setPostsErr(null);
    api.posts
      .byVendor(handle, { page, page_size: 10 })
      .then((r) => {
        setPosts((prev) => (page === 1 || !prev ? r.results : [...prev, ...r.results]));
        setPostsNext(r.next !== null);
        setPostsPage(page);
      })
      .catch(setPostsErr);
  }, [api, handle]);
  useEffect(() => {
    if (tab === "posts" && posts === null) loadPosts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadPosts]);

  const loadReviews = useCallback((page: number) => {
    setReviewsErr(null);
    api.reviews
      .byVendor(handle, { page, page_size: 10 })
      .then((r) => {
        setReviews((prev) => (page === 1 || !prev ? r.results : [...prev, ...r.results]));
        setReviewsNext(r.next !== null);
        setReviewsPage(page);
      })
      .catch(setReviewsErr);
  }, [api, handle]);
  useEffect(() => {
    if (tab === "reviews" && reviews === null) loadReviews(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadReviews]);

  async function addToCart(listingId: string) {
    if (status !== "authenticated") {
      nav("/login", { state: { from: `/v/${handle}` } });
      throw new Error("not authenticated");
    }
    setCartErr(undefined);
    try {
      await api.cart.add({ listing_id: listingId });
    } catch (e) {
      setCartErr(errorMessage(e, t));
      throw e;
    }
  }
  useEffect(load, [load]);
  useEffect(() => {
    api.catalog.categories().then(setCategories).catch(() => setCategories([]));
  }, [api]);
  const categoryName = (slug: string) => categories?.find((c) => c.slug === slug)?.names_i18n[lang] ?? categories?.find((c) => c.slug === slug)?.name ?? slug;

  const back = () => (window.history.length > 1 ? nav(-1) : nav("/"));

  const isOwnShop = !!v && me?.vendor?.handle === v.handle;

  async function startChat() {
    if (!v) return;
    if (status !== "authenticated") {
      nav("/login", { state: { from: `/v/${handle}` } });
      return;
    }
    setChatErr(undefined);
    setChatBusy(true);
    try {
      const chat = await api.chats.start(v.handle);
      nav(`/chat/${chat.id}`);
    } catch (e) {
      setChatErr(errorMessage(e, t));
    } finally {
      setChatBusy(false);
    }
  }

  if (err instanceof ApiError && err.status === 404)
    return <Screen><AppBar title="" onBack={back} /><EmptyState icon="store" title={t("vendors.empty")} message={`@${handle.replace(/^@/, "").toUpperCase()}`} /></Screen>;
  if (err) return <Screen><AppBar title="" onBack={back} /><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!v) return <Loading label={t("common.loading")} />;

  const loc = v.location;
  const directions = loc ? directionsUrl(loc.lat, loc.lng) : undefined;
  return (
    <Screen>
      <AppBar title={v.vendor_id} onBack={back} backLabel={t("common.back")} />
      <Card className="vc-stack">
        <div className="vc-row">
          <span className="vc-brand__mark" aria-hidden="true"><Icon name="store" size={32} /></span>
          <div style={{ flex: 1 }}>
            <h1 className="vc-h2" style={{ fontSize: "var(--vc-text-xl)" }} data-testid="vendor-name">{v.shop_name}</h1>
            <span className="vc-muted">{v.vendor_id}</span>
          </div>
          {!isOwnShop ? (
            <FollowButton
              handle={v.handle}
              following={v.is_following}
              onChange={(state) => setV({ ...v, is_following: state.following, follower_count: state.follower_count })}
            />
          ) : null}
        </div>
        <div className="vc-row">
          <StatusBadge kind={v.is_open ? "open" : "closed"} label={v.is_open ? t("status.open") : t("status.closed")} size="lg" />
          {v.verified ? <StatusBadge kind="verified" label={t("v.verified")} /> : null}
          {v.delivery.delivery_enabled ? <StatusBadge kind="delivery" label={t("v.delivery_on")} /> : <StatusBadge kind="pickup_only" label={t("v.pickup_only")} />}
        </div>
        <div className="soc-shopstats">
          <span className="soc-shopstats__item"><Icon name="star" size={18} /> <span className="soc-shopstats__num">{Number(v.rating_avg).toFixed(1)}</span></span>
          <button type="button" className="soc-shopstats__item" style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", color: "inherit" }} onClick={() => setTab("reviews")}>
            {t("social.review_count", { count: v.rating_count })}
          </button>
          <span className="soc-shopstats__item"><Icon name="user" size={18} /> {t("social.follower_count", { count: v.follower_count })}</span>
        </div>
        {loc ? <p style={{ margin: 0 }}><Icon name="pin" size={18} /> {[loc.address_line, loc.landmark, loc.city].filter(Boolean).join(", ")}</p> : null}
      </Card>
      <div className="vc-grid-3">
        <a className="vc-btn vc-btn--primary vc-btn--lg" href={`tel:${v.public_phone}`}><Icon name="phone" /> <span>{t("common.call")}</span></a>
        {!isOwnShop ? (
          <Button variant="accent" size="lg" icon="chat" loading={chatBusy} onClick={startChat}>{t("v.chat")}</Button>
        ) : null}
        {directions ? <a className="vc-btn vc-btn--secondary vc-btn--lg" href={directions} target="_blank" rel="noopener noreferrer"><Icon name="directions" /> <span>{t("common.directions")}</span></a> : null}
      </div>
      {chatErr ? <Banner tone="error" icon="alert">{chatErr}</Banner> : null}

      <div className="c-tabs" role="tablist" aria-label={t("v.tabs_label")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`c-tabs__btn${tab === tb ? " is-active" : ""}`}
            onClick={() => setTab(tb)}
          >
            {t(`v.tab.${tb}` as MessageKey)}
          </button>
        ))}
      </div>

      {tab === "about" ? (
        <Card className="vc-stack" role="tabpanel">
          <p style={{ margin: 0 }}>{v.bio || t("v.about.no_bio")}</p>

          <div>
            <p className="vc-muted" style={{ fontWeight: 700, margin: "0 0 6px" }}>{t("v.about.categories")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {v.categories.length > 0 ? (
                v.categories.map((slug) => <span key={slug} className="vc-chip is-selected">{categoryName(slug)}</span>)
              ) : (
                <span className="vc-muted">{t("v.about.no_categories")}</span>
              )}
            </div>
          </div>

          <div>
            <p className="vc-muted" style={{ fontWeight: 700, margin: "0 0 6px" }}>{t("v.about.fulfilment")}</p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {v.delivery.pickup_enabled ? <li>{t("v.about.pickup_available")}</li> : null}
              {v.delivery.delivery_enabled ? (
                <>
                  <li>{t("v.about.delivery_radius", { km: v.delivery.radius_km })}</li>
                  <li>
                    {Number(v.delivery.delivery_fee) > 0
                      ? t("v.about.delivery_fee", { fee: v.delivery.delivery_fee })
                      : t("v.about.delivery_free")}
                  </li>
                  {Number(v.delivery.min_order_amount) > 0 ? <li>{t("v.about.min_order", { amount: v.delivery.min_order_amount })}</li> : null}
                  {v.delivery.free_delivery_above ? <li>{t("v.about.free_above", { amount: v.delivery.free_delivery_above })}</li> : null}
                </>
              ) : null}
            </ul>
          </div>

          <p className="vc-muted" style={{ margin: 0 }}><Icon name="phone" size={16} /> {v.public_phone}</p>
        </Card>
      ) : tab === "products" ? (
        <div role="tabpanel">
          {cartErr ? <Banner tone="error" icon="alert">{cartErr}</Banner> : null}
          {productsErr ? (
            <ErrorState title={t("common.error_title")} message={errorMessage(productsErr, t)} onRetry={loadProducts} retryLabel={t("common.retry")} />
          ) : products === null ? (
            <Loading label={t("common.loading")} />
          ) : products.length === 0 ? (
            <EmptyState icon="box" title={t("products.empty_title")} message={t("products.empty_body")} />
          ) : (
            <ul className="vc-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {products.map((p) => (
                <ProductRow key={p.id} item={p} isOwnShop={isOwnShop} onAdded={addToCart} />
              ))}
            </ul>
          )}
        </div>
      ) : tab === "posts" ? (
        <div className="vc-stack" role="tabpanel">
          {postsErr ? (
            <ErrorState title={t("common.error_title")} message={errorMessage(postsErr, t)} onRetry={() => loadPosts(1)} retryLabel={t("common.retry")} />
          ) : posts === null ? (
            <Loading label={t("common.loading")} />
          ) : posts.length === 0 ? (
            <EmptyState icon="camera" title={t("social.posts_empty_title")} message={t("social.posts_empty_body")} />
          ) : (
            <>
              <div className="soc-postgrid">
                {posts.map((p) => <PostCard key={p.id} post={p} showVendor={false} />)}
              </div>
              {postsNext ? <Button variant="secondary" block onClick={() => loadPosts(postsPage + 1)}>{t("common.load_more")}</Button> : null}
            </>
          )}
        </div>
      ) : (
        <div className="vc-stack" role="tabpanel">
          {reviewsErr ? (
            <ErrorState title={t("common.error_title")} message={errorMessage(reviewsErr, t)} onRetry={() => loadReviews(1)} retryLabel={t("common.retry")} />
          ) : reviews === null ? (
            <Loading label={t("common.loading")} />
          ) : reviews.length === 0 ? (
            <EmptyState icon="star" title={t("social.reviews_empty_title")} message={t("social.reviews_empty_body")} />
          ) : (
            <Card>
              {reviews.map((r) => <ReviewCard key={r.id} review={r} footer={<ReviewReportButton reviewId={r.id} />} />)}
              {reviewsNext ? <Button variant="secondary" block onClick={() => loadReviews(reviewsPage + 1)}>{t("common.load_more")}</Button> : null}
            </Card>
          )}
        </div>
      )}

      <Button variant="ghost" onClick={() => nav("/")}>{t("nav.home")}</Button>
    </Screen>
  );
}
