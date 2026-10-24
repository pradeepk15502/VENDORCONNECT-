locals {
  project = "vendorconnect"
  tags = {
    Project     = "VendorConnect"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

module "network" {
  source             = "../../modules/network"
  project            = local.project
  environment        = var.environment
  single_nat_gateway = var.single_nat_gateway
  tags               = local.tags
}

# ECR repositories and the GitHub OIDC provider are account-wide, not per-environment — they're
# created once in environments/shared and looked up here by name (see that root's main.tf for why).
data "aws_ecr_repository" "this" {
  for_each = toset(["api", "web", "admin"])
  name     = "${local.project}/${each.value}"
}

module "dns" {
  source = "../../modules/dns"
  providers = {
    aws            = aws
    aws.us_east_1  = aws.us_east_1
  }
  domain_name        = var.domain_name
  create_hosted_zone = var.create_hosted_zone
  tags               = local.tags
}

module "alb" {
  source            = "../../modules/alb"
  project           = local.project
  environment       = var.environment
  vpc_id            = module.network.vpc_id
  public_subnet_ids = module.network.public_subnet_ids
  certificate_arn   = module.dns.alb_certificate_arn
  tags              = local.tags
}

# --- ECS is split into two modules specifically to keep this whole graph acyclic (see
# docs/ARCHITECTURE.md D35 for the full before/after dependency-graph writeup):
#
#   ecs_cluster  — the ECS cluster, the API's security group, and its log group. Depends only on
#                  network + alb. NOTHING else in this file depends on this module needing to wait
#                  for iam/secrets/storage, because this module never takes those as inputs at all.
#   ecs_service  — the task definition + running service. Needs iam/secrets/storage/dns (the "late"
#                  inputs) *and* ecs_cluster's outputs, but nothing downstream ever needs anything
#                  back from ecs_service — it's a pure sink for this part of the graph.
#
# database/redis below take ecs_cluster's security_group_id, never ecs_service's — that's what lets
# them sit *before* secrets/iam/storage in the graph despite ecs_service needing secrets/iam/storage
# itself.
module "ecs_cluster" {
  source                 = "../../modules/ecs_cluster"
  project                = local.project
  environment            = var.environment
  vpc_id                 = module.network.vpc_id
  alb_security_group_id  = module.alb.security_group_id
  tags                   = local.tags
}

module "storage" {
  source      = "../../modules/storage"
  project     = local.project
  environment = var.environment
  tags        = local.tags
}

module "database" {
  source                 = "../../modules/database"
  project                = local.project
  environment            = var.environment
  vpc_id                 = module.network.vpc_id
  private_subnet_ids     = module.network.private_subnet_ids
  ecs_security_group_id  = module.ecs_cluster.security_group_id
  instance_class         = var.db_instance_class
  multi_az               = var.multi_az
  skip_final_snapshot    = false
  deletion_protection    = true
  tags                   = local.tags
}

module "redis" {
  source                 = "../../modules/redis"
  project                = local.project
  environment            = var.environment
  vpc_id                 = module.network.vpc_id
  private_subnet_ids     = module.network.private_subnet_ids
  ecs_security_group_id  = module.ecs_cluster.security_group_id
  node_type              = var.redis_node_type
  tags                   = local.tags
}

module "ecs_service" {
  source                      = "../../modules/ecs_service"
  project                     = local.project
  environment                 = var.environment
  cluster_id                  = module.ecs_cluster.cluster_id
  security_group_id           = module.ecs_cluster.security_group_id
  log_group_name              = module.ecs_cluster.log_group_name
  private_subnet_ids          = module.network.private_subnet_ids
  alb_target_group_arn        = module.alb.target_group_arn
  container_image             = var.container_image
  desired_count               = var.desired_count
  ecs_task_execution_role_arn = module.iam.ecs_task_execution_role_arn
  ecs_task_role_arn           = module.iam.ecs_task_role_arn
  allowed_hosts               = "${module.dns.api_fqdn}"
  cors_allowed_origins        = "https://${module.dns.web_fqdn},https://${module.dns.admin_fqdn}"
  csrf_trusted_origins        = "https://${module.dns.web_fqdn},https://${module.dns.admin_fqdn}"
  sms_provider                = var.sms_provider
  aws_storage_bucket_name     = module.storage.media_bucket_name
  aws_s3_region_name          = var.aws_region
  django_secret_arn           = module.secrets.django_secret_arn
  database_url_secret_arn     = module.secrets.database_url_secret_arn
  redis_url_secret_arn        = module.secrets.redis_url_secret_arn
  tags                        = local.tags
}

module "secrets" {
  source                    = "../../modules/secrets"
  project                   = local.project
  environment               = var.environment
  db_master_user_secret_arn = module.database.master_user_secret_arn
  db_endpoint               = module.database.endpoint
  db_port                   = module.database.port
  db_name                   = module.database.db_name
  db_master_username        = module.database.master_username
  redis_endpoint            = module.redis.primary_endpoint_address
  redis_port                = module.redis.port
  redis_auth_token          = module.redis.auth_token
  tags                      = local.tags
}

module "iam" {
  source               = "../../modules/iam"
  project              = local.project
  environment          = var.environment
  media_bucket_arn     = module.storage.media_bucket_arn
  secret_arns = [
    module.secrets.django_secret_arn,
    module.secrets.database_url_secret_arn,
    module.secrets.redis_url_secret_arn,
  ]
  github_org                   = var.github_org
  github_repo                  = var.github_repo
  create_github_oidc_provider  = false # created once in environments/shared; looked up by URL here
  ecr_repository_arns          = [for r in data.aws_ecr_repository.this : r.arn]
  ecs_cluster_arn              = module.ecs_cluster.cluster_arn
  web_bucket_arn               = module.storage.web_bucket_arn
  admin_bucket_arn             = module.storage.admin_bucket_arn
  web_distribution_arn         = module.cdn.web_distribution_arn
  admin_distribution_arn       = module.cdn.admin_distribution_arn
  tags                         = local.tags
}

module "cdn" {
  source                             = "../../modules/cdn"
  project                            = local.project
  environment                        = var.environment
  certificate_arn                    = module.dns.cloudfront_certificate_arn
  web_fqdn                           = module.dns.web_fqdn
  admin_fqdn                         = module.dns.admin_fqdn
  api_fqdn                           = module.dns.api_fqdn
  web_bucket_name                    = module.storage.web_bucket_name
  web_bucket_arn                     = module.storage.web_bucket_arn
  web_bucket_regional_domain_name    = module.storage.web_bucket_regional_domain_name
  admin_bucket_name                  = module.storage.admin_bucket_name
  admin_bucket_arn                   = module.storage.admin_bucket_arn
  admin_bucket_regional_domain_name  = module.storage.admin_bucket_regional_domain_name
  tags                               = local.tags
}

module "monitoring" {
  source                      = "../../modules/monitoring"
  project                     = local.project
  environment                 = var.environment
  alert_email                 = var.alert_email
  alb_arn_suffix              = module.alb.arn_suffix
  target_group_arn_suffix     = module.alb.target_group_arn_suffix
  ecs_cluster_name            = module.ecs_cluster.cluster_name
  ecs_service_name            = module.ecs_service.service_name
  rds_instance_id             = module.database.identifier
  redis_replication_group_id  = module.redis.replication_group_id
  tags                        = local.tags
}

# --- DNS records that depend on things built above (see modules/dns for why these live here, not
# inside that module: it avoids a genuine module-to-module cycle between dns and cdn/alb). ---------
resource "aws_route53_record" "api" {
  zone_id = module.dns.zone_id
  name    = module.dns.api_fqdn
  type    = "A"
  alias {
    name                   = module.alb.dns_name
    zone_id                = module.alb.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "web" {
  zone_id = module.dns.zone_id
  name    = module.dns.web_fqdn
  type    = "A"
  alias {
    name                   = module.cdn.web_distribution_domain_name
    zone_id                = module.cdn.web_distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "admin" {
  zone_id = module.dns.zone_id
  name    = module.dns.admin_fqdn
  type    = "A"
  alias {
    name                   = module.cdn.admin_distribution_domain_name
    zone_id                = module.cdn.admin_distribution_hosted_zone_id
    evaluate_target_health = false
  }
}
