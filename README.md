# VendorConnect

**Find a specific product at nearby local shops — see if it's in stock, the price, whether the shop is open, how far it is, and whether the shop delivers.**
Small vendors get a simple digital shop: products, price, stock, open/closed, posts and customer messages.

> Status: **Phase 0 (architecture + DB design), Phase 1 (setup, design system, authentication),
> Phase 2 (customer home + location + search), Phase 3 (vendor discovery + profile), Phase 4
> (vendor product catalog + inventory + price), Phase 5 (vendor dashboard), Phase 6 (discovery
> filters + map view), Phase 7 (chat: messaging, quick replies, product-share, block/report),
> Phase 8 (cart, pickup/vendor-delivery checkout, orders, order tracking and vendor order
> management), Phase 9 (reviews tied to real completed orders + vendor replies, shop posts
> connected back to real products, following, and admin moderation of reports/posts/reviews),
> Phase 10 (AI-assisted product entry: real barcode/OCR-based detection with honest confidence
> bands, a full editable vendor-confirmation screen, and a real audit trail — see
> [docs/AI.md](docs/AI.md) for exactly what the current provider can and can't do) and Phase 11
> (admin back-office: live DB-backed dashboard, user suspend/restore, vendor verification and
> suspend/restore, read-only platform-wide Products/Categories/Orders visibility, and a real
> read-only viewer over the append-only audit trail every phase has been writing to since Phase 1 —
> see `docs/ARCHITECTURE.md` D32) complete and tested.**
> See [Roadmap](#roadmap) for what comes next.

## Architecture at a glance

| Layer | Choice | Why (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) |
|---|---|---|
| API | Django 5 + DRF, modular monolith | One transaction boundary for the stock/price loop, GeoDjango |
| DB | PostgreSQL 16 + PostGIS + pg_trgm | Index-backed distance queries, typo-tolerant multilingual search |
| Cache / limits | Redis | Rate limits, OTP throttling, caching |
| Web app | React + TypeScript + Vite PWA — one role-aware app for Customer ⇄ Vendor, plus a separate admin app | Link/QR install, low-end Android friendly, one codebase for both roles |
| Auth | Phone + OTP → JWT (15 min, memory) + rotating refresh (HttpOnly cookie) | Target users don't use passwords; XSS can't steal refresh |
| Languages | English + Hindi, regional-ready | `packages/i18n` |

## Repository

```
apps/
  web/              the VendorConnect app — one role-aware PWA, not two:
                       splash → language → role selection ("I'm a Customer" / "I'm a Vendor")
                       Customer: home, search, shops, cart, checkout, orders, addresses, profile, messages/chat, /v/@HANDLE deep link
                       Vendor:   onboarding wizard, Vendor ID, open/close dashboard, shop, orders, delivery settings, messages/chat
                       either role can switch to the other from Profile/Shop settings, no re-login
  admin/            admin web (separate back-office app; password + OTP login. Phase 9's moderation
                       queues (reports/posts/reviews) and Phase 10's "AI Scans" visibility, plus
                       Phase 11's dashboard, Users, Vendors + verification, read-only Products/
                       Categories/Orders visibility, and a read-only Audit logs viewer)
packages/
  ui/               design system: tokens.css, components, icons
  api-client/       typed API client, session provider, online status
  i18n/             en / hi dictionaries + provider
  shell/            shared screens: language picker, phone → OTP login flow
  config/           shared tsconfig
services/
  api/              Django project (config/, vc/<domain apps>/), incl. vc/ai — Phase 10's real
                       barcode/OCR detection provider, running in-process, not a separate service
                       (see docs/ARCHITECTURE.md D31 for why that amends the original Phase 0 plan)
infrastructure/
  docker/           web image + nginx config
  aws/              (Phase 13) Terraform IaC for the real AWS architecture — see infrastructure/aws/README.md
docs/               ARCHITECTURE · DATABASE · API · DEPLOYMENT · AI · openapi.yaml · screenshots/
tests/e2e/          Playwright end-to-end tests + run-stack.sh
.github/workflows/  CI/CD pipeline
```

Backend domain apps (`services/api/vc/`): `core` (health, errors, permissions, middleware) · `accounts` · `vendors` ·
`catalog` · `assets` · `social` · `chat` · `orders` · `notifications` · `ai` · `analytics` · `audit` · `moderation`.
All tables for every phase are designed and migrated now ([docs/DATABASE.md](docs/DATABASE.md)); endpoints arrive phase by phase.

## Local development

### Option A — Docker Compose
```bash
docker compose up --build
# API http://localhost:8000  ·  web (customer + vendor) :8081  ·  admin :8083  ·  MinIO console :9001
```

### Option B — Native (what the test runs used)
Requirements: Python 3.11, Node 22, PostgreSQL 16 with PostGIS 3, Redis 7, GDAL/GEOS libs.
```bash
# database
createuser -s vc && psql -c "ALTER USER vc PASSWORD 'vc_dev_pw'" && createdb -O vc vendorconnect

# API
cd services/api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
python manage.py migrate
python manage.py seed_taxonomy
python manage.py createsuperuser        # phone like +919000000001, then a password (admin login)
python manage.py runserver              # http://localhost:8000  (docs: /api/v1/docs/)

# web app (repo root, second terminal)
npm install
npm run dev:web                         # http://localhost:5173  (Customer and Vendor — role selection at start)
npm run dev:admin                       # http://localhost:5175
```
In development the OTP is shown on screen ("Test mode code") and printed in the API log — no SMS is sent.

### Environment variables
Documented inline in [`services/api/.env.example`](services/api/.env.example). Production-only requirements are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); `config.settings.prod` refuses to start with a weak secret key, OTP echo on,
or the console SMS provider.

## Testing

| Suite | Command | Result (Phase 13) |
|---|---|---|
| API unit + integration (pytest, real PostGIS) | `cd services/api && pytest` | **425 passed** |
| Web unit (Vitest) | `npm test` | **131 passed** |
| E2E (Playwright, real API + production builds, serialized — see [ARCHITECTURE.md](docs/ARCHITECTURE.md) D33) | `tests/e2e/run-stack.sh start && npm run e2e` | **37 passed**, 1 skipped (screenshots, `SHOTS` gate) |
| Lint | `ruff check . && ruff format --check .` · `npm run lint` (incl. jsx-a11y) | clean |
| Types | `npm run typecheck` · `npm run typecheck:tests` | clean |
| Security | `bandit`, `pip-audit`, `npm audit` | see below |

Security scan results are honest, not "no findings": `bandit` is clean, and both `pip-audit -r
requirements.txt` (production deps) and `npm audit --omit=dev --audit-level=high` (production
deps) report zero known vulnerabilities. Against the **dev-only** dependency sets — which never
ship to production (`requirements.txt` excludes dev deps; the built web/admin bundles exclude
devDependencies) — two pre-existing findings remain, unchanged since Phase 7: `pip-audit -r
requirements-dev.txt` flags `pytest` (8.4.2, fix in 9.0.3), and a full `npm audit` flags
`@vitest/mocker` via `vitest` (GHSA-82fw-gwwq-j7x9) — its fix needs a breaking `vitest@5.0.2`
upgrade across both web workspaces; deferred to avoid a mid-phase test-runner migration with no
production impact.

E2E flows covered (all inside the single `apps/web` app unless noted): customer (language → role selection → intro → location →
signup → home → reload keeps session → profile → Hindi → logout), search (category tile → ranked results, Hindi-transliterated
text query → ranked results, Vendor ID query → "Shop found" card → vendor profile, unrelated query → no-results state), vendors
(Home "Shops near you" preview → nearest open shop → vendor profile, Vendors tab → browse + category filter, vendor profile tabs
→ About shows real shop details, Products lists real listings with working Add to cart), vendor (language → role selection →
signup → 3-step shop setup with GPS → `@TESTWALA00N` issued → open → customer sees "Open" via deep link → close → customer sees
"Closed"), vendor products (dashboard → add product → appears in Products list with real price/unit/availability → edit
descriptive fields → update stock/availability → update price → delete → listing gone, slot freed), vendor dashboard
(overview tiles reflect real product/low-stock/out-of-stock counts from `GET /vendors/me/summary`, no fabricated
orders/sales tiles, "Create Post" lands on the real Phase 9 composer and "AI Scan Product" lands on the real Phase 10
scan screen), AI-assisted product entry (Phase 10: a vendor uploads a real product-label photo → real OCR (Tesseract)
matches it to the seeded "Tomato" product and its "Hybrid" variety → the confirm screen shows the match, its plain-
language confidence band, an explicit "Development scanner" disclosure, and an honest "Market price unavailable"
banner (no seeded market data) → the vendor edits the price themselves (never pre-filled) and taps "Add Product" →
a real `VendorProduct` is created exactly as a manual add would, and it now appears in the vendor's own product list
at the price they set; a blank photo — no barcode, no legible text — honestly reports "We couldn't confidently identify
this product" with no fabricated guess and offers "Add manually instead"; a network failure creating the detection
never navigates away from the scan screen and offers Try Again/Add Manually, then recovers once the network
returns; a vendor can never open or confirm another vendor's detection by URL), social (Phase 9: a customer follows a shop →
it appears under Profile → Following with a real server-backed unfollow round trip; a vendor publishes a post with a
real uploaded image and a linked product → the customer opens it from the shop's Posts tab and adds that same product
to cart from the post; a customer reviews a real completed order → the review appears on the shop's public Reviews tab
with a "Verified Purchase" badge; a vendor replies to a review from Shop → Reviews and can't reply twice; authorization
— a vendor can neither see another vendor's post in their own list nor edit or delete it by guessing its URL, and a
plain customer is redirected away from a vendor-only route), discovery filters
(Search and Vendors tab: "Open now" filter is a real `?open_now=1` round trip, not a client-side re-filter — narrows
results, "Clear all" restores them), map view (Search and Vendors tab: switching to Map plots one real marker per shop,
styled by actual open/closed status, and clicking a marker's "View shop" action opens that shop's real profile), chat
(customer starts a conversation from a shop's profile → vendor sees it and replies with a quick reply → customer sees
the reply via real short polling, not a page reload → vendor shares a real product listing → customer sees the product
card → customer reports the conversation → vendor blocks the customer → customer's composer is disabled after
reloading → vendor unblocks → customer can send again), orders (Phase 8: customer adds a listing to
cart → cart quantity update recalculates the vendor's subtotal → checkout → pickup → cash payment →
order placed → vendor accepts → preparing → ready → picked up → completed, with the customer seeing
the full reached-status timeline on reload; a second flow enables delivery from the vendor's Delivery
Settings screen → customer adds a GPS-captured address inside checkout → delivery-radius/fee
revalidation → order → accepted → preparing → ready → out for delivery → delivered → completed; a
third flow has the vendor reject an order with a required reason → the customer sees the reason and
loses the cancel action → a second, unrelated vendor is denied access to the order by ID), admin
(separate app; wrong password rejected → password + OTP → admin session → every sidebar section is
real, including Phase 10's "AI Scans"; Phase 11 adds: a live dashboard with real, non-fabricated
metrics that reflect real data and re-fetch cleanly on every time-range switch; Users — search finds
a real signed-up account, suspending it with a reason rejects that phone's very next login attempt
server-side with "This account is suspended. Contact support.", restoring it un-blocks the same
login immediately; Vendor verification — a freshly onboarded shop starts unverified, admin verifies
it with notes, and the shop's own public profile shows a "Verified" badge immediately; Vendors —
suspending a shop makes its public profile 404 instantly, restoring it brings the profile straight
back; Products/Categories — real, live vendor-listing and category-usage counts, not seeded/
fabricated numbers; Orders — real cross-vendor order visibility for support, with the customer's
phone number never exposed; Audit logs — a real admin action (e.g. a vendor verification) shows up
immediately when filtered by its action name, and no edit/delete affordance exists anywhere on the
screen, matching the trail's append-only guarantee), unknown Vendor ID link.

## API

Full reference: [docs/API.md](docs/API.md), live Swagger at `/api/v1/docs/`, schema in [docs/openapi.yaml](docs/openapi.yaml).

## Deployment

CI builds, lints, tests (unit, integration, E2E), runs security checks, builds Docker images, deploys to staging, and
promotes to production only after manual approval. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `django.core.exceptions.ImproperlyConfigured: Could not find the GDAL library` | Install `gdal-bin libgdal-dev` (Debian/Ubuntu) or `brew install gdal` |
| `type "geography" does not exist` during migrate | PostGIS package missing on the DB server (`postgresql-16-postgis-3`) |
| `permission denied to create extension` | The DB user needs superuser once for `CREATE EXTENSION` (or create postgis/pg_trgm/unaccent manually) |
| Logged out on every reload in dev | Open the app via the Vite dev server (it proxies `/api` on the same origin); don't call the API on :8000 directly from the browser |
| `429 otp_cooldown` | Wait 30 s between code requests (dev: set `OTP_RESEND_COOLDOWN_SECONDS=0`) |
| Test-mode code not shown | `OTP_DEV_ECHO=true` only works with `config.settings.dev` |

## Known limitations (Phase 10 / 11 / 13)
- SMS: only the console provider works; MSG91/Twilio adapters (`services/api/vc/accounts/sms.py`) are
  unimplemented stubs, not just missing credentials — `send_otp()` always raises. `config.settings.prod`
  refuses `SMS_PROVIDER=console`, so **no valid setting makes OTP login work in a real deployed
  environment today**. Not an infrastructure gap — Phase 13's AWS work doesn't touch this. See
  `docs/ARCHITECTURE.md` D34.
- Docker images and Compose are written and `services/api/Dockerfile` now installs the `tesseract-ocr`/
  `tesseract-ocr-eng`/`libzbar0` packages Phase 10 needs at runtime, but the images could not be *built* in this
  development workspace: the Docker daemon itself runs here, but its registry pulls (`docker.io` base images —
  `python`, `node`, `nginx`, `postgis`, `redis`, `minio`) are blocked by this workspace's network policy
  (`403 Forbidden`, confirmed down to the buildkit syntax-directive pull, before `FROM` even resolves), not by a
  missing daemon. A real, black-box runtime smoke test (`services/api/scripts/ai_smoke_test.py`) exists and is
  wired into CI as the `ai-runtime-smoke-test` job, which builds the actual `dev`-target image and runs it — but
  that job has not yet executed on real CI as of this hardening pass, so Docker verification for Phase 10 remains
  environment-blocked here, not confirmed complete. See `docs/AI.md`'s "Runtime verification" section.
  **Phase 13 update**: re-verified rather than assumed carried over — this session's sandbox couldn't even
  start the Docker daemon (`Cannot connect to the Docker daemon`), a stricter constraint than Phase 10's
  "daemon runs, registry pulls are blocked" finding. The same smoke test was instead run directly against
  a live `manage.py runserver` instance and passed in full (real OCR, real barcode decode) — see
  `docs/AI.md`'s Phase 13 update and `docs/ARCHITECTURE.md` D34. `infrastructure/aws/` (Terraform for a
  real AWS deployment) and real CI/CD deploy stages now also exist, but have never been applied to a real
  AWS account — no AWS credentials, Terraform CLI, or network path to AWS exists in this sandbox either.
- AI product detection (Phase 10) ships a real barcode/OCR-based provider, not a trained generic image classifier —
  every route to a pretrained model or hosted vision API is blocked by this workspace's network policy (verified,
  not assumed). A photo with no barcode and no legible text honestly reports "couldn't confidently identify" rather
  than guessing. Full detail in [docs/AI.md](docs/AI.md) and `docs/ARCHITECTURE.md` D31. A minimal, read-only admin
  page ("AI Scans") for the existing `GET /admin/ai/detections` endpoint shipped in the Phase 10 hardening pass.
