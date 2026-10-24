variable "project" {
  type = string
}

variable "repository_names" {
  description = "Which images actually need a repository. The AWS audit doc's Docker readiness section confirms all three (api/web/admin) are real, distinct images already built by CI — so all three are the default, but this stays a variable rather than hardcoded three so an environment can trim it if that ever changes."
  type        = list(string)
  default     = ["api", "web", "admin"]
}

variable "untagged_image_expiry_days" {
  type    = number
  default = 14
}

variable "keep_last_n_tagged_images" {
  type    = number
  default = 20
}

variable "tags" {
  type    = map(string)
  default = {}
}
