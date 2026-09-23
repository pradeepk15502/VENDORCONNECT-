import type {
  Category, LoginResult, Me, OtpSent, VendorCreateInput, VendorOwner, VendorPublic,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() {
    return this.code === "network_error";
  }
  /** First validation message for a field, if any. */
  field(name: string): string | undefined {
    const v = this.details?.[name];
    if (Array.isArray(v)) return String(v[0]);
    if (v && typeof v === "object") return Object.values(v as Record<string, unknown[]>).flat().map(String)[0];
    return typeof v === "string" ? v : undefined;
  }
}

type Listener = (token: string | null) => void;

export interface ApiClientOptions {
  baseUrl?: string; // default: same origin ("/api/v1")
  fetchImpl?: typeof fetch;
}

/**
 * Access token lives only in memory (never localStorage) — ARCHITECTURE D5.
 * The refresh token is an HttpOnly cookie; `restoreSession()` exchanges it for a new access token.
 */
export function createApiClient(opts: ApiClientOptions = {}) {
  const base = (opts.baseUrl ?? "/api/v1").replace(/\/$/, "");
  const f = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let access: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  const listeners = new Set<Listener>();

  const setAccess = (t: string | null) => {
    access = t;
    listeners.forEach((l) => l(t));
  };

  async function raw<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "X-Requested-With": "vendorconnect" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && access) headers.Authorization = `Bearer ${access}`;
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "include",
      });
    } catch {
      throw new ApiError(0, "network_error", "Network unavailable");
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = (data as { error?: { code: string; message: string; details: Record<string, unknown> } })?.error;
      throw new ApiError(res.status, e?.code ?? (res.status >= 500 ? "server_error" : "error"), e?.message ?? res.statusText, e?.details ?? {});
    }
    return data as T;
  }

  async function refresh(): Promise<boolean> {
    if (!refreshing) {
      refreshing = raw<{ access: string }>("POST", "/auth/token/refresh", undefined, false)
        .then((r) => {
          setAccess(r.access);
          return true;
        })
        .catch((e: ApiError) => {
          if (!e.isNetwork) setAccess(null);
          return false;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await raw<T>(method, path, body, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && (await refresh())) {
        return raw<T>(method, path, body, true);
      }
      throw e;
    }
  }

  return {
    get token() {
      return access;
    },
    onTokenChange(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    restoreSession: refresh,
    request,

    auth: {
      requestOtp: (phone: string) => raw<OtpSent>("POST", "/auth/otp/request", { phone }, false),
      verifyOtp: async (input: { phone: string; code: string; name?: string; language?: string; purpose?: "login" | "admin" }) => {
        const r = await raw<LoginResult>("POST", "/auth/otp/verify", input, false);
        setAccess(r.access);
        return r;
      },
      adminPassword: (phone: string, password: string) => raw<OtpSent>("POST", "/auth/admin/password", { phone, password }, false),
      me: () => request<Me>("GET", "/auth/me"),
      updateMe: (patch: Partial<Pick<Me, "name" | "email" | "language">>) => request<Me>("PATCH", "/auth/me", patch),
      logout: async () => {
        try {
          await raw<void>("POST", "/auth/logout", undefined, false);
        } finally {
          setAccess(null);
        }
      },
    },
    catalog: {
      categories: () => raw<Category[]>("GET", "/categories", undefined, false),
    },
    vendors: {
      create: (input: VendorCreateInput) => request<VendorOwner>("POST", "/vendors", input),
      me: () => request<VendorOwner>("GET", "/vendors/me"),
      update: (patch: Partial<Pick<VendorOwner, "shop_name" | "public_phone" | "bio">>) => request<VendorOwner>("PATCH", "/vendors/me", patch),
      setOpen: (is_open: boolean) => request<{ is_open: boolean; status_changed_at: string }>("POST", "/vendors/me/status", { is_open }),
      byHandle: (handle: string) => raw<VendorPublic>("GET", `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}`, undefined, false),
    },
    admin: {
      whoami: () => request<{ id: string; name: string; roles: string[]; permissions: string[] }>("GET", "/admin/whoami"),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
