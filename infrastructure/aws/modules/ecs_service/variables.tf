variable "project" {
  type = string
}

variable "environment" {
  type = string
}

# --- From modules/ecs_cluster (a separate module precisely so this module's other, later-arriving
# inputs -- iam/secrets/storage -- never become part of the cluster/security-group's own dependency
# chain). -----------------------------------------------------------------------------------------
variable "cluster_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "log_group_name" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_target_group_arn" {
  type = string
}

variable "container_port" {
  type    = number
  default = 8000
}

variable "container_image" {
  description = "Initial/placeholder image URI (e.g. the ECR repo with a \":bootstrap\" tag). Real deploys update this via `aws ecs register-task-definition` + `update-service` from CI, not repeated `terraform apply` — see the `ignore_changes` lifecycle block below and infrastructure/aws/README.md."
  type        = string
}

variable "cpu" {
  type    = number
  default = 512 # 0.5 vCPU — MVP/low-traffic sizing (AWS audit doc, "Cost awareness")
}

variable "memory" {
  type    = number
  default = 1024 # 1 GB — headroom for occasional OCR/barcode-decode bursts (AWS audit doc, "AI/OCR readiness")
}

variable "desired_count" {
  type    = number
  default = 2 # >=2 so a deploy/AZ event never drops to zero healthy tasks
}

variable "worker_concurrency" {
  description = "gunicorn worker count, tunable per environment/task size without a rebuild (AWS audit doc, \"Django API on ECS Fargate\" gap #1)."
  type        = number
  default     = 3
}

variable "ecs_task_execution_role_arn" {
  type = string
}

variable "ecs_task_role_arn" {
  type = string
}

# --- App configuration (PUBLIC env vars — see docs/DEPLOYMENT.md's variable classification) -------
variable "allowed_hosts" {
  type = string
}

variable "cors_allowed_origins" {
  type = string
}

variable "csrf_trusted_origins" {
  type = string
}

variable "sms_provider" {
  description = "console is refused by prod settings; msg91/twilio are still unimplemented stubs in vc/accounts/sms.py as of Phase 13 — OTP login will fail until a real adapter is written. Not an AWS/infra gap; tracked in docs/DEPLOYMENT.md known limitations."
  type        = string
}

variable "media_storage_backend" {
  type    = string
  default = "s3"
}

variable "aws_storage_bucket_name" {
  type = string
}

variable "aws_s3_region_name" {
  type = string
}

# --- Secrets (Secrets Manager ARNs — never plain values) -------------------
variable "django_secret_arn" {
  type = string
}

variable "database_url_secret_arn" {
  type = string
}

variable "redis_url_secret_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
