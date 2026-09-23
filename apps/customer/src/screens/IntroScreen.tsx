import { useI18n, type MessageKey } from "@vc/i18n";
import { Button, Icon, Screen, type IconName } from "@vc/ui";
import { useState } from "react";

const SLIDES: { icon: IconName; title: MessageKey; body: MessageKey }[] = [
  { icon: "search", title: "onb.1.title", body: "onb.1.body" },
  { icon: "check", title: "onb.2.title", body: "onb.2.body" },
  { icon: "bag", title: "onb.3.title", body: "onb.3.body" },
];

export function IntroScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <Screen className="vc-center-screen">
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onDone}>{t("common.skip")}</Button>
      </div>
      <div className="c-intro-art" aria-hidden="true"><Icon name={s.icon} size={96} /></div>
      <h1 className="vc-h1">{t(s.title)}</h1>
      <p style={{ margin: 0, fontSize: "var(--vc-text-lg)" }}>{t(s.body)}</p>
      <div className="vc-spacer" />
      <div className="c-dots" aria-label={`${i + 1} / ${SLIDES.length}`}>
        {SLIDES.map((_, j) => <span key={j} className={j === i ? "is-on" : ""} />)}
      </div>
      <Button size="lg" block onClick={() => (last ? onDone() : setI(i + 1))}>
        {last ? t("common.continue") : t("common.next")}
      </Button>
    </Screen>
  );
}
