# VendorConnect — Deployment

## Artifacts (built by CI on `main`)
| Image | Source | Runs |
|---|---|---|
| `api` | `services/api/Dockerfile` target `prod` | gunicorn, non-root, healthcheck `/health` |
| `customer`, `vendor`, `admin` | `infrastructure/docker/web.Dockerfile` (`APP=`) | nginx serving the production build, proxying `/api` |

## Recommended cloud layout (India region, e.g. AWS ap-south-1 Mumbai)
```
Route 53 / DNS
  app.vendorconnect.in   → CDN → customer container
  shop.vendorconnect.in  → CDN → vendor container
  admin.vendorconnect.in → (IP allow-list / SSO) → admin container
     each proxies /api → internal load balancer → api containers (ECS Fargate / Cloud Run, ≥2 tasks)
RDS PostgreSQL 16 + PostGIS (Multi-AZ in prod, PITR 14 days)
ElastiCache Redis
S3 (media, private; served via CDN signed URLs)
Secrets Manager (DJANGO_SECRET_KEY, JWT_SIGNING_KEY, OTP_HMAC_KEY, DB, SMS keys)
```
Staging mirrors production at smaller size, with SMS provider sandbox.

## Pipeline
`push → lint → typecheck → unit/integration tests → security (bandit, pip-audit, npm audit) → build → E2E (Playwright)
→ docker images (ghcr) → deploy staging → manual approval (GitHub "production" environment reviewers) → deploy production`.
Nothing is deployed from a laptop. Release = the image tag `sha`.

## Release steps
1. Run migrations as a one-off task with the new image: `python manage.py migrate && python manage.py seed_taxonomy`.
   Migrations must be backward compatible with the previous release (expand → deploy → contract).
2. Roll the API service; health checks gate traffic.
3. Roll web containers.
4. Smoke test: `/health/ready`, OTP login on staging number, vendor open/close.

## Required production environment
See `services/api/.env.example`. Production additionally requires: `ENVIRONMENT=production`,
strong `DJANGO_SECRET_KEY` (≥50 chars), separate `JWT_SIGNING_KEY` and `OTP_HMAC_KEY`, `SMS_PROVIDER` ≠ console,
`OTP_DEV_ECHO=false`, `DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `LOG_FORMAT=json`.
`config.settings.prod` refuses to start if these are unsafe (verified).

## Backups & recovery
- PITR on the managed database; nightly `pg_dump` to cross-region S3 (30-day retention).
- Monthly restore drill into staging. RPO ≤ 5 min, RTO ≤ 1 h.
- S3 versioning on the media bucket.

## Status
Phase 1: images, compose and CI are written; Docker daemon was not available in the build workspace, so
image builds are verified by CI rather than locally. Staging/production deploy jobs are placeholders
until cloud accounts exist (Phase 13).
