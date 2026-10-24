variable "domain_name" {
  description = "The apex domain, e.g. \"example.com\". Never hardcode a real domain — this is a variable precisely because the AWS audit doc's Domain section says not to assume one (vendorconnect.in in docs/DEPLOYMENT.md is an example only)."
  type        = string
}

variable "create_hosted_zone" {
  description = "true creates a new Route 53 public hosted zone for domain_name (first environment to own this domain). false looks up an existing zone by name (e.g. staging reusing production's zone, or the zone was created once, out of band)."
  type        = bool
  default     = false
}

variable "web_subdomain" {
  type    = string
  default = "app"
}

variable "admin_subdomain" {
  type    = string
  default = "admin"
}

variable "api_subdomain" {
  type    = string
  default = "api"
}

variable "tags" {
  type    = map(string)
  default = {}
}
