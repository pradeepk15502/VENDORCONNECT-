import { useI18n } from "@vc/i18n";
import { AppBar, EmptyState, Screen } from "@vc/ui";

export function VendorsScreen() {
  const { t } = useI18n();
  return (
    <Screen withNav>
      <AppBar title={t("nav.vendors")} />
      <EmptyState icon="store" title={t("home.nearby_empty")} message={t("home.nearby_soon")} />
    </Screen>
  );
}
