import type {
  AddressInput, AddressItem, AdminCategoryItem, AdminDashboard, AdminDashboardParams, AdminListingItem,
  AdminListingListParams, AdminOrderListItem, AdminOrderListParams, AdminPostItem, AdminReportItem, AdminReviewItem,
  AdminUserDetail, AdminUserListItem, AdminUserListParams, AdminUserSuspendInput, AdminVendorDetail,
  AdminVendorListItem, AdminVendorListParams, AdminVendorSuspendInput, AdminVendorVerifyInput,
  AIDetection, AIDetectionListItem, AIDetectionStatus, AuditLogItem, AuditLogListParams,
  CartAddInput, CartItem, CartUpdateInput,
  Category, CheckoutInput, CheckoutSummary, CheckoutSummaryParams, ChatItem, ChatListParams, ChatMessage,
  DeliverySettings, FollowedVendorItem, FollowState, InventoryUpdateInput, ListingDetail, LoginResult, Me, MediaAsset,
  MessagePage, MyReviewItem, NotificationPage, OrderDetail, OrderListParams, OrderTransitionInput, OtpSent,
  Paginated, Post, PostCreateInput, PostUpdateInput, PriceUpdateInput, QuickReplyItem, ReportChatInput, ReportInput,
  ReportResolveInput, ReportStatus, ReportTargetType, ReviewCreateInput, ReviewItem, ReviewReplyInput, SearchParams,
  SearchResultItem, SendMessageInput, VendorCreateInput, VendorListItem, VendorListParams, VendorOwner,
  VendorProductCreateInput, VendorProductItem, VendorProductListParams, VendorProductPublicItem,
  VendorProductUpdateInput, VendorPublic, VendorSummary,
} from "./types";

