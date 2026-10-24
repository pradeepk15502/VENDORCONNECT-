variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "db_master_user_secret_arn" {
  description = "The RDS-managed master-password secret (modules/database output `master_user_secret_arn`) — read here to compose a single DATABASE_URL the app's `env.db()` can parse."
  type        = string
}

variable "db_endpoint" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "db_master_username" {
  type = string
}

variable "redis_endpoint" {
  type = string
}

variable "redis_port" {
  type = number
}

variable "redis_auth_token" {
  description = "From modules/redis (random_password.auth_token) — generated there, not here, so this module never has to be created before redis (see modules/redis/main.tf's comment on that resource, and docs/ARCHITECTURE.md D35)."
  type        = string
  sensitive   = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
