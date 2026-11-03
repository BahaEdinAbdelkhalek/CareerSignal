# Cloudflare Worker gateway setup

The Angular app and API gateway are served by the `careersignal` Cloudflare Worker. The browser sends searches to the same-origin `/api/searches` routes. The Worker authenticates the request with Cloudflare Access, adds the Azure Function key server-side, and polls Durable Functions without returning its management URL to the browser.

## Cloudflare Worker settings

The Worker project must use:

- Repository: `BahaEdinAbdelkhalek/CareerSignal`
- Production branch: `main`
- Root directory: `CareerSignal-Web`
- Build command: `npm test && npm run build`
- Deploy command: `npx wrangler deploy`
- Angular output: `dist/careersignal/browser`

`.nvmrc` pins the build to Node.js 24. `wrangler.jsonc` connects the build output to the Worker as static assets and defines a per-user search submission limit of three requests per minute. Do not remove that rate-limit binding without replacing it with another abuse control.

## Configure Access

1. In Cloudflare, open **Zero Trust → Access → Applications** and add a self-hosted application for the Worker hostname.
2. Scope the application to the path `/api/*`, so the public demo remains accessible while API routes require sign-in.
3. Create an **Allow** policy for the account that is permitted to submit real CVs. Keep this allowlist narrow. The Worker independently checks the Access JWT signature, issuer, audience, and email.
4. Copy the Access team's issuer URL (for example `https://<team-name>.cloudflareaccess.com`) and the application's audience tag.

The `/api/access-login` route starts the Access sign-in flow. The app stores only a temporary live-mode preference in `sessionStorage`; it never stores an Access token or Azure credential.

## Configure Worker variables and secrets

In **Workers & Pages → careersignal → Settings → Variables and Secrets**, configure these for the production environment:

| Name | Type | Value |
|---|---|---|
| `CAREERSIGNAL_FUNCTION_APP_URL` | Variable | Azure Function App origin only, e.g. `https://<function-app>.azurewebsites.net` |
| `ACCESS_ISSUER` | Variable | Your Access issuer URL, with `https://` |
| `ACCESS_AUD` | Variable | The Access application's audience tag |
| `CAREERSIGNAL_ALLOWED_EMAIL` | Variable | The single email allowed to run live searches |
| `CAREERSIGNAL_FUNCTION_KEY` | Secret | The rotated Azure Function key |
| `CAREERSIGNAL_STATUS_ENCRYPTION_KEY` | Secret | A new random 32-byte key represented as 64 hexadecimal characters |

Generate the status encryption key locally with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not commit `.dev.vars`, print secrets in CI logs, or put the Function key or Durable URL in Angular configuration. `.dev.vars.example` contains placeholders only; copy it to `.dev.vars` for local Worker development and fill in local test values.

## Request flow

1. The user selects **Live** in the app. The browser navigates to `/api/access-login`; Cloudflare Access authenticates the user and returns them to the app.
2. After CV and preferences are reviewed, Angular sends a multipart request to `POST /api/searches` on the current Worker origin.
3. The Worker requires a valid Access JWT, matching allowlisted email, matching origin, and an available rate-limit slot. It forwards the PDF to Azure `POST /api/career-signal` with `x-functions-key` set server-side.
4. Azure starts the Durable orchestration. The Worker encrypts the returned instance ID and Durable status URL into an opaque, owner-bound handle and returns only that handle to the browser.
5. Angular polls `GET /api/searches/{handle}`. The Worker verifies the user's identity and handle, polls Azure, and returns only the workflow state or completed result.
6. When the Worker returns `Completed`, the existing Angular flow sets the result and switches to the contacts view. No browser page reload is needed.

The handle expires after two hours. It is encrypted with AES-GCM, tied to the Access subject, and unusable by a different Access identity. The Azure status URL is never returned or logged by this gateway.

## Safe activation and checks

The frontend defaults to demo mode. Keep it there for the public demo. A visitor who selects Live must authenticate through Access and pass the Worker allowlist; unauthorized requests are rejected server-side. The CV is uploaded only after the user confirms the reviewed search.

Before using a real CV, verify:

- Access is restricted to the intended email and scoped to `/api/*`.
- The Worker production variables and secrets are set, and no credentials are in the browser bundle.
- A fictional test PDF starts and completes a workflow; the dashboard switches to contacts when polling receives the completed result.
- Unauthenticated and non-allowlisted requests are rejected; another identity cannot poll a handle.
- Oversized uploads and rate-limited submissions are rejected.
- Failed workflows and timeout responses are shown as errors, not demo results.

The backend currently has no general user accounts or per-user ownership. This implementation is intentionally restricted to a single allowlisted operator; it is not ready for public multi-user CV processing. Real runs send candidate data to Azure AI Foundry and GetProspect and may consume GetProspect credits.
