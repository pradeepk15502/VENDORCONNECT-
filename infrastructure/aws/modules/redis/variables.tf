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
  type = string
}

variable "node_type" {
  description = "A single small node is sufficient — Redis is only used for DRF throttle counters and a cache/health-check (AWS audit doc, \"Redis on ElastiCache\"); no cluster mode, no read replicas."
  type        = string
  default     = "cache.t4g.micro"
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "tags" {
  type    = map(string)
  default = {}
}
