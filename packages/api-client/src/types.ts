/* Shared API types. Keep in sync with docs/API.md (generated OpenAPI at /api/v1/schema/). */

export type Role = "customer" | "vendor" | "admin" | "moderator" | "support";

export interface Me {
  id: string;
  phone: string;
  name: string;
  email: string;
  language: "en" | "hi";
  roles: Role[];
  vendor: { handle: string; shop_name: string } | null;
  date_joined: string;
}

export interface OtpSent {
  sent: true;
  expires_in: number;
  resend_after: number;
  dev_otp?: string; // dev/test only
}

export interface LoginResult {
  access: string;
  is_new_user: boolean;
  user: Me;
}

export interface Category {
  slug: string;
  name: string;
  names_i18n: Record<string, string>;
  icon: string;
  parent: string | null;
  sort_order: number;
}

export interface DeliverySettings {
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  radius_km: string;
  min_order_amount: string;
  delivery_fee: string;
  free_delivery_above: string | null;
}

export interface VendorPublic {
  handle: string;
  vendor_id: string;
  shop_name: string;
  verified: boolean;
  is_open: boolean;
  status_changed_at: string | null;
  public_phone: string;
  categories: string[];
  rating_avg: string;
  rating_count: number;
  follower_count: number;
  /** Whether the *current* caller follows this shop (Phase 9) — always `false` for an anonymous
   * request, since following is per-account. Comes from the backend, never guessed client-side. */
  is_following: boolean;
  location: { lat: number; lng: number; address_line: string; landmark: string; locality: string; city: string; pincode: string } | null;
  delivery: DeliverySettings;
  bio: string;
}

export interface VendorOwner extends VendorPublic {
  status: "active" | "suspended" | "closed_permanently";
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  onboarding_step: string;
  created_at: string;
}