- Vendor product listings are free-text (name/category/unit typed by the vendor) — there's no product-picker UI linking
  a listing to the shared `Product` catalog yet, so `product`/`variety` are always `null` and the `409 duplicate_listing`
  guard (same vendor+product+variety+unit) can't yet be triggered through the app. See `docs/ARCHITECTURE.md` D24.
- Posts (Phase 9) support photo/video media, but video is stored as-is with no server-side transcoding or thumbnail
  generation (images get real resized WebP variants); a linked product is limited to one per post.
- Admin Settings (Phase 11) has no form to fill in: the repository audit behind `docs/ARCHITECTURE.md` D32 found no
  platform-wide settings/feature-flag model anywhere in the backend (only per-vendor `DeliverySettings` and per-user
  `PrivacySettings`, both already editable from their own screens) — the section says so plainly instead of shipping
  a form that would save nothing real. Admin Categories is read-only for the same reason category CRUD (merge/rename)
  was never asked for as a real business rule; admin Products is read-only by design — a vendor's own price/stock can
  only ever change from their own shop screens, never from the back-office. Admin Orders is support-visibility only —
  no refund/payment action lives there; `_settle_payment` (checkout/transition flows) remains the only writer of
  `Payment` rows.
- Customer Profile has "Following" and "My Reviews" (Phase 9) but no separate "Favourite Shops" list: the Phase 9
  spec's own dedicated sections (following architecture, DB, authorization, list, feed) only ever describe following
  a shop, and its one "Favourite Shops" mention is a single line in an illustrative profile mockup with no elaborated
  behaviour of its own — building a second, barely-distinguished "save a shop" feature next to Following would be the
  kind of decorative, undifferentiated feature the spec's own "not an Instagram clone" principle argues against. The
  schema does have a listing-level `Favorite` (save a *product*, e.g. for a back-in-stock alert) from Phase 0, but no
  endpoint or screen uses it yet — a real, separate feature for a future phase if a product-level "saved items" list
  is wanted, not the same thing as "Favourite Shops".
