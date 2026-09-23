# VendorConnect

**Find a specific product at nearby local shops — see if it's in stock, the price, whether the shop is open, how far it is, and whether the shop delivers.**
Small vendors get a simple digital shop: products, price, stock, open/closed, posts and customer messages.

> Status: **Phase 0 (architecture + DB design) and Phase 1 (setup, design system, authentication) complete and tested.**
> See [Roadmap](#roadmap) for what comes next.

## Architecture at a glance

| Layer | Choice | Why (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) |
|---|---|---|
| API | Django 5 + DRF, modular monolith | One transaction boundary for the stock/price loop, GeoDjango |
| DB | PostgreSQL 16 + PostGIS + pg_trgm | Index-backed distance queries, typo-tolerant multilingual search |
| Cache / limits | Redis | Rate limits, OTP throttling, caching |
| Web apps | React + TypeScript + Vite PWAs (customer, vendor, admin) | Link/QR install, low-end Android friendly, one codebase |
| Auth | Phone + OTP → JWT (15 min, memory) + rotating refresh (HttpOnly cookie) | Target users don't use passwords; XSS can't steal refresh |
| Languages | English + Hindi, regional-ready | `packages/i18n` |

## Repository

```
apps/
  customer/         customer PWA (home, search, shops, cart, profile, /v/@HANDLE deep link)
  vendor/           vendor PWA (onboarding wizard, Vendor ID, open/close dashboard, shop)
  admin/            admin web (password + OTP login, section shell)
packages/
  ui/               design system: tokens.css, components, icons
  api-client/       typed API client, session provider, online status
  i18n/             en / hi dictionaries + provider
  shell/            shared screens: language picker, phone → OTP login flow
  config/           shared tsconfig
services/
  api/              Django project (config/, vc/<domain apps>/)
  ai/               (Phase 10) product classifier service — design in docs/AI.md
infrastructure/
  docker/           web image + nginx config
  deployment/       (Phase 13) cloud IaC
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
# API http://localhost:8000  ·  customer :8081  ·  vendor :8082  ·  admin :8083  ·  MinIO console :9001
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

# web apps (repo root, second terminal)
npm install
npm run dev:customer                    # http://localhost:5173
npm run dev:vendor                      # http://localhost:5174
npm run dev:admin                       # http://localhost:5175
```
In development the OTP is shown on screen ("Test mode code") and printed in the API log — no SMS is sent.

### Environment variables
Documented inline in [`services/api/.env.example`](services/api/.env.example). Production-only requirements are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); `config.settings.prod` refuses to start with a weak secret key, OTP echo on,
or the console SMS provider.

## Testing

| Suite | Command | Result (Phase 1) |
|---|---|---|
| API unit + integration (pytest, real PostGIS) | `cd services/api && pytest` | **56 passed** |
| Web unit (Vitest) | `npm test` | **22 passed** |
| E2E (Playwright, real API + production builds) | `tests/e2e/run-stack.sh start && npm run e2e` | **4 passed** |
| Lint | `ruff check .` · `npm run lint` (incl. jsx-a11y) | clean |
| Types | `npm run typecheck` · `npm run typecheck:tests` | clean |
| Security | `bandit`, `pip-audit`, `npm audit` | no findings |

E2E flows covered: customer (language → intro → location → signup → home → reload keeps session → profile → Hindi → logout),
vendor (signup → 3-step shop setup with GPS → `@TESTWALA00N` issued → open → customer sees "Open" via deep link → close → customer sees "Closed"),
admin (wrong password rejected → password + OTP → admin session), unknown Vendor ID link.

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

## Known limitations (Phase 1)
- SMS: only the console provider works; MSG91/Twilio adapters need credentials + DLT template registration.
- Docker images and Compose are written but weren't built in the development workspace (no Docker daemon); CI builds them.
- Search, product listings, maps, chat, cart/orders, reviews/posts, AI and admin tools are Phase 2–11; their screens show clear "coming" empty states.
- No service worker yet (offline caching arrives with Phase 4 vendor stock updates).
- Vendor shop location: GPS capture only; map pin adjustment arrives in Phase 6.

## Roadmap
2 Customer home + location + search · 3 Vendor discovery + profile · 4 Catalog + inventory + stock + price ·
5 Vendor dashboard · 6 Map · 7 Chat + call · 8 Cart + pickup/delivery + orders · 9 Reviews + posts + following ·
10 AI product detection · 11 Admin panel · 12 Hardening · 13 Cloud deployment · 14 Production verification.
