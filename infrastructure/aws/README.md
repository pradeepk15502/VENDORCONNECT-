# VendorConnect — AWS infrastructure (Phase 13)

Terraform for the architecture the [AWS Deployment Readiness Audit](../../docs/DEPLOYMENT.md) and
`docs/ARCHITECTURE.md` D34 describe. **Nothing in this directory has been applied.** This sandbox
has no real AWS account, no working AWS credentials, and no network path to AWS or the Terraform
registry — confirmed, not assumed (see the Phase 13 final report). This is reproducible code,
written and reviewed, ready for a real account.

## Layout

```
infrastructure/aws/
  modules/
    network/      VPC, public/private subnets, NAT
    ecr/          One repository per image (api, web, admin), immutable tags
    dns/          Route 53 zone + both ACM certificates (CloudFront's in us-east-1, ALB's regional)
    alb/          Public ALB: HTTP->HTTPS redirect, HTTPS -> the API target group
    ecs_cluster/  ECS cluster + the API's security group + its log group. Zero dependency on
                  iam/secrets/storage — that's what keeps the whole module graph acyclic (see
                  "Why ecs is split into ecs_cluster/ecs_service" below).
    ecs_service/  The Django API's task definition + running service. Needs iam/secrets/storage
                  and ecs_cluster's outputs; nothing else needs anything back from it.
    database/     RDS PostgreSQL + PostGIS, private, RDS-managed master password
    redis/        ElastiCache Redis, single node, private, encrypted in transit
    storage/      S3 buckets: media (private, versioned) + web/admin static-site origins
    secrets/      Secrets Manager: Django/JWT/OTP keys, composed DATABASE_URL/REDIS_URL, SMS placeholder
    iam/          ECS task execution role, ECS task role, GitHub OIDC deploy role — no AdministratorAccess
    cdn/          CloudFront for web + admin, S3 origins via OAC, /api/* forwarded to the ALB
    monitoring/   A small CloudWatch alarm set + SNS topic
  environments/
    shared/       Account-wide, once-only resources: the 3 ECR repos + the GitHub OIDC provider
                  (see "Why shared/ exists" below — apply this root FIRST)
    staging/      Smaller sizing, its own subdomains, disposable DB (skip_final_snapshot)
    production/   Multi-AZ RDS, one NAT per AZ, deletion protection on
  bootstrap-state.sh   One-time script: creates the S3 bucket + DynamoDB table Terraform's own
                       state lives in (a backend can't create itself)
```

