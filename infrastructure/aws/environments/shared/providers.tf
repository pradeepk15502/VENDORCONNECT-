provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "VendorConnect"
      Environment = "shared"
      ManagedBy   = "Terraform"
    }
  }
}
