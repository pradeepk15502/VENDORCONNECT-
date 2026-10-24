import { useSession, type Post } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, EmptyState, ErrorState, Icon, Loading, Modal, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { timeAgo } from "../../social/socialHelpers";

const KIND_LABEL: Record<Post["kind"], MessageKey> = {
  new_stock: "social.post.kind.new_stock",
  offer: "social.post.kind.offer",
  update: "social.post.kind.update",
  photo: "social.post.kind.photo",
  video: "social.post.kind.video",
};

function VendorPostRow({ post, onDeleted }: { post: Post; onDeleted: (id: string) => void }) {
  const { t, lang } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const cover = post.media[0];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function remove() {
    setBusy(true);
    setErr(undefined);
    try {
      await api.posts.remove(post.id);
      onDeleted(post.id);
    } catch (e) {
      setErr(errorMessage(e, t));
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Card className="soc-vendorpost">
      <div className="soc-vendorpost__thumb">
        {cover ? <img src={cover.variant_urls.thumb ?? cover.url} alt="" /> : <span className="soc-postcard__placeholder" aria-hidden="true"><Icon name="camera" size={24} /></span>}
      </div>
      <div className="soc-vendorpost__body">
        <StatusBadge kind="info" size="sm" label={t(KIND_LABEL[post.kind])} />
        {post.caption ? <p style={{ margin: 0 }}>{post.caption}</p> : null}
        <span className="vc-muted">{timeAgo(post.created_at, t, lang)} · {t("social.composer.likes", { n: post.like_count })}</span>
        {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
        <div className="soc-vendorpost__actions">
          <Button variant="secondary" icon="pencil" onClick={() => nav(`/vendor/posts/${post.id}/edit`)}>{t("social.composer.edit")}</Button>
          <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>{t("social.composer.delete")}</Button>
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("social.composer.delete_confirm_title")} closeLabel={t("common.close")}>
        <p>{t("social.composer.delete_confirm_body")}</p>
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t("common.back")}</Button>
          <Button variant="danger" loading={busy} onClick={remove}>{t("social.composer.delete")}</Button>
        </div>
      </Modal>
    </Card>
  );
}

/** Vendor "My Posts" (master prompt §14) — every post this vendor has published, newest first,
 * with real Edit/Delete (never a frontend-only fake state — every action round-trips the API). */
export function VendorPostsScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<Post[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [next, setNext] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback((p: number) => {
    setErr(null);
    api.posts.mine
      .list({ page: p, page_size: 20 })
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
      <AppBar
        title={t("v.shop.myposts")}
        onBack={() => nav(-1)}
        backLabel={t("common.back")}
        right={
          <button type="button" className="vc-iconbtn" aria-label={t("v.qa.post")} onClick={() => nav("/vendor/posts/new")}>
            <Icon name="plus" />
          </button>
        }
      />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Loading label={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState icon="share" title={t("social.posts_empty_title")} message={t("social.posts_empty_body")} action={<Button onClick={() => nav("/vendor/posts/new")}>{t("v.qa.post")}</Button>} />
      ) : (
        <div className="vc-stack">
          {items.map((p) => <VendorPostRow key={p.id} post={p} onDeleted={(id) => setItems((prev) => prev?.filter((x) => x.id !== id) ?? null)} />)}
          {next ? <Button variant="secondary" block onClick={() => load(page + 1)}>{t("common.load_more")}</Button> : null}
        </div>
      )}
    </Screen>
  );
}
