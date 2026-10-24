terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Bootstrapped once, out of band, by infrastructure/aws/bootstrap-state.sh (a state backend can't
  # create itself). Fill in infrastructure/aws/environments/shared/backend.hcl from
  # backend.hcl.example, then `terraform init -backend-config=backend.hcl`. Uses the same state
  # bucket/lock table as staging/production, just a different `key` — see backend.hcl.example.
  backend "s3" {}
}
