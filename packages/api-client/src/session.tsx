import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ApiClient } from "./client";
import type { Me } from "./types";

type Status = "restoring" | "anonymous" | "authenticated";
type SessionCtx = { api: ApiClient; status: Status; me: Me | null; setMe: (m: Me | null) => void; reloadMe: () => Promise<Me | null>; logout: () => Promise<void> };
const Ctx = createContext<SessionCtx | null>(null);

/** Restores the session from the refresh cookie on start-up, then loads /auth/me. */
export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("restoring");
  const [me, setMe] = useState<Me | null>(null);

  const reloadMe = useCallback(async () => {
    try {
      const m = await api.auth.me();
      setMe(m);
      setStatus("authenticated");
      return m;
    } catch {
      setMe(null);
      setStatus("anonymous");
      return null;
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    api.restoreSession().then((ok) => {
      if (!alive) return;
      if (ok) reloadMe();
      else setStatus("anonymous");
    });
    const off = api.onTokenChange((t) => {
      if (!t) {
        setMe(null);
        setStatus("anonymous");
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [api, reloadMe]);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setMe(null);
    setStatus("anonymous");
  }, [api]);

  const set = useCallback((m: Me | null) => {
    setMe(m);
    setStatus(m ? "authenticated" : "anonymous");
  }, []);

  return <Ctx.Provider value={{ api, status, me, setMe: set, reloadMe, logout }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession must be used inside <SessionProvider>");
  return c;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