export interface VendorSummary {
  is_open: boolean;
  status_changed_at: string | null;
  product_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface VendorCreateInput {
  shop_name: string;
  category_slugs: string[];
  location: { lat: number; lng: number; address_line: string; landmark?: string; locality?: string; city: string; state?: string; pincode?: string };
  public_phone?: string;
  bio?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

export type Availability = "in_stock" | "low_stock" | "out_of_stock";
export type Freshness = "fresh" | "aging" | "stale";

export interface SearchVendor {
  handle: string;
  vendor_id: string;
  shop_name: string;
  is_open: boolean;
  verified: boolean;
  delivery_enabled: boolean;
  /** Phase 6 (D26 map view) — null only if the vendor never completed location setup. */
  lat: number | null;
  lng: number | null;
}

/** One vendor's listing, as ranked by /search (ARCHITECTURE D10: relevance, stock, open, distance, freshness, rating). */
export interface SearchResultItem {
  id: string;
  name: string;
  price: string;
  mrp: string | null;
  unit: string;
  unit_quantity: string;
  availability: Availability;
  category: string;
  product: { slug: string; name: string } | null;
  freshness: Freshness;
  stock_updated_at: string;
  distance_km: number;
  vendor: SearchVendor;
}

export interface SearchParams {
  q?: string;
  lat: number;
  lng: number;
  category?: string;
  radius_km?: number;
  in_stock_only?: boolean;
  open_now?: boolean;
  delivery?: boolean;
  pickup?: boolean;
  price_min?: number;
  price_max?: number;
  page?: number;
  page_size?: number;
}

/** A vendor card for browsing (Home "Shops near you", the Vendors tab) — /vendors (ARCHITECTURE D22). */
export interface VendorListItem extends VendorPublic {
  distance_km: number;
}

export interface VendorListParams {
  lat: number;
  lng: number;
  category?: string;
  radius_km?: number;
  open_now?: boolean;
  delivery?: boolean;
  pickup?: boolean;
  page?: number;
  page_size?: number;
}

export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/* --- Vendor product / inventory / price management (Phase 4) --------------------------- */

export type Unit = "kg" | "g" | "l" | "ml" | "piece" | "dozen" | "packet" | "bundle" | "box" | "pair" | "strip" | "bottle" | "meter";
export const UNITS: Unit[] = ["kg", "g", "l", "ml", "piece", "dozen", "packet", "bundle", "box", "pair", "strip", "bottle", "meter"];

export type ListingStatus = "active" | "paused" | "deleted";

/** A vendor's own listing, full detail — GET/POST /vendor-products, and the response shape after
 * any create/update/stock/price change (ARCHITECTURE.md Phase 4 notes). */
export interface VendorProductItem {
  id: string;
  product: { slug: string; name: string } | null;
  category: string;
  variety: { id: string; name: string } | null;
  name: string;
  description: string;
  price: string;
  mrp: string | null;
  unit: Unit;
  unit_quantity: string;
  availability: Availability;
  quantity: string | null;
  low_stock_threshold: string | null;
  status: ListingStatus;
  stock_updated_at: string;
  price_updated_at: string;
  source: "manual" | "ai";
  freshness: Freshness;
  created_at: string;
  updated_at: string;
}

export interface VendorProductCreateInput {
  category: string;
  product?: string;
  variety?: string;
  name: string;
  description?: string;
  price: string | number;
  mrp?: string | number;
  unit: Unit;
  unit_quantity?: string | number;
  quantity?: string | number;
  low_stock_threshold?: string | number;
  availability?: Availability;
}

/** PATCH /vendor-products/{id} — descriptive fields only; price/availability/quantity are changed
 * via `inventory.update`/`prices.update` instead (each is the head of its own audit table). */
export interface VendorProductUpdateInput {
  category?: string;
  product?: string | null;
  variety?: string | null;
  name?: string;
  description?: string;
  unit?: Unit;
  unit_quantity?: string | number;
  mrp?: string | number | null;
  low_stock_threshold?: string | number | null;
  status?: "active" | "paused";
}

export interface VendorProductListParams {
  status?: ListingStatus;
  category?: string;
  availability?: Availability;
  page?: number;
  page_size?: number;
}

export interface InventoryUpdateInput {
  listing_id: string;
  availability: Availability;
  /** Omit to leave the existing quantity untouched; pass `null` to explicitly clear it. */
  quantity?: string | number | null;
  client_mutation_id?: string;
}

export interface PriceUpdateInput {
  listing_id: string;
  price: string | number;
}

/* --- Chat (Phase 7) ---------------------------------------------------------------------- */

export type ChatRole = "customer" | "vendor";
export type MessageKind = "text" | "image" | "product" | "order" | "system";

/** What a customer sees about the vendor on the other side of a chat. `public_phone` lets the
 * chat screen offer the same Call button as the vendor's profile (ARCHITECTURE D14/D28). */
export interface ChatVendorRef {
  handle: string;
  vendor_id: string;
  shop_name: string;
  is_open: boolean;
  public_phone: string;
}

/** What a vendor sees about the customer on the other side — name only, never the phone number
 * (ARCHITECTURE D14: vendor numbers are shown to customers; customer numbers never go the other way). */
export interface ChatCustomerRef {
  id: string;
  name: string;
}

export interface ChatLastMessage {
  text: string;
  kind: MessageKind;
  sender_side: ChatRole;
  created_at: string;
}

/** One row of `GET /chats` — `other`'s shape depends on which `role` the list was requested as. */
export interface ChatItem {
  id: string;
  other: ChatVendorRef | ChatCustomerRef;
  last_message: ChatLastMessage | null;
  unread_count: number;
  blocked_by_me: boolean;
  blocked_by_them: boolean;
  created_at: string;
}

export interface ChatListParams {
  role: ChatRole;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface MessageListingRef {
  id: string;
  name: string;
  price: string;
  unit: string;
}

/** `id` is the message's real identity; `cursor` is an opaque, monotonically increasing value used
 * only for `before`/`after` pagination — never shown to the person. */
export interface ChatMessage {
  id: string;
  cursor: number;
  sender_side: ChatRole;
  kind: MessageKind;
  text: string;
  listing: MessageListingRef | null;
  created_at: string;
}

export interface MessagePage {
  results: ChatMessage[];
  has_more: boolean;
}

export interface SendMessageInput {
  kind?: "text" | "product";
  text?: string;
  listing_id?: string;
  /** Lets a retried send (e.g. after a flaky network) be recognised as the same message server-side. */
  client_message_id?: string;
}

export type ReportChatReason = "spam" | "wrong_info" | "abusive" | "fraud" | "other";

export interface ReportChatInput {
  reason: ReportChatReason;
  details?: string;
}

/** A vendor's saved canned response (Phase 7) — one tap to send a common answer. */
export interface QuickReplyItem {
  id: number;
  text: string;
  position: number;
}

/** Customer-facing listing shape for a vendor's public "Products" tab (Phase 8) — deliberately
 * narrower than VendorProductItem: no quantity/low_stock_threshold/source/status (ARCHITECTURE D29). */
export interface VendorProductPublicItem {
  id: string;
  product: { slug: string; name: string } | null;
  category: string;
  name: string;
  description: string;
  price: string;
  mrp: string | null;
  unit: Unit;
  unit_quantity: string;
  availability: Availability;
  freshness: Freshness;
  stock_updated_at: string;
}

/* --- Addresses (Phase 8) ------------------------------------------------------------------ */

export interface AddressItem {
  id: string;
  label: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
  created_at: string;
}

export interface AddressInput {
  label?: string;
  line1?: string;
  line2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  /** Must be given together (or both omitted) — a half-set coordinate isn't a usable point. */
  lat?: number | null;
  lng?: number | null;
  is_default?: boolean;
}

/* --- Cart / checkout / orders (Phase 8) ---------------------------------------------------- */

export type Fulfilment = "pickup" | "delivery";
export type PaymentMethod = "cash" | "upi" | "online";
export type OrderStatus =
  | "placed" | "accepted" | "rejected" | "preparing" | "ready"
  | "out_for_delivery" | "delivered" | "picked_up" | "completed" | "cancelled";
export type OrderAction =
  | "accept" | "reject" | "preparing" | "ready" | "picked_up" | "out_for_delivery" | "delivered" | "completed" | "cancel";
export type CartItemProblem = "out_of_stock" | "insufficient_stock" | "listing_removed" | null;

/** A cart row's vendor group header — enough to render the group and gate its checkout button
 * without a second request per vendor. */
export interface CartVendorRef {
  handle: string;
  vendor_id: string;
  shop_name: string;
  status: "active" | "suspended" | "closed_permanently";
  is_open: boolean;
  delivery: DeliverySettings;
}

/** One cart row. Price/availability are always read live off the listing — never cached on the
 * cart item (ARCHITECTURE D29). */
export interface CartItem {
  id: string;
  listing_id: string;
  listing_status: ListingStatus;
  name: string;
  unit: Unit;
  unit_quantity: string;
  price: string;
  mrp: string | null;
  availability: Availability;
  vendor: CartVendorRef;
  quantity: string;
  note: string;
  line_total: string;
  added_at: string;
}

export interface CartAddInput {
  listing_id: string;
  quantity?: string | number;
  note?: string;
}

export interface CartUpdateInput {
  quantity: string | number;
  note?: string;
}

export interface CheckoutSummaryParams {
  vendor: string;
  fulfilment: Fulfilment;
  address_id?: string;
}

export interface CheckoutItem {
  listing_id: string;
  name: string;
  unit: Unit;
  unit_quantity: string;
  price: string;
  availability: Availability;
  quantity: string;
  line_total: string;
  problem: CartItemProblem;
}

/** Live totals for one vendor's cart — powers the Pickup/Delivery, Address and Order Review
 * screens; the same numbers `POST /checkout` rechecks at commit time (ARCHITECTURE D29). */
export interface CheckoutSummary {
  vendor: CartVendorRef;
  items: CheckoutItem[];
  subtotal: string;
  fulfilment: Fulfilment;
  pickup_available: boolean;
  delivery_available: boolean;
  address: AddressItem | null;
  distance_km: number | null;
  delivery_eligible: boolean | null;
  delivery_ineligible_reason: "delivery_disabled" | "address_missing_location" | "outside_radius" | "below_minimum" | null;
  delivery_fee: string;
  total: string;
  can_place_order: boolean;
  payment_methods: PaymentMethod[];
}

export interface ExpectedItem {
  listing_id: string;
  price: string;
  availability: Availability;
}

export interface CheckoutInput {
  vendor: string;
  fulfilment: Fulfilment;
  address_id?: string;
  payment_method: PaymentMethod;
  customer_note?: string;
  /** Any client-chosen string (>=8 chars, e.g. a UUID) — a retried submit with the same key returns
   * the order already created for it (200) instead of creating a duplicate (201). */
  idempotency_key: string;
  expected_items: ExpectedItem[];
  /** Dev/test only — forces the mock payment to fail, to exercise the failure path. */
  simulate_failure?: boolean;
}

export interface OrderItem {
  listing: string | null;
  name: string;
  unit: Unit;
  unit_price: string;
  quantity: string;
  line_total: string;
}

export type OrderActorSide = "customer" | "vendor" | "system";

export interface OrderStatusEvent {
  status: OrderStatus;
  note: string;
  actor_side: OrderActorSide;
  created_at: string;
}

export interface OrderVendorRef {
  handle: string;
  vendor_id: string;
  shop_name: string;
  public_phone: string;
  is_open: boolean;
}

/** What the *vendor* side of an order sees about the buyer — name only, never a phone number
 * (the same D14 rule chat already enforces). */
export interface OrderCustomerRef {
  id: string;
  name: string;
}

export interface DeliveryAddressSnapshot {
  label: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  lat: number | null;
  lng: number | null;
}

/** A database-backed order. `number` is the short customer-facing code (`VC-XXXXXX`); item
 * price/name/unit are snapshotted at creation, so a later vendor price change never touches a
 * past order (master prompt's own requirement). */
export interface OrderDetail {
  id: string;
  number: string;
  vendor: OrderVendorRef;
  customer: OrderCustomerRef;
  fulfilment: Fulfilment;
  status: OrderStatus;
  delivery_address: DeliveryAddressSnapshot | null;
  customer_note: string;
  subtotal: string;
  delivery_fee: string;
  total: string;
  payment_method: PaymentMethod;
  payment_status: "pending" | "succeeded" | "failed" | "refunded" | null;
  payment_provider: string | null;
  rejection_reason: string;
  items: OrderItem[];
  events: OrderStatusEvent[];
  /** Set once the customer has reviewed this order (Phase 9) — null before that, so the tracking
   * screen can show "Rate your experience" vs. "You reviewed this order" without a guess-and-fail POST. */
  review_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderListParams {
  role: "customer" | "vendor";
  status?: OrderStatus;
  page?: number;
  page_size?: number;
}

export interface OrderTransitionInput {
  action: OrderAction;
  /** Required for `reject` — omitted, it's a 400 naming which field is missing. */
  reason?: string;
}

/* --- Notifications (Phase 8) --------------------------------------------------------------- */

export type NotificationKind = "order_status" | "new_order";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPage extends Paginated<NotificationItem> {
  unread_count: number;
}

/* --- Media upload (Phase 9) ----------------------------------------------------------------- */

export type MediaKind = "image" | "video";

/** One processed, stored upload (`POST /media`) — image variants are real resized WebP files, not
 * the original re-served at different sizes (ARCHITECTURE D30). Video has no variants: it's stored
 * as-is, a documented limitation (no transcoding infrastructure yet). */
export interface MediaAsset {
  id: string;
  kind: MediaKind;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  url: string;
  variant_urls: Partial<Record<"large" | "medium" | "thumb", string>>;
}

/* --- Following (Phase 9) --------------------------------------------------------------------- */

export interface FollowState {
  following: boolean;
  follower_count: number;
}

/** A followed vendor card for `GET /following` — `distance_km` is only present when `lat`/`lng`
 * were sent with the request. */
export interface FollowedVendorItem extends VendorPublic {
  distance_km: number | null;
}

/* --- Posts (Phase 9) ------------------------------------------------------------------------- */

export type PostKind = "photo" | "video" | "new_stock" | "offer" | "update";
export const POST_KINDS: PostKind[] = ["new_stock", "offer", "update", "photo", "video"];
export type PostStatus = "published" | "hidden" | "removed";

export interface PostVendorRef {
  handle: string;
  vendor_id: string;
  shop_name: string;
  is_open: boolean;
}

export interface PostMediaItem {
  id: string;
  position: number;
  kind: MediaKind;
  url: string;
  variant_urls: Partial<Record<"large" | "medium" | "thumb", string>>;
}

/** A product attached to a post — enough to render "Fresh Tomato — ₹30/kg — In stock" and link
 * through to the real product detail page (master prompt §12). */
export interface PostLinkedListing {
  id: string;
  name: string;
  price: string;
  unit: Unit;
  unit_quantity: string;
  availability: Availability;
}

export interface Post {
  id: string;
  vendor: PostVendorRef;
  kind: PostKind;
  caption: string;
  media: PostMediaItem[];
  linked_listings: PostLinkedListing[];
  comments_enabled: boolean;
  status: PostStatus;
  like_count: number;
  offer_valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostCreateInput {
  kind: PostKind;
  caption?: string;
  media_asset_ids: string[];
  listing_ids?: string[];
  comments_enabled?: boolean;
  offer_valid_until?: string | null;
}

export interface PostUpdateInput {
  caption?: string;
  listing_ids?: string[];
  comments_enabled?: boolean;
}

export type ReportPostReason = "spam" | "misleading" | "inappropriate" | "fake_offer" | "other";
export const REPORT_POST_REASONS: ReportPostReason[] = ["spam", "misleading", "inappropriate", "fake_offer", "other"];

export type ReportReviewReason = "spam" | "abuse" | "fake" | "offensive" | "other";
export const REPORT_REVIEW_REASONS: ReportReviewReason[] = ["spam", "abuse", "fake", "offensive", "other"];

export interface ReportInput {
  reason: string;
  details?: string;
}

/* --- Reviews (Phase 9) ------------------------------------------------------------------------ */

export interface ReviewListingRef {
  id: string;
  name: string;
}

/** One review, as shown on a vendor's or a product's "Reviews" tab. `author_name` is already
 * privacy-resolved server-side ("Anonymous customer" when the reviewer opted out) — never render a
 * separate name field. */
export interface ReviewItem {
  id: string;
  author_name: string;
  rating: number;
  text: string;
  listing: ReviewListingRef | null;
  order_id: string | null;
  verified_purchase: boolean;
  vendor_reply: string;
  vendor_replied_at: string | null;
  created_at: string;
}

/** `GET /reviews/mine` — same shape plus which shop it's for and its moderation status, since a
 * review can be hidden by a moderator without being deleted (master prompt §25). */
export interface MyReviewItem extends ReviewItem {
  vendor: PostVendorRef;
  status: "published" | "hidden" | "flagged";
}

export interface ReviewCreateInput {
  rating: number;
  text?: string;
  listing_id?: string | null;
}

export interface ReviewReplyInput {
  vendor_reply: string;
}

/* --- Public listing detail (Phase 9) ----------------------------------------------------------- */

export interface ListingDetail extends VendorProductPublicItem {
  vendor: { handle: string; vendor_id: string; shop_name: string; is_open: boolean };
}

/* --- Admin moderation (Phase 9) ----------------------------------------------------------------- */

export type ReportTargetType = "vendor" | "listing" | "post" | "review" | "message" | "user" | "order";
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export interface AdminReportItem {
  id: string;
  reporter_name: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  details: string;
  status: ReportStatus;
  resolution: string;
  handled_by_name: string;
  created_at: string;
}

export interface ReportResolveInput {
  status: "resolved" | "dismissed";
  resolution?: string;
  hide_target?: boolean;
}

export interface AdminPostItem {
  id: string;
  vendor_handle: string;
  shop_name: string;
  kind: PostKind;
  caption: string;
  status: PostStatus;
  like_count: number;
  created_at: string;
}

export interface AdminReviewItem {
  id: string;
  vendor_handle: string;
  author_name: string;
  rating: number;
  text: string;
  status: "published" | "hidden" | "flagged";
  created_at: string;
}

/* --- AI-assisted product entry (Phase 10) --------------------------------------------------------
 * `LocalDetectionProvider` (see docs/AI.md) really decodes barcodes and really runs OCR — both are
 * genuine, local, non-fake capabilities. It does NOT run a trained image classifier: no such model
 * is reachable in the reference environment, so a photo with no barcode and no legible text
 * correctly comes back with `predictions: []` rather than an invented guess. `is_development: true`
 * on every response is not a formality — the UI must show it, never presenting this as production AI. */

export type AIConfidenceBand = "likely" | "possible" | "none";
export type AIDetectionStatus = "pending" | "done" | "failed" | "confirmed" | "discarded";

export interface AIPrediction {
  product_slug: string | null;
  product_name: string | null;
  variety_id: string | null;
  variety_name: string | null;
  category_slug: string | null;
  category_name: string | null;
  unit: Unit | null;
  label: string;
  confidence: number;
  band: AIConfidenceBand;
  source: "barcode" | "ocr" | "unknown";
}

export interface AISuggestedPrice {
  min: string;
  max: string;
  unit: Unit;
  region: string;
  source: string;
  observed_at: string;
}

export interface AIProviderRef {
  name: string;
  version: string;
  is_development: boolean;
}

export interface AIExistingListing {
  id: string;
  name: string;
}

export interface AIDetection {
  id: string;
  status: AIDetectionStatus;
  image_url: string | null;
  provider: AIProviderRef | null;
  predictions: AIPrediction[];
  barcode: string;
  ocr_text: string;
  suggested_price: AISuggestedPrice | null;
  existing_listing: AIExistingListing | null;
  message: string;
  error: string;
  vendor_corrected: boolean;
  latency_ms: number | null;
  created_at: string;
}

export interface AIDetectionListItem {
  id: string;
  vendor_handle: string;
  status: AIDetectionStatus;
  top_label: string | null;
  top_confidence: number | null;
  provider: string | null;
  error: string;
  vendor_corrected: boolean;
  created_at: string;
}

/* --- Admin back-office (Phase 11, ARCHITECTURE D32) ------------------------------------------
 * Every list here is server-side searched/filtered/paginated (same `Paginated<T>` shape as the
 * rest of the app) and every figure on the dashboard is a live DB aggregate — nothing here is
 * seeded or estimated client-side. */

export type AdminDashboardRange = "today" | "7d" | "30d" | "custom";

export interface AdminUserMetrics {
  total: number;
  new: number;
  active: number;
}

export interface AdminVendorMetrics {
  total: number;
  pending_verification: number;
  active: number;
  suspended: number;
}

export interface AdminProductMetrics {
  total: number;
  active_listings: number;
  out_of_stock_listings: number;
}

export interface AdminOrderMetrics {
  total: number;
  pending: number;
  completed: number;
  cancelled: number;
}

export interface AdminModerationMetrics {
  open_reports: number;
  reported_posts: number;
  reported_reviews: number;
  hidden_content: number;
}

export interface AdminAIMetrics {
  detections: number;
  failed_detections: number;
  dev_scanner_usage: number;
}

/** GET /admin/dashboard. `range`/`period_start`/`period_end` say exactly what window every other
 * number below was computed over — `users.total`/`vendors.total` are the only all-time figures. */
export interface AdminDashboard {
  range: AdminDashboardRange;
  period_start: string;
  period_end: string;
  users: AdminUserMetrics;
  vendors: AdminVendorMetrics;
  products: AdminProductMetrics;
  orders: AdminOrderMetrics;
  moderation: AdminModerationMetrics;
  ai: AdminAIMetrics;
}

export interface AdminDashboardParams {
  range?: AdminDashboardRange;
  /** Required together when range is "custom" (ISO date or datetime). */
  date_from?: string;
  date_to?: string;
}

export interface AdminUserVendorRef {
  handle: string;
  shop_name: string;
}

export interface AdminUserListItem {
  id: string;
  name: string;
  phone: string;
  email: string;
  roles: Role[];
  is_active: boolean;
  suspended_at: string | null;
  vendor: AdminUserVendorRef | null;
  date_joined: string;
  last_login: string | null;
}

export interface AdminUserDetail extends AdminUserListItem {
  suspension_reason: string;
  order_count: number;
  reports_filed_count: number;
  reports_against_count: number;
}

export interface AdminUserListParams {
  q?: string;
  role?: Role;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface AdminUserSuspendInput {
  reason: string;
}

export interface AdminVendorOwnerRef {
  id: string;
  name: string;
  phone: string;
}

export interface AdminVendorListItem {
  handle: string;
  shop_name: string;
  owner: AdminVendorOwnerRef;
  status: "active" | "suspended" | "closed_permanently";
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  city: string;
  categories: string[];
  is_open: boolean;
  rating_avg: string;
  rating_count: number;
  follower_count: number;
  created_at: string;
}

export interface AdminVendorHours {
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface AdminVendorDetail extends AdminVendorListItem {
  public_phone: string;
  location: { lat: number; lng: number; address_line: string; landmark: string; locality: string; city: string; pincode: string } | null;
  hours: AdminVendorHours[];
  delivery: DeliverySettings;
  product_count: number;
  post_count: number;
  review_count: number;
  order_count: number;
  verified_at: string | null;
  status_changed_at: string | null;
}

export interface AdminVendorListParams {
  q?: string;
  status?: string;
  verification_status?: string;
  category?: string;
  page?: number;
  page_size?: number;
}

export type VendorVerificationDecision = "verified" | "rejected";

export interface AdminVendorVerifyInput {
  decision: VendorVerificationDecision;
  notes?: string;
}

export interface AdminVendorSuspendInput {
  reason: string;
}

export interface AdminListingVendorRef {
  handle: string;
  shop_name: string;
}

/** A vendor's listing as seen by admin catalog visibility — read-only; there is no admin path
 * that writes a vendor's own price/stock (that stays exclusively the vendor's own screens). */
export interface AdminListingItem {
  id: string;
  vendor: AdminListingVendorRef;
  name: string;
  product_slug: string | null;
  category: string;
  price: string;
  unit: Unit;
  availability: Availability;
  status: ListingStatus;
  source: "manual" | "ai";
  created_at: string;
  updated_at: string;
}

export interface AdminListingListParams {
  q?: string;
  category?: string;
  vendor?: string;
  status?: string;
  availability?: Availability;
  page?: number;
  page_size?: number;
}

/** GET /admin/categories — unlike the public category list, includes inactive entries and real
 * usage counts; not paginated (small, fixed taxonomy, same as the public endpoint). */
export interface AdminCategoryItem {
  slug: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  listing_count: number;
  vendor_count: number;
}

export interface AdminOrderListItem {
  id: string;
  number: string;
  customer_name: string;
  vendor_handle: string;
  vendor_shop_name: string;
  fulfilment: Fulfilment;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: "pending" | "succeeded" | "failed" | "refunded" | null;
  total: string;
  created_at: string;
}

export interface AdminOrderListParams {
  q?: string;
  status?: OrderStatus;
  fulfilment?: Fulfilment;
  page?: number;
  page_size?: number;
}

/** GET /admin/audit-logs — read-only viewer over the append-only trail every admin/vendor action
 * has been writing to since Phase 1. `ip_hash`/`request_id` are deliberately not exposed here. */
export interface AuditLogItem {
  id: number;
  actor_name: string | null;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogListParams {
  action?: string;
  actor?: string;
  target_type?: string;
  target_id?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}
