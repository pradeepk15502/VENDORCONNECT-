variable "aws_region" {
  type    = string
  default = "ap-south-1" # Mumbai — matches docs/DEPLOYMENT.md's existing recommendation for an India-hyperlocal app
}

variable "environment" {
  type    = string
  default = "production"
}

variable "domain_name" {
  description = "The real apex domain, chosen at implementation time — never assumed (AWS audit doc, \"Domain architecture\"). No default on purpose: set it in terraform.tfvars."
  type        = string
}

variable "create_hosted_zone" {
  description = "true if production is the first environment to own this domain's Route 53 zone."
  type        = bool
  default     = true
}

variable "github_org" {
  type = string
}

variable "github_repo" {
  type    = string
  default = "vendorconnect"
}

variable "alert_email" {
  type    = string
  default = ""
}

variable "sms_provider" {
  description = "console is refused by prod settings. msg91/twilio are unimplemented stubs as of Phase 13 (services/api/vc/accounts/sms.py) — set this only once a real adapter has been written and credentials exist; until then, OTP login will fail in this environment regardless of AWS infrastructure. See docs/DEPLOYMENT.md known limitations."
  type        = string
}

variable "container_image" {
  description = "Bootstrap image URI for the initial `terraform apply` only — real deploys are done by CI (see modules/ecs's `ignore_changes` and infrastructure/aws/README.md)."
  type        = string
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "single_nat_gateway" {
  type    = bool
  default = false # one NAT per AZ in production — no single point of egress failure
}
