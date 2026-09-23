# VendorConnect — Architecture

> Status: Phase 0 + Phase 1 complete. This document is the source of truth for
> architectural decisions; each decision has a short "why" and the tradeoff.

## 1. What we are optimising for

The core loop is **vendor updates → database → customer searches → sees current
local availability → visits/orders → vendor updates**. Every decision below is
judged by whether it makes that loop faster, more truthful, or cheaper to run.

Non-negotiables derived from the spec:

| Rule | Where it is enforced |
|---|---|
| A product exists for many vendors; each vendor has its own price, stock, availability | `catalog_product` (concept) vs `catalog_vendorproduct` (vendor's listing) |
| Open/closed is per vendor and independent | `vendors_vendor.is_open` + `status_changed_at` |
| Delivery is optional and vendor-specific | `vendors_deliverysettings` (default OFF → "Pickup only") |
| Vendor ID unique, stable, case-insensitive | `vendors_vendor.handle` unique on `UPPER()`; never regenerated |
| Stale info shown transparently | `stock_updated_at` on every listing; API returns `freshness` |
| AI is advisory | `ai_detection` rows never create listings; only a vendor confirm endpoint does |
| No internal IDs exposed | UUID PKs everywhere; vendors addressed by handle |

## 2. System overview

```
             ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
             │ Customer PWA  │  │  Vendor PWA   │  │  Admin web    │
             │ apps/customer │  │  apps/vendor  │  │  apps/admin   │
             └──────┬────────┘  └──────┬────────┘  └──────┬────────┘
                    │  shared: packages/ui · api-client · i18n
                    └────────────── HTTPS / JSON ─────────┘
                                       │
                         ┌─────────────▼──────────────┐
                         │  API (Django 5 + DRF)       │   /api/v1/*
                         │  modular monolith           │   /health
                         │  accounts · vendors ·       │
                         │  catalog · search · orders  │──── SMS provider (adapter)
                         │  social · chat · notif ·    │──── Map provider (client-side adapter)
                         │  ai-gateway · audit ·       │──── Object storage (S3 / MinIO)
                         │  analytics                  │
                         └──────┬───────────┬──────────┘
                                │           │ HTTP (internal)
                   ┌────────────▼──┐   ┌────▼────────────────┐
                   │ PostgreSQL 16 │   │ AI service           │
                   │ + PostGIS     │   │ services/ai          │
                   │ + pg_trgm     │   │ pluggable classifier │
                   └───────────────┘   └──────────────────────┘
                   ┌───────────────┐
                   │ Redis         │  cache · rate limits · OTP throttle · (later) channels
                   └───────────────┘
```

## 3. Key decisions

### D1 — Backend: Django 5 + Django REST Framework, modular monolith
*Why:* One deployable, one database transaction boundary for the stock/price
loop, first-class GeoDjango/PostGIS, built-in admin for early operations,
mature auth/permissions. Apps are separated by domain so any of them can be
split out later.
*Tradeoff:* Lower raw throughput than Go/Node; irrelevant at MVP scale, and
horizontal scaling behind a load balancer is trivial because the API is stateless.

### D2 — Database: PostgreSQL 16 + PostGIS + pg_trgm + unaccent
*Why:* Geography points with GiST indexes give correct metre distances and
index-backed radius queries (`ST_DWithin`). pg_trgm gives typo-tolerant search
without running Elasticsearch on day one.

### D3 — Frontend: React + TypeScript + Vite, shipped as installable PWAs
An earlier concept document proposed React Native. For the MVP we ship PWAs:

| | PWA (chosen) | React Native |
|---|---|---|
| Install friction for low-literacy users | Share a link / QR at the shop, "Add to Home screen" | Play Store install, storage, updates |
| Works on low-end Android | Yes, small bundle | Heavier APK |
| One codebase for customer, vendor, admin | Yes | Admin still needs web |
| Camera for AI scan | `getUserMedia` / file input with `capture` | Native, slightly better |
| Push notifications | Web Push (Android fine; iOS 16.4+ only when installed) | Full |

*Tradeoff:* iOS push and background sync are weaker. The `packages/api-client`,
`packages/i18n` and type definitions are framework-agnostic so a React Native
(Expo) shell can be added later without touching the API.

### D4 — Three apps, one design system
`apps/customer`, `apps/vendor`, `apps/admin` share `packages/ui` (tokens +
components), `packages/api-client` (typed client, token refresh, offline
queue) and `packages/i18n` (English/Hindi, regional-ready). A person who is both
customer and vendor uses one account with two roles.

### D5 — Authentication: phone + OTP, JWT
- Primary login is **mobile number + 6-digit OTP** (the target audience rarely
  uses email/passwords). Admins additionally require a password.
- OTPs are stored only as HMAC-SHA256 hashes, expire in 5 minutes, allow 5
  attempts, and are throttled per phone and per IP.
- **Access token** (JWT, 15 min) is held in memory by the web apps.
  **Refresh token** (30 days, rotated, blacklisted on use/logout) is set as an
  `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth/`, so XSS
  cannot steal it. Native clients may send it in the body instead.
- SMS goes through an `SmsProvider` interface: `console` (dev/test) is
  implemented; MSG91/Twilio adapters are stubs until credentials exist.

### D6 — RBAC
Roles: `customer`, `vendor`, `admin`, `moderator`, `support`. A user holds any
subset (`accounts_userrole`). DRF permission classes (`IsVendor`, `IsAdmin`,
`HasAdminPermission("vendors.verify")`) guard every view. Admin actions are
fine-grained by Django permissions and written to `audit_auditlog`.

### D7 — Vendor ID (handle)
Format `@` + up to 8 letters from the shop name + 3-digit sequence, e.g.
`@SHARMA001`. Generated once at shop creation inside a transaction with a
unique index on `UPPER(handle)`; never changes when the shop is renamed.
Lookups strip `@` and uppercase. **Decision:** vendors are listed immediately
with an "unverified" state and receive the verified badge after admin review;
hiding unverified shops would make the marketplace empty at launch. Admin can
suspend any vendor instantly.

### D8 — Products: concept vs listing
`Product` is a platform concept ("Tomato", category Vegetables, default unit kg)
with multilingual `ProductAlias` rows ("tamatar", "टमाटर", "tomatoes").
`VendorProduct` is a vendor's listing with its own price, unit, availability,
optional quantity and timestamps. Vendors may also list custom items not in
the taxonomy (`product` nullable, `name` required) so we never block a vendor.

### D9 — Freshness (no stale stock shown as current)
Every listing carries `stock_updated_at`. The API returns
`freshness: fresh | aging | stale` using per-category thresholds (vegetables
go stale faster than hardware). Clients show "Updated 3 h ago"; stale items
are labelled "may be outdated" and ranked lower. Closed shops are never ranked
above open ones for the same product.

### D10 — Search (Phase 2)
A `SearchBackend` interface with a `PostgresSearchBackend` implementation:
1. Normalise query (lowercase, unaccent, strip `@`).
2. If it looks like a handle → exact vendor lookup.
3. Resolve to product concepts via alias trigram similarity (handles typos,
   Hindi script and transliteration).
4. Geo-filter listings with `ST_DWithin` on vendor location, then rank.
Ranking is a transparent weighted score (relevance, in-stock, open, distance,
freshness, rating). There is **no paid placement**; if promotion is added
later it will be labelled.
OpenSearch can replace the backend without changing the API contract.

### D11 — Location privacy
Customer coordinates are sent per request, rounded server-side to ~100 m
(3 decimals) before logging/analytics, and are never stored unless the
customer saves an address. Vendors only see a customer's address when the
customer places a delivery order with them.

### D12 — Media
Object storage (S3-compatible; MinIO locally). `MediaAsset` rows store keys,
dimensions and variants, never blobs. Uploads are validated by magic bytes,
size-limited, re-encoded (strips EXIF/GPS), resized to 1080/480/160 px WebP.

### D13 — Maps
A client-side `MapProvider` interface. Default implementation: Leaflet +
OpenStreetMap tiles (no key, suitable for dev; production should use a paid
tile provider or self-hosted tiles because OSM's public tiles have a usage
policy). Google Maps / Mappls adapters can be dropped in. Directions open the
device's maps app via a universal `geo:`/maps URL.

### D14 — Chat (Phase 7)
MVP: REST + short polling (works on flaky networks and behind any proxy),
with the message model designed for a later Django Channels/WebSocket upgrade.
Calling uses `tel:` links; vendor numbers are shown, customer numbers are not.

### D15 — AI (Phase 10)
Separate `services/ai` with a `ProductClassifier` interface and a versioned
model registry. The API stores every request in `ai_detection` and returns
suggestions only. Details in `AI.md`.

### D16 — Observability
Structured JSON logs (structlog) with request IDs; `/health` (liveness) and
`/health/ready` (DB + Redis); audit log for admin/vendor-sensitive actions;
Sentry DSN optional via env.

## 4. Navigation architecture

**Customer** (bottom nav: Home · Search · Vendors · Cart · Profile)
```
Splash → Language → Onboarding → Location permission / manual pick → Login (phone) → OTP
Home ─┬─ Search ─┬─ Product results → Product detail → Vendor profile
      │          └─ Vendor results / @ID → Vendor profile (Posts·Products·Reviews·About)
      ├─ Categories → Product results
      ├─ Nearby vendors / Map
      └─ Followed vendors · Posts
Cart (grouped by vendor) → Checkout per vendor (pickup | delivery) → Order tracking
Profile → Orders · Following · Addresses · Language · Notifications · Privacy · Help · Logout
```

**Vendor** (bottom nav: Home · Products · Orders · Messages · Shop)
```
Login (phone) → OTP → Onboarding wizard (name → shop → category → location → photo) → Vendor ID issued
Home: shop status toggle · today summary · quick actions
Products: list with one-tap stock toggle · add (manual | AI scan) · edit price
Orders: new · preparing · ready · done
Messages: chat list
Shop: profile · hours · delivery settings · posts · reviews · analytics
```

**Admin** (side nav): Dashboard · Users · Vendors · Verification · Products ·
Categories · Orders · Reviews · Posts · Reports · Analytics · Audit log · Settings

## 5. Environments

| | development | staging | production |
|---|---|---|---|
| Settings module | `config.settings.dev` | `config.settings.prod` + `ENVIRONMENT=staging` | `config.settings.prod` |
| SMS | console | provider sandbox | provider |
| OTP echo in API response | allowed (`OTP_DEV_ECHO`) | **forbidden** | **forbidden** (startup check) |
| Data | seed script | anonymised copy | real |

## 6. Security baseline (applied from Phase 1)
Input validation via DRF serializers; ORM only (no string-built SQL); CORS
allow-list; security headers (HSTS, CSP on web apps, X-Frame-Options DENY);
rate limits on auth and write endpoints; secrets only from environment;
`prod` settings refuse to start with DEBUG or a default secret key; audit logs.

## 7. Known risks / open questions
- SMS cost per OTP (~₹0.15–0.25) — mitigated by long refresh tokens and throttling.
- OSM public tiles cannot carry production traffic — budget a tile provider.
- Vendor adoption depends on how fast stock can be updated: one-tap toggles,
  bulk "mark all vegetables in stock", and offline queueing are P0 UX.
- Market price data source for AI price suggestions is undecided (Agmarknet
  public data is a candidate for fruits/vegetables).

## 8. Decisions added during Phase 1

### D17 — Customers can browse without logging in
Language → intro → location → login, but login is skippable. Search, vendor
profiles and product availability are public; login is required only for cart,
orders, chat, follow and reviews. *Why:* every extra step before the first
search loses low-literacy users; there's nothing private about "who has tomatoes".
*Tradeoff:* anonymous traffic needs IP rate limits (in place: 120 req/min).

### D18 — Admin login = password + OTP, enforced by token claim
Admin/moderator/support accounts must pass a password step, then OTP
(`purpose=admin`). Only then does the JWT carry `adm: true`; every admin
permission class checks that claim. A staff member who signs into the customer
app with plain OTP gets a normal session that cannot reach admin APIs.

### D19 — Same-origin deployment for web apps
Each web app is served with its API under `/api` on the same domain (nginx proxy
in production, Vite proxy in development). This lets the refresh cookie stay
`SameSite=Strict` and removes CORS from the production path.