- Chat (Phase 7) covers text messages, quick replies and sharing one of the vendor's own product listings. Image
  messages are not built — `Message.kind` already has room for one in the data model, but there's no file-upload
  pipeline yet; see `docs/ARCHITECTURE.md` D28. Sharing a product is a vendor-initiated action inside the conversation
  only — there's no "share to chat" entry point yet from a `SearchScreen` result card. Chat is REST + short polling
  (3 s), not WebSockets, per the original plan in `docs/ARCHITECTURE.md` D14 — new messages can take up to a few
  seconds to appear, and a block/report taken by the other side while a conversation is open is reflected on next
  reload, not instantly (the composer's disabled state isn't itself polled, only messages are; an attempted send
  while blocked still fails safely with a clear error).
- Payments (Phase 8) are a real, documented test/mock abstraction (`vc/orders/payments.py`), not a live payment
  gateway: Cash always works; "UPI (test)" and "Card / Netbanking (test)" simulate an immediate success (or, via an
  explicit on-screen "simulate a failed payment" checkbox, a real `payment_failed` error) rather than moving real
  money, and the app never claims a payment succeeded without going through this abstraction. Both non-cash methods
  are hidden and rejected server-side (`503 payment_provider_unavailable`) whenever `ENVIRONMENT=production`, so a
  real provider integration is a drop-in behind the same interface rather than a checkout redesign.
