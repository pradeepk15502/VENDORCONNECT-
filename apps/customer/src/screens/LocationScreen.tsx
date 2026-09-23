import { useI18n } from "@vc/i18n";
import { Banner, Button, Icon, Screen } from "@vc/ui";
import { useState } from "react";
import { CITIES, getGpsPosition, savePlace, type GeoError, type Place } from "../location";

export function LocationScreen({ onDone }: { onDone: (p: Place) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<GeoError | null>(null);
  const [manual, setManual] = useState(false);

  const choose = (p: Place) => {
    savePlace(p);
    onDone(p);
  };

  async function useGps() {
    setBusy(true);
    setErr(null);
    try {
      const p = await getGpsPosition();
      choose({ ...p, label: t("loc.current") });
    } catch (e) {
      setErr(e as GeoError);
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen className="vc-center-screen">
      <div className="c-intro-art" style={{ height: 160 }} aria-hidden="true"><Icon name="pin" size={80} /></div>
      <h1 className="vc-h1">{t("loc.title")}</h1>
      <p style={{ margin: 0 }}>{t("loc.body")}</p>
      {err ? <Banner tone="warn" icon="alert">{t(err === "denied" ? "loc.denied" : "loc.unavailable")}</Banner> : null}
      <Button size="lg" block icon="pin" onClick={useGps} loading={busy}>{t("loc.use_gps")}</Button>
      {!manual ? (
        <Button size="lg" block variant="secondary" onClick={() => setManual(true)}>{t("loc.choose")}</Button>
      ) : (
        <section className="vc-stack" aria-label={t("loc.pick_city")}>
          <h2 className="vc-h2">{t("loc.pick_city")}</h2>
          <ul className="c-list">
            {CITIES.map((c) => (
              <li key={c.label}>
                <button className="c-listbtn" onClick={() => choose(c)}>
                  <Icon name="pin" /> <span>{c.label}</span> <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  );
}
