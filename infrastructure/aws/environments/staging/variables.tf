variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "domain_name" {
  description = "Same apex domain as production — staging uses its own subdomains (staging-app.<domain>, etc. via the *_subdomain variables in modules/dns) within the zone production already created. Never assumed; set it in terraform.tfvars."
  type        = string
}

variable "create_hosted_zone" {
  description = "false by default — staging reuses the zone production created for the same domain_name."
  type        = bool
  default     = false
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
  description = "Staging should use the SMS provider's sandbox/test mode, never real production credentials (AWS audit doc, \"Environment separation\": never mix credentials). console is refused by prod settings; msg91/twilio are unimplemented stubs as of Phase 13 — see docs/DEPLOYMENT.md known limitations."
  type        = string
}

variable "container_image" {
  type = string
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "single_nat_gateway" {
  type    = bool
  default = true # cheaper — a single point of egress failure is an acceptable tradeoff for staging
}

variable "web_subdomain" {
  type    = string
  default = "staging-app"
}

variable "admin_subdomain" {
  type    = string
  default = "staging-admin"
}

variable "api_subdomain" {
  type    = string
  default = "staging-api"
}
