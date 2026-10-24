output "web_url" {
  value = "https://${module.dns.web_fqdn}"
}

output "admin_url" {
  value = "https://${module.dns.admin_fqdn}"
}

output "api_url" {
  value = "https://${module.dns.api_fqdn}"
}

output "ecr_repository_urls" {
  description = "From environments/shared, not this state — see that root's own outputs for the authoritative copy."
  value       = { for k, v in data.aws_ecr_repository.this : k => v.repository_url }
}

output "ecs_cluster_name" {
  value = module.ecs_cluster.cluster_name
}

output "ecs_service_name" {
  value = module.ecs_service.service_name
}

output "ecs_task_family" {
  description = "Put this in the GitHub environment's ECS_TASK_FAMILY variable — the deploy job describes this family to build the next task-definition revision from."
  value       = module.ecs_service.task_family
}

output "ecs_security_group_id" {
  description = "Put this in the GitHub environment's ECS_SECURITY_GROUP_ID variable — the deploy job's one-off migration task runs in this security group, same as the service."
  value       = module.ecs_cluster.security_group_id
}

output "private_subnet_ids" {
  description = "Put this (comma-joined) in the GitHub environment's PRIVATE_SUBNET_IDS variable — the deploy job's migration task runs in these subnets, same as the service."
  value       = module.network.private_subnet_ids
}

output "github_deploy_role_arn" {
  description = "Put this in the GitHub repo's variables/secrets for the CI/CD OIDC deploy step."
  value       = module.iam.github_deploy_role_arn
}

output "web_distribution_id" {
  description = "Put this in the GitHub environment's CLOUDFRONT_WEB_DISTRIBUTION_ID variable for the deploy job's cache invalidation step."
  value       = module.cdn.web_distribution_id
}

output "admin_distribution_id" {
  description = "Put this in the GitHub environment's CLOUDFRONT_ADMIN_DISTRIBUTION_ID variable for the deploy job's cache invalidation step."
  value       = module.cdn.admin_distribution_id
}

output "web_bucket_name" {
  description = "Put this in the GitHub environment's WEB_BUCKET_NAME variable for the deploy job's `aws s3 sync` step."
  value       = module.storage.web_bucket_name
}

output "admin_bucket_name" {
  description = "Put this in the GitHub environment's ADMIN_BUCKET_NAME variable for the deploy job's `aws s3 sync` step."
  value       = module.storage.admin_bucket_name
}

output "media_bucket_name" {
  value = module.storage.media_bucket_name
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "alerts_topic_arn" {
  value = module.monitoring.alerts_topic_arn
}
