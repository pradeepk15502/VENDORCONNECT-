import { useSession, type AddressItem } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, EmptyState, ErrorState, Icon, Modal, Screen, Skeleton, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export function AddressBookScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const [items, setItems] = useState<AddressItem[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [actionErr, setActionErr] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<AddressItem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null);
    api.addresses.list().then(setItems).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  async function remove(item: AddressItem) {
    setBusy(true);
    setActionErr(undefined);
    try {
      await api.addresses.remove(item.id);
      setConfirmDelete(null);
      load();
    } catch (e) {
      setActionErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <AppBar title={t("addr.title")} onBack={() => nav(-1)} backLabel={t("common.back")} right={
        <button className="vc-iconbtn" onClick={() => nav("/addresses/new")} aria-label={t("addr.add")}><Icon name="plus" /></button>
      } />
      {actionErr ? <Banner tone="error" icon="alert">{actionErr}</Banner> : null}
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={3} />
      ) : items.length === 0 ? (
        <EmptyState icon="pin" title={t("addr.empty_title")} message={t("addr.empty_body")} action={<Button icon="plus" onClick={() => nav("/addresses/new")}>{t("addr.add")}</Button>} />
      ) : (
        <ul className="vc-list">
          {items.map((a) => (
            <li key={a.id}>
              <div className="c-addr-card">
                <div className="c-addr-card__text">
                  <span className="c-addr-card__label">
                    <Icon name="pin" size={18} />
                    {a.label || t("addr.title")}
                    {a.is_default ? <StatusBadge kind="verified" size="sm" label={t("addr.default_badge")} /> : null}
                  </span>
                  <span className="c-addr-card__body">{[a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(", ")}</span>
                  {a.lat === null ? <span className="c-addr-card__body vc-muted">{t("addr.no_location_hint")}</span> : null}
                </div>
                <div className="c-addr-card__actions">
                  <button className="vc-iconbtn" onClick={() => nav(`/addresses/${a.id}/edit`)} aria-label={t("addr.edit")}><Icon name="pencil" size={18} /></button>
                  <button className="vc-iconbtn" onClick={() => setConfirmDelete(a)} aria-label={t("addr.delete")}><Icon name="trash" size={18} /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={t("addr.delete_confirm_title")} closeLabel={t("common.close")}>
        <p>{t("addr.delete_confirm_body")}</p>
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>{t("common.close")}</Button>
          <Button variant="danger" loading={busy} onClick={() => confirmDelete && remove(confirmDelete)}>{t("addr.delete")}</Button>
        </div>
      </Modal>
    </Screen>
  );
}
