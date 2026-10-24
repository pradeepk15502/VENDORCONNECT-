# VendorConnect — Architecture

> Status: Phase 0 + Phase 1 + Phase 2 + Phase 3 complete. This document is the source of truth for
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

VendorConnect ships as **one role-aware web app** (`apps/web`) plus a separate
back-office app for staff (`apps/admin`) — see D4/D20. It does not ship a
separate customer app and vendor app.

```
             ┌───────────────────────────────┐  ┌───────────────┐
             │  Web app — apps/web            │  │  Admin web    │
             │  role-aware: Customer ⇄ Vendor │  │  apps/admin   │
             └──────────────┬─────────────────┘  └──────┬────────┘
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
| One codebase for customer, vendor | Yes — one app, role-aware (D4/D20) | Admin still needs web |
| Camera for AI scan | `getUserMedia` / file input with `capture` | Native, slightly better |
| Push notifications | Web Push (Android fine; iOS 16.4+ only when installed) | Full |

*Tradeoff:* iOS push and background sync are weaker. The `packages/api-client`,
`packages/i18n` and type definitions are framework-agnostic so a React Native
(Expo) shell can be added later without touching the API.

### D4 — One role-aware application, one design system
VendorConnect is a **single role-aware application** where a user enters as a
**Customer** or a **Vendor**; the UI, navigation, permissions and available
features change according to the selected/active role. `apps/web` (customer
and vendor together) and `apps/admin` (staff back office, unaffected by this
decision) share `packages/ui` (tokens + components), `packages/api-client`
(typed client, token refresh, offline queue) and `packages/i18n`
(English/Hindi, regional-ready). A person who is both customer and vendor
uses **one account, one app install**, and switches which half of the UI is
active without logging out. See D20 for the full flow and rationale.

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

VendorConnect is one role-aware app (`apps/web`); the two diagrams below are
the journeys available *inside that one app*, reached through a shared
splash → language → role-selection sequence (see D20). They are not two
separate apps. `apps/admin` (last item below) is a separate back-office app
for staff, not a role a shopper picks on the role-selection screen.

```
Splash → Language → "How do you want to use VendorConnect?" (Role selection)
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   I'm a Customer               I'm a Vendor
```

**Customer role** (bottom nav: Home · Search · Vendors · Cart · Profile)
```
Role selection → Login (phone, skippable) → OTP → Onboarding intro → Location permission / manual pick
Home ─┬─ Search ─┬─ Product results → Product detail → Vendor profile
      │          └─ Vendor results / @ID → Vendor profile (Posts·Products·Reviews·About)
      ├─ Categories → Product results
      ├─ Nearby vendors / Map
      └─ Followed vendors · Posts
Cart (grouped by vendor) → Checkout per vendor (pickup | delivery) → Order tracking
Profile → Orders · Following · Addresses · Language · Notifications · Privacy · Help · Become a Vendor · Logout
```

**Vendor role** (bottom nav: Home · Products · Orders · Messages · Shop)
```
Role selection → Login (phone) → OTP → Onboarding wizard (name → shop → category → location → photo) → Vendor ID issued
Home: shop status toggle · today summary · quick actions
Products: list with one-tap stock toggle · add (manual | AI scan) · edit price
Orders: new · preparing · ready · done
Messages: chat list
Shop: profile · hours · delivery settings · posts · reviews · analytics · Switch to Customer
```

Either role can switch to the other from Profile / Shop settings without
logging out — same account, same app, just a different active role (D20).

**Admin** (side nav, separate app — `apps/admin`): Dashboard · Users ·
Vendors · Verification · Products · Categories · Orders · Reviews · Posts ·
Reports · Analytics · Audit log · Settings

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

### D20 — Single role-aware application (amends the first draft of D4)
**VendorConnect is a single role-aware application where users can enter as
Customer or Vendor. The UI, navigation, permissions and available features
change according to the selected/active role.** The full-flow UI mockups for
"customer" and "vendor" are not two separate products to build — they are
two complete role-based journeys inside the same VendorConnect product, and
the app is built accordingly.

Required flow:
```
Splash → Language → "How do you want to use VendorConnect?" (Role selection)
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
  I'm a Customer                I'm a Vendor
  Login/OTP → Location          Login/OTP → Shop setup → Verification
  → Customer Home               → Vendor Dashboard
```

- **One codebase, one install.** `apps/customer` and `apps/vendor` (two
  separate PWAs, as D4 originally described) were merged into a single
  `apps/web`. There is one link/QR and one "Add to Home screen" for the whole
  product; `apps/admin` is untouched by this — it is separate back-office
  tooling for staff, not a role an ordinary user picks on this screen.
- **Active role is a device-level UI preference**, not a backend concept —
  persisted the same way as the language choice (`localStorage`), not as a
  new field on the account. The backend already allows one `User` to be a
  customer and a vendor at the same time (a phone-keyed account with an
  optional related vendor profile — see `vc/accounts/models.py`), so this
  merge required **no backend or API changes**: selecting or switching a
  role never re-authenticates and never creates a second account.
- **Routing**: customer routes are unprefixed (`/`, `/search`, `/cart`,
  `/profile`, …); vendor routes are prefixed (`/vendor`, `/vendor/products`,
  `/vendor/shop`, …); a shared public route (`/v/:handle`, a vendor's shop
  page) is reachable regardless of role or first-run state. Route guards
  send a signed-in user to the matching half of the app if they navigate to
  a route belonging to the role they are not currently in.
- **Switching roles** is available without logging out: from Profile
  ("Become a Vendor" / "Switch to Vendor") and from Shop settings ("Switch
  to Customer"). Both call the same role-persisting function that also
  re-renders navigation immediately, so route guards see the new role right
  away rather than on next reload.
- **No CSS collisions from the merge.** Customer-only and vendor-only styles
  already followed a `c-*` / `v-*` class-naming convention, so both
  stylesheets could be imported into the one app unchanged.
- *Why the correction:* an earlier version of this document (previously
  D20) kept the three-PWA split from D4 and instead gave each app a small
  cross-app link on its splash screen. That satisfied "get someone who
  landed on the wrong app to the right one," but it still shipped two
  installable apps for what the spec defines as one product with two
  roles. A single app with an in-app role switch is what "one account can
  be customer and vendor at the same time" (D4) actually implies at the UI
  level, and it removes the duplicated nav shell, splash, language and
  login screens that living in two bundles required.
- **No social login buttons** remains intentional, unchanged from the
  original note here: the mockups' login screen shows Google/Apple/Facebook
  buttons, but D5 (phone + OTP only) has no OAuth backend, so those buttons
  would be dead UI. The login screen keeps its icon badge and plain-text
  Terms/Privacy disclaimer instead (not a link — those pages don't exist
  yet, and a dead link is worse than no link).

## 9. Decisions added during Phase 2

### D21 — Search implementation: bounded candidate fetch + explicit weights (amends D10)
D10 set the design; this is what shipped, in `vc/catalog/search.py` behind the
`SearchBackend` protocol (`PostgresSearchBackend`):
1. Resolve the query to product concepts via `TrigramSimilarity` against
   `ProductAlias.normalized`. Every product's English name, Hindi name and
   transliteration/typo variants are already seeded as alias rows
   (`seed_taxonomy`), so this one query covers multilingual and typo
   resolution — no separate `Product.name` lookup is needed. Custom
   (non-catalog) listings aren't covered by aliases, so they get their own
   direct name-trigram fallback against `VendorProduct.name`.
2. Geo-filter with `ST_DWithin` (`vendor__location__point__distance_lte`)
   on the existing GiST-indexed `geography` point — no new indexes.
3. Fetch at most `CANDIDATE_LIMIT = 500` matches ordered by distance, then
   rank in Python: the multi-factor score is simpler to read, test and
   change as a small `_score()` function than as one SQL expression. Fixed
   weights, summing to 1.0, in the same priority order D10 specified:
   relevance `0.35` · in-stock `0.20` · open `0.15` · distance `0.15` ·
   freshness `0.10` · rating `0.05`. No paid placement.
4. Per D9, closed vendors and out-of-stock/stale listings are never removed
   from results, only ranked lower — asserted directly in tests.

*Vendor-handle short-circuit is client-only, not part of `/search`.* Rather
than giving `/search` two response shapes (a shop vs. a listing), the web
app checks the query against the same handle pattern the backend uses for
Vendor IDs and, on a match, calls the existing `GET /vendors/{handle}`
directly and renders a separate "Shop found" card alongside any product
results. `/search` itself always returns listings only.

*Tradeoff:* ranking up to 500 rows in Python per request costs more than an
equivalent SQL `ORDER BY` would, in exchange for a formula that's easy to
read, unit-test and retune. Fine at MVP density; revisit (e.g. push more of
the score into SQL, or swap in OpenSearch per D10) if a category ever has
materially more than ~500 open listings inside a customer's search radius.

## 10. Decisions added during Phase 3

### D22 — Vendor discovery: `GET /vendors` is a plain geo query, not a `SearchBackend`
Home's "Shops near you" and the Vendors tab needed real nearby-vendor
browsing (previously both were "coming soon" placeholders, out of Phase 2's
scope — see D-note in the Phase 2 report). Unlike D10's product search,
listing nearby *vendors* has no text query, no alias resolution and no
relevance signal to weigh, so it doesn't get a `SearchBackend`-style
interface — that abstraction exists specifically because D10 promises product
search can move to OpenSearch later; nothing here makes an equivalent promise,
and adding one speculatively would be unused complexity (master-prompt
principle: don't introduce infrastructure a real requirement hasn't asked
for). `VendorCollectionView.get()` (`vc/vendors/views.py`) does the geo-filter
directly: `Vendor.objects.annotate(distance=Distance(...)).filter(location__point__distance_lte=(point, D(km=radius_km)))`,
the same `ST_DWithin`-backed pattern D10 established, reusing `_public_qs()`
and `VendorPublicSerializer` (extended with `distance_km` as
`VendorListSerializer`). Ranking is `order_by("-is_open", "distance")` — open
shops first, then nearest — mirroring D9's "never hide, only rank lower" for
closed shops, without D10's relevance/freshness/rating terms, which don't
apply to a shop as a whole.

`GET /vendors` and `POST /vendors` (shop creation, existing since Phase 1)
share one collection endpoint (`VendorCollectionView`) rather than two URLs,
consistent with REST collection semantics (GET lists, POST creates) — GET is
public (`AllowAny`, D17: browsing needs no login), POST stays
`IsAuthenticated`, enforced via `get_permissions()` per HTTP method.

### D23 — Vendor profile tabs show real data or say plainly what's missing
The profile screen's Products/Posts/Reviews/About tabs (an in-code comment
since Phase 1.5 already reserved the layout for them) are not all backed by
data yet: `Review` (`vc/social/models.py`) is migrated but has no API, and
there is still no vendor-facing way to list a shop's own products outside of
`/search`'s geo-scoped results (both are Phase 4/9 per `docs/API.md`'s
Planned table). Rather than stub these with placeholder or fabricated
content, only **About** renders now — bio, category tags, pickup/delivery
terms and contact, all already in `VendorPublicSerializer` — and
Products/Posts/Reviews show the same honest "Coming in a later phase" empty
state the vendor dashboard already uses elsewhere (`v.soon`), never fake
listings, posts or reviews.

### Fixed during Phase 3 — logging crash + silently corrupted `.env` values
Re-verifying the API's startup logs surfaced (and reproduced) a real,
previously-undiagnosed bug: any `logging.info`/`logging.warning` call — the
autoreloader's own "Watching for file changes", any request through the
`vc.access` middleware, any `django.request` warning — crashed with
`TypeError: 'str' object is not callable` inside
`structlog.stdlib.ProcessorFormatter.format()`. Root cause:
`LOGGING["formatters"]["json"/"console"]["processor"]`
(`services/api/config/settings/base.py`) was given as a **string**
(`"structlog.processors.JSONRenderer"`). `logging.config.dictConfig` only
import-resolves its special `"()"` key — any other key, including
`"processor"`, is used exactly as given — so `ProcessorFormatter` ended up
holding the literal string instead of a renderer instance, and later tried
to call it as a processor. Fix: since `base.py` is a plain Python module
rather than a JSON/YAML config file, there's no reason to spell these as
import-path strings at all — `import structlog` was moved above the
`LOGGING` dict and both formatters now reference the real objects
(`structlog.stdlib.ProcessorFormatter`, `structlog.processors.JSONRenderer()`,
`structlog.dev.ConsoleRenderer()`), with an explicit `foreign_pre_chain` so
plain stdlib log records (Django's own logs, not just structlog ones) still
get `add_log_level`/`add_logger_name`/timestamp applied before rendering.

The same pass found a second, related bug: `environ.Env.read_env()` was
called without `parse_comments=True`, so a `.env` copied from
`.env.example` (i.e. exactly what a fresh setup does) kept each value's
trailing `# explanation` comment as part of the value —
`SMS_PROVIDER` became `"console       # console | msg91 | twilio (...)"`,
which fails the exact-match provider lookup in `vc/accounts/sms.py`, and
`LOG_FORMAT` became an invalid formatter name, which is what turned the
structlog bug above from latent into a guaranteed startup crash. Fixed at
both ends: `read_env(..., parse_comments=True)`, and `.env.example`'s
explanatory comments moved onto their own line above each `KEY=value`
rather than trailing it, so a value is never ambiguous even for a reader
(or library) that doesn't strip comments. Re-verified: `manage.py migrate`,
`manage.py check`, and a live `runserver` boot + `/health`, `/health/ready`,
and a real OTP request (through `vc.sms`'s console provider) all log
cleanly with zero errors — see the Testing section in `README.md`.

## 11. Decisions added during Phase 4

### D24 — Vendor product catalog: audit-trailed inventory/price, free-text listings, soft delete
A vendor's product catalog (`VendorProduct`, `PriceHistory`, `InventoryEvent`
in `vc/catalog/models.py` — all migrated since Phase 0) is now exposed end to
end: `GET/POST /vendor-products`, `GET/PATCH/DELETE /vendor-products/{id}`,
`POST /inventory`, `POST /prices` (`vc/catalog/views.py`, `urls.py`). Three
decisions shaped the API surface:

