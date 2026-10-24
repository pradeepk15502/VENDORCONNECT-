import { ApiError, useSession, type Post } from "@vc/api-client";
import { REPORT_POST_REASONS } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Loading, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FollowButton } from "../../social/FollowButton";
import { ReportDialog } from "../../social/ReportDialog";
import { timeAgo } from "../../social/socialHelpers";
import { formatUnit } from "../../shared/units";

/** Customer Post Detail (master prompt §15) — vendor, media, caption, the attached product (if
 * any) with a real link through to its product page, and Follow/Chat/View Shop actions. */
export function PostDetailScreen() {
  const { postId = "" } = useParams();
  const { t, lang } = useI18n();
  const { api, me, status } = useSession();
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [following, setFollowing] = useState<{ following: boolean; follower_count: number } | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string>();
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    setPost(null);
    setFollowing(null);
    api.posts.get(postId).then(setPost).catch(setErr);
  }, [api, postId]);
  useEffect(load, [load]);
  // The post itself carries no personalized `is_following` — fetch the real current state from
  // the vendor's own profile once we know who the post is from, rather than defaulting to "Follow"
  // for someone who already follows this shop (master prompt §4: state must come from the backend).
  useEffect(() => {
    if (!post) return;
    api.vendors
      .byHandle(post.vendor.handle)
      .then((v) => setFollowing({ following: v.is_following, follower_count: v.follower_count }))
      .catch(() => setFollowing({ following: false, follower_count: 0 }));
  }, [api, post]);

  const isOwnShop = !!post && me?.vendor?.handle === post.vendor.handle;
  const back = () => (window.history.length > 1 ? nav(-1) : nav("/"));

  async function startChat() {
    if (!post) return;
    if (status !== "authenticated") {
      nav("/login", { state: { from: `/posts/${postId}` } });
      return;
    }
    setChatErr(undefined);
    setChatBusy(true);
    try {
      const chat = await api.chats.start(post.vendor.handle);
      nav(`/chat/${chat.id}`);
    } catch (e) {
      setChatErr(errorMessage(e, t));
    } finally {
      setChatBusy(false);
    }
  }

  if (err instanceof ApiError && err.status === 404)
    return <Screen><AppBar title="" onBack={back} /><EmptyState icon="camera" title={t("social.post_gone_title")} message={t("social.post_gone_body")} /></Screen>;
  if (err) return <Screen><AppBar title="" onBack={back} /><ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  if (!post) return <Loading label={t("common.loading")} />;

  const linked = post.linked_listings[0];

  return (
    <Screen>
      <AppBar
        title={post.vendor.shop_name}
        onBack={back}
        backLabel={t("common.back")}
        right={
          <button type="button" className="vc-iconbtn" aria-label={t("social.report.post_action")} onClick={() => setReportOpen(true)}>
            <Icon name="alert" />
          </button>
        }
      />

      {post.media.length > 0 ? (
        <div className="vc-stack">
          {post.media.map((m) => (
            <img key={m.id} src={m.variant_urls.large ?? m.url} alt="" style={{ width: "100%", borderRadius: "var(--vc-radius)", display: "block" }} />
          ))}
        </div>
      ) : null}

      <Card className="vc-stack">
        <button type="button" className="c-listbtn" onClick={() => nav(`/v/${post.vendor.handle}`)}>
          <Icon name="store" />
          <span>{post.vendor.shop_name}</span>
          <StatusBadge kind={post.vendor.is_open ? "open" : "closed"} size="sm" label={post.vendor.is_open ? t("status.open") : t("status.closed")} />
        </button>
        {post.caption ? <p style={{ margin: 0 }}>{post.caption}</p> : null}
        <span className="vc-muted">{timeAgo(post.created_at, t, lang)}</span>
      </Card>

      {linked ? (
        <Card className="vc-stack">
          <div className="c-result__top">
            <span className="c-result__name">{linked.name}</span>
            <span className="c-result__price">₹{linked.price}</span>
          </div>
          <span className="vc-muted">{formatUnit(t, linked.unit, linked.unit_quantity)}</span>
          <StatusBadge kind={linked.availability} size="sm" label={t(`avail.${linked.availability}` as MessageKey)} />
          <Button variant="secondary" icon="box" onClick={() => nav(`/listings/${linked.id}`)}>{t("social.view_product")}</Button>
        </Card>
      ) : null}

      {chatErr ? <Banner tone="error" icon="alert">{chatErr}</Banner> : null}
      {!isOwnShop ? (
        <div className="vc-grid-3">
          {following ? (
            <FollowButton handle={post.vendor.handle} following={following.following} onChange={setFollowing} />
          ) : (
            <Button variant="secondary" icon="plus" disabled>{t("social.follow")}</Button>
          )}
          <Button variant="accent" icon="chat" loading={chatBusy} onClick={startChat}>{t("v.chat")}</Button>
          <Button variant="secondary" icon="store" onClick={() => nav(`/v/${post.vendor.handle}`)}>{t("social.view_shop")}</Button>
        </div>
      ) : null}

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t("social.report.post_title")}
        reasons={REPORT_POST_REASONS.map((r) => ({ value: r, label: t(`social.report.reason.${r}` as MessageKey) }))}
        onSubmit={(reason, details) => api.posts.report(post.id, { reason, details })}
      />
    </Screen>
  );
}
