# Cloudflare Worker gateway to AWS

On `main`, Angular calls the Worker at the same origin using the existing `/api/searches` contract. The Worker verifies Cloudflare Access, then signs server-to-server requests to the AWS API Gateway endpoint with HMAC. The AWS API does not trust user IDs supplied by ordinary callers; every routed API request must have a valid signature, recent timestamp, and one-use UUID nonce for mutations.

The Worker also converts PDF form uploads into a short-lived, signed S3 upload. The presigned URL stays between the Worker and S3 and is never sent back to Angular. The browser continues to poll using an opaque, owner-bound handle; AWS execution ARNs and S3 keys are not returned to it.

## Cloudflare Worker configuration

Set these as Worker variables:

- `ACCESS_ISSUER`: the exact Cloudflare Access team issuer, for example `https://<team-name>.cloudflareaccess.com`.
- `ACCESS_AUD`: the audience tag for the Access application.
- `CAREERSIGNAL_ALLOWED_EMAIL`: the one email address allowed to run Live searches.
- `CAREERSIGNAL_AWS_API_URL`: the HTTPS origin from the AWS stack's `ApiBaseUrl` output, with no path, query, or trailing API route.

Set these as Worker secrets:

- `CAREERSIGNAL_GATEWAY_HMAC_KEY`: the same randomly generated value stored in the SSM SecureString's `gatewayHmacKey` field.
- `CAREERSIGNAL_STATUS_ENCRYPTION_KEY`: a separate random 32-byte key encoded as 64 hexadecimal characters. It encrypts the opaque browser search handle.

Keep the Access application scoped to the Worker site/API and allow only the configured operator. The Worker rate limiter is declared in `wrangler.jsonc`; keep it enabled. Do not set `CAREERSIGNAL_TRUSTED_SERVER_AUTH` on Cloudflare. That flag is reserved for the separate Node container server, which removes inbound `x-ms-client-principal` headers before adding one from a verified session.

Never put any of these secrets in Angular environment files, GitHub variables exposed to builds, or source control. If the HMAC key is rotated, update both Cloudflare and SSM, then deploy the Worker. Keep old keys out of logs.

## Smoke test

1. With Cloudflare Access signed out, request `POST /api/searches`; it must not reach the AWS API.
2. Sign in as the allowlisted account and submit a **fictional** text CV.
3. Confirm the Worker receives a 202 response and only returns an opaque `searchId`.
4. Poll until the status is `Completed`. Verify the Angular workspace displays the same analysis, ranked companies, contacts, and drafts as the Azure path.
5. Use AWS logs and DynamoDB/S3 metadata to troubleshoot. Never log CV text, model prompts, result bodies, HMAC signatures, presigned URLs, or provider keys.

The AWS API URL is public, but untrusted direct calls fail without the HMAC secret. The HMAC secret is a service credential: anyone who obtains it can impersonate a Worker request. Keep the Worker Access policy and secret access restricted, and rotate the key if it may have leaked.
