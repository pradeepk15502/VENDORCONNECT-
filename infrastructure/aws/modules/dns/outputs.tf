output "zone_id" {
  value = local.zone_id
}

output "cloudfront_certificate_arn" {
  value = aws_acm_certificate_validation.cloudfront.certificate_arn
}

output "alb_certificate_arn" {
  value = aws_acm_certificate_validation.alb.certificate_arn
}

output "web_fqdn" {
  value = "${var.web_subdomain}.${var.domain_name}"
}

output "admin_fqdn" {
  value = "${var.admin_subdomain}.${var.domain_name}"
}

output "api_fqdn" {
  value = "${var.api_subdomain}.${var.domain_name}"
}
