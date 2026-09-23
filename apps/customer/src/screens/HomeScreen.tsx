import { useSession, useOnline, type Category } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { EmptyState, ErrorState, Icon, OfflineBanner, Screen, Skeleton, Tile } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Place } from "../location";

export function HomeScreen({ place }: { place: Place }) {
  const { t, lang } = useI18n();
  const { api, me } = useSession();
  const online = useOnline();
  const nav = useNavigate();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(() => {
    setErr(null);
    setCats(null);
    api.catalog.categories().then(setCats).catch(setErr);
  }, [api]);
  useEffect(load, [load]);

  return (
    <Screen withNav>
      <div className="c-header">
        <button className="c-loc" onClick={() => nav("/welcome/location")} aria-label={`${t("loc.title")}: ${place.label}`}>
          <Icon name="pin" size={20} /> {place.label} <Icon name="chevron" size={18} />
        </button>
        <span className="vc-spacer" />
      </div>
      <h1 className="vc-h1">{me?.name ? t("home.hello", { name: me.name.split(" ")[0] }) : t("home.hello_anon")}</h1>
      {!online ? <OfflineBanner label={t("common.offline")} /> : null}

      <button className="c-search" onClick={() => nav("/search")} aria-label={t("nav.search")}>
        <Icon name="search" />
        <span className="c-search__text">{t("home.search_ph")}</span>
        <span className="c-search__cam" aria-label={t("home.scan")} role="img"><Icon name="camera" /></span>
      </button>

      <section className="vc-stack" aria-labelledby="cat-h">
        <h2 id="cat-h" className="vc-h2">{t("home.categories")}</h2>
        {err ? (
          <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={load} retryLabel={t("common.retry")} />
        ) : cats === null ? (
          <Skeleton lines={3} />
        ) : cats.length === 0 ? (
          <EmptyState title={t("vendors.empty")} />
        ) : (
          <div className="vc-grid-3">
            {cats.map((c, i) => (
              <Tile key={c.slug} icon={c.icon} label={c.names_i18n[lang] ?? c.name} tone={i % 4 === 3 ? "orange" : "green"} onClick={() => nav(`/search?category=${c.slug}`)} />
            ))}
          </div>
        )}
      </section>

      <section className="vc-stack" aria-labelledby="near-h">
        <h2 id="near-h" className="vc-h2">{t("home.nearby")}</h2>
        <EmptyState icon="store" title={t("home.nearby_empty")} message={t("home.nearby_soon")} />
      </section>
    </Screen>
  );
}
