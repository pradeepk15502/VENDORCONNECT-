# CloudFront's ACM certificate must be requested in us-east-1 regardless of the stack's home region
# (AWS audit doc, "HTTPS": "CloudFront and the ALB require separate certificates"). The root module
# supplies both provider configurations; this module only declares that it needs the aliased one.
terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
  }
}