- **Price and stock changes are not part of the descriptive-field PATCH.**
  `VendorProductUpdateSerializer` accepts name/description/category/unit
  fields and explicitly rejects `price`/`availability`/`quantity` with a
  `400` pointing at the correct endpoint. Changing price or
  availability/quantity instead goes through `POST /prices` or
  `POST /inventory`, each of which writes both the new state onto
  `VendorProduct` *and* an immutable row (`PriceHistory`/`InventoryEvent`) —
  so every change a vendor makes to what a customer sees is independently
  auditable, without bolting a generic "audit log" onto every field.
  `InventoryEvent.client_mutation_id` (with a `uniq_inventory_mutation`
  constraint) makes that endpoint idempotent for a vendor retrying after a
  dropped connection on a flaky mobile network — the exact scenario this app
  is built for.
- **A listing does not require a shared `Product` catalog link.** `product`
  stays nullable (D8, Phase 1) and `VendorProductCreateSerializer` never asks
  the frontend for one — there is deliberately no product-picker UI yet. A
  vendor names their own item in free text; `VendorProduct.name`'s own
  trigram index keeps it findable via `/search` regardless. This means the
  `uniq_active_listing` constraint (one active/paused listing per
  vendor+product+variety+unit, which only applies when `product` is set) can
  never fire through this UI today — confirmed by a backend unit test
  (`test_duplicate_active_listing_conflicts`) that exercises the constraint
  directly, since the frontend genuinely cannot reach it yet. Building the
  picker is future work, not a gap in this phase's scope.
- **Delete is soft.** `VendorProductDetailView.delete()` sets
  `status="deleted"` rather than removing the row, so `PriceHistory`/
  `InventoryEvent` (which would otherwise cascade-delete with a hard delete)
  stay intact for the audit trail, and the vendor+product+variety+unit slot
  becomes available again for a new listing (the `uniq_active_listing`
  condition only covers `active`/`paused`).

The frontend (`VendorProductFormScreen.tsx`) presents this 3-endpoint
backend as one "Save" button: on edit, it diffs the submitted form against
the originally-loaded item and fires only the calls a real change needs (0–1
PATCH, 0–1 `/prices`, 0–1 `/inventory`) — a vendor never sees the split, but
every write still lands in the right audit trail.

### Fixed during Phase 4 — a CSS min-width/shrink bug class, found via real E2E flakiness
The two new `vendor-products.spec.ts` E2E tests were flaky in a way that
looked, at first, like a Playwright/mobile-emulation quirk: clicking a
control that was visibly in the right place would time out with "intercepts
pointer events" from an unrelated element, and `window.innerWidth` would
read wider than the actual device viewport (e.g. `445` on a `412`-wide
Pixel 7 emulation) with no single element's `getBoundingClientRect()`
individually exceeding 412px. That combination (page reports as wider than
the viewport, yet no element looks oversized) is the signature of one
specific CSS bug, present in several unrelated spots at once:

A flex or grid child sized only by `flex: 1`/`1fr` still won't shrink below
its own content's intrinsic width, because the CSS-spec default
`min-width: auto` on a flex/grid item makes that intrinsic size a hard
floor — `overflow` on the item itself doesn't override it. A row that's
supposed to fit the screen (an AppBar title next to a fixed-width back
button and action slot; a bottom-nav tab strip; a vendor's shop-name header
next to a "verified" badge and a bell icon; a form's price/MRP field pair)
will instead grow to fit its widest content, and because that's the *whole
page's* width, mobile Chromium responds the way it would to any
badly-responsive site: it zooms the entire layout out to make the overflow
fit, which is what actually produced the `innerWidth` mismatch and the
knock-on click-coordinate flakiness (Playwright's real click lands in
zoomed *visual*-viewport space; the app's own layout math is still in
*layout*-viewport space).

Fixed at each real spot, not by suppressing the symptom:
`.v-pform__row2`, `.vc-appbar`, `.v-kv` and `.vc-iconbtn` all now use
`minmax(0, 1fr)` / `min-width: 0` / `flex: none` as appropriate (matching
the already-correct `.vc-grid-2`/`.vc-grid-3` pattern elsewhere in
`packages/ui`); the Dashboard header's shop-name block moved from an inline
`style={{flex:1}}` to a proper `.v-head__text` class carrying `min-width: 0`
plus a name-truncation rule (a real vendor's shop name is arbitrary-length
text, same as the shop address rendered by `.v-kv`). `.vc-bottomnav`
specifically kept overflowing even after switching its `grid-auto-columns`
to `minmax(0, 1fr)` — this pre-installed sandbox's Chromium build (revision
1194) apparently doesn't shrink implicit grid auto-columns below content
size the way `grid-template-columns: repeat(n, minmax(0,1fr))` correctly
does elsewhere in this same codebase — so it was rewritten as a flexbox
(`flex: 1 1 0; min-width: 0` per tab), the same pattern already proven
correct throughout the rest of the UI. Whether that's a genuine engine gap
or something narrower, flexbox is the more conventional tool for "N
equal-width shrinkable items" than an auto-placed grid track list anyway.

Two more issues surfaced only once the CSS was no longer masking them
further down the test: the new E2E tests assumed a bottom-nav "Products"
link was reachable immediately after a create redirects into the edit
screen, but that screen deliberately has no bottom nav (a focused,
single-purpose form) — fixed by clicking "Back" first, matching how a
vendor would actually navigate. Separately, `EmptyState`/`ErrorState`
(`packages/ui/src/components.tsx`) rendered their title as a plain `<p>`,
so `getByRole("heading", ...)` could never match it — changed to `<h2>`
(the `Screen`'s `AppBar` already owns the page's `<h1>`), which is also a
real accessibility fix: a screen-reader user can now jump to an empty/error
state via heading navigation instead of reading the whole screen.

## 12. Decisions added during Phase 5

