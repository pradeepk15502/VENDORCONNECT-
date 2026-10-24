variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group_id" {
  description = "Security group of the ECS service — the only allowed ingress source (AWS audit doc, \"Domain, HTTPS and networking\": RDS is never publicly accessible)."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major.minor version. Must support a PostGIS extension version >= 3.4 (see docs/ARCHITECTURE.md D2 / the AWS audit doc's PostgreSQL/PostGIS section) — confirm the exact combination RDS currently offers before applying."
  type        = string
  default     = "16.4"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro" # MVP/low-traffic sizing (AWS audit doc, "Cost awareness") — resize once real usage is known
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "max_allocated_storage" {
  description = "Enables RDS storage autoscaling up to this size (GB) — avoids guessing a fixed size up front."
  type        = number
  default     = 100
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "skip_final_snapshot" {
  description = "Should stay false in production — true is only for disposable staging DBs so `terraform destroy` doesn't hang waiting for a snapshot nobody needs."
  type        = bool
  default     = true
}

variable "db_name" {
  type    = string
  default = "vendorconnect"
}

variable "master_username" {
  type    = string
  default = "vc_admin"
}

variable "tags" {
  type    = map(string)
  default = {}
}
