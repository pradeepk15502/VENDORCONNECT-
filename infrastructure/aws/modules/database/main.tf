# RDS PostgreSQL + PostGIS (AWS audit doc, "PostgreSQL/PostGIS on RDS"). PostGIS itself is a Django
# migration concern (`vc/core/migrations/0001_extensions.py` already runs `CREATE EXTENSION
# postgis/pg_trgm/unaccent` — all three are on RDS's supported extension allowlist), not something
# Terraform needs to configure here beyond granting the master user the privilege RDS gives it by
# default.

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name}-db"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "db" {
  name        = "${local.name}-rds"
  description = "RDS ingress: ECS security group only. Never public."
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${local.name}-rds" })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_ecs" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = var.ecs_security_group_id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Postgres from the ECS API service"
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  security_group_id = aws_security_group.db.id
  cidr_ipv4          = "0.0.0.0/0"
  ip_protocol        = "-1"
}

resource "aws_db_instance" "this" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.master_username
  # RDS-managed master password: a Secrets Manager secret RDS creates and rotates itself. The
  # password value never appears in Terraform state or in this module's outputs (AWS audit doc,
  # "Secrets Manager" — "Terraform must not accidentally print secrets in outputs").
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_days
  backup_window           = "18:00-19:00" # 23:30-00:30 IST — low-traffic hours for an India-hyperlocal app
  maintenance_window      = "sun:19:30-sun:20:30"

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.name}-db-final-${formatdate("YYYYMMDD-hhmm", timestamp())}"
  apply_immediately         = false

  tags = var.tags

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}
