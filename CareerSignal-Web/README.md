# CareerSignal

## CareerSignal

<img src="public/assets/CareerSignal_Cover_Centered.png" alt="CareerSignal" width="100%" height="600" />

Angular frontend and Cloudflare Worker for CareerSignal. The `main` branch uses the AWS backend; the Azure Functions implementation is a separate legacy deployment.

## Current AWS frontend contract

On `main`, the browser signs in with Cognito authorization-code + PKCE and sends its access token directly to API Gateway. API Gateway validates the JWT. Cloudflare serves the Angular assets and the same-origin logo proxy; it is not in the current API request path. The Worker returns public deployment settings from `/runtime-config.json`. Those settings are the API URL and Cognito public client configuration, never provider keys.

The Lambda provider keys remain in the configured SSM SecureString. The Logo.dev key remains a Cloudflare Worker secret. The `CareerSignal-Web/src/environments/environment.ts` file contains no account-specific values; configure the Worker variables documented below.

## Legacy Azure backend contract

The following contract applies only to the separate Azure Functions backend, not the current AWS path.

- `POST /api/career-signal` requires Function-level authorization.
- Accepts JSON `{ "cvText": string, "preferences": object }` or multipart fields `cv` (PDF) and `preferences` (JSON).
- Start response is `createCheckStatusResponse(...)`, which provides Durable Functions management URLs including `statusQueryGetUri`.
- Poll the status URL for `runtimeStatus`. On `Completed`, output has `{ product, version, analysis, companies, contacts, drafts, summary }`; `drafts.results` contains individualized drafts.
- Analysis fields: `candidateSummary`, `skills`, `targetRoles`, `companyKeywords`, `hrJobTitles`, `countryCodes`, `matchingCriteria`, `gaps`.
- Company and contact `fitScore` values are deterministic heuristic ranking scores with `scoreBreakdown` and `matchReasons`, not probabilities.
- Contacts are capped at five (and two per company); email is only available when provider data supplies it. `emailStatus` and `enrichmentStatus` reflect lookup outcomes.
- Durable failure states include `Failed`, `Terminated`, and `Canceled`. The management URLs are credentials and must not be logged or exposed.
- Backend currently has no user sign-in, per-user ownership, or authorization binding for a workflow ID. Its Function key must never be embedded in Angular or exposed to unauthenticated visitors.

The Azure adapter is a separate legacy deployment. Do not use its Cloudflare Access variables or Function key with the current AWS deployment. For AWS, use Cognito and the API Gateway JWT authorizer described above.

## Local development

Requires Node.js 24+ and npm.

```sh
npm ci
npm start
```

For authenticated local testing, use the Worker preview rather than `ng serve` alone: copy `.dev.vars.example` to `.dev.vars`, fill in the AWS API/Cognito values, then run `npm run build` and `npm run preview`. The Angular dev server alone has no runtime config or authenticated API connection.

Live AWS search requires the runtime API and Cognito settings to be configured. Cognito client settings and the API URL are public; model, GetProspect, and Logo.dev keys must never be placed in Angular configuration. Keep real CV processing restricted to authorized users until account ownership, privacy, and deletion controls have been verified.

## Build and checks

```sh
npm run build
```

The app builds to `dist/careersignal/browser`. Interactive demo covers profile preference review, result sorting, profile signals, editable email drafts, copy actions, reviewed state, reset, input errors, and waiting/error UI. For real browser automation, add Playwright or another test runner and configure it against a local server before release.

## Legacy Azure Container Apps deployment

This deployment is for the separate Azure Functions path only. It is not the deployment path for the current AWS `main` branch. The single-container app serves Angular and a Node gateway; the Azure Function key is supplied as a Container Apps secret and is never put in Angular configuration.

See [`../docs/azure-container-apps.md`](../docs/azure-container-apps.md) for the GitHub image build and step-by-step Azure Portal setup. The container listens on port `8080`. Live mode requires the Container App's Entra authentication provider and a single allowlisted email. Keep Demo mode as the public default.

Build and run the legacy Azure container locally after setting its runtime configuration. This path is separate from the AWS Cloudflare deployment.

```sh
npm ci
npm test
npm run build
docker build -t careersignal-web .
docker run --rm -p 8080:8080 careersignal-web
```

## Cloudflare Worker deployment

The Angular app is hosted as static assets by the `careersignal` Cloudflare Worker. Its source is this folder's `worker.mjs`; `wrangler.jsonc` points the Worker at the Angular production output. The current frontend calls AWS API Gateway directly with Cognito, while the Worker serves assets, runtime configuration, and company logos. The older Access/HMAC proxy routes are not used by the current frontend.

Cloudflare Git build settings:

- Repository: your fork or GitHub repository
- Production branch: `main`
- Root directory: `CareerSignal-Web`
- Build command: `npm test && npm run build`
- Deploy command: `npx wrangler deploy`
- Static output: `dist/careersignal/browser`

The Worker applies security headers, serves Angular route fallbacks, provides `/runtime-config.json`, and proxies company logos. Before deploying, configure these Cloudflare Worker variables: `CAREERSIGNAL_PUBLIC_API_BASE_URL`, `CAREERSIGNAL_COGNITO_DOMAIN`, and `CAREERSIGNAL_COGNITO_CLIENT_ID`. These values are public, but must match your AWS stack outputs and Worker origin. Set your optional social links with `CAREERSIGNAL_PUBLIC_LINKEDIN_URL` and `CAREERSIGNAL_PUBLIC_GITHUB_URL`. Store `LOGO_DEV_PUBLISHABLE_KEY` as a Worker secret. The AWS API authenticates users through Cognito; do not configure the legacy Azure Access gateway for this path.

For local Worker route tests, run `npm test`. To preview the Worker locally, copy `.dev.vars.example` to `.dev.vars`, fill in the public API/Cognito values and the Logo.dev key, run `npm run build`, then `npm run preview`. The API URL and Cognito values are public configuration; `LOGO_DEV_PUBLISHABLE_KEY` is kept server-side by the Worker. Never add provider keys to Angular files or commit `.dev.vars`.

Company logos load through the same-origin `/logos/<domain>` Worker route. Image elements cannot send the app's Cognito bearer token, so this public-image route validates the domain and only fetches from Logo.dev's fixed origin. The Worker reads `LOGO_DEV_PUBLISHABLE_KEY`, keeping the key out of the browser bundle. Set the secret with `npx wrangler secret put LOGO_DEV_PUBLISHABLE_KEY`; set the public runtime variables in the Cloudflare dashboard before the first deployment of this version. Then run `npm test`, `npm run build`, and `npx wrangler deploy`. This frontend/Worker deployment does not require rebuilding the AWS ZIP or updating CloudFormation.

## Product limits

CareerSignal discovers companies and HR/Talent Acquisition contacts and prepares outreach. It does not discover vacancies or send email. The demonstration names, addresses, companies, score values, and match explanations are fictional and must not be presented as real contacts or verified information.
