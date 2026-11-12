# AWS frontend and API integration

## Current request path

The current `main` frontend uses Cognito authorization-code flow with PKCE and calls API Gateway directly with the Cognito access token. API Gateway validates the JWT. The Cloudflare Worker serves the Angular assets, public runtime configuration, and the company-logo proxy; it is not in the live API request path.

```text
Browser -> Cloudflare Worker: Angular assets and public config
Browser -> Cognito: sign-in and access token
Browser -> API Gateway: authenticated API calls
Browser -> private S3: short-lived presigned PDF upload
```

The AWS stack defines the API routes and Cognito JWT authorizer in `infra/aws/application.yml`. The frontend calls the API origin from `CAREERSIGNAL_PUBLIC_API_BASE_URL` and sends the access token as a bearer token. The API origin and Cognito client settings are public values, not credentials.

## Cloudflare runtime variables

Set these Worker variables before deploying the Angular/Worker update:

- `CAREERSIGNAL_PUBLIC_API_BASE_URL`: the `ApiBaseUrl` stack output, with no path or trailing route.
- `CAREERSIGNAL_COGNITO_DOMAIN`: the `CognitoDomain` stack output.
- `CAREERSIGNAL_COGNITO_CLIENT_ID`: the `CognitoUserPoolClientId` stack output.
- `CAREERSIGNAL_PUBLIC_LINKEDIN_URL` and `CAREERSIGNAL_PUBLIC_GITHUB_URL`: optional HTTPS profile links shown in the header.

The Worker returns these values from `/runtime-config.json`. Do not place provider credentials there. Keep `LOGO_DEV_PUBLISHABLE_KEY` as a Worker secret. Keep the model and GetProspect keys in the AWS SSM SecureString described in `infra/aws/README.md`.

For local Worker preview, put the public values and the Logo.dev key in the ignored `.dev.vars` file copied from `.dev.vars.example`. Do not commit `.dev.vars`.

## Verification

1. Open `/runtime-config.json` from the deployed Worker and confirm it contains only the API URL, Cognito client settings, and optional profile links. It must not contain any provider keys.
2. Sign in through Cognito and confirm API requests use the AWS API Gateway origin with an `Authorization: Bearer` header.
3. Confirm an unauthenticated API request is rejected by the API Gateway JWT authorizer.
4. Run a fictional CV through the complete workflow. Check that the search reaches a terminal state and the result page handles both contacts and zero-contact outcomes.
5. Confirm the Logo.dev key is not present in built assets, browser configuration, or responses from `/runtime-config.json`.
6. Test deletion and verify the corresponding DynamoDB and S3 application data is removed. Remember that Step Functions execution history has its own retention period.

## Legacy Worker proxy

`CareerSignal-Web/worker.mjs` still contains an older Cloudflare Access/HMAC proxy for `/api/searches`. The current Angular service does not call those routes, and the current AWS API template uses a Cognito JWT authorizer. Do not configure or depend on that legacy proxy for the current AWS frontend. Keep it in place until the deployed flow has been verified and any consumer of those legacy routes is ruled out.
