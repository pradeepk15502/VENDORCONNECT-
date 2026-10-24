provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "VendorConnect"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# CloudFront's ACM certificate must be requested in us-east-1 regardless of var.aws_region
# (modules/dns).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "VendorConnect"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
