# ElastiCache Redis — a single small node, no cluster mode, no read replicas (AWS audit doc, "Redis
# on ElastiCache": usage is cache + DRF throttle counters + a health-check ping only — nothing here
# needs more).

locals {
  name = "${var.project}-${var.environment}"
}

# Generated here, not in modules/secrets, specifically so this module never has to take an input
# from secrets: secrets needs THIS module's endpoint (to compose REDIS_URL), so if this module also
# needed a value FROM secrets, the two modules would form a 2-cycle. See
# infrastructure/aws/README.md "Why ecs is split into ecs_cluster/ecs_service" (same section also
# covers this) and docs/ARCHITECTURE.md D35.
resource "random_password" "auth_token" {
  length  = 32
  special = false # ElastiCache auth tokens must not contain '@', '"', '/' — simplest is to exclude all specials
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${local.name}-redis"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis ingress: ECS security group only. Never public."
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${local.name}-redis" })
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_ecs" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = var.ecs_security_group_id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "Redis from the ECS API service"
}

resource "aws_vpc_security_group_egress_rule" "redis_all" {
  security_group_id = aws_security_group.redis.id
  cidr_ipv4          = "0.0.0.0/0"
  ip_protocol        = "-1"
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${local.name}-redis"
  description           = "VendorConnect ${var.environment} — cache + DRF throttle counters only"

  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type

  # Single node, not cluster mode: num_cache_clusters = 1, num_node_groups left unset.
  num_cache_clusters = 1

  subnet_group_name = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth_token.result

  automatic_failover_enabled = false # single node — nothing to fail over to
  apply_immediately          = false

  tags = var.tags
}
