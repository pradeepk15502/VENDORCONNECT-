import { useSession } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { Banner, Button } from "@vc/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

/** Follow/Following toggle (master prompt §4) — the button's own state is never the source of
 * truth: every click calls the real follow/unfollow endpoint and only flips the label once the
 * server confirms it, then reports the fresh `{following, follower_count}` back up via `onChange`
 * so the page showing "245 Followers" stays in sync with the button next to it. */
export function FollowButton({
  handle,
  following,
  onChange,
  size = "md",
}: {
  handle: string;
  following: boolean;
  onChange: (state: { following: boolean; follower_count: number }) => void;
  size?: "md" | "lg";
}) {
  const { t } = useI18n();
  const { api, status } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function toggle() {
    if (status !== "authenticated") {
      nav("/login", { state: { from: `/v/${handle}` } });
      return;
    }
    setErr(undefined);
    setBusy(true);
    try {
      const state = following ? await api.following.unfollow(handle) : await api.following.follow(handle);
      onChange(state);
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="soc-followwrap">
      <Button
        variant={following ? "secondary" : "primary"}
        size={size}
        icon={following ? "check" : "plus"}
        loading={busy}
        aria-pressed={following}
        onClick={toggle}
      >
        {following ? t("social.following") : t("social.follow")}
      </Button>
      {err ? <Banner tone="error" icon="alert">{err}</Banner> : null}
    </div>
  );
}
