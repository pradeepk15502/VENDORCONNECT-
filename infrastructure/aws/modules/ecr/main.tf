# One repository per image actually built by CI (AWS audit doc, "Docker readiness" — api/web/admin
# are all real, distinct images). Immutable tags: `latest` is never the only deployment identity
# (Phase 13 prompt, ECR section) — CI pushes the commit SHA as the tag (see .github/workflows/ci.yml).

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repository_names)
  name                 = "${var.project}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after ${var.untagged_image_expiry_days} days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = var.untagged_image_expiry_days
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last ${var.keep_last_n_tagged_images} tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPatternList = ["*"]
          countType     = "imageCountMoreThan"
          countNumber   = var.keep_last_n_tagged_images
        }
        action = { type = "expire" }
      }
    ]
  })
}
