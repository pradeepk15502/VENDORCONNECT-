variable "project" {
  description = "Short project name used in resource names/tags (e.g. \"vendorconnect\")."
  type        = string
}

variable "environment" {
  description = "staging | production"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to spread public/private subnets across. 2 is the minimum for an ALB and RDS Multi-AZ."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "true = one shared NAT gateway (cheaper, single point of egress-failure — fine for staging/MVP); false = one NAT gateway per AZ (production-grade, costs more)."
  type        = bool
  default     = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
