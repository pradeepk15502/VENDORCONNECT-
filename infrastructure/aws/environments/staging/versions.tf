terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Bootstrapped once, out of band, by infrastructure/aws/bootstrap-state.sh. Fill in
  # infrastructure/aws/environments/staging/backend.hcl from backend.hcl.example, then
  # `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}
