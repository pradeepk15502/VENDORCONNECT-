# ECS cluster + the API's security group + its log group -- split out from what used to be a single
# "ecs" module (see infrastructure/aws/README.md "Why ecs is split into ecs_cluster/ecs_service" and
# docs/ARCHITECTURE.md D35 for the full before/after dependency-graph writeup).
#
# Everything in THIS module has zero dependency on iam, secrets, storage, database or redis -- it
# only needs the network and the ALB's security group (to allow ALB -> ECS ingress). That is what
# lets database/redis take this module's security_group_id, and iam take this module's cluster_arn,
# without creating a cycle: modules/ecs_service (the task definition + service, which DOES need
# iam/secrets/storage) is a separate module that consumes this module's outputs, never the reverse.

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_ecs_cluster" "this" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}

resource "aws_security_group" "ecs" {
  name        = "${local.name}-ecs"
  description = "ECS API ingress: ALB security group only. Never public (AWS audit doc, networking)."
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${local.name}-ecs" })
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  security_group_id            = aws_security_group.ecs.id
  referenced_security_group_id = var.alb_security_group_id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "ecs_all" {
  security_group_id = aws_security_group.ecs.id
  cidr_ipv4          = "0.0.0.0/0" # RDS/Redis further restrict ingress to only this SG on their own side
  ip_protocol        = "-1"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}
