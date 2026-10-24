import { useSession, type MyReviewItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, Card, EmptyState, ErrorState, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RatingStars } from "../../social/RatingStars";
import { timeAgo } from "../../social/socialHelpers";

/** Customer Profile → My Reviews (master prompt §29) — every review this customer has written,
 * across every shop, including its moderation status (a hidden review isn't just erased from
 * their own view — master prompt §25). */
export function MyReviewsScreen() {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<MyReviewItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [next, setNext] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback((p: number) => {
    setErr(null);
    api.reviews
      .mine({ page: p, page_size: 20 })
      .then((r) => {
        setItems((prev) => (p === 1 || !prev ? r.results : [...prev, ...r.results]));
        setNext(r.next !== null);
        setPage(p);
      })
      .catch(setErr);
  }, [api]);
  useEffect(() => load(1), [load]);

  return (
    <Screen>
      <AppBar title={t("social.my_reviews_title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Loading label={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState icon="star" title={t("social.reviews_empty_title")} message={t("social.my_reviews_empty_body")} />
      ) : (
        <div className="vc-stack">
          {items.map((r) => (
            <Card key={r.id} className="vc-stack">
              <div className="c-vcard__top">
                <button type="button" className="soc-postcard__vendor" style={{ padding: 0 }} onClick={() => nav(`/v/${r.vendor.handle}`)}>{r.vendor.shop_name}</button>
                <span className="vc-muted">{timeAgo(r.created_at, t, lang)}</span>
              </div>
              <RatingStars value={r.rating} size={18} label={t("social.review.rating_label", { n: r.rating })} />
              {r.text ? <p style={{ margin: 0 }}>{r.text}</p> : null}
              {r.status === "hidden" ? <StatusBadge kind="closed" size="sm" label={t("social.review_status.hidden")} /> : null}
              {r.vendor_reply ? (
                <div className="soc-review__reply">
                  <p className="soc-review__reply-label">{t("social.review.vendor_reply_label")}</p>
                  <p style={{ margin: 0 }}>{r.vendor_reply}</p>
                </div>
              ) : null}
            </Card>
          ))}
          {next ? <Button variant="secondary" block onClick={() => load(page + 1)}>{t("common.load_more")}</Button> : null}
        </div>
      )}
    </Screen>
  );
}
