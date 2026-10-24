import { useSession, type ReviewItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Loading, Screen } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReviewCard } from "../../social/ReviewCard";

function ReplyBox({ review, onReplied }: { review: ReviewItem; onReplied: (updated: ReviewItem) => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  if (review.vendor_reply) return null;

  if (!open) {
    return <Button variant="secondary" onClick={() => setOpen(true)}>{t("social.review.reply_action")}</Button>;
  }

  async function submit() {
    if (!text.trim()) return;
    setErr(undefined);
    setBusy(true);
    try {
      const updated = await api.reviews.reply(review.id, { vendor_reply: text.trim() });
      onReplied(updated);
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vc-stack">
      <div className="vc-field">
        <label htmlFor={`reply-${review.id}`} className="vc-field__label">{t("social.review.reply_label")}</label>
        <textarea
          id={`reply-${review.id}`}
          className="soc-reviewform__textarea"
          maxLength={1000}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("social.review.reply_ph")}
        />
      </div>
      {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
      <div className="vc-row">
        <Button variant="secondary" onClick={() => setOpen(false)}>{t("common.close")}</Button>
        <Button loading={busy} onClick={submit}>{t("social.review.reply_submit")}</Button>
      </div>
    </div>
  );
}

/** Vendor "Reviews" (master prompt §22) — every review of this shop, with a real Reply that
 * round-trips `POST /reviews/{id}/reply` (a reply is public and permanent, never a frontend-only
 * echo). Reviews here are read-only otherwise: only moderation (Phase 9's report/hide flow) can
 * remove one, never the vendor themselves. */
export function VendorReviewsScreen() {
  const { t } = useI18n();
  const { api, me } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [next, setNext] = useState(false);
  const [page, setPage] = useState(1);

  const handle = me?.vendor?.handle;

  const load = useCallback((p: number) => {
    if (!handle) return;
    setErr(null);
    api.reviews
      .byVendor(handle, { page: p, page_size: 20 })
      .then((r) => {
        setItems((prev) => (p === 1 || !prev ? r.results : [...prev, ...r.results]));
        setNext(r.next !== null);
        setPage(p);
      })
      .catch(setErr);
  }, [api, handle]);
  useEffect(() => load(1), [load]);

  return (
    <Screen>
      <AppBar title={t("v.shop.reviews")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Loading label={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState icon="star" title={t("social.reviews_empty_title")} message={t("social.reviews_empty_body")} />
      ) : (
        <div className="vc-stack">
          <Card>
            {items.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                footer={<ReplyBox review={r} onReplied={(updated) => setItems((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? null)} />}
              />
            ))}
          </Card>
          {next ? <Button variant="secondary" block onClick={() => load(page + 1)}>{t("common.load_more")}</Button> : null}
        </div>
      )}
    </Screen>
  );
}