### D25 — Vendor dashboard: a real summary endpoint, and removing two fabricated stat tiles
The dashboard (`DashboardScreen.tsx`) previously computed its Products/Low
stock/Out of stock tiles from three parallel filtered `GET /vendor-products`
list calls (cheap, but three round trips for three numbers), and — this is
the part worth a decision record — rendered its "Orders" and "Sales" tiles
as **hardcoded literals**, `<b>0</b>` and `<b>₹0</b>`, next to the real
tiles in the same grid. There is no order system yet (that's Phase 8 on
this project's own roadmap — see `README.md` Roadmap), so those two numbers
were never computed from anything; they were static markup dressed as live
data. That is exactly the fabricated-functionality this project's brief
rules out, and it was already shipped before this phase started auditing
the dashboard specifically.

Two changes, together:

- **`GET /vendors/me/summary`** (`vc/vendors/views.py::VendorSummaryView`,
  `IsVendor`-gated) replaces the three list calls with one aggregate query —
  `VendorProduct.objects.filter(status__in=[active, paused]).aggregate(...)`
  with conditional `Count(..., filter=Q(availability=...))` — returning
  `{is_open, status_changed_at, product_count, low_stock_count,
  out_of_stock_count}`. This was already reserved for Phase 5 in
  `docs/API.md`'s "Planned" list before this phase began.
- **The "Orders"/"Sales" tiles are gone, not faked-then-hidden.** The
  overview section now shows only the three real, computed counts; the
  section heading changed from "Today" (which implied daily
  transactional data that doesn't exist) to "Shop overview". The "Orders"
  quick-action tile already links to an honest coming-soon placeholder
  (`PlaceholderScreen`, matching the pattern used for Messages and AI Scan
  since Phase 1/4), so a vendor isn't left wondering whether orders exist —
  they're told plainly it's coming, rather than shown a permanent zero.
  Real order/sales tiles return in Phase 8, backed by actual data, not
  before.

While auditing the same screen, the "Create Post" quick action was found
routing to `/vendor/shop` (Shop Settings) — a leftover placeholder-of-sorts
that silently landed a vendor somewhere unrelated to what the button said.
It now routes to `/vendor/posts/new`, an honest coming-soon placeholder like
the other not-yet-built quick actions (Posts are Phase 9).

**Left out of this phase, on purpose:** master-prompt §24 also asks for
"opening hours" (a recurring weekly schedule, shown as e.g. "09:00 AM –
10:00 PM" next to the open/closed badge) as part of shop status. `is_open`
has been a purely manual, vendor-toggled boolean since Phase 1
(`vendors_vendor.is_open` — see the table at the top of this document), and
that manual toggle is documented there as the source of truth customers see.
Adding a recurring-hours schedule is a real feature (weekly day/time ranges,
a decision about whether it auto-overrides the manual toggle or merely
displays alongside it, timezone handling) that belongs with Shop Settings
rather than folded into a dashboard-stats phase; it's recorded as a known
limitation in `README.md` rather than half-built here.

## 13. Decisions added during Phase 6

### D26 — Discovery filters: opt-in query params, never a narrower default
Master-prompt §11 asks for Availability/Shop status/Distance/Delivery/Price
filters on both `/search` and `/vendors`. Every new param
(`in_stock_only`, `open_now`, `delivery`, `pickup`, `price_min`,
`price_max`, plus a `radius_km` the client can now set explicitly on top of
the existing default) defaults to "don't narrow" — `False`/absent — so the
existing D9 ranking behaviour (never hide a closed or out-of-stock result,
just rank it lower) is unchanged until the customer turns a filter on. This
matters because D9 was itself a deliberate product decision (a customer
finding *no* results because the one shop that has an item happens to be
closed is worse than showing it, ranked lower); an opt-in filter lets a
customer ask for a strictly narrower view without changing what "no filter"
means.

Both endpoints validate `price_min <= price_max`
(`SearchQuerySerializer.validate`) and share the same param names, so the
frontend's `DiscoveryFilterSheet` (`apps/web/src/customer/DiscoveryFilters.tsx`)
is one component reused by `SearchScreen` and `VendorsScreen`, varying only
in which filter groups it shows (`variant="search" | "vendors"` — price and
in-stock only make sense against products, not shops). Filter state lives in
the URL (`useSearchParams`), matching the existing `category` param
convention, so a filtered link is shareable/bookmarkable like any other
search.

Deferred out of this phase: a **rating** filter (master-prompt §11 asks for
one). `Vendor.rating_avg`/`rating_count` are real columns, but always `0`
today — there is no review system yet (Phase 9) — so a "4★ and up" filter
would only ever return everything or nothing. Shipping it now would be
exactly the "beautiful UI, no real functionality behind it" pattern this
project's brief forbids; it lands with Phase 9 once ratings are real.

### D27 — Map view: Leaflet + OpenStreetMap, per D13's own default
D13 (Phase 0) already named the plan — Leaflet + OSM tiles, no API key, a
universal maps link for directions — this phase is that plan implemented,
plus the pieces D13 left for whenever a map actually got built:

- **`DiscoveryMap.tsx`** is a thin imperative wrapper: Leaflet owns the DOM
  inside a `<div>` ref, React only calls back in when the center or the
  marker list changes. `react-leaflet` was deliberately not added — one
  more dependency for a component this small isn't worth it.
- **One marker per shop, not per listing.** `/search` returns one row per
  *listing*, so two products from the same shop would otherwise draw two
  overlapping markers; `markersFromSearchResults` collapses by vendor
  handle. `/vendors` is already one row per shop, so `markersFromVendors`
  is a plain filter (a vendor with no location on file — shouldn't happen
  in practice, but the field is nullable — is skipped rather than crashing).
- **`/search`'s vendor sub-object gained `lat`/`lng`.** It previously only
  carried `distance_km`; plotting a result needed its actual coordinates,
  which `/vendors` already exposed via `location` but `/search` never did.
  Additive, backward-compatible (existing consumers of `SearchResultItem`
  ignore fields they don't read), and free — `vendor__location` was already
  `select_related` for the existing delivery-flag lookup, so this adds no
  new queries.
- **No marker ever carries a database id** — only the vendor's public
  `handle`, the same one the list view already routes on
  (master-prompt §10's "do not expose database IDs to users").
- **The customer's own "you are here" dot is not clickable
  (`interactive: false`).** Found during this phase's own E2E pass: the
  seed data's "near you" shop is realistically close (~50 m), which at
  in-app zoom levels means its marker and the customer's own position
  marker overlap almost exactly. A clickable "you are here" dot sitting on
  top silently ate every click meant for the shop underneath it — a real
  usability bug, not just a test artifact, since any customer standing
  inside or right next to a shop would have hit the same thing. Leaflet
  gives non-interactive markers `pointer-events: none`, so the fix was one
  option, not a hit-testing workaround.
- **Directions reuse the existing link**, `google.com/maps/dir/?api=1&destination=lat,lng`
  (now `format.ts::directionsUrl`, extracted from `VendorProfileScreen`
  rather than duplicated) — this already *is* D13's "universal maps URL":
  it opens each device's own maps app via an intent/URL scheme handoff on
  mobile, and Google Maps in a browser tab on desktop, without needing a
  bare `geo:` URI that desktop browsers don't understand at all.
- Tile requests go straight to `tile.openstreetmap.org` from the browser,
  which is fine for development; per D13, production should move to a paid
  or self-hosted tile provider rather than run against OSM's public,
  rate-limited tiles at real traffic.

## 14. Decisions added during Phase 7

### D28 — Chat: implementing D14 (REST + short polling), scoped to text and product-share
D14 (Phase 0) already named the transport (REST + short polling, message
model upgradeable to WebSockets later) and the phone-privacy rule (vendor
numbers shown, customer numbers never exposed to a vendor). This phase
builds the full chat feature on that foundation:

- **Endpoints**: `GET/POST /chats` (list mine / start one), `GET
  /chats/{id}`, `GET/POST /chats/{id}/messages`, `POST
  /chats/{id}/read|block|unblock|report`, and
  `GET/POST /vendors/me/quick-replies` +
  `DELETE /vendors/me/quick-replies/{id}`. Every one of them resolves the
  caller's side (customer or vendor-owner) from the request user and the
  chat's own `customer`/`vendor.owner` — there is no `?as=` parameter a
  caller could lie through, so master-prompt §68's "never reach another
  account's private data by changing an ID" holds by construction, not by a
  permission check that could be forgotten on a new endpoint.
- **Phone privacy, enforced in the serializer, not just by convention.**
  `_ChatCustomerSerializer` (what a vendor sees) exposes only `id`/`name` —
  never `phone` — while `_ChatVendorSerializer` (what a customer sees) now
  also carries `public_phone`, so the chat header can offer the same Call
  button as the vendor's profile. `test_vendor_side_never_serializes_the_customers_phone_number`
  and `test_vendor_side_list_filters_by_customer_name_only_never_phone`
  pin this down at the API layer: searching a vendor's chat list by the
  customer's actual phone digits returns zero results, so a vendor can't
  fish for a customer's number one digit at a time through the search box.
- **Messages use a dual identity.** `Message.public_id` (a UUID) is the
  message's real, client-facing `id`; the DB's own auto-increment `id` is
  exposed only as an opaque `cursor` for `before`/`after` pagination — the
  same "never expose a database id" rule D27 already applied to map
  markers, applied here to chat history.
- **Cursor pagination, not the app's usual `?page=&page_size=` envelope.**
  Chat history is append-only and read backwards from "now," which is what
  `before` (load older) / `after` (poll for newer) naturally fit; forcing it
  through `StandardPagination`'s page-number envelope would make the
  frontend re-derive page numbers from a cursor for no benefit. Documented
  here as a deliberate, narrow exception to the project's pagination
  convention, not an oversight.
- **Block and report reuse existing infrastructure rather than new tables.**
  Blocking is two booleans already on `Chat` (`blocked_by_customer`,
  `blocked_by_vendor`) from the Phase 0 schema; a block stops the *other*
  side from sending (`_blocked_for_sender`) but never the blocker
  themselves — the same one-way logic a person would expect ("I blocked
  them" shouldn't also mute my own outgoing messages). Reporting reuses the
  pre-existing generic `vc.moderation.Report` model
  (`target_type="vendor"` when a customer reports, `target_type="user"`
  when a vendor reports the customer) instead of a chat-specific report
  table, and both actions call `vc.audit.service.record` like every other
  moderation-adjacent action in this codebase.
- **Frontend: one pair of role-parametrised components, not four
  near-duplicate screens.** `chat/ChatListScreen.tsx` and
  `chat/ChatConversationScreen.tsx` take a `role: "customer" | "vendor"`
  prop and render the correct side (vendor's shop name + Call button vs.
  customer's name only; the quick-reply chips and "Share a product" picker
  only for `role="vendor"`, matching what the API even allows them to do).
  Four thin wrapper screens (`customer/screens/{Messages,Chat}Screen.tsx`,
  `vendor/screens/{Messages,Chat}Screen.tsx`) just supply the role and the
  right navigation target, mirroring how `NotificationsScreen` already
  exists once per role in this codebase.
- **Polling only starts after the first page has loaded**, guarded by a
  `pollBusy` ref so a slow response never overlaps the next tick. An
  earlier draft started the 3-second interval immediately on mount, which
  could race the initial `GET messages` (no `after` yet) with the first
  poll tick (also no `after` yet) and double-append the same message —
  caught before it shipped, not found via a flaky E2E run.
- **Composer is disabled only when the *other* side has blocked the
  chat**, not when the viewer blocked it themselves — matching what the
  backend actually authorizes (`test_vendor_blocking_a_customer...`: "the
  vendor who did the blocking can still send"). A composer that lied about
  this — disabled for the blocker too — would be exactly the kind of fake
  UI state this project's brief forbids; a person who blocked someone and
  still wants to send a closing message is allowed to.
- **Deferred out of this phase**: image messages and order-attached
  messages. `Message.kind` already has `image`/`order` choices in the
  Phase 0 schema, but there is no file-upload pipeline anywhere in this
  app yet (Phase 0 media storage was scoped to product photos, not built
  yet either) and no order system until Phase 8 — shipping a picker for
  either now would produce UI with nothing real behind it. `kind="product"`
  ships instead: it needed no new infrastructure (an existing active
  listing, validated to belong to the chat's own vendor) and is the one a
  customer asking "do you have X?" most directly benefits from. Customer-
  initiated product-share (e.g. a "share" action from a `SearchScreen`
  result card) is deferred too — the vendor-side picker in the conversation
  covers the primary real use case (a vendor answering with specifics), and
  a second entry point can be added without changing the message format.

## 15. Decisions added during Phase 8

### D29 — Cart, checkout, orders and payments: real revalidation, single-vendor orders, mock payment behind an abstraction

Phase 0's schema already modelled `Cart`/`CartItem`/`Order`/`OrderItem`/`OrderStatusEvent`/`Payment`
(`vc/orders/models.py`) and vendor `DeliverySettings`/`Address` (`vc/accounts/models.py`) — Phase 8
is almost entirely new endpoints and screens on top of tables that were already right. Only one
column was added: `Order.idempotency_key` (see below).

- **Cart is a live view, not a cache.** `GET /cart` always joins each `CartItem` to its listing's
  *current* price/availability — there is no "price when added" field on `CartItem`, so the Cart
  screen can never show a stale number by construction. The only place a price is ever frozen is
  `OrderItem.unit_price`, snapshotted once at order creation, exactly as the master prompt requires
  ("later vendor price changes do not alter historical orders").
- **Orders are always single-vendor** (the Phase 0 model comment already said so). The Cart screen
  groups items by vendor client-side from one flat `GET /cart` list (the same pattern
  `SearchResultSerializer` already uses — embed the vendor per row rather than nesting a
  server-side tree); each vendor group gets its own "Checkout" action, so a cart spanning two shops
  produces two independent checkouts and two independent orders, never one merged order.
- **Stock/price revalidation is a real optimistic-concurrency check, not a re-fetch-and-hope.**
  `GET /checkout/summary?vendor=&fulfilment=&address_id=` computes the same numbers the checkout
  screen shows (live price × qty per item, subtotal, delivery fee/eligibility, total) from a shared
  `build_checkout_context()` helper. The frontend caches that response as its "expected" snapshot;
  `POST /checkout` recomputes the identical numbers *inside* the order-creation transaction, with
  `select_for_update()` held on the vendor's listing rows, and compares them field-by-field to the
  `expected` block the client sends back. Any mismatch — a price change, an availability drop, a
  listing gone, delivery no longer eligible — aborts with `409 cart_changed` (or `409
  delivery_ineligible`) and a `details.changes` list of exactly what's different (old value, new
  value, per listing), which is what the checkout screen renders as "here's what changed" rather
  than a generic error. Nothing is created until the client re-confirms (re-calls checkout, which
  now matches, since "expected" was refreshed from the 409's own payload) — this is the "require
  confirmation where appropriate" requirement implemented as a real 409/retry loop, not a modal that
  always says yes.
- **A successful checkout actually consumes tracked stock (Phase 12 fix, D33).** For a while, the
  `select_for_update()` lock described above only protected the *check* — it re-validated
  `quantity >= requested` correctly, but nothing ever decremented `VendorProduct.quantity`
  afterwards, so the lock guaranteed a consistent read, not a consistent resource. Two checkouts
  against the same `quantity=1` listing (concurrent, or simply sequential) could both pass the same
  `insufficient_stock` check and both succeed — a real oversell bug, not a theoretical one. Order
  creation now decrements each ordered listing's tracked `quantity` (skipped for a listing with
  `quantity=None`, which means the vendor doesn't track a count) under the same lock, in the same
  transaction, and records an `InventoryEvent` (`client_mutation_id=order:<order id>`) exactly like a
  vendor's own manual stock edit would.
- **The transaction lock prevents two different races at once**: a vendor changing price/stock
  while a customer is mid-checkout (caught by the revalidation above), and two concurrent submits of
  the same checkout racing each other into two orders. The second is closed by
  `Order.idempotency_key` (new column, one migration) — a per-attempt UUID the frontend generates
  once and resends on any retry (network failure, a double-tap), unique per customer
  (`UniqueConstraint(customer, idempotency_key)`, `client_message_id`-style, condition
  `~Q(idempotency_key="")`). A duplicate key returns the *existing* order with `200`, never a second
  row — the same idempotent-replay shape chat's `client_message_id` already established.
- **Delivery eligibility is computed from real geometry, never trusted from the client.** The
  customer's saved `Address.location` (a `PointField`, captured the same GPS-or-skip way vendor
  onboarding already captures shop location — D27) is compared to the vendor's
  `VendorLocation.point` with GeoDjango's `Distance`, the identical function `search.py` already
  uses for geo-ranking. An address with no captured point can still be saved (manual text-only
  entry is allowed, matching how a customer might add a relative's address without standing there),
  but it cannot be used for a delivery order — `checkout/summary` reports
  `delivery_ineligible_reason="address_missing_location"` and the frontend asks for a location
  before letting delivery proceed. Radius, minimum order value and the delivery fee/free-delivery
  threshold are the vendor's own existing `DeliverySettings` row (Phase 0), now finally reachable
  from the frontend (`ShopScreen`'s "Delivery" row was a disabled "coming soon" placeholder since
  Phase 5 — Phase 8 wires it to the `PATCH /vendors/me/delivery` endpoint that already existed).
- **Payment is a small abstraction with one mock implementation, not a real gateway.**
  `vc/orders/payments.py` defines `PaymentProvider` (a `charge(order, method) -> PaymentResult`
  protocol) and `MockPaymentProvider`, selected by `get_payment_provider()`. Cash is never "charged"
  — it's collected on handover, so its `Payment.status` starts `pending` and only becomes
  `succeeded` when the order reaches its final fulfilled status. UPI/online go through the mock
  provider synchronously during checkout; it always succeeds *unless* the request body's
  `simulate_failure: true` is set (a dev/test-only field the serializer only accepts outside
  `settings.ENVIRONMENT == "production"` — production simply doesn't have a real provider configured
  yet and checkout for `online`/`upi` is refused there with a clear `payment_provider_unavailable`
  error rather than a fake success, per the master prompt's "never fake a successful real payment").
  A simulated failure aborts the whole transaction (`402`, no order row at all) — cart and stock are
  untouched, so the customer can simply retry, which is exactly what real gateway failures require
  of a client anyway.
- **Order status is a table-driven state machine, not eight near-duplicate endpoints.** One
  `POST /orders/{id}/transition` takes `{action, reason?}`; `TRANSITIONS` maps
  `(current_status, action) -> new_status`, keyed so pickup and delivery orders branch after `ready`
  (`picked_up` vs `out_for_delivery`) and rejoin at `completed`. An action not valid from the order's
  current status is `409 invalid_transition` — "Rejected order cannot become Preparing" is enforced
  by the table simply not having that entry, not by scattered `if` checks that could drift out of
  sync between endpoints. `accept`/`reject`/`preparing`/`ready`/`picked_up`/`out_for_delivery`/
  `delivered`/`completed` are vendor-only; `cancel` is customer-only and only valid while
  `status="placed"` (before vendor acceptance) — the master prompt's explicit cancellation rule.
  Every transition writes an `OrderStatusEvent` (the tracking screen's timeline), and a prepaid
  order that's rejected or cancelled has its `Payment.status` moved `succeeded -> refunded`
  (simulated, same mock provider) — cash orders that never collected payment just stay `pending`
  (nothing to refund).
- **Cross-account access is resolved the same way chat already does it.** `_get_order(order_id,
  user)` returns `(order, role)` from `order.customer_id`/`order.vendor.owner_id` against the
  authenticated user, or raises `PermissionDenied` — there is no `?as=vendor` a caller could send to
  view someone else's order, satisfying master-prompt §68 by construction, matching `_get_chat`.
- **Notifications became real, not just modelled.** `vc/notifications/service.py` adds one
  `notify(user, kind, title, body, data)` helper; every order event in the table above calls it for
  whichever side didn't cause it (vendor accepts -> notify customer; customer cancels -> notify
  vendor; etc.), writing real `Notification` rows. `GET /notifications` (+ `.../read`,
  `.../read-all`) replaces both `NotificationsScreen` placeholders that have existed since Phase 1
  with a real, working inbox — cheap to finish now that real events exist to show, and leaving the
  screens fake once the bell icon's badge could be real would itself be the "beautiful UI with fake
  data" the brief forbids.
- **A vendor's products became visible to customers for the first time.** `VendorProfileScreen`'s
  "Products" tab was a "coming soon" placeholder since Phase 3 (customers previously only ever saw
  one listing at a time, via `/search`'s geo-ranked results). `GET /vendors/{handle}/products`
  (public, paginated, active+in-stock-first ordering, no geo-ranking needed since the vendor is
  already chosen) gives that tab a real list with "Add to cart" per row — the second, and more
  discoverable, add-to-cart entry point alongside the existing `SearchScreen` result cards.
- **Deferred out of this phase, and why**: a VendorConnect-run delivery fleet (explicitly ruled out
  by the master prompt — delivery stays the vendor's own arrangement, VendorConnect only carries the
  fee/radius/minimum the vendor sets); push/SMS delivery of notifications (`NotificationPreference`/
  `PushSubscription` tables exist from Phase 0 but nothing sends to them yet — in-app is real and
  sufficient for this phase); saved payment instruments/cards (the mock provider takes a method, not
  a stored card — nothing here claims to be PCI-relevant); and partial/split refunds (a
  cancellation/rejection refund is always the full amount, matching the "no partial fulfilment" rule
  that an order is one vendor's one basket, not a bundle that could be partially returned).

### D30 — Reviews, posts, following and moderation: commerce-linked social features, not an Instagram clone

Phase 0's schema already modelled `Post`/`PostMedia`/`PostLike`/`PostComment`, `Review`/`ReviewMedia`,
`Follow`/`Favorite` (`vc/social/models.py`) and `Report` (`vc/moderation/models.py`) — Phase 9 is new
endpoints, screens, one real object-storage-backed upload pipeline, and a small set of new
constraints the Phase 0 schema was missing.

- **Reviews can only come from a genuinely completed order.** `POST /orders/{id}/reviews` (not a
  standalone `/reviews` create endpoint) is the *only* way to write a review — the view resolves the
  order the same authorization-checked way every other order endpoint does (`_get_order(order_id,
  user)`, D29), rejects with `409 order_not_completed` unless `order.status == "completed"`, and sets
  `Review.order`/`Review.listing` from the order itself rather than trusting anything the client
  sends about which order or which vendor. A `UniqueConstraint(fields=["order"],
  condition=Q(order__isnull=False))` (new migration) stops a race between two concurrent submits for
  the same order from both succeeding — the view's own pre-check is necessary but not sufficient
  against a race, so the constraint is the actual guarantee (master prompt §19/§20: no duplicate,
  no unlimited fake reviews). A review's `order` being non-null *is* its "Verified Purchase" badge —
  there's no separate boolean to keep in sync. A vendor can `PATCH` a review exactly once to set
  `vendor_reply`/`vendor_replied_at` (a second attempt is rejected — the reply is a single, dated
  response, not a thread) but can never edit the rating or text itself.
- **`Vendor.rating_avg`/`rating_count`/`follower_count` are maintained by one shared module, not
  scattered per-view aggregate queries.** `vc/social/services.py`'s `recompute_vendor_rating()` (a
  real `Avg`/`Count` over `status=published` reviews, called after every review create/hide/unhide)
  and `adjust_follower_count()` (an atomic `F("follower_count") + delta`, called from follow/unfollow)
  are the only two places these denormalized columns are ever written — the same "one function per
  invariant" shape D25 already established for the vendor summary counts, so a future write path
  (e.g. bulk review import) can't reintroduce the "beautiful UI, fake numbers" problem by forgetting
  to update a counter.
- **Posts stay commerce-linked by construction, not by convention.** `Post.linked_listings` is a
  `ManyToManyField` to the vendor's own `VendorProduct` rows (validated to belong to the posting
  vendor — a vendor can never link another shop's listing), and the customer-facing `PostCard` always
  renders a real "View Product"/"View Shop" action from that relationship, never a bare photo with no
  path back to checkout — the master prompt's explicit "VendorConnect is NOT an Instagram clone"
  requirement enforced at the data-model level rather than left to the frontend's discretion. A post
  is still allowed to link nothing (`kind="update"`, e.g. "back from holiday, reopening Monday") —
  the requirement is that a product link is always *real* when present, not that every post needs one.
  `notify_followers_of_new_post()` is a deliberately synchronous, real fan-out to `Follow` rows (no
  task queue exists in this project yet) rather than a per-like/comment notification — a discrete
  vendor action (publishing) earns a notification; likes/comments do not (master prompt §28: "do not
  create noisy notifications for every minor interaction").
- **Follow state is always server-authoritative, never frontend-only.** `GET /vendors/{handle}` and
  every list endpoint that returns a `VendorPublic` (search, nearby, following feed) annotate
  `is_following` from a real `Follow` row lookup for the *current* caller — `vendors/serializers.py`
  precomputes a `following_ids` set once per request (one bulk query) rather than one `EXISTS` query
  per row, the same batch-annotation shape `VendorSummarySerializer` already used for listing counts
  in D25. An anonymous request always gets `is_following=False` (following is inherently
  per-account), and `POST /vendors/{handle}/follow` rejects `400 cannot_follow_own_shop` server-side
  — a vendor's own shop never shows a "Follow" action it could exploit to inflate its own count.
- **Media upload is a real, validated, Pillow-backed pipeline behind a storage abstraction — not a
  stubbed pass-through.** `POST /media` accepts a multipart file; `vc/assets/uploads.py` never trusts
  the client's declared `Content-Type` or filename extension as the real file type — the
  authoritative check is Pillow actually decoding the bytes (`Image.open().verify()` then
  `.load()`), which is what "don't trust client-declared MIME types" means in practice without a
  separate libmagic dependency. A genuinely undecodable file is rejected with `400 invalid_media`
  regardless of what its extension or `Content-Type` header claimed. Accepted images are EXIF-
  oriented, stripped of all EXIF/GPS metadata (a phone photo's embedded GPS coordinates are exactly
  the kind of incidental data a vendor posting a product photo shouldn't be leaking) and re-encoded
  as WebP at three sizes (1080/480/160px, per D12) — `MediaAsset.variant_urls` always reflects real,
  separately-stored files, never one image re-served at different `<img width>`s. Video is validated
  by declared `Content-Type`/extension/size only and stored byte-for-byte: there is no
  ffmpeg/ffprobe pipeline in this project, so video duration/dimension checks, transcoding and
  thumbnail generation are **not implemented** — a documented limitation (README "Known
  limitations"), not a pretended feature. `vc/assets/storage.py` is a small `MediaStorage` protocol
  (`put`/`url`/`delete`) with one local-filesystem implementation selected by
  `get_media_storage()` — no S3/MinIO credentials are configured for this project, so swapping in
  real object storage later is a new implementation behind the same interface, not a rewrite of
  every call site (the same "abstraction now, real provider later" shape D29 already used for
  payments).
- **Admin moderation hides, it never deletes, and every action is permission-gated and audited.**
  `vc/moderation/views.py` lives under `/moderation/*` rather than `/admin/*` — the broader admin
  panel (users, vendor verification, catalog CRUD, analytics) is a future phase; this is only the
  reports/posts/reviews slice the Phase 9 spec asks for, reusing the same `IsStaffRole`/
  `admin_permission` machinery Phase 1's admin login already built (`admin_permission("moderation.
  handle_report")`, `"social.moderate_post"`, `"social.moderate_review")`, each a real Django
  `Permission` a superuser or an explicitly-granted staff account holds — never a role name string
  compared by hand). Hiding a post or review sets `status` (`published` → `hidden`/`removed`) rather
  than deleting the row, precisely so the content and its author remain visible to future moderation
  and the action leaves a trail (master prompt §25/§26: moderation must not silently destroy data).
  Every resolve/hide/unhide call writes a real `vc.audit` entry (the same audit log Phase 1's admin
  login already writes to) — who did what, to which row, when. Resolving a `Report` never touches the
  reported content by itself; an admin optionally also hides the target in the same request
  (`hide_target: true`), making "I dismissed this" and "I dismissed this and hid the post" two
  distinct, explicit choices rather than one action silently implying the other.
- **Deferred out of this phase, and why**: comment threads on posts (`PostComment` exists in the
  Phase 0 schema and is exercised in migrations, but no endpoint or screen was built — the Phase 9
  spec's worked examples center on follow/post/review, not comment moderation, and shipping
  comments without their own moderation queue would reopen the abuse surface Phase 9's moderation
  work exists to close); a real push/task-queue-backed notification fan-out for new posts (today's
  synchronous `bulk_create` is real and correct, just not horizontally scalable to a shop with
  thousands of followers); a customer-facing "for you"/ranked feed (the Following feed is a plain
  reverse-chronological query across followed vendors, not a ranking algorithm); and a broader admin
  panel beyond moderation (user management, vendor verification, category CRUD, analytics — Phase
  11, per the roadmap).

### D31 — AI-assisted product entry: an honest in-process detector, not a simulated classifier (amends D15)

D15 planned a separate `services/ai` container behind a `ProductClassifier` interface, with a
trained image classifier as the baseline model. Phase 10 builds the full vendor-facing flow end to
end, but the model layer is amended for a fact only discoverable at build time: this environment's
network allowlist blocks every route to a pretrained-model source (`huggingface.co`,
`download.pytorch.org`) and every hosted vision API (`api.openai.com`, `vision.googleapis.com`) —
confirmed by direct connection attempts, not assumed. There is no legitimate way to obtain or call a
real generic image classifier here. The master prompt's own rule for exactly this situation (§30/§35)
is explicit: never fake a classifier's output to look real, and never block the rest of the phase on
a dependency that is genuinely unavailable — implement the correct abstraction, keep every other
layer real, and document the gap plainly. This section is that documentation; `docs/AI.md` covers the
resulting provider's exact capabilities and limitations in full.

- **The abstraction D15 asked for still exists, unchanged in shape.** `vc/ai/providers.py` defines
  `ProductDetectionProvider` (a `Protocol`: `name`, `version`, `is_development`, `detect(image_bytes)
  -> DetectionResult`) exactly where D15's `ProductClassifier` was meant to sit, and
  `get_default_provider()` follows the same factory pattern already established for every other
  swappable dependency in this codebase (`get_payment_provider()` in `vc/orders/payments.py`,
  `get_media_storage()` in `vc/assets/storage.py`, `get_search_backend()` in `vc/catalog/search.py`).
  A future real model integration — self-hosted ONNX, a licensed vision API, whatever is available
  when one is — is a second `ProductDetectionProvider` implementation and a one-line factory change,
  not a rewrite of `vc/ai/detection.py`, the API views, or the frontend.
- **What ships today, `LocalDetectionProvider`, is real, just narrower than a trained classifier.**
  It does genuine barcode decoding (`pyzbar`, against `Product.barcode`) and genuine OCR (`pytesseract`
  — real Tesseract, not a stub) matched against the real product/variety taxonomy via the exact
  `TrigramSimilarity`/`ProductAlias` infrastructure `vc/catalog/search.py` already uses for text
  search (D21) — no duplicate matching logic. It deliberately does **not** implement generic visual
  classification (guessing a product from a photo with no barcode and no legible text): the master
  prompt's own line is "return 'Unable to confidently identify' instead of inventing," and for a
  provider with no classifier backing it, every photo without a barcode or legible text *is* that
  case, honestly reported rather than papered over with a hardcoded guess.
- **`is_development = True` is a hard property of the provider, not a UI toggle someone could flip
  for a demo.** Every `AIDetectionSerializer` response includes it, and `VendorScanConfirmScreen`
  always renders a "Development scanner" disclosure line — the master prompt's requirement that a
  dev/test provider is never presented as production AI is enforced in the data the frontend
  receives, not left to a screen remembering to say so.
- **No separate `services/ai` process was built.** D15's rationale for process isolation — model
  upgrades and GPU/CPU sizing shouldn't touch the API — is a real concern for a served neural
  network, and does not apply to `pyzbar`/`pytesseract`, which are ordinary in-process library calls
  with no GPU, no large weights to load, and no independent scaling story. Running them inside the
  Django app (`vc/ai/`) is the proportionate choice for what this provider actually is; it also
  avoids inventing a second HTTP service with a fake-looking "model" behind it just to match a
  diagram written before this constraint was known. If a real trained model is integrated later and
  genuinely needs its own process/GPU lifecycle, that is the point to revisit this and stand up
  `services/ai` for real — not before.
- **Every provider response is re-validated server-side before it is trusted.**
  `vc/ai/detection.py::_sanitize_prediction()` re-resolves any provider-claimed product/variety
  against the real database rather than trusting the provider's slugs, and clamps confidence into
  `[0, 1]` — this is what makes "malformed provider response" (master prompt §21/§26) a handled case
  with real test coverage (`test_malformed_provider_response_is_sanitised_not_trusted`) rather than an
  assumption that a future, different provider will always return clean data.
- **Market price suggestions are real-source-or-absent, never invented.** `MarketPrice` is a real,
  Phase-0 model with no data-ingestion pipeline built yet (no Agmarknet or equivalent feed exists in
  this project) — `_suggest_price()` queries it honestly and returns `null` when it's empty, which the
  frontend renders as "Market price unavailable," never a fabricated number. Seeding a real price
  source is unchanged future work, tracked in `docs/AI.md` and the roadmap, not something Phase 10
  worked around with placeholder data.
- **A minimal, read-only admin page exists for `GET /admin/ai/detections`.** The Phase 10 hardening
  pass judged the endpoint's total absence from the admin sidebar — not even a "Coming in Phase 11"
  placeholder, unlike every other unbuilt admin domain — a genuine inconsistency with the rest of the
  admin app's own "section shell" pattern, so `apps/admin/src/App.tsx`'s `AIDetectionsSection`
  (~55 lines) adds exactly one filterable, paginated table (vendor, detected text/barcode, confidence,
  provider, vendor-corrected?, status, when) mirroring `ReportsSection`/`ReviewsModerationSection`'s
  existing shape. It takes no actions — there is nothing to action here, confirm/reject already
  happens on the vendor's own device — so it is deliberately not a moderation queue, just visibility
  onto data that already existed.
- **A black-box runtime smoke test proves the OS-level runtime, not just the Python code.**
  `services/api/scripts/ai_smoke_test.py` is a stdlib-only HTTP client (no `requests`, so it needs no
  extra install to run against a bare container) that drives the full real flow — signup, image
  upload, OCR, barcode, taxonomy match, confirm, cross-vendor 404 — against a *running instance*, to
  catch what `pytest` structurally cannot: a Dockerfile with correct Python packages but a missing
  system package still passes every unit test and 500s on every real request. It is wired into CI as
  the `ai-runtime-smoke-test` job (`.github/workflows/ci.yml`), which builds the real `dev`-target
  image and gates the `docker`/deploy jobs on it passing.
  One finding from building it is worth recording: `pyzbar` loads `libzbar.so.0` via
  `ctypes.cdll.LoadLibrary` **at import time**, so a container missing `libzbar0` fails to boot at all
  (the whole Django process crashes before serving a single request) — verified by removing the
  library and restarting the server process fresh. `pytesseract`, by contrast, only shells out to the
  `tesseract` binary lazily, per OCR request — a container missing `tesseract-ocr` boots fine and
  silently returns empty OCR text instead of erroring, a much quieter failure mode. Both facts drove
  `services/api/Dockerfile`'s explicit `tesseract-ocr tesseract-ocr-eng libzbar0` install (see the
  Dockerfile's own comment for why `tesseract-ocr-eng` is listed explicitly rather than left to
  transitive resolution).
- **The AI-scan E2E suite's vendor location is test-data isolation, not a production constraint.**
  `tests/e2e/ai-scan.spec.ts` creates real vendors with real listings via real OCR, and deliberately
  geolocates them in Sonipat (~55 km from the shared Gurugram cluster `search.spec.ts`/
  `vendors.spec.ts` assert fixed nearby-result counts against) — outside `SEARCH_RADIUS_KM_MAX`
  (25 km) so these real listings can never leak into another suite's unrelated fixed-count assertion.
  This is purely a test-fixture choice to keep suites independent; no application code reads or
  depends on this distance, and a real vendor onboarding anywhere, including inside that same 25 km
  radius, behaves identically regardless of which E2E suite happens to be running.
- **Docker build verification remains environment-blocked, not skipped.** This sandbox's network
  policy rejects every `docker.io` registry pull with `403 Forbidden` — confirmed down to the
  buildkit `# syntax=docker/dockerfile:1.7` frontend directive pull, meaning `docker build` fails
  before even resolving `FROM`, not a missing-daemon issue. The Dockerfile's OS-dependency
  correctness (tesseract/zbar packages, and the runtime smoke test above) has been reviewed and
  tested as thoroughly as this sandbox allows; an actual `docker build` + container boot + smoke-test
  run must happen in CI or an unrestricted environment before Phase 10's Docker verification can be
  called complete.
- **Deferred out of this phase, and why**: a trained generic image classifier (blocked by this
  environment's network policy, not skipped by choice — see above); a `services/ai` process split
  (no real model yet needing the isolation it exists to provide); ingesting a real market-price feed
  (no source is wired up; the honest "unavailable" state is the correct behaviour until one is).

### D32 — Admin back-office (Phase 11): reused permission architecture, no new RBAC, no fabricated business rules

Phase 11's mandate was an admin back-office over Users, Vendors, Catalog, Orders, Audit Logs and an
operational Dashboard — built by wiring up real, already-existing infrastructure and schema that
earlier phases had defined but never surfaced, not by designing a new admin subsystem from scratch.
The repository audit (master prompt's own required first step) found more dormant machinery than
expected, which shaped every decision below.

**What the audit found already real, but unwired:**

- `vc.audit.models.AuditLog` + `vc.audit.service.record()` had been writing rows since Phase 1 (auth,
  vendor, catalog, social, moderation, ai, chat, orders all call it) with **zero read endpoint** —
  Phase 11 is the first surface over this trail, not a new logging system.
- `core.permissions._admin_session()` / `IsStaffRole` / `admin_permission(perm)` already existed
  (Phase 8/9's moderation and AI admin views use exactly this coarse-list/fine-action split) and
  needed no changes — every new Phase 11 endpoint reuses it unmodified.
- `Vendor.verification_status` / `verified_at`, the `VendorVerification` model, and the
  `Vendor.Meta.permissions` entries `verify_vendor` / `suspend_vendor` had existed since Phase 0/8
  with no view ever referencing them.
- `User.is_active` / `suspended_at` / `suspension_reason` existed on the model with no admin path to
  set them.

Because all of this was already real schema and already-established permission plumbing, Phase 11
added **one** new Django permission in total — `accounts.manage_users` (`User.Meta.permissions`) —
and reused every other check as-is. This is deliberate: the master prompt's "reuse Django's built-in
permission system... do not over-engineer a new RBAC system" is satisfied by construction rather than
by restraint, because a working coarse/fine split already existed to reuse.

**New read/action surfaces, one Django app each, same shape throughout** — a `StandardPagination`
list view gated by `IsStaffRole`, and (where the action is a mutation) a second view gated by
`admin_permission("<app>.<perm>")`, with every mutation calling `audit.service.record()`:

- `vc/audit` — `GET /admin/audit-logs` (`AdminAuditLogListView`): filterable by `action`, `actor`
  (phone or id), `target_type`, `target_id`, `date_from`/`date_to`. Deliberately **read-only with no
  detail/edit/delete route at all** — "audit logs are append-only from the admin UI" is enforced by
  there being no code path that could mutate a row, not by a permission check that a superuser could
  bypass. `ip_hash`/`request_id` are excluded from `AuditLogSerializer` (operational fields, no
  moderation value, smaller exposure surface).
- `vc/core` — `GET /admin/dashboard` (`AdminDashboardView`): every figure is a live aggregate query
  computed at request time — nothing cached, nothing seeded, nothing estimated. `range` (`today` /
  `7d` / `30d` / `custom`) resolves to a `(start, end)` window via `_resolve_range()`, and
  `AdminDashboardSerializer`'s nested serializers each carry a `help_text` stating whether that field
  is period-scoped (new users, orders placed, AI detections) or current backlog/state (open reports,
  hidden content, vendor totals) — so no number on the page is ambiguous about what it counts.
  Analytics was folded into this single dashboard rather than built as a second section, since the
  master prompt asked for real DB-backed metrics, not a separate BI surface (explicitly out of scope).
- `vc/accounts` — `GET /admin/users`, `GET /admin/users/{id}`, `POST /admin/users/{id}/suspend`,
  `POST /admin/users/{id}/restore` (list/detail: `IsStaffRole`; suspend/restore:
  `admin_permission("accounts.manage_users")`). Suspending rejects `request.user.id == user_id` with
  `cannot_suspend_self` — not asked for explicitly, but a direct consequence of "never silently modify
  accounts" applied to the admin's own account. A suspended user's next OTP verify is rejected with
  `403 account_suspended`.
- `vc/vendors` — `GET /admin/vendors`, `GET /admin/vendors/{handle}`,
  `POST /admin/vendors/{handle}/verify` (`decision: verified|rejected`, writes a `VendorVerification`
  row and updates `Vendor.verification_status`/`verified_at`), `POST .../suspend`, `POST .../restore`
  (list/detail: `IsStaffRole`; verify: `admin_permission("vendors.verify_vendor")`; suspend/restore:
  `admin_permission("vendors.suspend_vendor")`). Routes use the vendor's handle, matching the existing
  public `VendorByHandleView` convention, not a UUID. The admin list intentionally includes suspended
  vendors (invisible on the public list) — that visibility gap is the point of the surface.
- `vc/catalog` — `GET /admin/products` (cross-vendor `VendorProduct` listing; excludes soft-deleted
  listings unless `status=deleted` is passed explicitly) and `GET /admin/categories` (taxonomy with
  real annotated `product_count`/`listing_count`/`vendor_count`), both `IsStaffRole`, both read-only —
  there is no admin path that writes a vendor's own price or stock; that stays exclusively the
  vendor's own `PriceView`/`InventoryView`.
- `vc/orders` — `GET /admin/orders` (search by order number/customer name/vendor handle; filter by
  `status`/`fulfilment`) and `GET /admin/orders/{id}` (`IsStaffRole`, both read-only — no
  refund/payment action was built; `_settle_payment` inside the existing checkout/transition flows
  remains the only writer of `Payment` rows). The detail view deliberately reuses the same
  `OrderSerializer` the customer and vendor sides already see, including its existing omission of the
  customer's phone number (`_OrderCustomerRefSerializer`, D14/D29's privacy rule) — an admin support
  view needs the same information a vendor sees to answer "what happened to this order," no more.

**Platform settings — documented gap, not invented.** The audit found no platform-wide
settings/feature-flag model anywhere in the backend: `DeliverySettings` is per-vendor and
`PrivacySettings` is per-user; neither is a platform configuration concept an admin screen could
honestly expose. Per the master prompt's own rule ("if a requirement cannot be implemented because
the backend does not contain the required business concept: STOP and report the exact dependency
instead of inventing a new business rule"), no settings endpoint or model was built. The admin
frontend's Settings section says this plainly instead of showing a fabricated form.

**Security posture carried through unchanged from Phase 8/9's own conventions**: every admin
endpoint is gated server-side (no frontend role flag is ever trusted alone — `IsStaffRole` re-checks
the JWT's `adm` claim and the user's real Django roles/permissions on every request); every mutating
admin action writes a real `AuditLog` row via the same `audit.service.record()` every other app
already used; sensitive fields are excluded at the serializer level (no password/OTP/token field on
any user row, no `ip_hash`/`request_id` on any audit row, no customer phone on any admin order view);
and cross-tenant visibility is the admin surface's entire purpose (an admin sees every vendor's
suspended shop, every customer's orders) rather than something to guard against, unlike the
customer/vendor-facing endpoints it sits alongside.

Backend test coverage added for this phase: `accounts` (12), `vendors` (10), `catalog` (8), `orders`
(9), `audit` (12), `core` dashboard (9) — 60 new passing tests, each exercising a real end-to-end
flow (a real OTP/password+OTP admin login, a real mutation, a real re-read) rather than calling
internal service functions directly, matching this codebase's existing test convention.

### D33 — Phase 12: production hardening, reliability, security & CI verification

Phase 12's mandate was explicitly *not* new product features but closing genuine production-readiness
gaps — the master prompt's own words were "do not invent issues just to create work" and "do not
assume something is missing until you inspect the existing implementation." So the phase started with
a read-only audit (nine focused passes: auth/authz, uploads, rate limiting, DB integrity/transactions/
concurrency, logging/observability, dependency reproducibility, CI/Docker/AI-smoke-test, performance,
test-reliability/accessibility) before any code changed, and every fix below traces to something the
audit — or, in two cases, direct verification against source — actually found, not a hypothetical.

**Fixed — genuine bugs, not hardening-for-its-own-sake:**

- **Checkout didn't consume stock it had just checked** (`vc/orders/views.py`) — the single most
  significant finding. `select_for_update()` correctly re-validated `quantity >= requested`, but
  nothing decremented `VendorProduct.quantity` afterwards, so the lock protected a *check*, not a
  *resource*: two checkouts against a `quantity=1` listing could both pass and both succeed. Fixed by
  decrementing under the same lock, in the same transaction, and writing an `InventoryEvent` — see
  D29's own updated bullet above. Regression test proves the *second* checkout is genuinely blocked
  (`409 items_unavailable`), not just that the first one's math is right.
- **`SMS_PROVIDER=console` was reachable outside development** (`config/settings/prod.py`) — the
  guard used to also require `ENVIRONMENT == "production"`, which meant loading `prod` settings
  (`DJANGO_SETTINGS_MODULE=config.settings.prod`) while that separate env var was unset or
  misconfigured would silently keep the dev-only console SMS "provider" active — OTPs logged instead
  of sent, in what is otherwise a production deployment. Loading `prod` settings at all is already
  the production signal (the file's other two guards, `SECRET_KEY` and `OTP_DEV_ECHO`, never had the
  extra condition either); this one now doesn't, and can't be bypassed by a second misconfigured
  variable. Covered by a new settings-module-reload test suite (`test_prod_settings.py`).
- **`AdminVendorVerifyView` wrote its audit row and the vendor's live status as two independent,
  unwrapped saves** (`vc/vendors/views.py`) — if the second write failed after the first committed
  (a DB blip, a dropped connection), the decision would exist in the audit trail forever with no way
  to tell from the vendor's own row that it had ever happened. Wrapped in one `transaction.atomic()`
  block; regression test forces the second write to fail and asserts *neither* row survives.
- **Two real N+1 query patterns**: `GET /admin/users` issued one query per row for both `roles` and
  `vendor` (`role_codes()`'s `.values_list()` and `.exclude().first()` each re-query even after
  `prefetch_related`, since DRF/Django's field-level query methods always clone-and-re-fetch rather
  than reading a prefetch cache — fixed by having both read the prefetch cache directly when present,
  falling back to the original per-object query otherwise); chat message listing issued one query per
  product-share message for its `listing` FK (fixed with `select_related("listing")`). Both have a
  regression test asserting query count stays flat as row count grows, not just that the numbers are
  right for one fixed page size.
- **An unhandled exception on any `/api/` route leaked Django's default HTML debug/error page** — no
  `handler500` existed, so any bug DRF's own exception handler didn't already catch would fall through
  to Django's default view, which either shows a full traceback (`DEBUG=True`) or a generic HTML page
  that doesn't match this API's `{"error": {...}}` envelope. Added `vc.core.exceptions.handler500`,
  wired in `config/urls.py`: `/api/` routes get the standard JSON envelope (logged server-side with
  the request ID, never in the response body); everything else keeps Django's own default page
  unchanged (there is no `/django-admin/`-hardening reason to touch it).
- **Video upload accepted a mismatched content-type/extension pair and stored under the filename's
  extension** (`vc/assets/uploads.py`) — `_guess_kind` used *or* logic (either signal being
  video-like was enough), and the stored file's extension came from the client-supplied filename, not
  the verified content-type. Now both signals must independently indicate video, and the stored
  extension is derived from `content_type` — a mismatched pair is rejected outright rather than
  silently trusting whichever signal was more convenient.
- **`OpenAPI` schema generation warned on `SearchResultSerializer.category`** — a plain
  `serializers.Serializer` (no `Meta.model`) made a `SlugRelatedField` under-specified. Not a security
  or correctness issue (the warning's own fallback — `string` — was already correct), but genuinely
  fixable: converted to a `SerializerMethodField` returning the same slug string. (A first attempt
  used `@extend_schema_field` directly on the field instance, which looked right but doesn't actually
  survive DRF's `Field.__deepcopy__` reconstructing a fresh instance from constructor args on every
  serializer use — caught by re-running `spectacular --validate --fail-on-warn` after the "fix" still
  showed the same warning, which is exactly the kind of claim this phase's rule against unverified
  fixes exists to catch.) `spectacular --validate --fail-on-warn` now passes with zero warnings across
  the entire schema, not just this one field.

**Added — real gaps the audit found, not invented ones:**

- **Four new rate-limit scopes** (`vc/core` `DEFAULT_THROTTLE_RATES`, `config/settings/base.py`):
  `ai_detection` (30/hour — real CPU-bound OCR/barcode inference, not cheap CRUD), `media_upload`
  (60/hour — image decode/re-encode cost), `chat_message` (60/min, POST only — polling stays
  unthrottled; ownership checks alone don't cap message-flooding between two already-authenticated
  accounts), `report_submit` (20/hour, shared across chat/post/review reports — same abuse shape).
  Each has a regression test proving the limit actually triggers (`monkeypatch`ing the throttle
  class's `rate` directly, since overriding `settings.REST_FRAMEWORK` at runtime does *not* affect
  DRF's already-import-time-bound `SimpleRateThrottle.THROTTLE_RATES` class attribute — a real gotcha
  the first test attempt hit and silently didn't catch anything until traced down). `chat_message`
  started at 30/min and was raised to 60/min after the existing pagination regression test (which
  legitimately sends 35 messages in one burst to populate more than one `PAGE_SIZE=30` page) started
  failing under it — exactly the "don't break legitimate usage" case the master prompt warned about,
  caught by actually re-running the full existing suite rather than only the new throttle tests.
- **Early oversized-upload rejection + `client_max_body_size`** (`vc/assets/views.py`,
  `infrastructure/docker/nginx-spa.conf`) — the app-level size check ran *after* `f.read()` had
  already buffered the whole file; moved earlier so an oversized upload fails fast. Separately, nginx
  had no `client_max_body_size`, so Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` (which doesn't apply to
  multipart file parts) was the only real ceiling — added `55m` at the correct layer for this
  Django-behind-nginx architecture.
- **`django` logger double-emission** and **`CORS_EXPOSE_HEADERS`** missing for `X-Request-ID`
  (`config/settings/base.py`) — the latter meant the header was set on every response but invisible
  to cross-origin browser JS (the SPA's own origin), defeating half its point as a client-side
  correlation aid.
- **Admin list race condition** (`apps/admin/src/App.tsx`) — the specific Phase 11 finding this phase
  was asked to revisit (§20): every list section shares a `useCallback(load) + useEffect(load, [load])`
  shape, and a stale (slower, older) response landing after a newer one could silently overwrite the
  screen. A full `AbortController` integration wasn't possible without changing the shared
  `@vc/api-client` (which doesn't take a signal), so — per the prompt's own "do not overengineer it" —
  a `useStaleGuard()` generation-counter hook was added once and applied to all 11 list sections
  uniformly, with a direct `renderHook`-based regression test proving a stale response's `isCurrent()`
  check fails once a newer request has started.
- **Admin table rows had no keyboard/screen-reader path** — a bare `<tr onClick>` (Users/Vendors/
  Orders) has no focus stop and isn't announced as interactive. Added a small `rowActivation()` helper
  (`role="button"`, `tabIndex`, Enter/Space handling) applied to the same three sections, with a
  regression test for both the ARIA attributes and the Enter/Space activation.
- **`.dockerignore` didn't exclude `.venv`** (223MB) or `.ruff_cache` — both Dockerfile stages
  `COPY . .` the whole build context after already `pip install`-ing into the image's own
  site-packages, so the host's local dev tooling was being copied into the image for zero runtime
  benefit.
- **Playwright's default worker parallelism could race spec files against each other** — `chat`,
  `orders`, `social`, `screenshots`, `search`, `vendors` (web project) and `admin` (admin project) all
  exercise the *same* seeded vendor (`@SHARMA001` / `+919990000001`) from `run-stack.sh`'s fixed seed
  data; nothing scopes them to run one at a time. Set `workers: 1` in `tests/e2e/playwright.config.ts`
  — broader than only the files first suspected (an audit of read/write usage file-by-file would have
  been the "clever" fix; forcing serialization is the one that doesn't require proving which uses are
  safe to parallelize). Costs some CI wall-clock time; the full 38-spec suite still runs in ~3 minutes
  serialized.

**Investigated and confirmed already correct — no change made:**

- **Django-side CSP** — an audit pass flagged "no CSP anywhere" as a gap. False: `nginx-spa.conf`
  (the layer that actually serves HTML to browsers in this API-serves-JSON/nginx-serves-SPA
  architecture) already sets one. Adding a second, Django-side CSP header would either duplicate or
  conflict with it for no benefit.
- **Playwright version drift** — Phase 11 had found `^1.50.0` resolving to `1.63.0` against an
  environment expecting `1.56.1`. Re-verified directly this phase: `package.json` pins an exact
  `"1.56.1"` (no caret), `package-lock.json` resolves it to exactly `1.56.1` throughout, and CI's
  `npm ci && npx playwright install --with-deps chromium` installs the matching browser build for
  that exact package version — already properly resolved, no drift, no action needed.
- **`ai-runtime-smoke-test` CI job** — confirmed it is a real, wired-in job (`needs: [e2e]`, and the
  final `docker` job in turn `needs: [e2e, ai-runtime-smoke-test]`, so a failure here blocks the image
  push), not orphaned YAML. The job itself builds the Docker `dev` target and runs
  `scripts/ai_smoke_test.py` against it — this repo's sandbox cannot execute that exact path (Docker
  Hub registry pulls are network-blocked here; see Docker verification below), but the same script was
  run directly against a locally-started `manage.py runserver` instance with this host's own installed
  `tesseract`/`libzbar0` and passed every step end-to-end (real OCR text `'TAMATAR HYBRID'` extracted,
  real barcode `4006381333931` decoded) — genuine evidence the underlying runtime path works, short of
  proving the container image specifically.
- **ALLOWED_HOSTS / CORS_ALLOWED_ORIGINS / CSRF_TRUSTED_ORIGINS having no startup validation** — an
  audit pass flagged the absence of an explicit non-empty check. Not a genuine gap: an empty value for
  any of these fails obviously and immediately (every request rejected, or CORS/CSRF failing closed),
  not silently insecure — there's no scenario where a misconfiguration here quietly passes and only
  becomes a problem later. Left as-is rather than adding validation for validation's sake.
- **`SECRET_KEY`-derived `JWT_SIGNING_KEY`/`OTP_HMAC_KEY` defaults, and cookie `SameSite` defaults** —
  reviewed, both common and acceptable practice; not changed.

**Deferred, with reasons on record:**

- **`web.Dockerfile` USER/non-root + HEALTHCHECK changes** — this sandbox cannot pull base images
  from Docker Hub (see below), so any change here is unverifiable blind; too risky to make without a
  real build to check against. Left for a session where Docker verification is actually possible.
- **A dedicated search-endpoint throttle** — lower-confidence, lower-priority than the four scopes
  added; the existing generic anonymous budget (120/min) was judged adequate for now.
- **`pytest==8.*` (installed 8.4.2)** has a known advisory, `PYSEC-2026-1845`, fixed in `9.0.3`: a
  predictable `/tmp/pytest-of-{user}` directory name on UNIX that a *local* user on the same machine
  could exploit — never reachable by the deployed application (pytest isn't in `requirements.txt`,
  never runs in production) and only relevant to whoever else has a shell on the same CI runner/dev
  box. `8 -> 9` is a major-version jump for a deeply-integrated test framework (plugin API surface
  shared with `pytest-django`/`pytest-cov`); not upgraded solely to silence this advisory, per the
  master prompt's explicit instruction not to force a breaking test-tooling upgrade for that reason.
  Planned resolution: revisit alongside a deliberate `pytest-django`/`pytest-cov` compatibility check,
  not as a standalone bump.
- **`@vitest/mocker` (via `vitest`)** has a moderate advisory, `GHSA-82fw-gwwq-j7x9` (path traversal /
  arbitrary file read via a redirect mock), affecting the installed `vitest@3.2.7`. `npm audit`'s own
  suggested fix is `vitest@5.0.2` — two major versions ahead, a breaking change for the whole test
  suite's mocking API. Dev-only tooling (`npm audit --omit=dev` — the actual production dependency
  set — reports zero vulnerabilities); never shipped, never reachable from a deployed instance.
  Planned resolution: a deliberate, tested `vitest` major-version migration, not a forced audit-fix.

**CI / Docker verification.** Docker Engine (daemon + CLI) is present in this sandbox and does start,
but every image-pull attempt against Docker Hub (`registry-1.docker.io`) — including the base
`python:3.11-slim-bookworm` layer and the `docker/dockerfile:1.7` buildx syntax directive — is
rejected with a direct `403 Forbidden` by the sandbox's network policy, confirmed by trying both a
full `docker build` and a bare `docker pull`. **Docker build: BLOCKED — registry/network
limitation.** This is a sandbox constraint, not a project defect: `services/api/Dockerfile` and
`infrastructure/docker/nginx-spa.conf` were still reviewed and hardened (`.dockerignore`, body-size
limit) on their merits, and the CI workflow's own `docker`/`ai-runtime-smoke-test` jobs (which run on
real GitHub Actions runners with real registry access) were read in full and confirmed correctly
wired rather than assumed.

**Full regression gate, this phase**: backend `pytest` 414/414 passed; frontend `vitest` 131/131
passed; E2E `playwright` 37/37 passed (1 intentionally skipped — `screenshots.spec.ts`'s opt-in
capture test, gated behind `SHOTS=1`, not a functional test); `tsc` typecheck (both apps) clean;
`eslint .` clean; `manage.py check` clean; `manage.py check --deploy` clean (zero warnings, prod-like
settings); `makemigrations --check --dry-run`: no changes detected; `spectacular --validate
--fail-on-warn`: zero warnings, zero errors; `bandit -r vc config`: zero findings; `pip-audit -r
requirements.txt`: zero known vulnerabilities; `npm audit --omit=dev --audit-level=high`: zero
vulnerabilities.

### D34 — Phase 13: AWS deployment implementation (Terraform IaC + real CI/CD deploy stages)

Phase 13's mandate was to move from D33's audit findings to actual implementation: infrastructure as
code for the architecture the AWS Deployment Readiness Audit recommended, the missing S3 media
storage backend, and the CI/CD pipeline's two placeholder deploy stages. The explicit instruction was
not to re-audit and not to invent a different architecture than what the audit had already justified
line-by-line against this repository's real code — every module below traces to a specific audit
finding, not a generic "best practice" checklist.

**Terraform IaC** (`infrastructure/aws/`) — one module per real requirement the audit found (network,
ECR, DNS/ACM, ALB, ECS, database, redis, storage, secrets, IAM, CDN, monitoring), wired into two
environment roots (`staging`, `production`) plus a third, `shared`, added specifically to fix a real
bug: `modules/ecr` names repositories `"${project}/${image}"` with no environment segment, and an AWS
account permits only one GitHub Actions OIDC provider per URL — both are genuinely account-wide, so
giving staging and production each their own copy (the first draft) would fail with "already exists"
the moment both were applied to the same account. `shared` owns both instead, applied once;
`staging`/`production` look the ECR repos up by a `data "aws_ecr_repository"` block and disable their
own OIDC-provider creation, matching the CI/CD pipeline's own "build once, promote" shape (one image,
pushed once, deployed to both environments without a rebuild). RDS uses `manage_master_user_password`
so Terraform never holds or prints the DB password directly; the composed `DATABASE_URL`/`REDIS_URL`
secrets Django's `env.db()` needs are assembled from that RDS-managed secret plus the ElastiCache auth
token via `jsondecode`/`data.aws_secretsmanager_secret_version`. GitHub Actions authenticates via
OIDC (`aws_iam_openid_connect_provider`, trust scoped to `repo:${org}/${repo}:*`) — no long-lived AWS
keys anywhere. IAM has four roles total (ECS task execution, ECS task, GitHub deploy, and the OIDC
provider's own trust) — never `AdministratorAccess` — each scoped to exactly the resource ARNs it
needs, including the GitHub deploy role's S3-sync/CloudFront-invalidation permissions being scoped
per-environment to that environment's own web/admin bucket and distribution only, never the other
environment's. CloudFront's response-headers policy reproduces every security header
`nginx-spa.conf` used to set (CSP and Permissions-Policy included — an initial pass had ported over
only 4 of the 6, since the AWS provider splits "declared" security headers like CSP from arbitrary
ones like Permissions-Policy into two different resource blocks), since there is no nginx process left
once web/admin move to S3+CloudFront static hosting.

**S3 media storage** (`vc/assets/storage.py`) — `S3MediaStorage`, a second, additive implementation of
the pre-existing `MediaStorage` protocol (alongside `LocalMediaStorage`), selected by
`MEDIA_STORAGE_BACKEND` env var; callers (`uploads.py`, `serializers.py`) needed zero changes, exactly
like `vc/orders/payments.py`'s existing provider-swap pattern. Every object is private (Block Public
Access, no ACLs) and reachable only via a time-limited presigned URL — there is no public/CDN-cached
asset class in this app's real data model to justify anything else (AI-scan detections reuse the same
`storage_key` as ordinary uploads). Storage keys are always server-generated UUIDs
(`uploads.py`), so `_safe_key()`'s path-traversal rejection is defense-in-depth, not closing an
exploitable gap. Tested with `moto[s3]` — a real, in-process, mocked S3 — proving the backend actually
works without needing a real AWS account to run its test suite.

**CI/CD** (`.github/workflows/ci.yml`) — the two `echo`-only placeholder jobs became real deploy
logic. API: register a new ECS task-definition revision pointing at the freshly-pushed image, run
database migrations as a one-off task from *that* revision, verify its exit code, and only then move
the live service onto it (`update-service` + `wait services-stable`) — a migration failure fails the
job before traffic ever moves, and the previous revision keeps serving untouched. Web/admin: sync the
already-built SPA (uploaded as a build artifact by the `web` job, never rebuilt) to that environment's
S3 bucket, invalidate its CloudFront distribution, then smoke-test not just that the SPA loads but
that CloudFront's `/api/*` same-origin routing genuinely reaches the real API (`GET /api/v1/schema/`
returning a real OpenAPI document, not the SPA's `index.html` — the custom error response that makes
client-side routes work on refresh would otherwise silently mask a routing misconfiguration as a
"passing" 200). Production reuses the exact image tag and static build that passed staging — never a
rebuild — gated by a GitHub Environment's required-reviewer protection rule (a repository setting,
not something Terraform configures). The registry itself moved from `ghcr.io` to the shared ECR from
`environments/shared`, per the audit's own recommendation.

**While verifying this phase's own regression gate, two real, pre-existing (not phase-13-introduced)
bugs surfaced and were fixed, both in test-only code with zero effect on application behavior:** a
`vc/core/tests/test_admin_dashboard.py` import pattern that shadowed two pytest fixtures with same-
named function parameters, tripping `ruff`'s F811 on every use (fixed by moving the cross-app fixture
re-export into a proper `vc/core/tests/conftest.py`, matching the pattern `vc/social`, `vc/moderation`
and `vc/ai`'s own test suites already use); and four files `ruff format` had never been run against.
Both are evidence that Phase 11's own regression-gate tasks (§143–146 in the project's task list) were
never actually completed — this phase does not attempt to backfill that gap beyond what blocked its
own gate.

**What is verified vs. not, this phase.** Everything reachable without a real AWS account or a working
Docker daemon was: the full backend/frontend/E2E suites (pytest 425/425, vitest 131/131, playwright
37/38 — 1 intentionally skipped), `manage.py check --deploy` against real prod-settings env vars,
`bandit`/`pip-audit`/`npm audit` (all clean), and the Phase 10 AI runtime smoke test run directly
against a live `manage.py runserver` instance (real Tesseract OCR, real pyzbar barcode decode — proves
the application-level AI runtime, not the specific Docker image's OS packages). Not verified, and not
claimed: Terraform was never run through a real `terraform validate`/`plan`/`apply` (no Terraform CLI,
no network path to the Terraform registry or any AWS API in this sandbox — reviewed by hand and
checked for valid HCL syntax and internal consistency with `python-hcl2` instead, which is not the
same thing); the built container image's OS-level dependencies were never proven, because the Docker
daemon in this sandbox cannot start at all (`Cannot connect to the Docker daemon`, `ulimit: error
setting limit (Operation not permitted)` — a *stricter* constraint than D33's finding for the same
sandbox family, which had a running daemon blocked only on Docker Hub registry pulls; environments of
this kind evidently vary run to run, so this is reported as directly observed this session, not
assumed carried over from D33). Neither limitation is a code defect in this repository.

**A genuine, unresolved application-code gap, unrelated to AWS infrastructure**: `services/api/vc/accounts/sms.py`'s
`Msg91SmsProvider`/`TwilioSmsProvider` are both unimplemented stubs whose `send_otp()` always raises
`RuntimeError`, and `config/settings/prod.py` refuses `SMS_PROVIDER=console` at boot. As things stand,
**no valid `SMS_PROVIDER` setting makes OTP login work in a real deployed (prod-settings) environment**
— no amount of Terraform or CI/CD work changes this; it needs a real adapter (or real MSG91/Twilio
credentials wired into that file) before OTP login can work anywhere but a local dev/CI console.

### D35 — Terraform module-dependency-graph audit: four real cycles found and fixed (amends D34)

D34 shipped `infrastructure/aws/` with a section in `infrastructure/aws/README.md` ("Why the
cross-module wiring isn't a cycle") asserting that several modules which take each other's outputs
as inputs don't actually form a cycle, because it's never the same resource on both sides. That
assertion was checked by hand, not computed — and a follow-up module-dependency-graph audit (the
same kind of check a `terraform graph` render or a third-party Terraform linter performs) found it
was wrong for four of the module pairs it covered.

**What a dependency-graph audit means for Terraform, precisely.** Terraform's real execution graph
(what `terraform plan`/`apply` build) operates at *resource* granularity: a resource inside a module
only depends on the specific `var.X`/`local.X`/resource references it literally contains, not on
every input the module call as a whole happens to receive. Two modules can reference each other's
outputs without a true cycle, provided the specific resources behind those outputs don't loop back.
A *module-level* (coarse) graph — module A depends on module B if any input of A references any
output of B — is coarser and can show a cycle the fine-grained resource graph resolves. D34's README
section relied on this fine-grained argument, asserted by hand for each pair it named.

**The tool.** No `terraform` CLI is available in this sandbox (re-confirmed for this task: `which
terraform` empty, `curl` to `registry.terraform.io` and `sts.amazonaws.com` both fail). A
purpose-built static analyzer was written instead
(`infrastructure/aws/` was parsed with `python-hcl2`, one merged AST per module directory and per
environment root), building two graphs and running real cycle detection (Tarjan's strongly-connected
-components algorithm) on both:

- **Fine graph** — node = a specific resource/data/output/variable inside a specific module.
  Edges follow actual references, resolved across module boundaries via each root's `module "X" {
  arg = <expr> }` call sites and each module's own `output "Y" { value = <expr> }` blocks. This is
  the graph whose acyclicity actually determines whether Terraform can build a valid execution order.
- **Coarse graph** — node = module name. Edge A → B if any input of A's module call references any
  output of B. This is the human/tool-visible view.

This is explicitly **not equivalent to `terraform validate`/`terraform plan`** — it cannot catch
provider-schema errors, type mismatches, or anything requiring an actual provider plugin. It answers
one narrower question as rigorously as static analysis without the real CLI allows: does the
reference graph these files imply contain a true cycle.

**A bug in the tool itself, caught before trusting its output.** The first run of this analyzer
reported both graphs as acyclic — including the coarse graph, which was already known (from a
first-principles read of every module's `main.tf`) to contain the `iam ↔ storage` cycle described
below. Investigating why traced to a real quirk in this sandbox's installed `python-hcl2` version:
block *labels* (`module "ecs" { ... }`, `output "cluster_arn" { ... }`, resource types/names) come
back from `hcl2.load()` with the literal quote characters from the HCL source still embedded in the
dict key (`'"ecs"'`, not `'ecs'`) — confirmed directly against this repo's own files. Values inside
block bodies (the actual `module.foo.bar`-style references the regex-based extractor scans for) are
unaffected. Left unfixed, this meant module-call source nodes (keyed by the quoted label) and
module-output destination nodes (keyed by a clean regex-extracted name) silently landed on two
different node identities that never connected — which does not merely mis-draw a cycle, it makes
one architecturally invisible to cycle detection, because the two halves of the loop never join into
one graph component. The fix was a single normalization step (strip one layer of matching
double-quotes from every block-label extraction) applied uniformly before any graph or cycle-
detection logic ran; the tool was re-run from a known-good state afterward, and its "before" findings
below were reproduced against the actual pre-fix Terraform, not asserted from memory of the earlier
manual read.

**The four real cycles (module-level graph, before):**

```
ecs ──needs──> secrets ──needs──> database ──needs──> ecs.security_group_id     [cycle: ecs↔secrets↔database]
ecs ──needs──> secrets ──needs──> redis    ──needs──> ecs.security_group_id     [cycle: ecs↔secrets↔redis]
iam ──needs──> storage ──needs──> iam.ecs_task_role_arn                          [cycle: iam↔storage, 2-node]
ecs ──needs──> storage ──needs──> iam ──needs──> ecs.cluster_arn                [cycle: ecs↔storage↔iam]
redis ──needs──> secrets ──needs──> redis.auth_token                            [cycle: redis↔secrets, 2-node,
                                                                                   found independently — see below]
```

The first three match exactly what a review of this Terraform (performed independently of this
codebase) identified. The `redis ↔ secrets` cycle is narrower and was not part of that review's
three named chains, but the same audit surfaces it: `modules/secrets` generated the ElastiCache AUTH
token (`random_password.redis_auth_token`) and separately read `redis`'s endpoint to compose
`REDIS_URL`, while `modules/redis` took that same generated token back as an input — two-directional
by construction, regardless of which specific resources were involved.

All four traced to the same underlying pattern: a module bundling an "early" resource (needed by
something that must exist before a "late" dependency chain even starts) together with a "late"
resource (needing outputs from further down that same chain) — `modules/ecs` created both the ECS
security group (needed early, by `database`/`redis`) and the task definition (needing `secrets`,
which needs `database`/`redis`'s endpoints); `modules/secrets` generated a Redis credential (needed
early, by `redis` itself) alongside composing a secret that needs `redis`'s endpoint (late).

**The fix — restructuring, not `depends_on`:**

- **`modules/ecs` split into `modules/ecs_cluster` and `modules/ecs_service`.** `ecs_cluster` owns
  the cluster, the API security group, and its log group — inputs limited to `network`/`alb`, full
  stop. `ecs_service` owns the task definition + service, taking `ecs_cluster`'s outputs plus
  `iam`/`secrets`/`storage`/`dns`. `database`/`redis` now take `ecs_cluster.security_group_id`
  (never `ecs_service`'s) for their ingress rules.
- **`modules/storage` no longer takes `ecs_task_role_arn`.** The media bucket's resource policy
  dropped its `AppRoleReadWrite` statement (which named the task role ARN); that same access was
  already, separately, granted via `modules/iam`'s identity-based policy on the role
  (`aws_iam_role_policy.ecs_task_s3`, pre-existing, unchanged) — sufficient on its own once Block
  Public Access is on and nothing denies it, so removing the resource-based duplicate changes no
  actual permission. `iam` still depends on `storage`'s bucket ARNs; the reverse direction is gone.
- **`modules/redis` generates its own AUTH token** (`random_password.auth_token`, a sensitive
  output) instead of taking it from `secrets`. `secrets` takes `redis_auth_token` as a new input
  alongside the endpoint/port it already read.

**The module-level graph, after (all real edges; no self-reference of a module back onto itself
appears anywhere):**

```
network, dns                         (no dependencies)
alb                    -> network, dns
ecs_cluster            -> network, alb
storage                (no dependencies)
database               -> network, ecs_cluster
redis                  -> network, ecs_cluster
secrets                -> database, redis
cdn                    -> dns, storage
iam                    -> ecs_cluster, storage, secrets, cdn
ecs_service            -> network, alb, dns, ecs_cluster, iam, secrets, storage
monitoring             -> alb, database, ecs_cluster, ecs_service, redis
```

Re-running the same analyzer (post-fix, tool bug already corrected) against this wiring: **fine
graph acyclic, coarse graph acyclic — both computed, not asserted.** Every output name CI/CD reads
(`ecs_cluster_name`, `ecs_service_name`, `ecs_task_family`, `ecs_security_group_id`, and all the
others `.github/workflows/ci.yml` and `infrastructure/aws/README.md`'s setup steps reference) is
unchanged; only which module produces it internally changed, so the CI/CD deploy design from D34 is
untouched by this fix. No IAM permission, security-group rule, or S3/CloudFront setting changed in
effect — only which side of a relationship declares the input.

**What this does and doesn't prove.** A computed, cycle-free fine-grained *and* coarse-grained
static reference graph is the strongest evidence obtainable for this codebase without a working
`terraform` binary that the graph Terraform would build is acyclic. It is still not a real
`terraform plan` — provider-level validation (attribute types, required-argument enforcement engine-
side, provider-specific graph transformations) is out of scope for a regex-and-HCL-label static
analyzer, and this is stated plainly rather than glossed over: **do not treat this as a substitute
for running `terraform validate`/`plan` against a real backend before the first real apply.**
