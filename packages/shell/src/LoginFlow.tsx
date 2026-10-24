import { ApiError, useSession, type LoginResult } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { AppBar, Banner, Button, Icon, OtpInput, Screen, TextField } from "@vc/ui";
import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "./errors";

const isValidIndianMobile = (v: string) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, "").slice(-10)) && v.replace(/\D/g, "").length >= 10;

/** Phone → OTP. Used by customer and vendor apps (and admin step 2 via `purpose="admin"`). */
export function LoginFlow({
  onSuccess,
  onBack,
  askName = true,
  title,
  preSent,
  purpose = "login",
}: {
  onSuccess: (r: LoginResult) => void;
  onBack?: () => void;
  askName?: boolean;
  title?: string;
  preSent?: { phone: string; devOtp?: string; resendAfter: number };
  purpose?: "login" | "admin";
}) {
  const { t, lang } = useI18n();
  const { api, setMe } = useSession();
  const [step, setStep] = useState<"phone" | "otp">(preSent ? "otp" : "phone");
  const [phone, setPhone] = useState(preSent?.phone ?? "");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | undefined>(preSent?.devOtp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [cooldown, setCooldown] = useState(preSent?.resendAfter ?? 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const digits = phone.replace(/\D/g, "").slice(-10);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError(undefined);
    if (!isValidIndianMobile(phone)) {
      setError(t("auth.err.phone"));
      return;
    }
    setBusy(true);
    try {
      const r = await api.auth.requestOtp(digits);
      setDevOtp(r.dev_otp);
      setCooldown(r.resend_after);
      setCode("");
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? t("auth.err.phone") : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.auth.verifyOtp({ phone: digits, code, name: name.trim() || undefined, language: lang, purpose });
      setMe(r.user);
      onSuccess(r);
    } catch (err) {
      setError(errorMessage(err, t));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step === "otp" && code.length === 6 && !busy) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (step === "phone") {
    return (
      <Screen>
        <AppBar title="" onBack={onBack} backLabel={t("common.back")} />
        <form className="vc-stack" onSubmit={send} noValidate>
          <span className="vc-icon-badge" aria-hidden="true"><Icon name="phone" size={30} /></span>
          <h1 className="vc-h1">{title ?? t("auth.login_title")}</h1>
          <p className="vc-muted" style={{ margin: 0 }}>{t("auth.login_body")}</p>
          <TextField
            label={t("auth.phone")}
            prefix="+91"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={error}
            autoFocus
            name="phone"
          />
          {askName ? <TextField label={t("auth.name")} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} name="name" /> : null}
          <Button type="submit" size="lg" block loading={busy}>{t("auth.send_code")}</Button>
          <p className="vc-finePrint">{t("auth.disclaimer")}</p>
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar title="" onBack={() => { setStep("phone"); setError(undefined); }} backLabel={t("auth.change_number")} />
      <form className="vc-stack" onSubmit={verify} noValidate>
        <span className="vc-icon-badge" aria-hidden="true"><Icon name="shield" size={30} /></span>
        <h1 className="vc-h1">{t("auth.otp_title")}</h1>
        <p className="vc-muted" style={{ margin: 0 }}>{t("auth.otp_body", { phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` })}</p>
        {devOtp ? <Banner tone="info" icon="shield"><span data-testid="dev-otp">{t("auth.dev_code", { code: devOtp })}</span></Banner> : null}
        <OtpInput label={t("auth.otp_label")} value={code} onChange={setCode} error={error} autoFocus />
        <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>{t("auth.verify")}</Button>
        <Button type="button" variant="ghost" block disabled={cooldown > 0 || busy} onClick={() => send()}>
          {cooldown > 0 ? t("auth.resend_in", { s: cooldown }) : t("auth.resend")}
        </Button>
      </form>
    </Screen>
  );
}
