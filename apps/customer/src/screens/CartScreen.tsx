import { useI18n } from "@vc/i18n";
import { AppBar, Button, EmptyState, Screen } from "@vc/ui";
import { useNavigate } from "react-router-dom";

export function CartScreen() {
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <Screen withNav>
      <AppBar title={t("nav.cart")} />
      <EmptyState icon="cart" title={t("cart.empty")} message={t("cart.empty_body")} action={<Button icon="search" onClick={() => nav("/search")}>{t("nav.search")}</Button>} />
    </Screen>
  );
}
