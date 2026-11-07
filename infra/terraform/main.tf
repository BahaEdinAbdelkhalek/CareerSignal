data "azurerm_resource_group" "target" {
  count = var.deploy_enabled ? 1 : 0
  name  = var.resource_group_name
}

resource "azurerm_container_app_environment" "careersignal" {
  count = var.deploy_enabled ? 1 : 0

  name                = var.environment_name
  location            = var.location
  resource_group_name = data.azurerm_resource_group.target[0].name
  logs_destination    = "azure-monitor"

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
    minimum_count         = 0
    maximum_count         = 1
  }

  tags = {
    application = "careersignal"
    managed_by  = "terraform"
  }
}

resource "azurerm_container_app" "web" {
  count = var.deploy_enabled ? 1 : 0

  name                         = var.container_app_name
  container_app_environment_id = azurerm_container_app_environment.careersignal[0].id
  resource_group_name          = data.azurerm_resource_group.target[0].name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  secret {
    name  = "function-key"
    value = var.function_key
  }

  secret {
    name  = "status-encryption-key"
    value = var.status_encryption_key
  }

  secret {
    name  = "entra-client-secret"
    value = var.entra_client_secret
  }

  secret {
    name  = "session-encryption-key"
    value = var.session_encryption_key
  }

  template {
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "careersignal-web"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "CAREERSIGNAL_AUTH_PROVIDER"
        value = "azure"
      }
      env {
        name  = "CAREERSIGNAL_PUBLIC_ORIGIN"
        value = var.public_origin
      }
      env {
        name  = "CAREERSIGNAL_ENTRA_TENANT_ID"
        value = var.entra_tenant_id
      }
      env {
        name  = "CAREERSIGNAL_ENTRA_CLIENT_ID"
        value = var.entra_client_id
      }
      env {
        name        = "CAREERSIGNAL_ENTRA_CLIENT_SECRET"
        secret_name = "entra-client-secret"
      }
      env {
        name  = "CAREERSIGNAL_ALLOWED_EMAIL"
        value = var.allowed_email
      }
      env {
        name  = "CAREERSIGNAL_FUNCTION_APP_URL"
        value = var.function_app_url
      }
      env {
        name        = "CAREERSIGNAL_FUNCTION_KEY"
        secret_name = "function-key"
      }
      env {
        name        = "CAREERSIGNAL_STATUS_ENCRYPTION_KEY"
        secret_name = "status-encryption-key"
      }
      env {
        name        = "CAREERSIGNAL_SESSION_ENCRYPTION_KEY"
        secret_name = "session-encryption-key"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  lifecycle {
    precondition {
      condition = alltrue([
        var.public_origin != "",
        var.entra_tenant_id != "",
        var.entra_client_id != "",
        var.entra_client_secret != "",
        var.allowed_email != "",
        var.function_key != "",
        can(regex("^[0-9a-fA-F]{64}$", var.status_encryption_key)),
        can(regex("^[0-9a-fA-F]{64}$", var.session_encryption_key)),
      ])
      error_message = "Set the HTTPS public origin, Entra values, authorized email, Function key, and both 64-character encryption keys before enabling deployment."
    }
  }

  tags = {
    application = "careersignal"
    managed_by  = "terraform"
  }
}
