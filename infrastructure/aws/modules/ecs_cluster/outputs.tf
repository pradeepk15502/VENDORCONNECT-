output "cluster_id" {
  value = aws_ecs_cluster.this.id
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "security_group_id" {
  value = aws_security_group.ecs.id
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}
