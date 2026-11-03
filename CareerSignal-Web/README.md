# CareerSignal

## CareerSignal

<img src="public/assets/CareerSignal_Cover_Centered.png" alt="CareerSignal" width="100%" height="600" />

Standalone Angular frontend for CareerSignal. This repository is separated from the Azure Functions backend so its deployment cannot change the backend's workflow.

## Verified backend contract

Backend contract verified against the backend in this repository, branch `main`.

- `POST /api/career-signal` requires Function-level authorization.
- Accepts JSON `{ "cvText": string, "preferences": object }` or multipart fields `cv` (PDF) and `preferences` (JSON).
- Start response is `createCheckStatusResponse(...)`, which provides Durable Functions management URLs including `statusQueryGetUri`.
- Poll the status URL for `runtimeStatus`. On `Completed`, output has `{ product, version, analysis, companies, contacts, drafts, summary }`; `drafts.results` contains individualized drafts.
- Analysis fields: `candidateSummary`, `skills`, `targetRoles`, `companyKeywords`, `hrJobTitles`, `countryCodes`, `matchingCriteria`, `gaps`.
- Company and contact `fitScore` values are deterministic heuristic ranking scores with `scoreBreakdown` and `matchReasons`, not probabilities.
- Contacts are capped at five (and two per company); email is only available when provider data supplies it. `emailStatus` and `enrichmentStatus` reflect lookup outcomes.
- Durable failure states include `Failed`, `Terminated`, and `Canceled`. The management URLs are credentials and must not be logged or exposed.
- Backend currently has no user sign-in, per-user ownership, or authorization binding for a workflow ID. Its Function key must never be embedded in Angular or exposed to unauthenticated visitors.

The live adapter calls the same-origin Cloudflare Worker gateway, not Azure directly. The Worker validates a Cloudflare Access JWT and allowlisted email, enforces a submission rate limit, keeps the Function key server-side, and encrypts the Durable status URL into an owner-bound handle. Live requests remain unavailable until the Access application and Worker variables/secrets are configured. The backend has no general user accounts or per-user ownership, so live use is limited to the configured operator.

## Local development

Requires Node.js 24+ and npm.

```sh
npm ci
npm start
```

Open the local URL printed by Angular CLI. Default mode is demo in `src/environments/environment.ts`. Demo mode uses fictional sample results and never calls the backend or GetProspect. The current PDF interaction checks extension, MIME type and 10 MB limit locally; it does not upload or parse the selected file in demo mode.

Live search uses the Worker gateway and requires Cloudflare Access plus its production variables and secrets. The Azure Function key is never part of Angular configuration. The app defaults to demo mode; choose **Live** to authenticate before uploading a CV. Keep live access restricted to the configured operator until user ownership and deletion controls are added.

## Build and checks

```sh
npm run build
```

The app builds to `dist/careersignal/browser`. Interactive demo covers profile preference review, result sorting, profile signals, editable email drafts, copy actions, reviewed state, reset, input errors, and waiting/error UI. For real browser automation, add Playwright or another test runner and configure it against a local server before release.

## Azure Container Apps deployment

The single-container deployment serves the Angular production build and the same-origin Node gateway from one Azure Container App. The gateway calls the existing Azure Functions workflow; the Azure Function key is supplied as a Container Apps secret and is never put in Angular configuration.

See [`../docs/azure-container-apps.md`](../docs/azure-container-apps.md) for the GitHub image build and step-by-step Azure Portal setup. The container listens on port `8080`. Live mode requires the Container App's Entra authentication provider and a single allowlisted email. Keep Demo mode as the public default.

Build and run the container locally after building Angular:

```sh
npm ci
npm test
npm run build
docker build -t careersignal-web .
docker run --rm -p 8080:8080 careersignal-web
```

## Cloudflare Worker deployment alternative

The Angular app can also be hosted as static assets by the `careersignal` Cloudflare Worker. Its source is this folder's `worker.mjs`; `wrangler.jsonc` points the Worker at the Angular production output. Follow [`../docs/cloudflare-worker-gateway.md`](../docs/cloudflare-worker-gateway.md) only if you choose Cloudflare instead of the Azure Container Apps deployment.

Cloudflare Git build settings:

- Repository: `BahaEdinAbdelkhalek/CareerSignal`
- Production branch: `main`
- Root directory: `CareerSignal-Web`
- Build command: `npm test && npm run build`
- Deploy command: `npx wrangler deploy`
- Static output: `dist/careersignal/browser`

The Worker applies security headers, serves Angular route fallbacks, and provides a same-origin gateway at `/api/searches`. Configure Cloudflare Access and the Worker secrets before using Live mode. See [`../docs/cloudflare-worker-gateway.md`](../docs/cloudflare-worker-gateway.md) for the complete setup. Demo mode remains the default and does not call Azure or GetProspect.

For local Worker route tests, run `npm test`. To preview the Worker locally, copy `.dev.vars.example` to `.dev.vars`, fill local values, run `npm run build`, then `npm run preview`. Never commit `.dev.vars`.

## Product limits

CareerSignal discovers companies and HR/Talent Acquisition contacts and prepares outreach. It does not discover vacancies or send email. The demonstration names, addresses, companies, score values, and match explanations are fictional and must not be presented as real contacts or verified information.
