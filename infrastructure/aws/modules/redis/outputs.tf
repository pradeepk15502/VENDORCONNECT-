output "replication_group_id" {
  value = aws_elasticache_replication_group.this.replication_group_id
}

output "primary_endpoint_address" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  value = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  value = aws_security_group.redis.id
}

output "auth_token" {
  description = "Consumed by modules/secrets to compose REDIS_URL. Generated here (not in secrets) so this module never depends on secrets — see main.tf's comment above random_password.auth_token."
  value       = random_password.auth_token.result
  sensitive   = true
}
