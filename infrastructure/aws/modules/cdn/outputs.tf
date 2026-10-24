output "web_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_distribution_arn" {
  description = "For scoping the CI/CD deploy role's cloudfront:CreateInvalidation permission to this distribution only."
  value       = aws_cloudfront_distribution.web.arn
}

output "web_distribution_domain_name" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "web_distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.web.hosted_zone_id
}

output "admin_distribution_id" {
  value = aws_cloudfront_distribution.admin.id
}

output "admin_distribution_arn" {
  description = "For scoping the CI/CD deploy role's cloudfront:CreateInvalidation permission to this distribution only."
  value       = aws_cloudfront_distribution.admin.arn
}

output "admin_distribution_domain_name" {
  value = aws_cloudfront_distribution.admin.domain_name
}

output "admin_distribution_hosted_zone_id" {
  value = aws_cloudfront_distribution.admin.hosted_zone_id
}
