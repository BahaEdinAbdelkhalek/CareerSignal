output "container_app_url" {
  description = "Public HTTPS URL for the CareerSignal web app."
  value       = var.deploy_enabled ? "https://${azurerm_container_app.web[0].ingress[0].fqdn}" : null
}

output "entra_callback_url" {
  description = "Register this exact URL as a Web redirect URI in the Entra app registration."
  value       = var.deploy_enabled ? "https://${azurerm_container_app.web[0].ingress[0].fqdn}/api/auth/callback" : null
}

output "container_app_id" {
  description = "Azure resource ID of the created Container App."
  value       = var.deploy_enabled ? azurerm_container_app.web[0].id : null
}