/** Builds a `?a=1&b=2` query string, dropping undefined/empty/false values (filters are opt-in —
 * a `false` toggle means "don't filter," same as leaving it out). */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

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

  /** Multipart upload (`POST /media`, Phase 9) — separate from `raw`/`request` because a file body
   * must NOT get the `Content-Type: application/json` header those set: the browser needs to set
   * its own `multipart/form-data; boundary=...` from the FormData object. Same auth/401-refresh
   * handling as `request`, just a different body encoding. */
  async function rawUpload<T>(path: string, file: File, auth: boolean): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "X-Requested-With": "vendorconnect" };
    if (auth && access) headers.Authorization = `Bearer ${access}`;
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await f(`${base}${path}`, { method: "POST", headers, body: form, credentials: "include" });
    } catch {
      throw new ApiError(0, "network_error", "Network unavailable");
    }
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

  async function uploadFile<T>(path: string, file: File): Promise<T> {
    try {
      return await rawUpload<T>(path, file, true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && (await refresh())) {
        return rawUpload<T>(path, file, true);
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
      search: (params: SearchParams) =>
        raw<Paginated<SearchResultItem>>(
          "GET",
          `/search${qs({
            q: params.q,
            lat: params.lat,
            lng: params.lng,
            category: params.category,
            radius_km: params.radius_km,
            in_stock_only: params.in_stock_only,
            open_now: params.open_now,
            delivery: params.delivery,
            pickup: params.pickup,
            price_min: params.price_min,
            price_max: params.price_max,
            page: params.page,
            page_size: params.page_size,
          })}`,
          undefined,
          false,
        ),
    },
    vendors: {
      create: (input: VendorCreateInput) => request<VendorOwner>("POST", "/vendors", input),
      me: () => request<VendorOwner>("GET", "/vendors/me"),
      summary: () => request<VendorSummary>("GET", "/vendors/me/summary"),
      update: (patch: Partial<Pick<VendorOwner, "shop_name" | "public_phone" | "bio">>) => request<VendorOwner>("PATCH", "/vendors/me", patch),
      setOpen: (is_open: boolean) => request<{ is_open: boolean; status_changed_at: string }>("POST", "/vendors/me/status", { is_open }),
      /** Public profile — no login required to view a shop (D17) — but sent through `request()`,
       * not a bare unauthenticated `raw`, so a signed-in customer's real `is_following` state comes
       * back correctly (Phase 9). `request()` degrades to a plain public call automatically when
       * there's no session: with no in-memory access token, `raw` never attaches an auth header. */
      byHandle: (handle: string) => request<VendorPublic>("GET", `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}`),
      near: (params: VendorListParams) =>
        raw<Paginated<VendorListItem>>(
          "GET",
          `/vendors${qs({
            lat: params.lat,
            lng: params.lng,
            category: params.category,
            radius_km: params.radius_km,
            open_now: params.open_now,
            delivery: params.delivery,
            pickup: params.pickup,
            page: params.page,
            page_size: params.page_size,
          })}`,
          undefined,
          false,
        ),
      /** The vendor profile's public "Products" tab (Phase 8) — no auth required. */
      products: (handle: string, params: { page?: number; page_size?: number } = {}) =>
        raw<Paginated<VendorProductPublicItem>>(
          "GET",
          `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/products${qs({ page: params.page, page_size: params.page_size })}`,
          undefined,
          false,
        ),
      /** `{delivery_enabled, pickup_enabled, radius_km, min_order_amount, delivery_fee, free_delivery_above}`, all optional. */
      updateDelivery: (patch: Partial<{
        delivery_enabled: boolean; pickup_enabled: boolean; radius_km: string | number;
        min_order_amount: string | number; delivery_fee: string | number; free_delivery_above: string | number | null;
      }>) => request<DeliverySettings>("PATCH", "/vendors/me/delivery", patch),
    },
    admin: {
      whoami: () => request<{ id: string; name: string; roles: string[]; permissions: string[] }>("GET", "/admin/whoami"),
      /** Phase 10 §25/§32: minimal operational visibility, not a second product database — the
       * same read-only, filterable list shape `moderation.reports.list()` already established. */
      aiDetections: {
        list: (params: { status?: AIDetectionStatus; vendor?: string; page?: number; page_size?: number } = {}) =>
          request<Paginated<AIDetectionListItem>>(
            "GET",
            `/admin/ai/detections${qs({ status: params.status, vendor: params.vendor, page: params.page, page_size: params.page_size })}`,
          ),
      },
      /* --- Phase 11: admin back-office (ARCHITECTURE D32) --------------------------------------- */
      /** Every figure is a live DB aggregate for the requested `range`/`date_from`/`date_to` window
       * — nothing here is cached or estimated client-side. */
      dashboard: (params: AdminDashboardParams = {}) =>
        request<AdminDashboard>(
          "GET",
          `/admin/dashboard${qs({ range: params.range, date_from: params.date_from, date_to: params.date_to })}`,
        ),
      /** Read-only viewer over the append-only `AuditLog` trail — no admin API path can edit or
       * delete a row (master prompt §15: append-only from the admin UI's perspective). */
      auditLogs: {
        list: (params: AuditLogListParams = {}) =>
          request<Paginated<AuditLogItem>>(
            "GET",
            `/admin/audit-logs${qs({
              action: params.action,
              actor: params.actor,
              target_type: params.target_type,
              target_id: params.target_id,
              date_from: params.date_from,
              date_to: params.date_to,
              page: params.page,
              page_size: params.page_size,
            })}`,
          ),
      },
      users: {
        list: (params: AdminUserListParams = {}) =>
          request<Paginated<AdminUserListItem>>(
            "GET",
            `/admin/users${qs({ q: params.q, role: params.role, is_active: params.is_active, page: params.page, page_size: params.page_size })}`,
          ),
        get: (id: string) => request<AdminUserDetail>("GET", `/admin/users/${encodeURIComponent(id)}`),
        /** Requires `accounts.manage_users` server-side; rejects suspending your own account. */
        suspend: (id: string, input: AdminUserSuspendInput) =>
          request<AdminUserDetail>("POST", `/admin/users/${encodeURIComponent(id)}/suspend`, input),
        restore: (id: string) => request<AdminUserDetail>("POST", `/admin/users/${encodeURIComponent(id)}/restore`),
      },
      vendors: {
        list: (params: AdminVendorListParams = {}) =>
          request<Paginated<AdminVendorListItem>>(
            "GET",
            `/admin/vendors${qs({
              q: params.q,
              status: params.status,
              verification_status: params.verification_status,
              category: params.category,
              page: params.page,
              page_size: params.page_size,
            })}`,
          ),
        get: (handle: string) => request<AdminVendorDetail>("GET", `/admin/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}`),
        /** Requires `vendors.verify_vendor` server-side; writes a real `VendorVerification` row. */
        verify: (handle: string, input: AdminVendorVerifyInput) =>
          request<AdminVendorDetail>("POST", `/admin/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/verify`, input),
        /** Requires `vendors.suspend_vendor` server-side. */
        suspend: (handle: string, input: AdminVendorSuspendInput) =>
          request<AdminVendorDetail>("POST", `/admin/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/suspend`, input),
        restore: (handle: string) =>
          request<AdminVendorDetail>("POST", `/admin/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/restore`),
      },
      /** Cross-vendor listing visibility — read-only, no write path to a vendor's own price/stock. */
      products: {
        list: (params: AdminListingListParams = {}) =>
          request<Paginated<AdminListingItem>>(
            "GET",
            `/admin/products${qs({
              q: params.q,
              category: params.category,
              vendor: params.vendor,
              status: params.status,
              availability: params.availability,
              page: params.page,
              page_size: params.page_size,
            })}`,
          ),
      },
      /** Not paginated — a small, fixed taxonomy, same as the public `/categories` endpoint. */
      categories: {
        list: () => request<AdminCategoryItem[]>("GET", "/admin/categories"),
      },
      /** Read-only order visibility — no refund/payment action lives here. */
      orders: {
        list: (params: AdminOrderListParams = {}) =>
          request<Paginated<AdminOrderListItem>>(
            "GET",
            `/admin/orders${qs({ q: params.q, status: params.status, fulfilment: params.fulfilment, page: params.page, page_size: params.page_size })}`,
          ),
        /** Reuses the same `OrderDetail` shape the customer/vendor sides already see. */
        get: (id: string) => request<OrderDetail>("GET", `/admin/orders/${encodeURIComponent(id)}`),
      },
    },
    vendorProducts: {
      list: (params: VendorProductListParams = {}) =>
        request<Paginated<VendorProductItem>>(
          "GET",
          `/vendor-products${qs({ status: params.status, category: params.category, availability: params.availability, page: params.page, page_size: params.page_size })}`,
        ),
      create: (input: VendorProductCreateInput) => request<VendorProductItem>("POST", "/vendor-products", input),
      get: (id: string) => request<VendorProductItem>("GET", `/vendor-products/${encodeURIComponent(id)}`),
      update: (id: string, patch: VendorProductUpdateInput) => request<VendorProductItem>("PATCH", `/vendor-products/${encodeURIComponent(id)}`, patch),
      remove: (id: string) => request<void>("DELETE", `/vendor-products/${encodeURIComponent(id)}`),
    },
    inventory: {
      update: (input: InventoryUpdateInput) => request<VendorProductItem>("POST", "/inventory", input),
    },
    prices: {
      update: (input: PriceUpdateInput) => request<VendorProductItem>("POST", "/prices", input),
    },
    /* --- Phase 10: AI-assisted product entry — advisory only, never auto-publishing (docs/AI.md) */
    ai: {
      /** Runs a scan (barcode + OCR + taxonomy match) against an already-uploaded image. Never
       * publishes anything — see `confirm()`. */
      detect: (imageId: string) => request<AIDetection>("POST", "/ai/detections", { image_id: imageId }),
      get: (id: string) => request<AIDetection>("GET", `/ai/detections/${encodeURIComponent(id)}`),
      /** The vendor's final, possibly-edited values — same shape as `vendorProducts.create()`.
       * Reuses that exact creation path server-side; this is the only call that ever writes a
       * listing from a scan (master prompt §17: "the AI must never automatically publish"). */
      confirm: (id: string, input: VendorProductCreateInput) =>
        request<VendorProductItem>("POST", `/ai/detections/${encodeURIComponent(id)}/confirm`, input),
      history: (params: { page?: number; page_size?: number } = {}) =>
        request<Paginated<AIDetectionListItem>>(
          "GET",
          `/vendors/me/ai-detections${qs({ page: params.page, page_size: params.page_size })}`,
        ),
    },
    chats: {
      list: (params: ChatListParams) =>
        request<Paginated<ChatItem>>(
          "GET",
          `/chats${qs({ role: params.role, q: params.q, page: params.page, page_size: params.page_size })}`,
        ),
      /** Starts (or reopens, idempotently) a conversation with a vendor, as the calling customer. */
      start: (vendorHandle: string) => request<ChatItem>("POST", "/chats", { vendor: vendorHandle }),
      get: (chatId: string) => request<ChatItem>("GET", `/chats/${encodeURIComponent(chatId)}`),
      /** `after` (short polling for new messages) and `before` (loading older history) are mutually
       * exclusive cursors — pass only one. */
      messages: (chatId: string, params: { before?: number; after?: number } = {}) =>
        request<MessagePage>(
          "GET",
          `/chats/${encodeURIComponent(chatId)}/messages${qs({ before: params.before, after: params.after })}`,
        ),
      send: (chatId: string, input: SendMessageInput) =>
        request<ChatMessage>("POST", `/chats/${encodeURIComponent(chatId)}/messages`, input),
      markRead: (chatId: string) => request<void>("POST", `/chats/${encodeURIComponent(chatId)}/read`),
      block: (chatId: string) => request<void>("POST", `/chats/${encodeURIComponent(chatId)}/block`),
      unblock: (chatId: string) => request<void>("POST", `/chats/${encodeURIComponent(chatId)}/unblock`),
      report: (chatId: string, input: ReportChatInput) =>
        request<{ status: string }>("POST", `/chats/${encodeURIComponent(chatId)}/report`, input),
    },
    quickReplies: {
      list: () => request<QuickReplyItem[]>("GET", "/vendors/me/quick-replies"),
      create: (text: string) => request<QuickReplyItem>("POST", "/vendors/me/quick-replies", { text }),
      remove: (id: number) => request<void>("DELETE", `/vendors/me/quick-replies/${id}`),
    },
    addresses: {
      list: () => request<AddressItem[]>("GET", "/addresses"),
      create: (input: AddressInput) => request<AddressItem>("POST", "/addresses", input),
      get: (id: string) => request<AddressItem>("GET", `/addresses/${encodeURIComponent(id)}`),
      update: (id: string, patch: AddressInput) => request<AddressItem>("PATCH", `/addresses/${encodeURIComponent(id)}`, patch),
      remove: (id: string) => request<void>("DELETE", `/addresses/${encodeURIComponent(id)}`),
    },
    cart: {
      list: () => request<CartItem[]>("GET", "/cart"),
      /** Adds a listing, or increases its quantity if it's already in the cart (200 vs 201). */
      add: (input: CartAddInput) => request<CartItem>("POST", "/cart", input),
      update: (itemId: string, input: CartUpdateInput) => request<CartItem>("PATCH", `/cart/items/${encodeURIComponent(itemId)}`, input),
      remove: (itemId: string) => request<void>("DELETE", `/cart/items/${encodeURIComponent(itemId)}`),
    },
    checkout: {
      /** Live totals for one vendor's cart items — no side effects; call again whenever
       * fulfilment/address changes so the screen always shows current numbers. */
      summary: (params: CheckoutSummaryParams) =>
        request<CheckoutSummary>(
          "GET",
          `/checkout/summary${qs({ vendor: params.vendor, fulfilment: params.fulfilment, address_id: params.address_id })}`,
        ),
      /** Revalidates stock/price/eligibility inside one transaction, then creates the order.
       * Throws ApiError with codes like `cart_changed`/`items_unavailable`/`delivery_ineligible`
       * (see docs/API.md) — the caller re-fetches `summary()` and shows what changed. */
      submit: (input: CheckoutInput) => request<OrderDetail>("POST", "/checkout", input),
    },
    orders: {
      list: (params: OrderListParams) =>
        request<Paginated<OrderDetail>>(
          "GET",
          `/orders${qs({ role: params.role, status: params.status, page: params.page, page_size: params.page_size })}`,
        ),
      get: (id: string) => request<OrderDetail>("GET", `/orders/${encodeURIComponent(id)}`),
      transition: (id: string, input: OrderTransitionInput) => request<OrderDetail>("POST", `/orders/${encodeURIComponent(id)}/transition`, input),
      /** Only for a completed order the caller is the customer on (master prompt §17) — the server
       * re-checks all of that; this never trusts anything the client claims. */
      review: (id: string, input: ReviewCreateInput) => request<ReviewItem>("POST", `/orders/${encodeURIComponent(id)}/reviews`, input),
    },
    notifications: {
      list: (params: { page?: number; page_size?: number } = {}) =>
        request<NotificationPage>("GET", `/notifications${qs({ page: params.page, page_size: params.page_size })}`),
      markRead: (id: string) => request<void>("POST", `/notifications/${encodeURIComponent(id)}/read`),
      markAllRead: () => request<void>("POST", "/notifications/read-all"),
    },
    /* --- Phase 9: media, following, feed, posts, reviews, reports, moderation ------------------ */
    media: {
      /** Real Pillow-validated processing server-side (never trusts the file's declared MIME
       * type/extension) — see ARCHITECTURE D30. Images come back with 3 resized WebP variants;
       * video is stored as-is (documented limitation, no transcoding infrastructure yet). */
      upload: (file: File) => uploadFile<MediaAsset>("/media", file),
    },
    following: {
      list: (params: { lat?: number; lng?: number; page?: number; page_size?: number } = {}) =>
        request<Paginated<FollowedVendorItem>>(
          "GET",
          `/following${qs({ lat: params.lat, lng: params.lng, page: params.page, page_size: params.page_size })}`,
        ),
      follow: (handle: string) => request<FollowState>("POST", `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/follow`),
      unfollow: (handle: string) => request<FollowState>("POST", `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/unfollow`),
    },
    feed: {
      /** "From Shops You Follow" (master prompt §8/§30) — real posts only, empty (not an error) for
       * a customer following nobody yet. */
      list: (params: { page?: number; page_size?: number } = {}) =>
        request<Paginated<Post>>("GET", `/feed${qs({ page: params.page, page_size: params.page_size })}`),
    },
    posts: {
      mine: {
        list: (params: { page?: number; page_size?: number } = {}) =>
          request<Paginated<Post>>("GET", `/vendors/me/posts${qs({ page: params.page, page_size: params.page_size })}`),
        create: (input: PostCreateInput) => request<Post>("POST", "/vendors/me/posts", input),
      },
      /** The profile's "Posts" tab (master prompt §14) — public, published-only. */
      byVendor: (handle: string, params: { page?: number; page_size?: number } = {}) =>
        raw<Paginated<Post>>(
          "GET",
          `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/posts${qs({ page: params.page, page_size: params.page_size })}`,
          undefined,
          false,
        ),
      /** The post detail screen (master prompt §15) — public for a published post; no personalized
       * field depends on the viewer, so this stays a plain unauthenticated public call. */
      get: (id: string) => raw<Post>("GET", `/posts/${encodeURIComponent(id)}`, undefined, false),
      update: (id: string, patch: PostUpdateInput) => request<Post>("PATCH", `/posts/${encodeURIComponent(id)}`, patch),
      remove: (id: string) => request<void>("DELETE", `/posts/${encodeURIComponent(id)}`),
      report: (id: string, input: ReportInput) => request<{ status: string }>("POST", `/posts/${encodeURIComponent(id)}/report`, input),
    },
    reviews: {
      /** The profile's "Reviews" tab (master prompt §21) — public, published-only. */
      byVendor: (handle: string, params: { page?: number; page_size?: number } = {}) =>
        raw<Paginated<ReviewItem>>(
          "GET",
          `/vendors/${encodeURIComponent(handle.replace(/^@/, ""))}/reviews${qs({ page: params.page, page_size: params.page_size })}`,
          undefined,
          false,
        ),
      byListing: (listingId: string, params: { page?: number; page_size?: number } = {}) =>
        raw<Paginated<ReviewItem>>(
          "GET",
          `/listings/${encodeURIComponent(listingId)}/reviews${qs({ page: params.page, page_size: params.page_size })}`,
          undefined,
          false,
        ),
      mine: (params: { page?: number; page_size?: number } = {}) =>
        request<Paginated<MyReviewItem>>("GET", `/reviews/mine${qs({ page: params.page, page_size: params.page_size })}`),
      reply: (id: string, input: ReviewReplyInput) => request<ReviewItem>("POST", `/reviews/${encodeURIComponent(id)}/reply`, input),
      report: (id: string, input: ReportInput) => request<{ status: string }>("POST", `/reviews/${encodeURIComponent(id)}/report`, input),
    },
    listings: {
      /** Public product detail page (master prompt §12/§33) — what a post's attached product, or a
       * vendor's product row, deep-links to. */
      detail: (id: string) => raw<ListingDetail>("GET", `/listings/${encodeURIComponent(id)}`, undefined, false),
    },
    moderation: {
      reports: {
        list: (params: { status?: ReportStatus; target_type?: ReportTargetType; page?: number; page_size?: number } = {}) =>
          request<Paginated<AdminReportItem>>(
            "GET",
            `/moderation/reports${qs({ status: params.status, target_type: params.target_type, page: params.page, page_size: params.page_size })}`,
          ),
        resolve: (id: string, input: ReportResolveInput) => request<AdminReportItem>("POST", `/moderation/reports/${encodeURIComponent(id)}/resolve`, input),
      },
      posts: {
        list: (params: { status?: string; vendor?: string; page?: number; page_size?: number } = {}) =>
          request<Paginated<AdminPostItem>>(
            "GET",
            `/moderation/posts${qs({ status: params.status, vendor: params.vendor, page: params.page, page_size: params.page_size })}`,
          ),
        hide: (id: string) => request<AdminPostItem>("POST", `/moderation/posts/${encodeURIComponent(id)}/hide`),
        unhide: (id: string) => request<AdminPostItem>("POST", `/moderation/posts/${encodeURIComponent(id)}/unhide`),
      },
      reviews: {
        list: (params: { status?: string; vendor?: string; page?: number; page_size?: number } = {}) =>
          request<Paginated<AdminReviewItem>>(
            "GET",
            `/moderation/reviews${qs({ status: params.status, vendor: params.vendor, page: params.page, page_size: params.page_size })}`,
          ),
        hide: (id: string) => request<AdminReviewItem>("POST", `/moderation/reviews/${encodeURIComponent(id)}/hide`),
        unhide: (id: string) => request<AdminReviewItem>("POST", `/moderation/reviews/${encodeURIComponent(id)}/unhide`),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