- Order tracking and the in-app notification lists (Phase 8) are fetch-on-open, not live: a customer watching the
  order-tracking screen while the vendor changes its status needs to reload to see the change (chat's polling
  doesn't cover orders yet), and neither list supports push notifications — only the in-app "Notifications" screen.
- Vendor delivery (Phase 8) is deliberately vendor-fulfilled, not a VendorConnect-owned courier network: a vendor
  turns delivery on/off, and sets its radius/fee/minimum order themselves in Shop → Delivery Settings; the app
  computes real distance/eligibility and tracks status (`out_for_delivery` → `delivered`) but has no rider
  assignment, live rider tracking, or route planning — "who carries the order" is entirely up to the vendor.
- Shop hours are a manual open/closed toggle only — there's no recurring weekly schedule (e.g. auto-open 9am–9pm) to
  display or apply automatically. See `docs/ARCHITECTURE.md` D25.
- No service worker yet (offline caching for vendor stock updates is a future candidate).
- No rating filter — `Vendor.rating_avg`/`rating_count` are real columns but always `0` until Phase 9 ships reviews;
  shipping a "4★+" filter now would only ever return everything or nothing. See `docs/ARCHITECTURE.md` D26.
- Vendor shop location during onboarding is GPS-capture only — there's no interactive map to fine-tune the pin
  (Phase 6's map is the customer-facing discovery map, a different screen; see `docs/ARCHITECTURE.md` D27).
- Map tiles load straight from `tile.openstreetmap.org` (no API key) — fine for development; production should move to
  a paid or self-hosted tile provider per OSM's usage policy, per the original plan in `docs/ARCHITECTURE.md` D13.
- Two dev-only, non-shipping security findings (`pytest`, `@vitest/mocker`) — see Testing → Security above.

## Roadmap
12 Hardening · 13 Cloud deployment — both complete (see `docs/ARCHITECTURE.md` D33/D34). 14 Production
verification: an actual applied AWS deployment, a real domain, and the `SMS_PROVIDER` adapter Phase 13
left unresolved (`docs/DEPLOYMENT.md` "Required production environment") — its detailed specification
has not been supplied yet.
