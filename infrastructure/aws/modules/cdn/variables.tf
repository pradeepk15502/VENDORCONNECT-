variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "certificate_arn" {
  description = "The us-east-1 ACM certificate covering both web_fqdn and admin_fqdn (modules/dns output cloudfront_certificate_arn)."
  type        = string
}

variable "web_fqdn" {
  type = string
}

variable "admin_fqdn" {
  type = string
}

variable "web_bucket_name" {
  type = string
}

variable "web_bucket_arn" {
  type = string
}

variable "web_bucket_regional_domain_name" {
  type = string
}

variable "admin_bucket_name" {
  type = string
}

variable "admin_bucket_arn" {
  type = string
}

variable "admin_bucket_regional_domain_name" {
  type = string
}

variable "api_fqdn" {
  description = "The ALB's custom domain (modules/dns output api_fqdn) — CloudFront's origin for the /api/* behavior, so both apps keep calling a relative \"/api/v1\" path on their own origin (AWS audit doc, \"Web + admin deployment model\")."
  type        = string
}

variable "price_class" {
  description = "PriceClass_100 = North America + Europe edge locations only — cheapest; widen if traffic outside those regions matters (AWS audit doc, \"Cost awareness\")."
  type        = string
  default     = "PriceClass_100"
}

variable "tags" {
  type    = map(string)
  default = {}
}
