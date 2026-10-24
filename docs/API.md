# VendorConnect — API

Base path: `/api/v1`. JSON only. Interactive docs: `GET /api/v1/docs/` · OpenAPI: `GET /api/v1/schema/`
(a generated copy is committed at `docs/openapi.yaml`).

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <access>` (15 min). Refresh: HttpOnly cookie `vc_refresh` (web) or body (native). |
| CSRF | Any request using the refresh cookie must send `X-Requested-With: vendorconnect`. |
| Errors | Always `{"error": {"code", "message", "details"}}`. Validation → `code: validation_error`, `details` = field → messages. |
| Status codes | 200/201 success · 204 no body · 400 validation/business rule · 401 not authenticated · 403 forbidden/suspended · 404 · 409 conflict · 429 rate limited (`details.retry_after_seconds`) · 500 unexpected server error (Phase 12: same `{"error": {"code": "server_error", ...}}` envelope, never a stack trace/SQL/path) |
| Pagination | `?page=&page_size=` (max 100) → `{count, page, page_size, next, previous, results}` |
| Sorting / filtering | `?ordering=field,-field`; filters are per endpoint query params |
| IDs | UUIDs; vendors by handle (`SHARMA001`, `@sharma001` also accepted) |
| Tracing | `X-Request-ID` accepted and echoed; exposed cross-origin (`Access-Control-Expose-Headers`, Phase 12) so browser JS can read it too |

## Implemented (Phase 1–11)

### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | – | Liveness |
| GET | `/health/ready` | – | DB (PostGIS) + cache; 503 if degraded |

### Auth
| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/auth/otp/request` | – | `{phone}` → `{sent, expires_in, resend_after, dev_otp?}`. Same response whether or not the number exists. |
| POST | `/auth/otp/verify` | – | `{phone, code, name?, language?, purpose?: login\|admin, refresh_in_body?}` → `{access, is_new_user, user, refresh?}` + cookie |
| POST | `/auth/admin/password` | – | `{phone, password}` → OTP sent (step 1 of admin login) |
| POST | `/auth/token/refresh` | cookie or `{refresh}` | → `{access, refresh?}`; rotates, old token blacklisted |
| POST | `/auth/logout` | cookie or `{refresh}` | → 204; blacklists refresh, clears cookie |
| GET/PATCH | `/auth/me` | user | `{name, email, language}` editable; phone read-only |

Rate limits: OTP request 20/h per IP, 5/h and 30 s cooldown per phone; verify 60/h per IP, 5 attempts per code; admin password 10/h per IP.

Beyond the generic per-user budget (600/min) and per-IP anonymous budget (120/min), four endpoints
with real per-call cost or interpersonal-abuse potential carry their own scope (Phase 12; all
overridable via env, defaults shown): `POST /media` (image/video uploads) 60/hour per user;
`POST /ai/detections` (OCR/barcode inference) 30/hour per user; `POST /chats/{id}/messages`
(sending — polling/reading is unthrottled) 60/min per user; `POST /chats/{id}/report`,
`POST /posts/{id}/report`, `POST /reviews/{id}/report` 20/hour per user.

