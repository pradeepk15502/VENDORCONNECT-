import { useSession, useOnline, type Category, type Post, type VendorListItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { Banner, Button, EmptyState, ErrorState, Icon, OfflineBanner, Screen, Skeleton, Tile } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PostCard } from "../../social/PostCard";
import { VendorCard } from "../VendorCard";
import type { Place } from "../location";

const NEARBY_PREVIEW_COUNT = 5;
const FEED_PREVIEW_COUNT = 5;

export function HomeScreen({ place }: { place: Place }) {
  const { t, lang } = useI18n();
  const { api, me, status } = useSession();
  const online = useOnline();
  const nav = useNavigate();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [nearby, setNearby] = useState<VendorListItem[] | null>(null);
  const [nearbyErr, setNearbyErr] = useState<unknown>(null);
  const [feed, setFeed] = useState<Post[] | null>(null);

  const load = useCallback(() => {
    setErr(null);
    setCats(null);
    api.catalog.categories().then(setCats).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  const loadNearby = useCallback(() => {
    setNearbyErr(null);
    setNearby(null);
    api.vendors
      .near({ lat: place.lat, lng: place.lng, page_size: NEARBY_PREVIEW_COUNT })
      .then((r) => setNearby(r.results))
      .catch(setNearbyErr);
  }, [api, place.lat, place.lng]);
  useEffect(loadNearby, [loadNearby]);

  // "From Shops You Follow" (master prompt §8/§30) — signed-in customers only, and hidden entirely
  // rather than shown empty, so a customer following nobody doesn't see a dead section cluttering
  // the primary product-discovery home (§30: "do not overwhelm").
  useEffect(() => {
    if (status !== "authenticated") {
      setFeed(null);
      return;
    }
    api.feed.list({ page_size: FEED_PREVIEW_COUNT }).then((r) => setFeed(r.results)).catch(() => setFeed(null));
  }, [api, status]);

  return (
    <Screen withNav>
      <div className="c-header">
        <button className="c-loc" onClick={() => nav("/welcome/location")} aria-label={`${t("loc.title")}: ${place.label}`}>
          <Icon name="pin" size={20} /> {place.label} <Icon name="chevron" size={18} />
        </button>
        <span className="vc-spacer" />
        <button className="vc-iconbtn" onClick={() => nav("/notifications")} aria-label={t("notif.title")}>
          <Icon name="bell" />
        </button>
      </div>
      <h1 className="vc-h1">{me?.name ? t("home.hello", { name: me.name.split(" ")[0] }) : t("home.hello_anon")}</h1>
      {!online ? <OfflineBanner label={t("common.offline")} /> : null}

      <button className="c-search" onClick={() => nav("/search")} aria-label={t("nav.search")}>
        <Icon name="search" />
        <span className="c-search__text">{t("home.search_ph")}</span>
        <span className="c-search__cam" aria-label={t("home.scan")} role="img"><Icon name="camera" /></span>
      </button>

      <Banner tone="info" icon="shield">{t("loc.body")}</Banner>

      <section className="vc-stack" aria-labelledby="cat-h">
        <h2 id="cat-h" className="vc-h2">{t("home.categories")}</h2>
        {err ? (
          <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
        ) : cats === null ? (
          <Skeleton lines={3} />
        ) : cats.length === 0 ? (
          <EmptyState title={t("vendors.empty")} />
        ) : (
          <div className="c-cat-row">
            {cats.map((c, i) => (
              <Tile key={c.slug} icon={c.icon} label={c.names_i18n[lang] ?? c.name} tone={i % 4 === 3 ? "orange" : "green"} onClick={() => nav(`/search?category=${c.slug}`)} />
            ))}
          </div>
        )}
      </section>

      <section className="vc-stack" aria-labelledby="near-h">
        <div className="c-section-title">
          <h2 id="near-h" className="vc-h2">{t("home.nearby")}</h2>
          {nearby && nearby.length > 0 ? (
            <Button variant="ghost" onClick={() => nav("/vendors")}>{t("home.see_all")}</Button>
          ) : null}
        </div>
        {nearbyErr ? (
          <ErrorState title={t("common.error_title")} message={errorMessage(nearbyErr, t)} onRetry={loadNearby} retryLabel={t("common.retry")} />
        ) : nearby === null ? (
          <Skeleton lines={2} />
        ) : nearby.length === 0 ? (
          <EmptyState icon="store" title={t("home.nearby_empty")} message={t("home.nearby_empty_body")} />
        ) : (
          <div className="vc-stack">
            {nearby.map((v) => (
              <VendorCard key={v.handle} item={v} onOpen={() => nav(`/v/${v.handle}`)} />
            ))}
          </div>
        )}
      </section>

      {feed && feed.length > 0 ? (
        <section className="vc-stack" aria-labelledby="feed-h">
          <div className="c-section-title">
            <h2 id="feed-h" className="vc-h2">{t("home.from_shops_you_follow")}</h2>
            <Button variant="ghost" onClick={() => nav("/following")}>{t("home.see_all")}</Button>
          </div>
          <div className="soc-feedlist">
            {feed.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        </section>
      ) : null}
    </Screen>
  );
}
