# Run CareerSignal in Azure Container Apps

This deployment uses one container app for both the Angular website and the Node.js gateway. The gateway sends requests to the existing Azure Functions workflow; the Azure Function key stays in Container Apps secrets and is never compiled into Angular.

```text
Browser -> Container App (Angular + gateway) -> Azure Functions -> Durable workflow
```

Live access is restricted to the single email configured in `CAREERSIGNAL_ALLOWED_EMAIL`. Keep the public demo in Demo mode unless you have explicitly enabled and tested authentication.

## 1. Build and publish the container image

The GitHub Actions workflow at `.github/workflows/careersignal-container.yml` runs gateway tests, builds the Docker image, and publishes it to GitHub Container Registry (GHCR) after changes are pushed to `azure`.

1. Commit and push the Azure changes to the repository's `azure` branch.
2. In GitHub, open the repository's **Actions** tab and wait for **Build CareerSignal container** to pass.
3. Open your GitHub profile's **Packages** page and select `careersignal-web`.
4. If Azure will pull the image without registry credentials, set the package visibility to **Public**. The image contains the same public application code as this public repository, but never put secrets in the image.
5. The image name is `ghcr.io/bahaedinabdelkhalek/careersignal-web:latest`. The workflow also publishes an immutable commit-SHA tag. Use the SHA tag when you want to deploy a specific build.

If the workflow cannot publish, check the repository's **Settings → Actions → General → Workflow permissions** and allow workflows to write packages. Do not add an Azure key as a GitHub Actions variable for this image build.

## 2. Create the Container Apps environment and app

In the Azure Portal:

1. Search **Container Apps**, select **Create**, then choose your Student subscription and `rg-hr-project` (or the resource group you intend to use).
2. On **Basics**, set the app name to `careersignal-web` and choose a region that your subscription permits. Select **Consumption**. Create a Container Apps environment in that same region if you do not already have one.
3. Use the wizard's default Log Analytics setup if required, but review the cost estimate before creating supporting resources.
4. On **Container**, select a public registry / Docker Hub or other registry, and enter:
   - Image: `ghcr.io/bahaedinabdelkhalek/careersignal-web`
   - Tag: `latest` (or the immutable SHA tag from the successful GitHub Actions run)
   - Container name: `careersignal-web`
   - CPU and memory: start with the smallest values the portal allows.
5. On **Ingress**, enable ingress, select **External**, use **HTTP**, set the target port to `8080`, and disable insecure HTTP if that option is shown. Container Apps terminates HTTPS at ingress and forwards traffic to port 8080.
6. For a low-cost initial demo, set minimum replicas to `0` and maximum replicas to `1`. Scale-to-zero can cause a cold start. Check the pricing estimate and your student credit; Consumption does not guarantee that every supporting resource is free.
7. Review and create the app. Open its generated HTTPS application URL. The public demo should load.

The application uses `/` for Angular and same-origin `/api/searches` routes for the gateway. Do not configure a separate Azure API URL in Angular.

## 3. Configure Microsoft sign-in for the Express environment

The Express environment does not support Container Apps' built-in Authentication blade. The Node gateway performs Microsoft Entra OpenID Connect itself, so do not add an identity provider in the Container App portal. Keep public ingress enabled for the demo; the gateway protects live API routes with an encrypted, HttpOnly session and an exact email allowlist.

Use an app registration in your workforce tenant. You can reuse the registration created during the failed Container Apps authentication attempt; do not create duplicates. In **Microsoft Entra ID → App registrations → your registration**:

1. Set **Supported account types** to **Accounts in this organizational directory only**.
2. Under **Authentication**, add a **Web** redirect URI exactly as follows:
   `https://careersignal-web.purplehill-d5ad3b16.spaincentral.azurecontainerapps.io/api/auth/callback`
3. Under **Certificates & secrets**, create a client secret and copy its value immediately. It is separate from the Azure Function key. Set a reminder to rotate it before expiry.
4. Copy the registration's **Application (client) ID** and the directory **Tenant ID**. No Microsoft Graph permissions are needed; the app requests only `openid profile email` scopes.

