# VendorConnect — Deployment

## Artifacts (built by CI on `main`)
| Image | Source | Runs |
|---|---|---|
| `api` | `services/api/Dockerfile` target `prod` | gunicorn, non-root, healthcheck `/health` |
| `web`, `admin` | `infrastructure/docker/web.Dockerfile` (`APP=`) | nginx serving the production build, proxying `/api` |

`web` is the single role-aware app serving both the Customer and Vendor journeys (see
[docs/ARCHITECTURE.md](ARCHITECTURE.md) D4/D20) — there is no separate customer/vendor image or domain to deploy.

## AWS cloud layout (ap-south-1 Mumbai) — implemented as Terraform in `infrastructure/aws/`

```
Route 53 (one hosted zone, both environments)
  app.<domain>          → CloudFront (OAC → private S3 bucket)   ┐ /api/* forwarded, same origin,
  admin.<domain>        → CloudFront (OAC → private S3 bucket)   ┘ to api.<domain> (no CORS needed)
  api.<domain>           → ALB (HTTPS, regional ACM cert) → ECS Fargate service (Django API, ≥1 task)
RDS PostgreSQL 16 + PostGIS (private, RDS-managed master password, Multi-AZ in production)
ElastiCache Redis (private, single node, encrypted in transit + at rest)
S3: one media bucket (private, versioned, presigned-URL-only access — no public objects anywhere) +
    one static-site bucket each for web/admin (CloudFront-only access via Origin Access Control)
Secrets Manager: DJANGO_SECRET_KEY/JWT_SIGNING_KEY/OTP_HMAC_KEY, composed DATABASE_URL/REDIS_URL
CloudWatch: application logs + a small alarm set (ECS health, ALB 5xx rate, RDS/Redis basics)
```

`web`/`admin` are **not** containers in this architecture — both are pure client-side SPAs with no
server-side rendering, so they're static builds in S3 served through CloudFront rather than paying for
always-on Fargate tasks purely to serve unchanging files (AWS Deployment Readiness Audit, "Web + admin
deployment model"). The `web`/`admin` Docker images in the table above still exist and are still built
by CI — they're what the self-hosted `docker-compose.yml` path runs, kept for parity, but nothing in
the AWS deploy path runs them.

Staging mirrors production at smaller size (single-AZ RDS/Redis, one NAT gateway, disposable DB), its
own `staging-*` subdomains in the same Route 53 zone, and the SMS provider's sandbox credentials, never
production ones. ECR repositories and the GitHub Actions OIDC provider are account-wide, not
per-environment, and live in their own `infrastructure/aws/environments/shared` Terraform root — see
that root's own comments for why. Full module-by-module detail, first-time setup steps, and known
limitations: `infrastructure/aws/README.md`.

## Pipeline
`push → lint → typecheck → unit/integration tests → security (bandit, pip-audit, npm audit) → build → E2E (Playwright)
→ docker images (ECR) → deploy staging (migrate → ECS update → smoke test; web/admin: S3 sync + CloudFront
invalidation → smoke test) → manual approval (GitHub "production" environment reviewers) → deploy production
(same sequence)`. Nothing is deployed from a laptop. Release = the image tag `sha` — see
`infrastructure/aws/README.md` and `.github/workflows/ci.yml` for the actual implementation (Phase 13).

## Release steps
This is what `.github/workflows/ci.yml`'s `deploy-staging`/`deploy-production` jobs actually do —
manual release steps only matter if you're bypassing CI, which nothing here recommends:
1. Register a new ECS task-definition revision pointing at the new image tag (the commit SHA — ECR
   repositories are immutable-tag, so `latest` is never the deploy identity).
2. Run migrations as a one-off ECS task **from that new revision**, and verify its exit code before
   doing anything else. Migrations must be backward compatible with the previous release (expand →
   deploy → contract) — a migration failure here stops the release; the previous revision keeps
   serving traffic untouched.
3. `update-service` to the new revision and wait for it to report stable; health checks gate traffic.
4. Sync the already-built `apps/web/dist`/`apps/admin/dist` to their S3 buckets and invalidate both
   CloudFront distributions.
5. Smoke test: API `/health` and `/health/ready` directly against the ALB; the web/admin CloudFront
   URLs both load and both genuinely proxy `/api/v1/schema/` through to the real API (not just serving
   the SPA shell — see `infrastructure/aws/README.md`'s "Deploys vs. terraform apply").
6. Production repeats 1–5 against production's own cluster/database, after a required-reviewer
   approval on GitHub's "production" environment — using the *same* image tag and static build that
   just passed staging, never a rebuild.

## Required production environment
See `services/api/.env.example`. Production additionally requires: `ENVIRONMENT=production`,
strong `DJANGO_SECRET_KEY` (≥50 chars), separate `JWT_SIGNING_KEY` and `OTP_HMAC_KEY`, `SMS_PROVIDER` ≠ console,
`OTP_DEV_ECHO=false`, `DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `LOG_FORMAT=json`, and — for the S3
media backend — `MEDIA_STORAGE_BACKEND=s3`, `AWS_STORAGE_BUCKET_NAME`, `AWS_S3_REGION_NAME` (`prod`
settings refuse to boot with `MEDIA_STORAGE_BACKEND=s3` and no bucket name set). Every one of these is
delivered to the ECS task via Secrets Manager or the task definition's own environment block by
Terraform (`infrastructure/aws/modules/ecs`, `modules/secrets`) — none of them are ever committed to
Git, baked into the Docker image, or set as a plain GitHub Actions secret.
`config.settings.prod` refuses to start if these are unsafe (verified).

**Known gap, not an infrastructure problem**: no `SMS_PROVIDER` setting actually works yet —
`services/api/vc/accounts/sms.py`'s `msg91`/`twilio` adapters are unimplemented stubs, and `console` is
refused outside development. OTP login will not work in a real deployed environment until one of those
adapters is actually implemented; see `docs/ARCHITECTURE.md` D34.

## Backups & recovery
- PITR on the managed database (RDS automated backups); a scheduled cross-region export is a
  deliberate follow-up, not yet in the Terraform (`infrastructure/aws/README.md`, "Known limitations").
- Monthly restore drill into staging recommended once a real account exists. RPO ≤ 5 min, RTO ≤ 1 h.
- S3 versioning on the media bucket (`infrastructure/aws/modules/storage`).

## Status
Phase 1: images, compose and CI are written; Docker daemon was not available in the build workspace, so
image builds are verified by CI rather than locally.

Phase 13: Terraform IaC (`infrastructure/aws/`) and the real CI/CD deploy stages
(`.github/workflows/ci.yml`'s `deploy-staging`/`deploy-production`) are written and self-validated, but
**not yet applied to a real AWS account** — this sandbox has no AWS credentials, no Terraform CLI, and
no network path to AWS or the Terraform registry (confirmed, not assumed). See the Phase 13 final
report and `infrastructure/aws/README.md`'s "Known limitations" for exactly what's needed before a
real deploy, including a real domain, real AWS credentials, and a genuine unresolved
application-code gap (no working SMS provider in a deployed environment — `services/api/vc/accounts/sms.py`).
