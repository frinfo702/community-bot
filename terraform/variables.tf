variable "account_id" {
  description = "Cloudflare account ID that owns the docs Worker."
  type        = string
}

variable "worker_name" {
  description = "Name of the static-assets Worker."
  type        = string
  default     = "community-bot-docs"
}

variable "compatibility_date" {
  description = "Workers compatibility date for the docs Worker."
  type        = string
  default     = "2026-10-01"
}
