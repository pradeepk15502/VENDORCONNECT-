variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "alert_email" {
  description = "Optional — if set, subscribes this address to the alarm SNS topic (AWS confirms the subscription by email; Terraform can't auto-confirm it)."
  type        = string
  default     = ""
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}

variable "ecs_cluster_name" {
  type = string
}

variable "ecs_service_name" {
  type = string
}

variable "rds_instance_id" {
  type = string
}

variable "redis_replication_group_id" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
