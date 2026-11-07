# CareerSignal Container Apps Terraform

This Terraform configuration describes a **new** standard Consumption Container Apps environment and a CareerSignal web container. It leaves the resource group itself unmanaged and does not alter the existing Azure Functions backend.

It is intentionally opt-in: `deploy_enabled` defaults to `false`, so the default plan creates no Azure resources. This does not make an enabled deployment free. Azure Monitor log collection, Container Apps, the environment, and related resources can consume student credit. Check Cost Management before applying.

## Important before use

- The currently running `careersignal-web` app and its Express environment are **not imported or changed** by this configuration.
- Defaults use distinct `-iac` resource names to avoid overwriting the portal-created app. Enabling this configuration creates an additional environment and app and may increase cost.
- Do not apply it unless you intend to create those extra resources. To manage the existing app instead, first design and review a Terraform import plan; do not rename the existing app or environment to force adoption.
- Terraform stores secret values in its state file even when variables are marked `sensitive`. Keep state local and private for this prototype, never commit it, and do not upload it to a public backend. For team/production use, configure a secured remote state backend and preferably use Key Vault secret references.
- The container image must already exist and be public in GHCR. The sample uses an immutable tag so Terraform can create a new revision when the image changes.
- No Azure resources are created by these instructions until `deploy_enabled` is explicitly set to `true` and `terraform apply` is run.

## Prerequisites

- Terraform 1.8 or later
- Azure CLI logged into the intended subscription: `az login`
- The `rg-hr-project` resource group already exists
- A public GHCR image built from the current frontend/gateway source
- A single-tenant Entra app registration with this Web redirect URI after Terraform prints the app URL:
  `https://<container-app-fqdn>/api/auth/callback`

## Safe preview

From this directory in PowerShell:

```powershell
az login
az account set --subscription "Azure for Students"
terraform init
terraform plan
```

With the default `deploy_enabled = false`, the plan must show **0 to add, 0 to change, 0 to destroy**.

## Configure an intentional deployment

1. Copy `terraform.tfvars.example` to `terraform.tfvars`. This file is gitignored.
2. Use a new app/environment name unless you have separately reviewed a Terraform import plan. The example names are `careersignal-web-iac` and `careersignal-env-iac`.
3. Set `deploy_enabled = true` only after checking the Azure cost estimate and subscription credit.
4. Fill the tenant/client IDs, allowed email, current public image tag, Function key, Entra client secret, and two distinct random 64-hex-character encryption keys in the local tfvars file. Do not paste secrets into chat or commit the file.
5. For a first deployment, `public_origin` cannot be known until Azure creates the app. Use a two-pass setup:
   - First create the resources with a temporary HTTPS origin value, then read `container_app_url` and `entra_callback_url` from Terraform outputs.
   - Add the exact output callback URL as a **Web redirect URI** in the Entra registration.
   - Update `public_origin` to the actual `container_app_url` in local `terraform.tfvars` and apply again.
6. Review the plan carefully. It should only create the named `-iac` app and environment. Stop if it proposes deleting or replacing existing backend resources.
7. Run `terraform apply` only after reviewing the complete plan and expected charges.

Terraform creates the app with external HTTPS ingress, target port 8080, Consumption workload profile, zero minimum replicas and maximum one replica. Scale-to-zero can reduce compute usage while idle, but does not guarantee a zero bill.

## Update the container

Set `image` in local `terraform.tfvars` to the new GHCR SHA tag, for example `ghcr.io/bahaedinabdelkhalek/careersignal-web:sha-<current-commit>`, then run `terraform plan` and review it before `terraform apply`. An immutable tag makes the revision change explicit. The Terraform does not configure a GitHub-to-Azure deployment credential or auto-deploy on push.

## Remove only resources created by this Terraform

After verifying the Terraform state contains only the `-iac` resources, `terraform destroy` removes those managed resources. Review the destroy plan carefully. It must not include `rg-hr-project`, the existing Function App, storage, Key Vault, Durable resources, or the existing portal-created `careersignal-web` app.
