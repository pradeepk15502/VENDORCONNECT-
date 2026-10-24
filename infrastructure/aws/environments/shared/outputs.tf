output "ecr_repository_urls" {
  value = module.ecr.repository_urls
}

output "ecr_repository_arns" {
  value = module.ecr.repository_arns
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
