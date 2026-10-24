variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "media_bucket_arn" {
  description = "ARN of the S3 media bucket the ECS task role may read/write (scoped to it and its objects only)."
  type        = string
}

variable "secret_arns" {
  description = "Secrets Manager secret ARNs the ECS task execution role may read (never `*`)."
  type        = list(string)
}

variable "github_org" {
  description = "GitHub org/user that owns the repository, for the OIDC trust condition."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (without the org), for the OIDC trust condition."
  type        = string
}

variable "ecr_repository_arns" {
  description = "ECR repository ARNs the CI/CD deployment role may push/pull."
  type        = list(string)
}

variable "ecs_cluster_arn" {
  description = "ECS cluster ARN the CI/CD deployment role may deploy to."
  type        = string
}

variable "web_bucket_arn" {
  description = "S3 bucket ARN the CI/CD deployment role may sync the built apps/web SPA into."
  type        = string
}

variable "admin_bucket_arn" {
  description = "S3 bucket ARN the CI/CD deployment role may sync the built apps/admin SPA into."
  type        = string
}

variable "web_distribution_arn" {
  description = "CloudFront distribution ARN the CI/CD deployment role may invalidate after a web deploy."
  type        = string
}

variable "admin_distribution_arn" {
  description = "CloudFront distribution ARN the CI/CD deployment role may invalidate after an admin deploy."
  type        = string
}

variable "create_github_oidc_provider" {
  description = "Whether to create the GitHub Actions OIDC provider in this AWS account. Set false if it already exists (an account can only have one)."
  type        = bool
  default     = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
