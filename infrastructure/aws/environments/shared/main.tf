# Account-level resources that must exist exactly once, never once per environment.
#
# Both ECR repository names (modules/ecr: "${project}/${image}", no environment segment) and the
# GitHub Actions OIDC provider (one per URL per AWS account — AWS itself rejects a second one) are
# genuinely account-wide, not per-environment. Applying staging and production's own Terraform
# roots to the same account would otherwise both try to create "vendorconnect/api" and the same
# OIDC provider a second time and fail with "already exists" — a real repository constraint, not a
# stylistic choice, which is why this one piece of infrastructure lives outside environments/staging
# and environments/production (Phase 13 prompt, "do NOT invent a different architecture unless a
# concrete repository constraint requires it" — this is that constraint). It also matches the CI/CD
# target flow's own shape: one image is built and pushed once, then promoted from staging to
# production without a rebuild, so the registry it lives in is shared infrastructure by design.
#
# Apply this once, before the first `terraform apply` in either environments/staging or
# environments/production (see infrastructure/aws/README.md, "First-time setup").

locals {
  project = "vendorconnect"
  tags = {
    Project   = "VendorConnect"
    ManagedBy = "Terraform"
  }
}

module "ecr" {
  source  = "../../modules/ecr"
  project = local.project
  tags    = local.tags
}

# GitHub Actions OIDC — created once here; environments/staging and environments/production each
# set modules/iam's create_github_oidc_provider = false and look this same provider up by URL
# (modules/iam already supports that lookup path).
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint is validated by AWS itself as of the provider's current API behaviour;
  # this value is the well-known root CA thumbprint GitHub has published for this provider.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = local.tags
}
