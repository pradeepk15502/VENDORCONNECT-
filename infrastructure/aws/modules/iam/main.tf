# Minimum IAM for the app + CI/CD (AWS audit doc, "IAM" — no AdministratorAccess anywhere here).

locals {
  name = "${var.project}-${var.environment}"
}

# ---------------------------------------------------------------------------
# ECS task execution role — pulls the image from ECR, writes logs to CloudWatch, and reads only the
# specific secrets this task definition references.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_task_execution_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0
  statement {
    sid       = "ReadOnlyTheSecretsThisTaskNeeds"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  count  = length(var.secret_arns) > 0 ? 1 : 0
  name   = "read-task-secrets"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_task_execution_secrets[0].json
}

# ---------------------------------------------------------------------------
# ECS task role — the application's own runtime identity. Only S3 access, scoped to the media
# bucket/prefix. Nothing else is called from application code today (AWS audit doc, "IAM").
# ---------------------------------------------------------------------------
resource "aws_iam_role" "ecs_task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "ecs_task_s3" {
  statement {
    sid       = "MediaBucketObjectAccess"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.media_bucket_arn}/*"]
  }
  statement {
    sid       = "MediaBucketListOwnPrefixOnly"
    actions   = ["s3:ListBucket"]
    resources = [var.media_bucket_arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name   = "media-bucket-access"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_s3.json
}

# ---------------------------------------------------------------------------
# GitHub Actions OIDC — no long-lived AWS access keys in GitHub Secrets.
# ---------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint is validated by AWS itself as of the provider's current API behaviour;
  # this value is the well-known root CA thumbprint GitHub has published for this provider.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = var.tags
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Scoped to this repo only. Tighten further (e.g. `:ref:refs/heads/main` or
    # `:environment:production`) once the exact workflow trigger shape is final.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}/${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "PushPullThisProjectsEcrRepos"
    actions   = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:BatchCheckLayerAvailability", "ecr:PutImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload"]
    resources = var.ecr_repository_arns
  }
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # GetAuthorizationToken has no resource-level permissions in the ECR API
  }
  statement {
    sid       = "DeployToThisEcsCluster"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:DescribeServices", "ecs:UpdateService", "ecs:RunTask", "ecs:DescribeTasks"]
    resources = ["*"] # RegisterTaskDefinition/DescribeTaskDefinition don't support resource scoping; the
    # rest are additionally constrained below by the ecs:cluster condition key.
  }
  statement {
    sid       = "OnlyThisCluster"
    actions   = ["ecs:UpdateService", "ecs:RunTask", "ecs:DescribeServices", "ecs:DescribeTasks"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.ecs_cluster_arn]
    }
  }
  statement {
    sid       = "PassTheTwoTaskRolesOnly"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_task_execution.arn, aws_iam_role.ecs_task.arn]
  }
  statement {
    sid       = "ReadLogsForDeployVerification"
    actions   = ["logs:GetLogEvents", "logs:DescribeLogStreams"]
    resources = ["arn:aws:logs:*:*:log-group:/ecs/${local.name}*"]
  }
  # Web/admin deploys: sync the built SPA to this environment's own bucket only, then invalidate
  # this environment's own distribution only (AWS audit doc, "Web + admin deployment model" —
  # static assets in S3/CloudFront, not ECS, so their deploy step is a sync + invalidation, not a
  # task-definition update).
  statement {
    sid       = "SyncWebAndAdminBuilds"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${var.web_bucket_arn}/*", "${var.admin_bucket_arn}/*"]
  }
  statement {
    sid       = "ListWebAndAdminBucketsForSync"
    actions   = ["s3:ListBucket"]
    resources = [var.web_bucket_arn, var.admin_bucket_arn]
  }
  statement {
    sid       = "InvalidateWebAndAdminDistributionsOnly"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [var.web_distribution_arn, var.admin_distribution_arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy-permissions"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