Every listed module is one the [AWS audit doc](../../docs/DEPLOYMENT.md) found genuinely required —
nothing here is speculative (no API Gateway, no Celery/queue infrastructure, no multi-node Redis;
see that doc's "Services that are NOT required").

## First-time setup (per AWS account)

1. `./bootstrap-state.sh <bucket-name> <region>` — creates the Terraform state bucket + lock table
   (shared by all three roots below — only the state `key` differs).
2. `cd environments/shared`, copy `backend.hcl.example` → `backend.hcl` and fill in the bucket/table
   from step 1, then `terraform init -backend-config=backend.hcl && terraform plan && terraform apply`.
   This must run **before** staging or production — see "Why `shared/` exists" below.
3. For each of `environments/staging` and `environments/production`: copy `backend.hcl.example` →
   `backend.hcl` (same bucket, different `key`) and `terraform.tfvars.example` → `terraform.tfvars`,
   filling in the real domain name, GitHub org/repo, and SMS provider. **Read the `sms_provider`
   comment in that file before setting it** — see "Known limitations" below.
4. Push a bootstrap image to the `api` ECR repository (created in step 2) *before* either
   environment's first apply — the ECS task definition needs some image to reference. Run
   `docker build` locally against `services/api/Dockerfile` target `prod` and push it by hand once
   (`aws ecr get-login-password | docker login ...`, `docker push`).
5. `cd environments/<env> && terraform init -backend-config=backend.hcl && terraform plan`.
   Review the plan like any other change to a shared system before `terraform apply`.
6. Populate that GitHub environment's ("staging" or "production", under repo Settings → Environments)
   variables straight from this apply's outputs — every name below is also a Terraform output name,
   so `terraform output <name>` gives the exact value to paste:
   `AWS_DEPLOY_ROLE_ARN` (`github_deploy_role_arn`), `AWS_REGION` (the `aws_region` input you set),
   `ECS_CLUSTER` (`ecs_cluster_name`), `ECS_SERVICE` (`ecs_service_name`), `ECS_TASK_FAMILY`
   (`ecs_task_family`), `ECS_SECURITY_GROUP_ID` (`ecs_security_group_id`), `PRIVATE_SUBNET_IDS`
   (`private_subnet_ids`, comma-joined), `WEB_BUCKET_NAME` (`web_bucket_name`), `ADMIN_BUCKET_NAME`
   (`admin_bucket_name`), `CLOUDFRONT_WEB_DISTRIBUTION_ID` (`web_distribution_id`),
   `CLOUDFRONT_ADMIN_DISTRIBUTION_ID` (`admin_distribution_id`), `WEB_URL` (`web_url`), `ADMIN_URL`
   (`admin_url`), `API_URL` (`api_url`) — see `.github/workflows/ci.yml`, which reads all of these.
   Using the full URLs (rather than reconstructing them from a domain + assumed subdomain prefix)
   keeps the workflow from assuming any particular subdomain naming scheme — the Phase 13 prompt's
   own "never assume the domain name" applies just as much to *how* a domain is structured as to the
   domain itself. All of these are non-secret identifiers (ARNs, bucket names, IDs, URLs), never
   credentials, which is why they're GitHub *variables*, not *secrets* — consistent with using OIDC
   instead of long-lived AWS keys in the first place. Also give "production" at least one required
   reviewer (Settings → Environments → production → protection rules) — that's the actual approval
   gate `deploy-production` depends on; Terraform doesn't and can't configure this part, it's a GitHub
   repository setting.

## Why `shared/` exists

`modules/ecr` names repositories `"${project}/${image}"` with no environment segment, and an AWS
account can only ever have one GitHub Actions OIDC provider for a given URL — both are genuinely
account-wide, not per-environment. Applying `environments/staging` and `environments/production` to
the same account would each try to create `vendorconnect/api` and the same OIDC provider a second
time and fail with "already exists." `environments/shared` owns both instead, applied once;
`environments/staging` and `environments/production` each look the ECR repos up with a
`data "aws_ecr_repository"` block and set `modules/iam`'s `create_github_oidc_provider = false` to
look up the same provider by URL. This also matches the CI/CD flow itself: one image is built and
pushed once (into the shared registry), then the *same* image is promoted from staging to production
without a rebuild — see `.github/workflows/ci.yml`.

## Deploys vs. `terraform apply`

Terraform provisions the *shape* of the infrastructure once (the cluster, the service, the task
definition's environment/secrets wiring, the S3 buckets, the CloudFront distributions). It does
**not** run on every code push. Day-to-day deploys are CI/CD's job, and are two independent things
per environment, both in `.github/workflows/ci.yml`'s `deploy-staging`/`deploy-production` jobs:

- **API**: register a new ECS task definition revision with the new image tag, run the one-off
  migration task against it, and only if that succeeds call `update-service` — see the AWS audit
  doc's "Database migrations" section for the exact sequence (migration task → verify → update
  service). `modules/ecs_service`'s `aws_ecs_service` has `lifecycle { ignore_changes =
  [task_definition, desired_count] }` for exactly this reason: without it, every `terraform plan`
  after a CI deploy would show a spurious diff trying to revert the service to whichever image
  Terraform itself last applied.
- **Web/admin**: `npm run build` produces `apps/web/dist` and `apps/admin/dist` (pure static output —
  neither app takes a build-time API URL; see "Web + admin deployment model" below), CI syncs each to
  its own S3 bucket with `aws s3 sync --delete`, then invalidates that bucket's CloudFront
  distribution (`/*`) so viewers stop getting the previous build from cache. Nothing about this touches
  Terraform state — the buckets and distributions already exist from the apply in "First-time setup."

## Why ecs is split into ecs_cluster/ecs_service (module-graph acyclicity)

An earlier revision of this Terraform had `modules/ecs` as one module owning the cluster, the API's
security group, *and* the task definition/service — and three genuine module-level cycles as a
result: `ecs ↔ database` and `ecs ↔ redis` (both wanted the ECS security group, but `ecs` also
needed `secrets`, which needed `database`/`redis`'s endpoints), `iam ↔ storage` (the media bucket's
resource policy named the ECS task role, while the task role's own policy named the bucket ARN), and
`ecs ↔ storage ↔ iam` (chained through the two prior cycles). A fourth, narrower cycle
(`redis ↔ secrets`) existed independently: `secrets` generated the Redis AUTH token and read back
`redis`'s endpoint to compose `REDIS_URL`, while `redis` took that same generated token as an input.

This was caught by a dependency-graph audit run against the *module-call* graph (which module's
input references which other module's output) — the same view `terraform graph`, most third-party
Terraform linters, and a human skimming `module "X" { ... = module.Y.z ... }` blocks would all see.
It was **not** visible from `terraform validate` or a hand-wave "different resources on each side"
argument, because that argument only holds if you can enumerate, for every apparent cross-reference,
exactly which resource sits behind each output — easy to get wrong, and this codebase's own earlier
version of this section got it wrong (see docs/ARCHITECTURE.md D35 for the full incident writeup:
what the audit found, why the old code *would* still have produced a valid Terraform apply order
purely by accident of which specific resource each output happened to reference, and why that
accident is not something to design around going forward).

The fix, applied throughout `modules/` and both `environments/*/main.tf`:

- **`modules/ecs` → `modules/ecs_cluster` + `modules/ecs_service`.** `ecs_cluster` owns the ECS
  cluster, the API's security group, and its log group — it takes only `network`/`alb` outputs, full
  stop. `ecs_service` owns the task definition + running service, takes `ecs_cluster`'s outputs
  (`cluster_id`, `security_group_id`, `log_group_name`) plus `iam`/`secrets`/`storage`/`dns`, and
  nothing else in the graph ever needs anything back from it. `database`/`redis` now take
  `ecs_cluster.security_group_id` (never `ecs_service`'s), which is what lets them sit *before*
  `secrets`/`iam`/`storage` in the graph despite `ecs_service` needing those.
- **`storage` no longer takes `ecs_task_role_arn`.** Its media-bucket policy dropped the
  `AppRoleReadWrite` statement that named the ECS task role; that access is granted solely through
  `modules/iam`'s own identity-based policy on the role (`aws_iam_role_policy.ecs_task_s3`), which
  was already there and is sufficient on its own once Block Public Access is on and nothing denies
  it. `iam` still depends on `storage`'s bucket ARNs (one direction only, now).
- **`redis` generates its own AUTH token** (`random_password.auth_token`, exposed as a sensitive
  output) instead of taking it from `secrets`. `secrets` now takes `redis_auth_token` as an input
  (alongside the endpoint/port it already read) to compose `REDIS_URL` and store the token secret.

None of this changed any GitHub Actions variable name, any IAM permission grant, any security-group
rule, or the CI/CD deploy sequence — `.github/workflows/ci.yml` reads Terraform outputs by name
(`ecs_cluster_name`, `ecs_service_name`, `ecs_task_family`, `ecs_security_group_id`), and every one
of those output *names* is unchanged; only which module they're sourced from internally changed.

The remaining cross-references that look superficially similar are genuinely fine and needed no
change: `dns`/`cdn`/`alb` (ACM certificates have no dependency on the CloudFront distributions or
load balancer that consume them; only the Route 53 alias *records* in `environments/<env>/main.tf`,
not `modules/dns` itself, depend on `cdn`/`alb`) — this one really is the "different resource on
each side, and neither side points back" pattern, verified the same way (a real dependency-graph
check, not an assertion) documented in docs/ARCHITECTURE.md D35.

## Known limitations (read before applying to a real account)

- **This code has never been applied.** `terraform validate`/`plan`/`apply` could not run in this
  sandbox (no Terraform CLI, no network path to `registry.terraform.io` or any AWS API — see the
  Phase 13 final report for the exact evidence). It has been reviewed by hand, checked for valid HCL
  syntax (`python-hcl2`), and checked for module-graph cycles with a purpose-built static
  dependency-graph tool (see docs/ARCHITECTURE.md D35) — none of this is the same as a real
  `terraform validate`/`plan`, which can catch provider-schema errors, type mismatches, and cycles
  this tooling cannot. Run both before the first real apply.
- **`SMS_PROVIDER=msg91`/`twilio` are unimplemented stubs**, not real integrations
  (`services/api/vc/accounts/sms.py`) — every `send_otp` call on either raises `RuntimeError` today.
  `config.settings.prod` refuses to boot with `SMS_PROVIDER=console`, so as the application code
  stands, **there is no SMS provider setting that makes OTP login actually work in a deployed
  environment** — this is an application-code gap, not an infrastructure one, and no amount of
  Terraform fixes it. Write a real adapter (or wire real MSG91/Twilio credentials into
  `services/api/vc/accounts/sms.py`) before relying on OTP login anywhere but a local dev/CI console.
- **The composed `DATABASE_URL`/`REDIS_URL` secrets** (`modules/secrets`) are assembled once at
  `apply` time by reading the RDS-managed master-password secret. If RDS password *rotation* is
  turned on later, these composed secrets go stale until the next `terraform apply` — there is no
  rotation Lambda wired up. Documented as a deliberate scope decision (see `modules/secrets/main.tf`),
  not an oversight — add one if/when rotation is actually enabled.
- **Terraform state contains generated secret values** (the Redis auth token, in particular) as
  ordinary resource attributes — true of most IaC tools, not specific to this code. This is exactly
  why the state backend itself must be the encrypted, access-restricted S3 bucket `bootstrap-state.sh`
  creates, never a local `.tfstate` file.
- **Multi-AZ, instance classes, and Fargate task sizing are all MVP/low-traffic defaults** (AWS audit
  doc, "Cost awareness") — resize once real traffic exists, don't provision for hypothetical scale.
- **A real domain must be chosen and its registrar pointed at the Route 53 name servers** this
  creates (`terraform apply` output, or the AWS Console) before ACM's DNS validation can complete —
  Terraform waits on `aws_acm_certificate_validation`, so the first apply will hang at that step
  until the domain's NS records actually point here.
