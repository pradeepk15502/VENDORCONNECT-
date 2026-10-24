variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "noncurrent_version_expiration_days" {
  description = "S3 versioning is on for the media bucket (accidental-overwrite recovery); old versions are cheap to keep for a while but not forever."
  type        = number
  default     = 90
}

variable "tags" {
  type    = map(string)
  default = {}
}
