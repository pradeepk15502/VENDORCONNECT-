# VendorConnect — API

Base path: `/api/v1`. JSON only. Interactive docs: `GET /api/v1/docs/` · OpenAPI: `GET /api/v1/schema/`
(a generated copy is committed at `docs/openapi.yaml`).

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <access>` (15 min). Refresh: HttpOnly cookie `vc_refresh` (web) or body (native). |
| CSRF | Any request using the refresh cookie must send `X-Requested-With: vendorconnect`. |
| Errors | Always `{"error": {"code", "message", "details"}}`. Validation → `code: validation_error`, `details` = field → messages. |
| Status codes | 200/201 success · 204 no body · 400 validation/business rule · 401 not authenticated · 403 forbidden/suspended · 404 · 409 conflict · 429 rate limited (`details.retry_after_seconds`) |
| Pagination | `?page=&page_size=` (max 100) → `{count, page, page_size, next, previous, results}` |
| Sorting / filtering | `?ordering=field,-field`; filters are per endpoint query params |
| IDs | UUIDs; vendors by handle (`SHARMA001`, `@sharma001` also accepted) |
| Tracing | `X-Request-ID` accepted and echoed |

## Implemented (Phase 1)

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

### Vendors
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/vendors` | user | Create shop → issues Vendor ID, grants `vendor` role. 409 if the user already has one. |
| GET/PATCH | `/vendors/me` | vendor | Shop details; `handle` immutable |
| POST | `/vendors/me/status` | vendor | `{is_open}` one-tap open/close |
| PATCH | `/vendors/me/delivery` | vendor | `{delivery_enabled, pickup_enabled, radius_km, min_order_amount, delivery_fee, free_delivery_above}` |
| GET | `/vendors/{handle}` | – | Public profile (case-insensitive, `@` optional). Suspended → 404. |

### Catalog
| GET | `/categories` | – | Active categories with Hindi names |

### Admin
| GET | `/admin/whoami` | admin session | Confirms password+OTP session; roles and permissions |

## Planned (by phase)
`/search` (2) · `/vendors?near=` (3) · `/vendor-products`, `/inventory`, `/prices` (4) · `/vendors/me/summary` (5) ·
`/messages` (7) · `/cart`, `/orders` (8) · `/reviews`, `/posts`, `/follows` (9) · `/ai/detections` (10) · `/admin/*` (11) · `/notifications`, `/analytics/events`.
