import type { Post } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { Icon, StatusBadge } from "@vc/ui";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnit } from "../shared/units";
import { timeAgo } from "./socialHelpers";

const KIND_LABEL: Record<Post["kind"], MessageKey> = {
  new_stock: "social.post.kind.new_stock",
  offer: "social.post.kind.offer",
  update: "social.post.kind.update",
  photo: "social.post.kind.photo",
  video: "social.post.kind.video",
};

/** A vendor post — the discovery-feed unit (master prompt §8) and the vendor's own "Posts" tab
 * item (§14). `footer` lets a caller (the vendor's own post-management screen) add Edit/Delete
 * without this component knowing about ownership at all. */
export function PostCard({ post, showVendor = true, footer }: { post: Post; showVendor?: boolean; footer?: ReactNode }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const cover = post.media[0];
  const linked = post.linked_listings[0];

  return (
    <article className="soc-postcard">
      <button type="button" className="soc-postcard__media" onClick={() => nav(`/posts/${post.id}`)} aria-label={t("social.post.open")}>
        {cover ? (
          <img src={cover.variant_urls.medium ?? cover.url} alt="" loading="lazy" />
        ) : (
          <span className="soc-postcard__placeholder" aria-hidden="true"><Icon name="camera" size={32} /></span>
        )}
        <span className="soc-postcard__kind"><StatusBadge kind="info" label={t(KIND_LABEL[post.kind])} size="sm" /></span>
      </button>
      <div className="soc-postcard__body">
        {showVendor ? (
          <button type="button" className="soc-postcard__vendor" onClick={() => nav(`/v/${post.vendor.handle}`)}>
            <Icon name="store" size={18} /> <span>{post.vendor.shop_name}</span>
          </button>
        ) : null}
        {post.caption ? <p className="soc-postcard__caption">{post.caption}</p> : null}
        {linked ? (
          <button type="button" className="soc-postcard__product" onClick={() => nav(`/listings/${linked.id}`)}>
            <span className="soc-postcard__product-name">{linked.name}</span>
            <span className="soc-postcard__product-price">₹{linked.price}/{formatUnit(t, linked.unit, "1")}</span>
            <StatusBadge kind={linked.availability} size="sm" label={t(`avail.${linked.availability}` as MessageKey)} />
          </button>
        ) : null}
        <span className="vc-muted soc-postcard__time">{timeAgo(post.created_at, t, lang)}</span>
        {footer}
      </div>
    </article>
  );
}