### Vendors
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/vendors` | – | Nearby vendors, ranked open-first then nearest (Phase 3) |
| POST | `/vendors` | user | Create shop → issues Vendor ID, grants `vendor` role. 409 if the user already has one. |
| GET/PATCH | `/vendors/me` | vendor | Shop details; `handle` immutable |
| GET | `/vendors/me/summary` | vendor | Dashboard stat tiles — real counts, one query (Phase 5) |
| POST | `/vendors/me/status` | vendor | `{is_open}` one-tap open/close |
| PATCH | `/vendors/me/delivery` | vendor | `{delivery_enabled, pickup_enabled, radius_km, min_order_amount, delivery_fee, free_delivery_above}` |
| GET | `/vendors/{handle}` | – | Public profile (case-insensitive, `@` optional). Suspended → 404. |
| GET | `/vendors/{handle}/products` | – | Public "Products" tab (Phase 8) — a vendor's active listings, in-stock first |

Every response that embeds a vendor (`GET /vendors`, `/search`, `/vendors/{handle}`) now also
carries `follower_count` and a real, per-caller `is_following` (Phase 9) — `false` for an
anonymous request, since following is inherently per-account, never guessed client-side
(ARCHITECTURE D30).

#### `GET /vendors` — query params
| Param | Required | Notes |
|---|---|---|
| `lat`, `lng` | yes | Customer's current position, sent per request — never stored (D11), bounded to India |
| `category` | no | Category slug — only vendors tagged with it |
| `radius_km` | no | Bounded `0.5`–`SEARCH_RADIUS_KM_MAX` (`25`); defaults to `SEARCH_RADIUS_KM_DEFAULT` (`5`) if omitted |
| `open_now` | no | Phase 6, opt-in (default `false`) — only vendors with `is_open=true` |
| `delivery` | no | Phase 6, opt-in — only vendors with delivery enabled |
| `pickup` | no | Phase 6, opt-in — only vendors with pickup enabled |
| `page`, `page_size` | no | Standard pagination (see Conventions) |

Response: the standard paginated envelope; each result is a `VendorListItem` —
`{handle, vendor_id, shop_name, verified, is_open, status_changed_at, public_phone, categories, rating_avg, rating_count, follower_count, location, delivery, bio, distance_km}`.

`open_now`/`delivery`/`pickup` are opt-in filters (ARCHITECTURE D26): each
defaults to `false`, meaning "don't narrow" — omitting them all reproduces
the exact Phase 3 response shape and ranking, unchanged.

Ranking is `-is_open` then `distance` — open shops first, then nearest;
closed shops are shown, never hidden (D9). No text query or relevance signal
applies here (that's `/search`, for products) — see `docs/ARCHITECTURE.md`
D22 for why this is a plain geo query rather than a `SearchBackend`. No auth
required (D17).

#### `GET /vendors/me/summary` (Phase 5)
Response: `{is_open, status_changed_at, product_count, low_stock_count,
out_of_stock_count}` — the vendor dashboard's overview tiles, computed in
one aggregate query over the caller's own active+paused listings. No
`orders`/`sales` fields: those need the order system (Phase 8); see
`docs/ARCHITECTURE.md` D25 for why a placeholder `0` isn't shown instead.
(Order counts still aren't folded into this endpoint — vendors see their
order queue via `GET /orders?role=vendor`, Phase 8's own list.)

#### `GET /vendors/{handle}/products` (Phase 8) — query params
Standard pagination only (`page`, `page_size`). Response: the standard
paginated envelope; each result is a `VendorProductPublic` —
`{id, product, category, name, description, price, mrp, unit, unit_quantity, availability, freshness, stock_updated_at}`.
Deliberately narrower than the vendor-owned `VendorProduct` shape (no
`quantity`, `low_stock_threshold`, `source`, `status`) — a customer sees
coarse availability only, never the vendor's exact stock count, matching
`/search`'s existing `SearchResultSerializer` convention. 404 for a
suspended/unknown handle.

### Catalog
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/categories` | – | Active categories with Hindi names |
| GET | `/search` | – | Ranked nearby listings by text query and/or category (Phase 2) |

#### `GET /search` — query params
| Param | Required | Notes |
|---|---|---|
| `lat`, `lng` | yes | Customer's current position, sent per request — never stored (D11), bounded to India |
| `q` | no | Product name, alias, Hindi/transliteration (e.g. `tamatar`), or a Vendor ID (`@SHARMA001`) |
| `category` | no | Category slug; combinable with `q`. Neither `q` nor `category` set → "browse nearby" mode |
| `radius_km` | no | Bounded `0.5`–`SEARCH_RADIUS_KM_MAX` (`25`); defaults to `SEARCH_RADIUS_KM_DEFAULT` (`5`) if omitted |
| `in_stock_only` | no | Phase 6, opt-in (default `false`) — excludes `out_of_stock`; `low_stock` still shown |
| `open_now` | no | Phase 6, opt-in — only listings from vendors with `is_open=true` |
| `delivery` | no | Phase 6, opt-in — only listings from vendors with delivery enabled |
| `pickup` | no | Phase 6, opt-in — only listings from vendors with pickup enabled |
| `price_min`, `price_max` | no | Phase 6, opt-in — inclusive range; `400` if `price_max < price_min` |
| `page`, `page_size` | no | Standard pagination (see Conventions) |

Response: the standard paginated envelope; each result —
`{id, name, price, mrp, unit, unit_quantity, availability: in_stock|low_stock|out_of_stock, category, product, freshness: fresh|aging|stale, stock_updated_at, distance_km, vendor: {handle, vendor_id, shop_name, is_open, verified, delivery_enabled, lat, lng}}`.

`vendor.lat`/`vendor.lng` were added in Phase 6 (ARCHITECTURE D27) so a
result can be plotted on the map view without a second request; `null` only
if the vendor never completed location setup.

Results are ranked by a transparent weighted score (relevance · in-stock ·
open · distance · freshness · rating — no paid placement); closed shops and
out-of-stock/stale listings are shown, ranked lower, never hidden. See
`docs/ARCHITECTURE.md` D10/D21 for the ranking design and formula. The
Phase 6 filters above are opt-in (D26): each defaults to "don't narrow", so
omitting them all reproduces the exact pre-Phase-6 response, unchanged. A
query that looks like a Vendor ID is resolved by the client directly against
`GET /vendors/{handle}` — `/search` itself always returns listings, never a
vendor object. No auth required (D17).

