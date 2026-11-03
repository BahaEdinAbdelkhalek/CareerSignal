# IntrenshipSearchHelp

## CareerSignal

<img src="public/assets/CareerSignal_Cover_Centered.png" alt="CareerSignal" width="100%" height="600" />

Standalone Angular frontend for CareerSignal. This repository is separated from the Azure Functions backend so its deployment cannot change the backend's workflow.

## Verified backend contract

Inspected backend repository: `IntrenshipSearchHelp`, branch `main`.

- `POST /api/career-signal` requires Function-level authorization.
- Accepts JSON `{ "cvText": string, "preferences": object }` or multipart fields `cv` (PDF) and `preferences` (JSON).
- Start response is `createCheckStatusResponse(...)`, which provides Durable Functions management URLs including `statusQueryGetUri`.
- Poll the status URL for `runtimeStatus`. On `Completed`, output has `{ product, version, analysis, companies, contacts, drafts, summary }`; `drafts.results` contains individualized drafts.
- Analysis fields: `candidateSummary`, `skills`, `targetRoles`, `companyKeywords`, `hrJobTitles`, `countryCodes`, `matchingCriteria`, `gaps`.
- Company and contact `fitScore` values are deterministic heuristic ranking scores with `scoreBreakdown` and `matchReasons`, not probabilities.
- Contacts are capped at five (and two per company); email is only available when provider data supplies it. `emailStatus` and `enrichmentStatus` reflect lookup outcomes.
- Durable failure states include `Failed`, `Terminated`, and `Canceled`. The management URLs are credentials and must not be logged or exposed.
- Backend currently has no user sign-in, per-user ownership, or authorization binding for a workflow ID. Its Function key must never be embedded in Angular or exposed to unauthenticated visitors.

**Live integration is intentionally disabled.** `CareerSignalApiService` describes the observed submit/poll response contract, but no browser API key is supported. It needs a trusted authenticated server-side gateway that validates user identity, applies ownership and rate limits, keeps Function credentials private, and safely proxies Durable polling/deletion before public live use. The Angular live mode checks are not a substitute for that gateway.

## Local development

Requires Node.js 24+ and npm.

```sh
npm ci
npm start
```

Open the local URL printed by Angular CLI. Default mode is demo in `src/environments/environment.ts`. Demo mode uses fictional sample results and never calls the backend or GetProspect. The current PDF interaction checks extension, MIME type and 10 MB limit locally; it does not upload or parse the selected file in demo mode.

To connect live data later, implement a secure gateway, update the typed adapter to its authenticated contract, and review privacy/retention policy. Do not set a Function key in Angular environment files. The current build-time mode is set in `src/environments/environment.ts`; `.env.example` documents intended deployment values, but Angular does not load `.env` files automatically.

## Build and checks

```sh
npm run build
```

The app builds to `dist/intrenshipsearchhelp/browser`. Interactive demo covers profile preference review, result sorting, profile signals, editable email drafts, copy actions, reviewed state, reset, input errors, and waiting/error UI. For real browser automation, add Playwright or another test runner and configure it against a local server before release.

## Deploy to Azure Static Web Apps Free

1. Push this folder as the `IntrenshipSearchHelp` web repository to GitHub.
2. In Azure Portal, create a **Static Web App**, select the **Free** plan, and connect the repository and `main` branch. No Azure resources are created by this project.
3. Set build preset to **Custom** if prompted. Use app location `/`, API location blank, and output location `dist/intrenshipsearchhelp/browser`.
4. Add the generated deployment token to the repository's Actions secrets as `AZURE_STATIC_WEB_APPS_API_TOKEN`. The included workflow uses that secret.
5. Ensure the successful build uses Node 24 and `npm ci && npm run build`. Review the Actions workflow before merge.
6. Keep the published site in demo mode. Do not enable live API access until an authenticated server-side gateway, user authorization, rate limiting, CV retention/deletion controls, privacy notice, and security review exist.

`staticwebapp.config.json` configures SPA fallback and baseline security headers. The Content Security Policy currently allows Google Fonts. Remove that external font allowance if self-hosting fonts.

## Product limits

CareerSignal discovers companies and HR/Talent Acquisition contacts and prepares outreach. It does not discover vacancies or send email. The demonstration names, addresses, companies, score values, and match explanations are fictional and must not be presented as real contacts or verified information.
