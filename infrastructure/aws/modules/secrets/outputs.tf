output "django_secret_arn" {
  value = aws_secretsmanager_secret.django.arn
}

output "redis_auth_secret_arn" {
  value = aws_secretsmanager_secret.redis_auth.arn
}

output "sms_provider_secret_arn" {
  value = aws_secretsmanager_secret.sms_provider.arn
}

output "database_url_secret_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}

output "redis_url_secret_arn" {
  value = aws_secretsmanager_secret.redis_url.arn
}

