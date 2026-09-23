import { useI18n } from "@vc/i18n";
import { AppBar, EmptyState, Screen, type IconName } from "@vc/ui";

export function PlaceholderScreen({ title, icon }: { title: string; icon: IconName }) {
  const { t } = useI18n();
  return (
    <Screen withNav>
      <AppBar title={title} />
      <EmptyState icon={icon} title={t("v.soon")} />
    </Screen>
  );
}