### Vendor Products (Phase 4)
A vendor's own catalog — not to be confused with public, customer-facing
`GET /search`. Price and stock/availability are deliberately **not** part of
the descriptive PATCH; see `docs/ARCHITECTURE.md` D24 for why they're each
routed through their own audit-trailed endpoint instead.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/vendor-products` | vendor | The signed-in vendor's own listings |
| POST | `/vendor-products` | vendor | Create a listing (sets initial price/stock too) |
| GET | `/vendor-products/{id}` | vendor | One listing, must be owned by the caller |
| PATCH | `/vendor-products/{id}` | vendor | Descriptive fields only — `price`/`availability`/`quantity` → 400 |
| DELETE | `/vendor-products/{id}` | vendor | Soft delete (`status=deleted`); frees the slot for a new listing |
| POST | `/inventory` | vendor | One-tap stock/availability update; audit-trailed, idempotent |
| POST | `/prices` | vendor | Price change; audit-trailed |

#### `GET /vendor-products` — query params
| Param | Required | Notes |
|---|---|---|
| `status` | no | `active` \| `paused` \| `deleted`. Default: active + paused (everything currently listed) |
| `category` | no | Category slug filter |
| `availability` | no | `in_stock` \| `low_stock` \| `out_of_stock` |
| `page`, `page_size` | no | Standard pagination (see Conventions) |

Response: the standard paginated envelope; each result is the full listing —
`{id, product, category, variety, name, description, price, mrp, unit, unit_quantity, availability, quantity, low_stock_threshold, status, stock_updated_at, price_updated_at, source, freshness, created_at, updated_at}`.
`product`/`variety` are `null` for a free-text listing not linked to the
shared catalog (D8/D24 — there is no product-picker UI yet, so every listing
created through the app today has `product: null`).

#### `POST /vendor-products` — body
`{category, name, price, unit, description?, product?, variety?, mrp?, unit_quantity?, quantity?, low_stock_threshold?, availability?}`
→ `201` + the created listing. `category` and `product` are slugs;
`variety` is a UUID and, like `product`, optional. `409 duplicate_listing`
if the vendor already has an active/paused listing for the same
vendor+product+variety+unit — only reachable when `product` is set (see
D24; today's UI never sets it).

#### `PATCH /vendor-products/{id}` — body
Any of `{category, product, variety, name, description, unit, unit_quantity, mrp, low_stock_threshold, status}`
(status is `active` \| `paused` only — `deleted` is DELETE's job). Sending
`price`, `availability` or `quantity` here is a `400` naming the endpoint to
use instead.

#### `POST /inventory` — body
`{listing_id, availability, quantity?, client_mutation_id?}` → the updated
listing. `quantity` omitted leaves the stored value unchanged; `quantity: null`
explicitly clears it. `client_mutation_id` (any client-chosen string, e.g. a
UUID generated at submit time) makes a retried/offline-queued submission
idempotent — replaying the same id returns the already-applied listing
instead of recording a second `InventoryEvent`.

#### `POST /prices` — body
`{listing_id, price}` → the updated listing. `400` if `price` would exceed
the listing's current `mrp`.

### Chat (Phase 7)
REST + short polling (ARCHITECTURE D14/D28) — a caller's side (customer or
the vendor's owner) is always resolved from the authenticated user and the
chat itself, never from a client-supplied parameter.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/chats` | user | The caller's own conversations, as customer or vendor (`?role=`) |
| POST | `/chats` | user | Start (or idempotently reopen) a conversation with a vendor |
| GET | `/chats/{id}` | participant | One conversation's summary |
| GET | `/chats/{id}/messages` | participant | Message history / poll for new messages |
| POST | `/chats/{id}/messages` | participant | Send a message |
| POST | `/chats/{id}/read` | participant | Mark the caller's side as read up to now → `204` |
| POST | `/chats/{id}/block` | participant | Stop the *other* side from sending → `204` |
| POST | `/chats/{id}/unblock` | participant | Reverse a block → `204` |
| POST | `/chats/{id}/report` | participant | File a moderation report against the other side |
| GET | `/vendors/me/quick-replies` | vendor | The vendor's saved canned responses, in order |
| POST | `/vendors/me/quick-replies` | vendor | Add one (max 20 — `400 quick_reply_limit` beyond that) |
| DELETE | `/vendors/me/quick-replies/{id}` | vendor | Remove one; `404` if it isn't the caller's own |

`participant` = the chat's own customer, or the owner of its vendor —
anyone else gets `403`, never a different chat's data (master-prompt §68).

#### `GET /chats` — query params
| Param | Required | Notes |
|---|---|---|
| `role` | yes | `customer` \| `vendor` — which side's conversations to list (a user can be both) |
| `q` | no | Filters by the *other* side's name — the vendor's shop name, or (vendor-side only) the customer's display name. Never matches a customer's phone number. |
| `page`, `page_size` | no | Standard pagination |

Each result: `{id, other, last_message, unread_count, blocked_by_me, blocked_by_them, created_at}`.
`other` is `{handle, vendor_id, shop_name, is_open, public_phone}` when
`role=customer`, or `{id, name}` (never `phone`) when `role=vendor`.
`last_message` is `null` for a chat with no messages yet, else
`{text, kind, sender_side, created_at}`.

