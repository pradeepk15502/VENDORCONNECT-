import { useSession, type MediaAsset, type Post, type PostKind, type VendorProductItem, POST_KINDS } from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Chip, ErrorState, Icon, Loading, Modal, Screen } from "@vc/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const KIND_LABEL: Record<PostKind, MessageKey> = {
  new_stock: "social.post.kind.new_stock",
  offer: "social.post.kind.offer",
  update: "social.post.kind.update",
  photo: "social.post.kind.photo",
  video: "social.post.kind.video",
};

const MAX_MEDIA = 6;

/** Vendor "Create Post" / edit (master prompt §13/§14) — real media upload (`POST /media`) then
 * `POST /vendors/me/posts`; attaching a real product (`linked_listings`) is how a post stays
 * connected back to real commerce rather than being an Instagram-style photo dump (master
 * prompt's own "VendorConnect is NOT an Instagram clone" rule). Editing an existing post can only
 * change caption/product (`PATCH` never accepts new media — a post's photos are fixed once
 * published), so the media picker and kind selector are create-only. */
export function VendorPostFormScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const fileRef = useRef<HTMLInputElement>(null);

  const [original, setOriginal] = useState<Post | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [products, setProducts] = useState<VendorProductItem[] | null>(null);
  const [kind, setKind] = useState<PostKind>("update");
  const [caption, setCaption] = useState("");
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [listingId, setListingId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.vendorProducts.list({ page_size: 100 }).then((r) => setProducts(r.results)).catch(() => setProducts([]));
  }, [api]);

  const load = useCallback(() => {
    if (!id) return;
    setLoadErr(null);
    api.posts
      .get(id)
      .then((p) => {
        setOriginal(p);
        setCaption(p.caption);
        setListingId(p.linked_listings[0]?.id ?? "");
      })
      .catch(setLoadErr);
  }, [api, id]);
  useEffect(load, [load]);

  async function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadErr(undefined);
    setUploading(true);
    try {
      const room = MAX_MEDIA - media.length;
      const picked = Array.from(files).slice(0, room);
      const uploaded: MediaAsset[] = [];
      for (const file of picked) {
        uploaded.push(await api.media.upload(file));
      }
      setMedia((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setUploadErr(errorMessage(e, t));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeMedia(mediaId: string) {
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));
  }

  async function submitCreate() {
    if (media.length === 0) {
      setFormErr(t("social.composer.media_required"));
      return;
    }
    setFormErr(undefined);
    setBusy(true);
    try {
      await api.posts.mine.create({
        kind,
        caption: caption.trim() || undefined,
        media_asset_ids: media.map((m) => m.id),
        listing_ids: listingId ? [listingId] : undefined,
      });
      nav("/vendor/posts", { replace: true });
    } catch (e) {
      setFormErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit() {
    if (!original || !id) return;
    setFormErr(undefined);
    setBusy(true);
    try {
      await api.posts.update(id, {
        caption: caption.trim(),
        listing_ids: listingId ? [listingId] : [],
      });
      nav("/vendor/posts", { replace: true });
    } catch (e) {
      setFormErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setDeleteBusy(true);
    try {
      await api.posts.remove(id);
      nav("/vendor/posts", { replace: true });
    } catch (e) {
      setConfirmDelete(false);
      setFormErr(errorMessage(e, t));
      setDeleteBusy(false);
    }
  }

  if (editing && loadErr) {
    return <Screen><AppBar title="" onBack={() => nav(-1)} backLabel={t("common.back")} /><ErrorState title={t("common.error_title")} message={errorMessage(loadErr, t)} onRetry={load} retryLabel={t("common.retry")} /></Screen>;
  }
  if (editing && !original) return <Loading label={t("common.loading")} />;

  return (
    <Screen>
      <AppBar title={editing ? t("social.composer.edit_title") : t("social.composer.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      <div className="vc-stack">
        {!editing ? (
          <>
            <div>
              <p className="vc-field__label">{t("social.composer.kind_label")}</p>
              <div className="soc-composer__kindgrid" role="group" aria-label={t("social.composer.kind_label")}>
                {POST_KINDS.map((k) => (
                  <Chip key={k} selected={kind === k} onClick={() => setKind(k)}>{t(KIND_LABEL[k])}</Chip>
                ))}
              </div>
            </div>

            <div>
              <p className="vc-field__label">{t("social.composer.media_label")}</p>
              <div className="soc-composer__mediagrid">
                {media.map((m) => (
                  <div key={m.id} className="soc-composer__thumb">
                    {m.kind === "image" ? <img src={m.variant_urls.thumb ?? m.url} alt="" /> : <span className="soc-postcard__placeholder" aria-hidden="true"><Icon name="camera" size={28} /></span>}
                    <button type="button" className="vc-iconbtn soc-composer__thumb-remove" aria-label={t("social.composer.remove_media")} onClick={() => removeMedia(m.id)}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
                {media.length < MAX_MEDIA ? (
                  <button type="button" className="soc-composer__addmedia" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={t("social.composer.add_media")}>
                    <Icon name={uploading ? "refresh" : "plus"} size={26} />
                  </button>
                ) : null}
              </div>
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => onFilesPicked(e.target.files)} />
              {uploadErr ? <Banner tone="error" icon="alert">{uploadErr}</Banner> : null}
            </div>
          </>
        ) : null}

        <div className="vc-field">
          <label htmlFor="post-caption" className="vc-field__label">{t("social.composer.caption_label")}</label>
          <textarea
            id="post-caption"
            className="soc-composer__textarea"
            maxLength={500}
            rows={4}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("social.composer.caption_ph")}
          />
        </div>

        {products && products.length > 0 ? (
          <div className="vc-field">
            <label htmlFor="post-listing" className="vc-field__label">{t("social.composer.product_label")}</label>
            <div className="vc-field__control">
              <select id="post-listing" value={listingId} onChange={(e) => setListingId(e.target.value)} style={{ width: "100%", height: 48, border: 0, background: "transparent", padding: "0 12px" }}>
                <option value="">{t("social.composer.product_none")}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
        ) : null}

        {formErr ? <Banner tone="error" icon="alert">{formErr}</Banner> : null}

        <Button size="lg" block loading={busy} onClick={editing ? submitEdit : submitCreate}>
          {editing ? t("common.save") : t("social.composer.publish")}
        </Button>

        {editing ? (
          <Button variant="danger" block onClick={() => setConfirmDelete(true)}>{t("social.composer.delete")}</Button>
        ) : null}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("social.composer.delete_confirm_title")} closeLabel={t("common.close")}>
        <p>{t("social.composer.delete_confirm_body")}</p>
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t("common.back")}</Button>
          <Button variant="danger" loading={deleteBusy} onClick={remove}>{t("social.composer.delete")}</Button>
        </div>
      </Modal>
    </Screen>
  );
}
