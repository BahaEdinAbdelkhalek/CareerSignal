# CareerSignal security and operations checklist

## Before using real candidate CVs

- Publish a clear privacy notice naming Microsoft Azure / the configured Azure AI Foundry deployment and GetProspect as service providers.
- Define the purpose and lawful basis for processing candidate CVs and professional contact data. Do not assume that uploading a CV automatically authorizes every downstream use.
- Confirm the applicable Microsoft and GetProspect terms, data-processing agreements, data locations, retention, and international-transfer arrangements for the actual subscriptions and regions.
- Keep the Function App and storage account non-public where possible. Restrict the Function key and rotate it if it is exposed.
- Do not put Function keys, Durable management URLs, CV content, API responses or email addresses into client-side analytics or logs.
- Confirm Key Vault and Blob Storage RBAC for the user-assigned managed identity. Prefer private networking and storage firewall restrictions where available.
- The application independently enforces the 10 MB PDF limit. On Flex Consumption, `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT` is not used, so enforce a request-size cap at API Management, Front Door, or another ingress layer before public launch.

## Retention behavior in this version

1. The upload function stores extracted CV text at `{instanceId}/candidate-cv.txt`.
2. The CV analysis activity deletes that blob in a `finally` block, whether analysis succeeds or fails.
3. If orchestration startup fails after upload, the HTTP handler deletes the blob.
4. A daily timer deletes orphaned CV text blobs that remain beyond `CAREERSIGNAL_CV_ORPHAN_RETENTION_HOURS` (default 48 hours).
5. Durable Task Scheduler autopurge removes terminal orchestration histories after its default 30-day retention period. The retention policy is a scheduler-level resource setting and applies across task hubs on that scheduler.
6. A caller may purge a terminal workflow sooner with `DELETE /api/career-signal/{instanceId}`.

The blob-cleanup timer is best-effort operational code, not a substitute for monitoring. Alert on timer failures and test deletion in a non-production task hub before using real candidate data. Durable Task Scheduler autopurge defaults to 30 days for terminal states and can be changed through the scheduler retention policy. Also configure Azure Storage lifecycle management as a secondary safeguard if your deployment retains other blobs in the same storage account/container.

## Matching and recommendation quality

- Scores are deterministic heuristics. They are ranking aids, not probabilities or hiring predictions.
- A company profile can be incomplete. Missing metadata can lower a match score even when a company is suitable.
- A contact's title and employer may be stale. Check current role and company before outreach.
- `emailStatus: valid` comes from provider data. It does not guarantee deliverability at send time.
- The service does not identify open vacancies. Never describe a matched company as hiring unless vacancy information has been independently established.
- Review every generated email for factual accuracy, tone, recipient fit and candidate-specific claims before sending.

## Production-readiness work not included in this patch

- User sign-in and authorization that binds each orchestration ID to its owner.
- Per-user rate limits, abuse prevention and quotas.
- Consent and processing audit records, support workflows and export/delete controls.
- A user-facing results UI with retry/re-run behavior and manual review of matches.
- A benchmark dataset measuring company/contact precision, email validity and draft factuality.
- Load tests, dependency vulnerability scanning, Azure Monitor alerts and deployment rollback.
- A deployment-specific Bicep/Terraform baseline for identity, Key Vault RBAC, private endpoints, storage policies and Durable Task Scheduler.