#### `POST /chats` — body
`{vendor}` (a handle, `@` optional) → `201` (new) or `200` (already existed)
with the same shape as one `GET /chats` row. `400 cannot_chat_own_shop` if
the vendor is the caller's own; `404` for an unknown/inactive handle.

#### `GET /chats/{id}/messages` — query params
`before` / `after` are the message's opaque `cursor` (never its real `id`,
which is a UUID) — pass at most one:
| Param | Notes |
|---|---|
| `before` | Load up to 30 messages older than this cursor → `has_more` says if there's more history |
| `after` | Poll for messages newer than this cursor (up to 200); omit both for the most recent 30 |

Response: `{results: [message...], has_more}`. Each message:
`{id, cursor, sender_side, kind, text, listing, created_at}` — `kind` is
`text` \| `product` (the only two a client can create; `image`/`order` exist
in the data model for a later phase, see ARCHITECTURE D28). `listing` is
`null` unless `kind=product`, else `{id, name, price, unit}` — a live
snapshot of the vendor's own listing, not a copy frozen at send time.

#### `POST /chats/{id}/messages` — body
`{kind?: text|product, text?, listing_id?, client_message_id?}` → `201`
with the created message, or `200` + the original if `client_message_id`
matches an already-sent message (safe retry after a flaky network).
`kind: text` requires non-blank `text`; `kind: product` requires
`listing_id` naming one of *this chat's own vendor's* active listings
(`404` otherwise — a listing can't be borrowed from a different shop).
`403 blocked` if the other side has blocked this conversation.

#### `POST /chats/{id}/report` — body
`{reason: spam|wrong_info|abusive|fraud|other, details?}` → `201
{status: "received"}`. Files a `vc.moderation.Report` against the other
side (the vendor, or the customer's user account) and an audit log entry.

### Addresses (Phase 8)
A customer's saved delivery addresses — small and unpaginated, same shape
as vendor quick replies. Only ever required for delivery orders (D29);
pickup never touches this.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/addresses` | user | The caller's own addresses, default first |
| POST | `/addresses` | user | Add one. First address (or `is_default: true`) becomes the default |
| GET | `/addresses/{id}` | owner | One address |
| PATCH | `/addresses/{id}` | owner | Edit fields; `is_default: true` demotes the previous default |
| DELETE | `/addresses/{id}` | owner | Remove; if it was the default, the most recent remaining one is promoted |

Body (`POST`/`PATCH`): `{label?, line1, line2?, landmark?, city, state?, pincode, lat?, lng?, is_default?}`.
`lat`/`lng` must both be present or both absent (`400` otherwise), bounded
to India. Only set when the customer captured a real location — no
frontend-only guess (master prompt's own requirement); an address without
one can still be saved but can't be checked for delivery eligibility until
it has one. Ownership is always resolved from `request.user`, never a
client-supplied id — another customer's address is a `404`, not a `403`
(same "not found or not yours" convention chat/vendor-products already use).

### Cart (Phase 8)
Real backend persistence — survives refresh/logout/device change. Vendor-aware:
items from different vendors sit in the same cart but are always checked
out (and shown) one vendor at a time, mirroring how `/search` already lists
listings with their vendor embedded rather than grouping server-side
(ARCHITECTURE D29). Cart items hold **no price snapshot** — the cart is a
live view of the vendor's current listings; the actual snapshot happens
once, at order creation.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/cart` | user | Every item in the caller's cart, across all vendors |
| POST | `/cart` | user | Add a listing (or increase its quantity if already present) |
| PATCH | `/cart/items/{id}` | owner | Change quantity and/or note |
| DELETE | `/cart/items/{id}` | owner | Remove one item |

`POST /cart` body: `{listing_id, quantity?: 1, note?}` → `201` (new item) or
`200` (quantity added to an existing one). `404` for an unknown/inactive
listing; `400 cannot_order_own_shop` for the caller's own shop.

Each item in the response: `{id, listing_id, listing_status, name, unit,
unit_quantity, price, mrp, availability, vendor: {handle, vendor_id,
shop_name, status, is_open, delivery}, quantity, note, line_total, added_at}`
— `price`/`availability`/`listing_status` always reflect the listing
*right now*, so a stale cart is visible in the cart screen itself, before
checkout ever revalidates it.

### Checkout (Phase 8)
Real stock/price revalidation, one vendor per checkout. `GET
/checkout/summary` and `POST /checkout` share one internal function
(`build_checkout_context`, ARCHITECTURE D29) so what the customer reviews
on screen is exactly what gets rechecked at commit time — never a second,
slightly-different code path to drift out of sync.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/checkout/summary` | user | Live totals for one vendor's cart items — no side effects |
| POST | `/checkout` | user | Revalidate, then atomically create the order |

#### `GET /checkout/summary` — query params
| Param | Required | Notes |
|---|---|---|
| `vendor` | yes | Handle (`@` optional) |
| `fulfilment` | yes | `pickup` \| `delivery` |
| `address_id` | only for delivery | One of the caller's own addresses |

Response (`CheckoutSummary`): `{vendor, items: [{listing_id, name, unit,
unit_quantity, price, availability, quantity, line_total, problem}],
subtotal, fulfilment, pickup_available, delivery_available, address,
distance_km, delivery_eligible, delivery_ineligible_reason, delivery_fee,
total, can_place_order, payment_methods}`. `problem` is `null` unless the
item is `out_of_stock` \| `insufficient_stock` \| `listing_removed`.
`distance_km` uses real GeoDjango distance to the address's point, never a
frontend estimate (master prompt's own requirement). `payment_methods` is
`["cash"]` only in production until a real payment provider is configured
(the mock `online`/`upi` paths are dev/test only — see ARCHITECTURE D29).

#### `POST /checkout` — body
`{vendor, fulfilment, address_id?, payment_method: cash|upi|online,
customer_note?, idempotency_key (≥8 chars), expected_items: [{listing_id,
price, availability}], simulate_failure?}` → `201` with the created
`Order`, or `200` with the existing order if `idempotency_key` was already
used by this customer (safe retry after a network failure or double-tap —
one of the master prompt's named edge cases).

`expected_items` is the client's last-seen `GET /checkout/summary` snapshot
sent back for the server to diff against the truth at commit time. Every
check happens inside one transaction with the vendor's cart-referenced
listings row-locked:

| Failure | Status | Code | `details` |
|---|---|---|---|
| Cart empty for this vendor | 409 | `cart_empty` | – |
| An item is out of stock / short / removed | 409 | `items_unavailable` | `{summary}` |
| Pickup requested, vendor doesn't offer it | 409 | `pickup_unavailable` | – |
| Delivery requested, not eligible | 409 | `delivery_ineligible` | `{reason, summary}` |
| Price/availability changed since the summary was fetched | 409 | `cart_changed` | `{changes: [{listing_id, name, field, old, new}], summary}` |
| Vendor closed / deactivated | 409 | `vendor_closed` \| `vendor_unavailable` | – |
| Non-cash method outside dev/test | 503 | `payment_provider_unavailable` | – |
| Mock payment declined (`simulate_failure: true`, dev/test only) | 402 | `payment_failed` | – |

On success: an `Order` + snapshotted `OrderItem`s are created (price/name/unit
frozen at that instant — later vendor price changes never touch a past
order), a `Payment` row is created via the payment-provider abstraction,
the vendor's cart items for that vendor are cleared, and the vendor is
notified (`new_order`). For each ordered listing that tracks a numeric
`quantity` (an `availability`-only listing, `quantity=null`, is untouched),
that quantity is decremented by the ordered amount under the same row lock
and an `InventoryEvent` is written (`client_mutation_id=order:<order id>`) —
Phase 12: previously the lock only protected the *check* (`insufficient_stock`)
and nothing consumed the stock it protected, so two checkouts against the same
limited-quantity listing could both pass. Nothing is written if any check
above fails — including payment failure, which rolls back the whole order
(and, since the decrement lives in the same transaction, the stock too).

### Orders (Phase 8)
Database-backed, one vendor per order. Status transitions go through a
single table-driven endpoint rather than one per action (ARCHITECTURE
D29) — the same table also decides which reason is required and which
role may act.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/orders` | user | The caller's own orders, as customer or vendor (`?role=`) |
| GET | `/orders/{id}` | participant | One order's full detail |
| POST | `/orders/{id}/transition` | participant | Advance (or cancel) the order |

`participant` = the order's own customer, or the owner of its vendor —
anyone else gets `403` for a real order id, `404` for an unknown one
(mirrors chat's `_get_chat` convention exactly — master-prompt §68: identity
is always resolved from the authenticated session, never a client-supplied
id).

#### `GET /orders` — query params
| Param | Required | Notes |
|---|---|---|
| `role` | yes | `customer` \| `vendor` — which side to list |
| `status` | no | Exact status filter |
| `page`, `page_size` | no | Standard pagination |

Each result is an `Order`: `{id, number, status, fulfilment, vendor: {id,
handle, shop_name}, customer: {id, name}, items: [{listing, name, unit,
unit_price, quantity, line_total}], events: [{status, note, actor_side,
created_at}], delivery_address, customer_note, rejection_reason, subtotal,
delivery_fee, total, payment_method, payment_status, payment_provider,
created_at, updated_at}`. On the vendor side, `customer` never includes a
phone number (same rule chat already enforces for vendor→customer chat
rows). `number` is a short customer-facing code (`VC-XXXXXX`), not the
internal UUID.

#### `POST /orders/{id}/transition` — body
`{action, reason?}`. Valid `action`s and what they require:

| Action | From | Role | Reason required | To |
|---|---|---|---|---|
| `accept` | placed | vendor | – | accepted |
| `reject` | placed | vendor | yes | rejected |
| `preparing` | accepted | vendor | – | preparing |
| `ready` | preparing | vendor | – | ready |
| `picked_up` | ready (pickup only) | vendor | – | picked_up |
| `out_for_delivery` | ready (delivery only) | vendor | – | out_for_delivery |
| `delivered` | out_for_delivery (delivery only) | vendor | – | delivered |
| `completed` | picked_up (pickup) / delivered (delivery) | vendor | – | completed |
| `cancel` | placed | customer | – | cancelled |

Any other `(action, current status)` pair, or the wrong role for that
action, is a `409 invalid_transition` (or `409 permission_denied` for a
right-action-wrong-role attempt) — e.g. a rejected or completed order can
never move to `preparing`, and a customer can never cancel once the vendor
has accepted (the master prompt's own two named examples). `rejected` and
`cancelled` and `completed` are terminal — nothing moves out of them.
Rejecting or cancelling refunds an already-succeeded (online/UPI) payment
and marks an uncollected cash payment `failed`; completing a cash order
marks its payment `succeeded` (money changes hands on handover, not
before). Each transition appends one `OrderStatusEvent` (the tracking
timeline) and notifies the other side for the events the master prompt
named: customer gets `accept`/`reject`/`ready`/`out_for_delivery`/`completed`;
vendor gets the customer's `cancel`. (`preparing`/`picked_up`/`delivered`
advance the status and timeline but aren't separately notified — not on
the master prompt's event list.)

### Notifications (Phase 8)
Real rows, connected to order events above — no push/SMS delivery yet
(in-app inbox only; see ARCHITECTURE D29's deferred list).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | user | The caller's own inbox, newest first |
| POST | `/notifications/{id}/read` | owner | Mark one read → `204` |
| POST | `/notifications/read-all` | user | Mark everything read → `204` |

`GET /notifications` response: the standard paginated envelope plus one
extra top-level field, `unread_count`. Each result: `{id, kind, title,
body, data, read_at, created_at}`. `data` carries context for the client to
act on (`{order_id}` for every order notification today). Another user's
notification is a `404`, never visible or markable by id-guessing.

### Admin
| GET | `/admin/whoami` | admin session | Confirms password+OTP session; roles and permissions |

### Media (Phase 9)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/media` | user | Upload one image/video (multipart) → a processed `MediaAsset` |

Images are Pillow-decoded — the declared `Content-Type`/filename extension are checked but never
trusted as the real file type (`400 invalid_media` if the bytes don't actually decode) — then
EXIF-oriented, stripped of all EXIF/GPS metadata, and re-encoded as three WebP variants
(large/medium/thumb). Video is validated by declared type/extension/size only and stored as-is —
no transcoding, duration or dimension checks (documented limitation, ARCHITECTURE D30). Response
(`MediaAsset`): `{id, kind: image|video, content_type, size_bytes, width, height, url,
variant_urls: {large?, medium?, thumb?}}` — `variant_urls` is empty for video.

### Following (Phase 9)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/following` | user | Vendors the caller follows — nearest first if `lat`/`lng` given |
| POST | `/vendors/{handle}/follow` | user | Follow a shop → `{following, follower_count}` |
| POST | `/vendors/{handle}/unfollow` | user | Unfollow → same shape |

`400 cannot_follow_own_shop` for the caller's own shop, checked server-side rather than left to the
frontend to hide the button. `GET /following` rows are a `VendorPublic` plus `distance_km` (only
present when `lat`/`lng` are sent).

### Feed (Phase 9)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/feed` | user | Posts from shops the caller follows, newest first |

Plain reverse-chronological pagination across followed vendors' published posts — not a ranking
algorithm (ARCHITECTURE D30's deferred list).

### Posts (Phase 9)
Posts stay connected back to real commerce by construction — see ARCHITECTURE D30 for why
`linked_listings` isn't optional decoration ("VendorConnect is NOT an Instagram clone").

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/vendors/me/posts` | vendor | The caller's own posts |
| POST | `/vendors/me/posts` | vendor | Publish a post |
| GET | `/vendors/{handle}/posts` | – | A shop's public posts (profile "Posts" tab) |
| GET | `/posts/{id}` | – | One post's detail — a shareable deep link |
| PATCH | `/posts/{id}` | owner | Edit caption/linked products only — never media or kind |
| DELETE | `/posts/{id}` | owner | Remove (soft — `status=removed`) |
| POST | `/posts/{id}/report` | user | File a moderation report |

`POST /vendors/me/posts` body: `{kind: new_stock|offer|update|photo|video, caption?,
media_asset_ids: string[] (≥1), listing_ids?: string[], comments_enabled?, offer_valid_until?}`.
`media_asset_ids` must be the caller's own uploads from `POST /media`; `listing_ids` must be the
caller's own active listings — a vendor can never link another shop's product. `PATCH /posts/{id}`
only ever accepts `{caption?, listing_ids?, comments_enabled?}` — a post's media and kind are fixed
once published.

Response (`Post`): `{id, vendor: {handle, vendor_id, shop_name, is_open}, kind, caption, media:
[{id, position, kind, url, variant_urls}], linked_listings: [{id, name, price, unit,
unit_quantity, availability}], comments_enabled, status, like_count, offer_valid_until,
created_at, updated_at}`. `owner` = the post's own vendor's owner, resolved server-side exactly
like every other owned resource in this API — a different vendor gets `403`/`404` on
`PATCH`/`DELETE` and never sees the post in their own `GET /vendors/me/posts` list (master prompt
§68). `POST /posts/{id}/report` body: `{reason: spam|misleading|inappropriate|fake_offer|other,
details?}` → `{status: "received"}`.

### Reviews (Phase 9)
A review can only be written from a genuinely completed order — there is no standalone "create
review" endpoint (ARCHITECTURE D30: no unlimited fake reviews).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/orders/{id}/reviews` | customer | Write a review for *this* completed order |
| GET | `/vendors/{handle}/reviews` | – | A shop's public reviews (profile "Reviews" tab) |
| GET | `/listings/{id}/reviews` | – | Reviews mentioning one listing |
| GET | `/listings/{id}` | – | Standalone product detail page (what a post's "View Product" opens) |
| GET | `/reviews/mine` | user | The caller's own reviews, across shops |
| POST | `/reviews/{id}/reply` | vendor (owner) | Reply once — a second attempt is rejected |
| POST | `/reviews/{id}/report` | user | File a moderation report |

`POST /orders/{id}/reviews` body: `{rating: 1-5, text?, listing_id?}` → `201` with the created
review. `409 order_not_completed` unless the order's own status is `completed`; `409
already_reviewed` if this order already has one — also enforced by a real unique constraint on
`order`, so a race between two concurrent submits can't both succeed. `listing_id`, when given,
must be one of the order's own items.

Response (`ReviewItem`): `{id, author_name, rating, text, listing: {id, name} | null, order_id,
verified_purchase, vendor_reply, vendor_replied_at, created_at}`. `verified_purchase` is simply
"was this tied to an order" — there is no separate flag that could fall out of sync with it.
`author_name` is already privacy-resolved server-side; never render a separate name field.
`GET /reviews/mine` rows additionally carry `{vendor, status}`, since a review can be hidden by a
moderator without being deleted. `POST /reviews/{id}/reply` body: `{vendor_reply}` — only the
review's own vendor's owner may call this, and only once (`vendor_replied_at` already set →
rejected). Every review write/hide/unhide recomputes `Vendor.rating_avg`/`rating_count` from real
published reviews through one shared helper (`vc/social/services.py`) — never a value adjusted by
hand.

### Admin moderation (Phase 9)
Lives under `/moderation/*`, separate from the broader `/admin/*` back-office (Phase 11, below) —
reuses the same permission machinery Phase 1's admin login already built. Hiding never deletes;
every action writes a real audit-log entry (ARCHITECTURE D30).

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/moderation/reports` | `moderation.handle_report` | Filter by `status`, `target_type` |
| POST | `/moderation/reports/{id}/resolve` | `moderation.handle_report` | Resolve/dismiss, optionally hide the target |
| GET | `/moderation/posts` | `social.moderate_post` | Filter by `status`, `vendor` handle |
| POST | `/moderation/posts/{id}/hide`, `/unhide` | `social.moderate_post` | Toggle visibility |
| GET | `/moderation/reviews` | `social.moderate_review` | Filter by `status`, `vendor` handle |
| POST | `/moderation/reviews/{id}/hide`, `/unhide` | `social.moderate_review` | Toggle visibility |

Each permission is a real Django `Permission` a superuser holds automatically or a staff account
must be explicitly granted (`GET /admin/whoami`'s `permissions` is `["*"]` for a superuser, else
the exact codenames held) — never a role-name string compared by hand. `POST
/moderation/reports/{id}/resolve` body: `{status: resolved|dismissed, resolution?, hide_target?}`
— `hide_target: true` additionally hides the reported post/review in the same call (only
meaningful when `target_type` is `post`/`review`), so "dismissed" and "dismissed + hidden" are two
distinct, explicit outcomes rather than one silently implying the other.

### AI-assisted product entry (Phase 10)
AI only ever suggests; only `POST /ai/detections/{id}/confirm` writes a `VendorProduct`, and it
reuses the exact same create serializer manual Add Product uses. Full capability/limitation
disclosure — including why there is no trained image classifier in this build — is in `docs/AI.md`
and ARCHITECTURE D31.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/ai/detections` | vendor | Analyze one uploaded image → an `AIDetection` |
| GET | `/ai/detections/{id}` | vendor (owner) | One detection's full detail |
| POST | `/ai/detections/{id}/confirm` | vendor (owner) | Create/attach the vendor's listing from it |
| GET | `/vendors/me/ai-detections` | vendor | The caller's own detection history |
| GET | `/admin/ai/detections` | staff | Cross-vendor visibility, filterable by `status`/`vendor` |

`POST /ai/detections` body: `{image_id}` — must be the caller's own `MediaAsset` of `kind=image`
(a video, another user's image, or an unknown id is rejected). Response (`AIDetection`): `{id,
status: done|failed, image_url, provider: {name, version, is_development}, predictions: [{label,
confidence, band: likely|possible|none, source: barcode|ocr, product_slug, product_name, variety_id,
variety_name, category_slug, category_name, unit}], barcode, ocr_text, suggested_price: {amount,
unit, source, observed_at} | null, existing_listing: {id, name, price, availability} | null, message,
error, vendor_corrected, latency_ms, created_at}`. `status="failed"` covers every provider
exception/timeout/malformed-response case (master prompt §21) — never a fabricated `done` result.
An empty `predictions` array with `status="done"` is the honest "no confident match" case, distinct
from a hard failure.

`POST /ai/detections/{id}/confirm` body: the same fields as `POST /vendor-products` (category, name,
price, unit, etc. — every field editable, none pre-filled with a price) plus optional
`product`/`variety` to attach the vendor's chosen catalog match. `409 detection_already_used` if this
detection was already confirmed; the same `409` a manual create returns on a duplicate active
listing. Another vendor's detection is `404` on both `GET` and `confirm` — never visible or
confirmable cross-vendor.

`GET /vendors/me/ai-detections` / `GET /admin/ai/detections` rows (`AIDetectionListItem`):
`{id, vendor_handle, status, top_label, top_confidence, provider, error, vendor_corrected,
created_at}` — a lightweight audit trail, not the full detail payload.

### Admin back-office (Phase 11)
Every endpoint below reuses the exact same `_admin_session`/`IsStaffRole`/`admin_permission(perm)`
machinery Phase 1's admin login and Phase 9's moderation already built — no new RBAC system, no
frontend-only permission flags. Full design rationale, including what was deliberately deferred and
why, is in `docs/ARCHITECTURE.md` D32.

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/admin/dashboard` | staff | Live DB-backed metrics: users, vendors, catalog, orders, moderation, AI — for `range: today\|7d\|30d\|custom` |
| GET | `/admin/users` | staff | Search/filter every account by `q` (name or phone), `role`, `is_active` |
| GET | `/admin/users/{id}` | staff | One account's full detail, incl. order/report counts |
| POST | `/admin/users/{id}/suspend` | `accounts.manage_users` | `{reason}` → blocks that account's very next login server-side |
| POST | `/admin/users/{id}/restore` | `accounts.manage_users` | Un-suspend |
| GET | `/admin/vendors` | staff | Search/filter every shop (incl. suspended) by `q`, `status`, `verification_status` |
| GET | `/admin/vendors/{handle}` | staff | One shop's full detail, incl. product/order/review/post counts |
| POST | `/admin/vendors/{handle}/verify` | `vendors.verify_vendor` | `{decision: verified\|rejected, notes?}` |
| POST | `/admin/vendors/{handle}/suspend` | `vendors.suspend_vendor` | `{reason}` → shop's public profile 404s immediately |
| POST | `/admin/vendors/{handle}/restore` | `vendors.suspend_vendor` | Un-suspend |
| GET | `/admin/products` | staff | Every vendor's listing across the platform, read-only — filter by `q`, `vendor`, `category`, `status` |
| GET | `/admin/categories` | staff | Full taxonomy incl. inactive, with real `product_count`/`listing_count`/`vendor_count` — unpaginated, like the public `/categories` |
| GET | `/admin/orders` | staff | Every order across every vendor and customer, read-only support visibility — filter by `q`, `status`, `fulfilment` |
| GET | `/admin/orders/{id}` | staff | Full order detail (same shape the customer/vendor sides see) — the customer's phone is never included |
| GET | `/admin/audit-logs` | staff | Read-only viewer over the append-only `AuditLog` trail every app has written to since Phase 1 — filter by `action`, `actor` (phone or id), `target_type`, `target_id`, date range |

All list endpoints use the same paginated envelope as the rest of the API (`{count, page, page_size,
next, previous, results}`) except `/admin/categories`, which mirrors the public `/categories`
endpoint's bare-array shape. `/admin/dashboard`'s `range=custom` requires both `date_from` and
`date_to` (`400` otherwise); every metric's `help_text` states whether it's period-scoped or
current-state/backlog, so an empty platform genuinely shows zeroes rather than a placeholder.
`/admin/orders`, `/admin/products` and `/admin/categories` are strictly read-only (`POST`/`PATCH`/
`DELETE` all `405`) — there is no admin path that writes a vendor's own price/stock, and no
refund/payment action lives under `/admin/*`; `/admin/audit-logs` is read-only for a different
reason — nothing, including an admin, can rewrite the trail through the API. `/admin/users/{id}` and
`/admin/vendors/{handle}` accept the same handle-with-or-without-`@` convention as the public
`/vendors/{handle}` route.

## Planned (by phase)
`/analytics/events`.
