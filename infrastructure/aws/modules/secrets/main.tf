# App secrets (AWS audit doc, "Secrets Manager"). Values generated here (django/jwt/otp keys, the
# Redis auth token) are random and app-internal — safe for Terraform to generate. Third-party
# credentials (SMS provider) are NOT invented: this creates an empty placeholder secret that a
# human fills in once, out of band, the same way `docs/DEPLOYMENT.md` already describes for the
# non-AWS environment variables.
#
# Known limitation, documented rather than hidden: Terraform state necessarily contains the
# generated values as resource attributes (this is true of `random_password` and most secret
# resources in any IaC tool, not specific to this module) — see infrastructure/aws/README.md
# "State and secrets" for why the state backend itself must be encrypted and access-restricted.

locals {
  name = "${var.project}-${var.environment}"
}

resource "random_password" "django_secret_key" {
  length  = 64
  special = false # Django's SECRET_KEY only needs high entropy, not punctuation that risks shell/env-var escaping issues
}

resource "random_password" "jwt_signing_key" {
  length  = 64
  special = false
}

resource "random_password" "otp_hmac_key" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "django" {
  name = "${local.name}/django"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "django" {
  secret_id = aws_secretsmanager_secret.django.id
  secret_string = jsonencode({
    DJANGO_SECRET_KEY = random_password.django_secret_key.result
    JWT_SIGNING_KEY   = random_password.jwt_signing_key.result
    OTP_HMAC_KEY      = random_password.otp_hmac_key.result
  })
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name = "${local.name}/redis-auth-token"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = var.redis_auth_token
}

# Placeholder only — a human replaces "REPLACE_ME" via the AWS Console/CLI once a real SMS
# provider account exists. Terraform never invents a third-party credential.
resource "aws_secretsmanager_secret" "sms_provider" {
  name = "${local.name}/sms-provider"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "sms_provider" {
  secret_id     = aws_secretsmanager_secret.sms_provider.id
  secret_string = jsonencode({ SMS_PROVIDER = "REPLACE_ME", SMS_API_KEY = "REPLACE_ME" })

  lifecycle {
    ignore_changes = [secret_string] # don't stomp the real value once ops fill it in
  }
}

# ---------------------------------------------------------------------------
# DATABASE_URL / REDIS_URL — composed here because the app reads each as ONE connection-string env
# var (`env.db("DATABASE_URL")`, `env("REDIS_URL")` in config/settings/base.py), not as separate
# host/port/user/password fields. RDS's own managed-password secret only holds
# `{username, password}`, so this reads that value and reassembles the full DSN.
#
# Known limitation (documented, not hidden): if RDS master-password *rotation* is turned on later,
# this composed secret goes stale until the next `terraform apply` re-reads it — there is no
# rotation Lambda wired to this secret in this phase. Acceptable for now: `manage_master_user_password`
# does not enable automatic rotation by default, and adding one here would be exactly the kind of
# "elaborate" machinery the AWS audit doc's monitoring/cost sections warn against building
# speculatively. Revisit if/when rotation is actually turned on.
# ---------------------------------------------------------------------------
data "aws_secretsmanager_secret_version" "db_master" {
  secret_id = var.db_master_user_secret_arn
}

locals {
  db_master = jsondecode(data.aws_secretsmanager_secret_version.db_master.secret_string)
  database_url = "postgis://${var.db_master_username}:${local.db_master.password}@${var.db_endpoint}:${var.db_port}/${var.db_name}"
  redis_url    = "redis://:${var.redis_auth_token}@${var.redis_endpoint}:${var.redis_port}/0"
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${local.name}/database-url"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

resource "aws_secretsmanager_secret" "redis_url" {
  name = "${local.name}/redis-url"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = local.redis_url
}
