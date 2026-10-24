# Internet -> ALB -> ECS (AWS audit doc, "Domain, HTTPS and networking"). HTTP redirects to HTTPS;
# HTTPS terminates here and forwards to the API's target group. The ECS task itself is never
# reachable except through this ALB (see modules/ecs's security group, which only allows ingress
# from this module's security group).

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public ALB ingress (443, 80->redirect); egress to ECS only"
  vpc_id      = var.vpc_id
  tags        = merge(var.tags, { Name = "${local.name}-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  from_port          = 443
  to_port            = 443
  ip_protocol        = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0"
  from_port          = 80
  to_port            = 80
  ip_protocol        = "tcp"
  description        = "Redirected to HTTPS by the listener rule below, never forwarded to ECS"
}

resource "aws_vpc_security_group_egress_rule" "to_ecs" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4          = "0.0.0.0/0" # narrowed further by modules/ecs's own ingress rule (ALB SG only)
  ip_protocol        = "-1"
}

resource "aws_lb" "this" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
  tags               = var.tags
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # Fargate tasks register by IP, not instance ID

  health_check {
    path                = var.health_check_path
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }

  deregistration_delay = var.deregistration_delay_seconds
  tags                  = var.tags
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
