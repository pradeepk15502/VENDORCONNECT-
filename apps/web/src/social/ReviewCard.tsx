import type { ReviewItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { Icon, StatusBadge } from "@vc/ui";
import type { ReactNode } from "react";
import { RatingStars } from "./RatingStars";
import { timeAgo } from "./socialHelpers";

/** One review (master prompt §21) — rating, reviewer, time-ago, "✓ Verified Purchase" when it's
 * backed by a real completed order, and the vendor's own reply if there is one. `footer` lets a
 * caller add a "Reply"/"Report" action without this component knowing who's viewing it. */
export function ReviewCard({ review, footer }: { review: ReviewItem; footer?: ReactNode }) {
  const { t, lang } = useI18n();
  return (
    <article className="soc-review">
      <div className="soc-review__head">
        <div>
          <p className="soc-review__author">{review.author_name}</p>
          <RatingStars value={review.rating} size={16} label={t("social.review.rating_label", { n: review.rating })} />
        </div>
        <span className="vc-muted soc-review__time">{timeAgo(review.created_at, t, lang)}</span>
      </div>
      {review.verified_purchase ? <StatusBadge kind="verified" size="sm" label={t("social.review.verified")} /> : null}
      {review.text ? <p className="soc-review__text">{review.text}</p> : null}
      {review.listing ? <p className="vc-muted soc-review__listing"><Icon name="box" size={16} /> {review.listing.name}</p> : null}
      {review.vendor_reply ? (
        <div className="soc-review__reply">
          <p className="soc-review__reply-label">{t("social.review.vendor_reply_label")}</p>
          <p style={{ margin: 0 }}>{review.vendor_reply}</p>
        </div>
      ) : null}
      {footer}
    </article>
  );
}
