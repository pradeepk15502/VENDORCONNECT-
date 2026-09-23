import { useI18n } from "@vc/i18n";
import { AppBar, EmptyState, Icon, Screen, TextField } from "@vc/ui";
import { useState } from "react";

/* Phase 2 replaces this with product / vendor / @ID search. */
export function SearchScreen() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  return (
    <Screen withNav>
      <AppBar title={t("nav.search")} />
      <TextField label={t("nav.search")} placeholder={t("home.search_ph")} value={q} onChange={(e) => setQ(e.target.value)} type="search" enterKeyHint="search" autoFocus />
      <EmptyState icon="search" title={t("search.coming")} />
      <span className="vc-sr-only"><Icon name="search" /></span>
    </Screen>
  );
}
