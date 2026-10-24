import { ApiError, useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Icon, Screen, Spinner } from "@vc/ui";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type Step = "idle" | "uploading" | "analyzing" | "error";

/** Vendor "AI Scan Product" (Phase 10, master prompt §3/§4/§21). Picks/captures one photo, uploads
 * it through the existing media pipeline (`POST /media` — no second upload path), then runs a scan
 * (`POST /ai/detections`). A scan almost never fails at the HTTP level — `run_detection()` turns
 * every internal failure (unreadable image, provider error, low/no confidence) into an ordinary
 * successful response with `status: "failed"` or empty predictions, so all of that is rendered on
 * the next screen (`VendorScanConfirmScreen`). This screen only has to handle the failures that
 * happen *before* a detection even exists: the upload itself failing, or the image being rejected
 * (wrong file type, not an image) — and always offers a way out to manual entry, per §21/§35 ("AI
 * must never trap the vendor"). */
export function VendorScanScreen() {
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("idle");
  const [err, setErr] = useState<string>();
  const [lastFile, setLastFile] = useState<File | null>(null);

  async function runScan(file: File) {
    setLastFile(file);
    setErr(undefined);
    setStep("uploading");
    try {
      const asset = await api.media.upload(file);
      setStep("analyzing");
      const detection = await api.ai.detect(asset.id);
      nav(`/vendor/products/scan/${detection.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? errorMessage(e, t) : errorMessage(e, t));
      setStep("error");
    }
  }

  function onPicked(files: FileList | null) {
    const file = files?.[0];
    if (file) void runScan(file);
  }

  const busy = step === "uploading" || step === "analyzing";

  return (
    <Screen>
      <AppBar title={t("v.scan.title")} onBack={() => nav(-1)} backLabel={t("common.back")} />
      <div className="vc-stack v-scan">
        {busy ? (
          <div className="v-scan__busy">
            <Spinner size={40} />
            <p>{t(step === "uploading" ? "v.scan.uploading" : "v.scan.analyzing")}</p>
          </div>
        ) : (
          <>
            <div className="v-scan__hero" aria-hidden="true">
              <Icon name="camera" size={48} />
            </div>
            <p className="v-scan__intro">{t("v.scan.intro")}</p>

            {step === "error" && err ? (
              <Banner tone="error" icon="alert">
                {err}
              </Banner>
            ) : null}

            <Button size="lg" icon="camera" block onClick={() => cameraRef.current?.click()}>
              {t("v.scan.take_photo")}
            </Button>
            <Button size="lg" variant="secondary" block onClick={() => fileRef.current?.click()}>
              {t("v.scan.upload_photo")}
            </Button>
            {step === "error" && lastFile ? (
              <Button variant="secondary" block onClick={() => void runScan(lastFile)}>
                {t("v.scan.try_again")}
              </Button>
            ) : null}

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => onPicked(e.target.files)}
            />
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPicked(e.target.files)} />

            <Button variant="ghost" block onClick={() => nav("/vendor/products/new")}>
              {t("v.scan.add_manually")}
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
