import { useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { Banner, Button, Icon, Screen } from "@vc/ui";
import { useState } from "react";

export const customerShopUrl = (handle: string) => `${import.meta.env.VITE_CUSTOMER_URL ?? window.location.origin}/v/${handle}`;

export function VendorIdScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const [copied, setCopied] = useState(false);
  const handle = me?.vendor?.handle ?? "";

  async function share() {
    const url = customerShopUrl(handle);
    const text = `${me?.vendor?.shop_name} — @${handle} on VendorConnect`;
    try {
      if (navigator.share) await navigator.share({ title: text, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setCopied(true);
      }
    } catch {
      /* user cancelled */
    }
  }

  return (
    <Screen className="vc-center-screen">
      <h1 className="vc-h1">{t("v.id.title")}</h1>
      <p style={{ margin: 0 }}>{t("v.id.body")}</p>
      <div className="v-idcard">
        <Icon name="store" size={48} />
        <span style={{ fontSize: "var(--vc-text-lg)", fontWeight: 650 }}>{me?.vendor?.shop_name}</span>
        <span className="v-idcard__id" data-testid="vendor-id">@{handle}</span>
      </div>
      {copied ? <Banner tone="success" icon="check">{t("v.id.copied")}</Banner> : null}
      <div className="vc-spacer" />
      <Button size="lg" block variant="secondary" icon="share" onClick={share}>{t("v.id.share")}</Button>
      <Button size="lg" block onClick={onDone}>{t("v.id.go")}</Button>
    </Screen>
  );
}