When the candidate selects **Live**, `/api/access-login` starts the authorization-code flow with PKCE. The gateway validates the returned token's signature, tenant issuer, audience, expiry, nonce, and allowed email. It encrypts the resulting session in a Secure, HttpOnly, SameSite cookie. The Azure Function key and Durable status URL remain server-side. Test with the configured email and confirm another tenant account is rejected.

## 4. Add application settings and secrets

Open the Container App's **Settings → Secrets** and add:

- `careersignal-function-key`: the rotated Azure Function key.
- `careersignal-status-encryption-key`: a new random 32-byte key encoded as 64 hexadecimal characters.
- `careersignal-entra-client-secret`: the Entra app registration client secret.
- `careersignal-session-encryption-key`: a separate new random 32-byte key encoded as 64 hexadecimal characters.

Generate separate status and session encryption keys locally in PowerShell (from the `CareerSignal-Web` folder). Run the command twice and use a different value for each secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not paste either secret into chat, GitHub, Angular environment files, or the Docker image. Then open **Settings → Environment variables** (or the container's **Environment variables**) and add:

| Name | Value |
|---|---|
| `CAREERSIGNAL_AUTH_PROVIDER` | `azure` |
| `CAREERSIGNAL_PUBLIC_ORIGIN` | `https://careersignal-web.purplehill-d5ad3b16.spaincentral.azurecontainerapps.io` |
| `CAREERSIGNAL_ENTRA_TENANT_ID` | The Entra directory Tenant ID |
| `CAREERSIGNAL_ENTRA_CLIENT_ID` | The Entra app registration Application (client) ID |
| `CAREERSIGNAL_ENTRA_CLIENT_SECRET` | Reference the `careersignal-entra-client-secret` secret |
| `CAREERSIGNAL_SESSION_ENCRYPTION_KEY` | Reference the `careersignal-session-encryption-key` secret |
| `CAREERSIGNAL_ALLOWED_EMAIL` | The one account allowed to run live searches |
| `CAREERSIGNAL_FUNCTION_APP_URL` | Function App origin only: `https://hr-function-brercabzfnf2d7gj.spaincentral-01.azurewebsites.net` (use this only if it is still your Function App) |
| `CAREERSIGNAL_FUNCTION_KEY` | Reference the `careersignal-function-key` secret |
| `CAREERSIGNAL_STATUS_ENCRYPTION_KEY` | Reference the `careersignal-status-encryption-key` secret |
| `PORT` | `8080` |

For secret-backed variables, select **Reference a secret** in the portal rather than typing the secret into a normal variable. The Function App URL must not include `/api/career-signal`, `?code=`, or any key.

Save the configuration and create a new revision. Check **Revisions and replicas** and wait for the revision to become healthy.

## 5. Test the deployment with fictional data

1. Open the public HTTPS URL in a private browser window. Confirm the Demo experience loads without sign-in.
2. In browser developer tools, check that `/api/searches` is same-origin. The browser must never request the Azure Function hostname directly.
3. Before sign-in, a direct POST to `/api/searches` should return 401. Selecting Live should redirect to the Microsoft sign-in page.
4. Sign in with the allowlisted account and submit a fictional test CV first. Confirm the API start returns 202, polling reaches a terminal state, and completed results appear in the contacts view without a browser reload.
5. Try a different Microsoft account and verify it cannot start a workflow. Also verify Azure workflow failures appear as errors, not demo results.

Do not test with a real CV until all access checks pass. The workflow sends candidate information to the existing Azure AI Foundry and GetProspect integrations and may consume provider credits.

## Updating the app

Every push to `azure` builds and publishes `latest` plus an immutable commit-SHA tag. Container Apps does not automatically pull a changed image just because the `latest` tag moved. To deploy manually, open the Container App's **Revisions and replicas** (or **Containers**) page, edit the image tag and save to create a new revision. Keep the tag as `latest` to deploy the newest build, or select a SHA tag to deploy a specific build. Wait for the revision to become healthy and receive traffic before removing the previous healthy revision.

The current in-memory submission limiter is process-local and resets when the container restarts. It is an additional guard for this single-operator setup, not a durable quota or a substitute for authentication. For public multi-user use, add persistent per-user authorization, rate limiting, retention/deletion controls, and ownership in the backend before enabling live processing.
