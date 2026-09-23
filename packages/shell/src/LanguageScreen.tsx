import { LANGUAGES, useI18n, type Lang } from "@vc/i18n";
import { Button, Icon, Screen } from "@vc/ui";
import { useState } from "react";

export function LanguageScreen({ onDone, brand }: { onDone: () => void; brand: string }) {
  const { lang, setLang, t } = useI18n();
  const [sel, setSel] = useState<Lang>(lang);
  return (
    <Screen className="vc-center-screen">
      <div className="vc-brand">
        <span className="vc-brand__mark"><Icon name="store" size={36} /></span>
        <span className="vc-brand__name">{brand}</span>
      </div>
      <h1 className="vc-h1">{t("lang.title")}</h1>
      <p className="vc-muted" style={{ margin: 0 }}>Choose your language · अपनी भाषा चुनें</p>
      <div className="vc-stack" role="radiogroup" aria-label={t("lang.title")}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            role="radio"
            aria-checked={sel === l.code}
            className={`vc-langopt ${sel === l.code ? "is-selected" : ""}`}
            onClick={() => {
              setSel(l.code);
              setLang(l.code);
            }}
          >
            <span className="vc-langopt__native">{l.native}</span>
            <span className="vc-langopt__label">{l.label}</span>
            {sel === l.code ? <Icon name="check" /> : null}
          </button>
        ))}
      </div>
      <div className="vc-spacer" />
      <Button size="lg" block onClick={() => { setLang(sel); onDone(); }}>{t("common.continue")}</Button>
      <p className="vc-muted" style={{ margin: 0, textAlign: "center", fontSize: "var(--vc-text-sm)" }}>{t("lang.subtitle")}</p>
    </Screen>
  );
}
