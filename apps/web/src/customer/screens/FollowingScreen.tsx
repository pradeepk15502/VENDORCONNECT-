import { useSession, type FollowedVendorItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistance } from "../format";
import type { Place } from "../location";

function FollowedRow({ item, onUnfollowed }: { item: FollowedVendorItem; onUnfollowed: (handle: string) => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function unfollow() {
    setErr(undefined);
    setBusy(true);
    try {
      await api.following.unfollow(item.handle);
      onUnfollowed(item.handle);
    } catch (e) {
      setErr(errorMessage(e, t));
      setBusy(false);
    }
  }

  return (
    <Card className="vc-stack">
      <div className="c-vcard__top">
        <span className="c-vcard__name">{item.shop_name}</span>
        {item.distance_km != null ? <span className="c-vcard__dist"><Icon name="pin" size={16} /> {formatDistance(t, item.distance_km)}</span> : null}
      </div>
      <span className="vc-muted">{item.vendor_id}</span>
      <div className="c-vcard__badges">
        <StatusBadge kind={item.is_open ? "open" : "closed"} size="sm" label={item.is_open ? t("status.open") : t("status.closed")} />
        <span className="vc-row" style={{ gap: 4 }}><Icon name="star" size={16} /> {Number(item.rating_avg).toFixed(1)}</span>
      </div>
      {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
      <div className="vc-row">
        <Button variant="secondary" onClick={() => nav(`/v/${item.handle}`)}>{t("social.view_shop")}</Button>
        <Button variant="ghost" loading={busy} onClick={unfollow}>{t("social.unfollow")}</Button>
      </div>
    </Card>
  );
}

/** Customer Profile → Following (master prompt §7) — real backend list, paginated, with Unfollow. */
export function FollowingScreen({ place }: { place?: Place }) {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<FollowedVendorItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [next, setNext] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback((p: number) => {
    setErr(null);
    api.following
      .list({ lat: place?.lat, lng: place?.lng, page: p, page_size: 20 })
      .then((r) => {
        setItems((prev) => (p === 1 || !prev ? r.results : [...prev, ...r.results]));
        setNext(r.next !== null);
        setPage(p);
      })
      .catch(setErr);
  }, [api, place?.lat, place?.lng]);
  useEffect(() => load(1), [load]);

  return (
    <Screen>
      <AppBar title={t("social.following_title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Loading label={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState icon="store" title={t("social.following_empty_title")} message={t("social.following_empty_body")} action={<Button onClick={() => nav("/vendors")}>{t("nav.vendors")}</Button>} />
      ) : (
        <div className="vc-stack">
          {items.map((v) => <FollowedRow key={v.handle} item={v} onUnfollowed={(h) => setItems((prev) => prev?.filter((x) => x.handle !== h) ?? null)} />)}
          {next ? <Button variant="secondary" block onClick={() => load(page + 1)}>{t("common.load_more")}</Button> : null}
        </div>
      )}
    </Screen>
  );
}
