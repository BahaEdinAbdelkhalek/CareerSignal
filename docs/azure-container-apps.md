# Legacy: Run CareerSignal in Azure Container Apps

**This guide applies to the separate Azure Functions path, not the current AWS `main` deployment.** This deployment uses one container app for both the Angular website and the Node.js gateway. The gateway sends requests to the existing Azure Functions workflow; the Azure Function key stays in Container Apps secrets and is never compiled into Angular.

```text
Browser -> Container App (Angular + gateway) -> Azure Functions -> Durable workflow
```

Live access is restricted to the single email configured in `CAREERSIGNAL_ALLOWED_EMAIL`. Keep the public demo in Demo mode unless you have explicitly enabled and tested authentication.

## 1. Build and publish the container image

The GitHub Actions workflow at `.github/workflows/careersignal-container.yml` runs gateway tests, builds the Docker image, and publishes it to GitHub Container Registry (GHCR) after changes are pushed to `main`.

1. Commit and push the project changes to the repository's `main` branch.
2. In GitHub, open the repository's **Actions** tab and wait for **Build CareerSignal container** to pass.
3. Open your GitHub profile's **Packages** page and select `careersignal-web`.
4. If Azure will pull the image without registry credentials, set the package visibility to **Public**. The image contains the same public application code as this public repository, but never put secrets in the image.
5. The image name is `ghcr.io/<your-github-owner>/careersignal-web:latest`. The workflow also publishes an immutable commit-SHA tag. Use the SHA tag when you want to deploy a specific build.

If the workflow cannot publish, check the repository's **Settings → Actions → General → Workflow permissions** and allow workflows to write packages. Do not add an Azure key as a GitHub Actions variable for this image build.

## 2. Create the Container Apps environment and app

In the Azure Portal:

1. Search **Container Apps**, select **Create**, then choose your subscription and resource group.
2. On **Basics**, set the app name to `careersignal-web` and choose a region that your subscription permits. Select **Consumption**. Create a Container Apps environment in that same region if you do not already have one.
3. Use the wizard's default Log Analytics setup if required, but review the cost estimate before creating supporting resources.
4. On **Container**, select a public registry / Docker Hub or other registry, and enter:
   - Image: `ghcr.io/<your-github-owner>/careersignal-web`
   - Tag: `latest` (or the immutable SHA tag from the successful GitHub Actions run)
   - Container name: `careersignal-web`
   - CPU and memory: start with the smallest values the portal allows.
5. On **Ingress**, enable ingress, select **External**, use **HTTP**, set the target port to `8080`, and disable insecure HTTP if that option is shown. Container Apps terminates HTTPS at ingress and forwards traffic to port 8080.
6. For a low-cost initial demo, set minimum replicas to `0` and maximum replicas to `1`. Scale-to-zero can cause a cold start. Check the pricing estimate and your student credit; Consumption does not guarantee that every supporting resource is free.
7. Review and create the app. Open its generated HTTPS application URL. The public demo should load.

The application uses `/` for Angular and same-origin `/api/searches` routes for the gateway. Do not configure a separate Azure API URL in Angular.

## 3. Configure Container Apps authentication

The site should remain publicly viewable, while live API calls require a sign-in. Configure the Container App's built-in **Authentication** using Microsoft Entra ID:

1. Open the Container App and select **Authentication** (in some portal layouts this is under **Settings**).
2. Add the **Microsoft** / **Microsoft Entra ID** identity provider. Use the portal's managed app registration option if available, or create an app registration as prompted. Complete the provider's redirect/callback setup exactly as the portal displays it.
3. Configure unauthenticated requests to be **allowed** so the public demo and static assets remain accessible. The gateway itself rejects unauthenticated `/api` requests. Do not disable the identity provider after setup.
4. Save and restart/create the new revision if prompted.
5. Set `CAREERSIGNAL_ALLOWED_EMAIL` below to the email Entra places in the authenticated principal. The gateway checks this exact email before accepting any live request.

When the user selects **Live**, the app sends them to `/api/access-login`, which redirects to the Container App's Entra sign-in route. The platform supplies the authenticated principal to the server; the gateway checks the email allowlist. Test that an unauthenticated `POST /api/searches` gets HTTP 401 and that signing in with an unapproved account does not start a workflow. If you cannot configure the provider or verify those rejections, do not use Live mode.

## 4. Add application settings and secrets

Open the Container App's **Settings → Secrets** and add:

- `careersignal-function-key`: the rotated Azure Function key.
- `careersignal-status-encryption-key`: a new random 32-byte key encoded as 64 hexadecimal characters.

Generate the encryption key locally in PowerShell (from the `CareerSignal-Web` folder):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not paste either secret into chat, GitHub, Angular environment files, or the Docker image. Then open **Settings → Environment variables** (or the container's **Environment variables**) and add:

| Name | Value |
|---|---|
| `CAREERSIGNAL_AUTH_PROVIDER` | `azure` |
| `CAREERSIGNAL_ALLOWED_EMAIL` | The one account allowed to run live searches |
| `CAREERSIGNAL_FUNCTION_APP_URL` | Function App origin only: `https://<your-function-app>.azurewebsites.net` |
| `CAREERSIGNAL_FUNCTION_KEY` | Reference the `careersignal-function-key` secret |
| `CAREERSIGNAL_STATUS_ENCRYPTION_KEY` | Reference the `careersignal-status-encryption-key` secret |
| `PORT` | `8080` |

For secret-backed variables, select **Reference a secret** in the portal rather than typing the secret into a normal variable. The Function App URL must not include `/api/career-signal`, `?code=`, or any key.

Save the configuration and create a new revision. Check **Revisions and replicas** and wait for the revision to become healthy.

## 5. Test the deployment with fictional data

1. Open the public HTTPS URL in a private browser window. Confirm the Demo experience loads without sign-in.
2. In browser developer tools, check that `/api/searches` is same-origin. The browser must never request the Azure Function hostname directly.
3. Before sign-in, a direct POST to `/api/searches` should return 401. Selecting Live should redirect to Entra sign-in.
4. Sign in with the allowlisted account and submit a fictional test CV first. Confirm the API start returns 202, polling reaches a terminal state, and completed results appear in the contacts view without a browser reload.
5. Try an account that is not allowlisted and verify it cannot start a search. Also verify Azure workflow failures appear as errors, not demo results.

Do not test with a real CV until all access checks pass. The workflow sends candidate information to the existing Azure AI Foundry and GetProspect integrations and may consume provider credits.

## Updating the app

Every push to `main` builds and publishes a new image. Container Apps does not necessarily replace a running revision just because the `latest` tag changed. After the workflow succeeds, update the app's container image/revision in the portal to the new immutable SHA tag (recommended), then save and wait for the new revision to become healthy. Keep the previous healthy revision until the new one is verified.

The current in-memory submission limiter is process-local and resets when the container restarts. It is an additional guard for this single-operator setup, not a durable quota or a substitute for authentication. For public multi-user use, add persistent per-user authorization, rate limiting, retention/deletion controls, and ownership in the backend before enabling live processing.
