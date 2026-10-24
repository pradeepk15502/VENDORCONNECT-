import { useSession } from "@vc/api-client";
import { LANGUAGES, useI18n } from "@vc/i18n";
import { AppBar, Button, Card, Chip, Icon, Screen } from "@vc/ui";
import { useNavigate } from "react-router-dom";
import type { Place } from "../location";
import type { ActiveRole } from "../../role";

export function ProfileScreen({
  place,
  onChangePlace,
  onSwitchRole,
}: {
  place: Place;
  onChangePlace: () => void;
  onSwitchRole: (role: ActiveRole) => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { me, logout, api } = useSession();
  const nav = useNavigate();

  const changeLang = (code: "en" | "hi") => {
    setLang(code);
    if (me) api.auth.updateMe({ language: code }).catch(() => undefined);
  };

  // Same account, a different mode: skip login when we already have a session (see role.ts / D20).
  function switchToVendor() {
    onSwitchRole("vendor");
    if (!me) { nav("/login"); return; }
    nav(me.vendor ? "/vendor" : "/vendor/setup");
  }

  return (
    <Screen withNav>
      <AppBar title={t("profile.title")} />
      <Card>
        {me ? (
          <div className="vc-row">
            <Icon name="user" size={40} />
            <div>
              <p className="vc-h2" data-testid="profile-name">{me.name || "—"}</p>
              <p className="vc-muted" style={{ margin: 0 }}>{me.phone.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2")}</p>
            </div>
          </div>
        ) : (
          <Button block size="lg" icon="user" onClick={() => nav("/login", { state: { from: "/profile" } })}>{t("auth.send_code")}</Button>
        )}
      </Card>
      <Card className="vc-stack">
        <h2 className="vc-h2">{t("profile.language")}</h2>
        <div className="vc-row">
          {LANGUAGES.map((l) => <Chip key={l.code} selected={lang === l.code} onClick={() => changeLang(l.code)}>{l.native}</Chip>)}
        </div>
      </Card>
      <ul className="c-list">
        <li><button className="c-listbtn" onClick={onChangePlace}><Icon name="pin" /><span>{place.label}</span><Icon name="chevron" /></button></li>
        {me ? (
          <li>
            <button className="c-listbtn" onClick={() => nav("/messages")}>
              <Icon name="chat" /><span>{t("profile.messages")}</span><Icon name="chevron" />
            </button>
          </li>
        ) : null}
        {me ? (
          <li>
            <button className="c-listbtn" onClick={() => nav("/orders")}>
              <Icon name="orders" /><span>{t("profile.orders")}</span><Icon name="chevron" />
            </button>
          </li>
        ) : null}
        {me ? (
          <li>
            <button className="c-listbtn" onClick={() => nav("/addresses")}>
              <Icon name="pin" /><span>{t("profile.addresses")}</span><Icon name="chevron" />
            </button>
          </li>
        ) : null}
        {me ? (
          <li>
            <button className="c-listbtn" onClick={() => nav("/following")}>
              <Icon name="store" /><span>{t("profile.following")}</span><Icon name="chevron" />
            </button>
          </li>
        ) : null}
        {me ? (
          <li>
            <button className="c-listbtn" onClick={() => nav("/reviews")}>
              <Icon name="star" /><span>{t("profile.my_reviews")}</span><Icon name="chevron" />
            </button>
          </li>
        ) : null}
        <li><button className="c-listbtn" disabled><Icon name="shield" /><span>{t("profile.privacy")}</span></button></li>
        <li><button className="c-listbtn" disabled><Icon name="chat" /><span>{t("profile.help")}</span></button></li>
      </ul>
      <Button variant="secondary" block icon="store" onClick={switchToVendor}>
        {me?.vendor ? t("role.switch_to_vendor") : t("role.become_vendor")}
      </Button>
      {me ? <Button variant="secondary" block icon="logout" onClick={() => logout()}>{t("auth.logout")}</Button> : null}
    </Screen>
  );
}
