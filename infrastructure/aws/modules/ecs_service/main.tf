# ECS Fargate service running the Django API only (web/admin are static, served from
# modules/cdn+storage, per the AWS audit doc's "Web + admin deployment model"). The ECS task is
# never reachable except through the ALB.
#
# This module owns only the task definition + service -- the cluster, the API's own security group,
# and its log group live in modules/ecs_cluster (a separate module with zero dependency on
# iam/secrets/storage), which this module takes as inputs. See infrastructure/aws/README.md "Why
# ecs is split into ecs_cluster/ecs_service" and docs/ARCHITECTURE.md D35 for why that split is
# what makes the overall module graph acyclic.

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn             = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.container_image
      essential = true
      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
      environment = [
        { name = "ENVIRONMENT", value = var.environment },
        { name = "DJANGO_DEBUG", value = "false" },
        { name = "DJANGO_ALLOWED_HOSTS", value = var.allowed_hosts },
        { name = "CORS_ALLOWED_ORIGINS", value = var.cors_allowed_origins },
        { name = "CSRF_TRUSTED_ORIGINS", value = var.csrf_trusted_origins },
        { name = "OTP_DEV_ECHO", value = "false" },
        { name = "SMS_PROVIDER", value = var.sms_provider },
        { name = "LOG_LEVEL", value = "INFO" },
        { name = "LOG_FORMAT", value = "json" },
        { name = "MEDIA_STORAGE_BACKEND", value = var.media_storage_backend },
        { name = "AWS_STORAGE_BUCKET_NAME", value = var.aws_storage_bucket_name },
        { name = "AWS_S3_REGION_NAME", value = var.aws_s3_region_name },
        { name = "WEB_CONCURRENCY", value = tostring(var.worker_concurrency) },
        { name = "DJANGO_SETTINGS_MODULE", value = "config.settings.prod" },
      ]
      secrets = [
        { name = "DJANGO_SECRET_KEY", valueFrom = "${var.django_secret_arn}:DJANGO_SECRET_KEY::" },
        { name = "JWT_SIGNING_KEY", valueFrom = "${var.django_secret_arn}:JWT_SIGNING_KEY::" },
        { name = "OTP_HMAC_KEY", valueFrom = "${var.django_secret_arn}:OTP_HMAC_KEY::" },
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
        { name = "REDIS_URL", valueFrom = var.redis_url_secret_arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.log_group_name
          "awslogs-region"        = var.aws_s3_region_name
          "awslogs-stream-prefix" = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -fsS http://localhost:${var.container_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.alb_target_group_arn
    container_name    = "api"
    container_port    = var.container_port
  }

  # Deploys after this initial apply are done by CI/CD (`aws ecs register-task-definition` +
  # `update-service` — see .github/workflows/ci.yml and infrastructure/aws/README.md "Deploys vs.
  # terraform apply"), not by re-running Terraform for every release. Without this, every
  # `terraform plan` after a CI deploy would show a spurious diff trying to revert the service back
  # to whatever image/task-definition revision Terraform itself last knew about.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = var.tags
}
