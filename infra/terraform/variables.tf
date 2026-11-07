variable "deploy_enabled" {
  description = "Must be explicitly set true to create Azure resources. Keep false while reviewing cost and configuration."
  type        = bool
  default     = false
}

variable "subscription_id" {
  description = "Azure subscription ID. Leave empty to use the subscription selected by az login."
  type        = string
  default     = ""
}

variable "resource_group_name" {
  description = "Existing resource group for the CareerSignal web resources. Terraform will not create or delete this group."
  type        = string
  default     = "rg-hr-project"
}

variable "location" {
  description = "Azure region permitted by the subscription."
  type        = string
  default     = "Spain Central"
}

variable "container_app_name" {
  description = "Name for the Container App. Use a new name unless importing an existing app into Terraform state."
  type        = string
  default     = "careersignal-web-iac"
}

variable "environment_name" {
  description = "Name for the standard workload-profiles Container Apps environment. This creates a new environment."
  type        = string
  default     = "careersignal-env-iac"
}

variable "image" {
  description = "Public GHCR image, including an immutable tag for repeatable deployments."
  type        = string
  default     = "ghcr.io/bahaedinabdelkhalek/careersignal-web:sha-1b66cc2"
}

variable "public_origin" {
  description = "Exact public HTTPS origin of the app, with no path or trailing slash."
  type        = string
  default     = ""
}

variable "entra_tenant_id" {
  description = "Microsoft Entra workforce tenant ID."
  type        = string
  default     = ""
}

variable "entra_client_id" {
  description = "Microsoft Entra app registration client ID."
  type        = string
  default     = ""
}

variable "entra_client_secret" {
  description = "Microsoft Entra app registration client secret. Never commit tfvars or Terraform state."
  type        = string
  sensitive   = true
  default     = ""
}

variable "allowed_email" {
  description = "Single account allowed to run live searches."
  type        = string
  default     = ""
}

variable "function_app_url" {
  description = "Azure Function App origin only, without path or query string."
  type        = string
  default     = "https://hr-function-brercabzfnf2d7gj.spaincentral-01.azurewebsites.net"
}

variable "function_key" {
  description = "Rotated Azure Function key. This value is stored in Terraform state; protect the state file."
  type        = string
  sensitive   = true
  default     = ""
}

variable "status_encryption_key" {
  description = "32 random bytes as 64 hex characters. Stored in Terraform state; protect the state file."
  type        = string
  sensitive   = true
  default     = ""

  validation {
    condition     = var.status_encryption_key == "" || can(regex("^[0-9a-fA-F]{64}$", var.status_encryption_key))
    error_message = "status_encryption_key must be empty or 64 hexadecimal characters."
  }
}

variable "session_encryption_key" {
  description = "A separate 32-byte random key as 64 hex characters. Stored in Terraform state; protect the state file."
  type        = string
  sensitive   = true
  default     = ""

  validation {
    condition     = var.session_encryption_key == "" || can(regex("^[0-9a-fA-F]{64}$", var.session_encryption_key))
    error_message = "session_encryption_key must be empty or 64 hexadecimal characters."
  }
}
