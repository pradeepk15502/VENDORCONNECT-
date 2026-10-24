# S3 buckets (AWS audit doc, "S3 storage readiness" + "S3 Security"): one media bucket for
# `S3MediaStorage` (services/api/vc/assets/storage.py), one static-hosting bucket each for
# apps/web and apps/admin (origins behind their own CloudFront distributions — see modules/cdn,
# which owns the bucket policy granting CloudFront read access).
#
# All three: Block Public Access fully on, default encryption, no object ACLs anywhere. Nothing
# here is ever publicly reachable directly — CloudFront (web/admin) or a presigned URL (media) is
# the only way any object is ever read.

locals {
  name = "${var.project}-${var.environment}"
}

# ---------------------------------------------------------------------------
# Media bucket
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "media" {
  bucket = "${local.name}-media"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled" # accidental-overwrite/delete recovery (AWS audit doc, "Backups")
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "expire-old-noncurrent-versions"
    status = "Enabled"
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }
  }
}

# Access for the ECS task role is granted entirely on the identity side (modules/iam's
# `aws_iam_role_policy.ecs_task_s3`, which this module has no need to know about) rather than
# restated here as a resource-based grant naming that role's ARN. A bucket policy is only actually
# *needed* for cross-account access or an explicit deny; granting the same-account task role access
# via its own identity-based policy is sufficient once Block Public Access is on (true for this
# bucket) and nothing here denies it, and it avoids two separate policy surfaces (this bucket policy
# and the role's own policy) that would otherwise have to be kept in sync by hand. This is also what
# keeps this module from depending on modules/iam's `ecs_task_role_arn` output, which is what iam's
# own inline S3 policy depends on the *reverse* direction (this module's bucket ARN) — see
# infrastructure/aws/README.md "Why ecs is split into ecs_cluster/ecs_service" and
# docs/ARCHITECTURE.md D35 for the full before/after graph this was part of fixing.
data "aws_iam_policy_document" "media_bucket_policy" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket_policy.json
}

# ---------------------------------------------------------------------------
# Web / admin static-site buckets (CloudFront origins — modules/cdn owns their bucket policy)
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "web" {
  bucket = "${local.name}-web"
  tags   = var.tags
}

resource "aws_s3_bucket" "admin" {
  bucket = "${local.name}-admin"
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "admin" {
  bucket                  = aws_s3_bucket.admin.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "admin" {
  bucket = aws_s3_bucket.admin.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
