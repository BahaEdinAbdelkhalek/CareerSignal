# CareerSignal security and operations checklist

## Current AWS and Cloudflare deployment

### Candidate data and provider use

- Publish a privacy notice explaining that CV content is sent to the configured AI provider for analysis, and that GetProspect is used to search selected companies and HR contacts. Review the exact provider plans, data-processing terms, data locations, retention, and costs before processing real CVs.
- Use fictional CVs for a public showcase until that review is complete. Do not imply that fictional contacts, scores, or match reasons are verified people or hiring signals.
- Ask for clear user consent before upload. A CV upload is not automatically permission for every downstream use.
- The app prepares drafts; it does not send email. Users must verify a contact's current employer, role, and email before outreach.

### Credentials and browser configuration

- Keep model and GetProspect keys in the AWS SSM SecureString configured for the task Lambda. Keep the Logo.dev key in Cloudflare Worker secrets.
- `/runtime-config.json` may expose only the API origin, Cognito domain/client ID, and optional public profile links. Never add provider keys, AWS credentials, function keys, HMAC keys, or encryption keys to it or to Angular assets.
- Do not commit `.env`, `.dev.vars`, local settings, credentials, private keys, or deployment state. Example files should contain placeholders only.
- Run a secret scan over the full Git history before showcase release. If a credential was ever committed or pushed, revoke and rotate it; removing it from the current tree does not invalidate copies in history, builds, or artifacts.

### Access, retention, and deletion

- API Gateway validates Cognito JWTs. The current user pool is configured for administrator-created users, not open public signup. Keep real processing limited to accounts you intentionally create.
- Uploaded CVs and temporary processing objects are stored in private S3. The workflow deletes the original CV after analysis where possible; the two-day lifecycle rule is a fallback. Results are configured for 30-day expiry. S3 lifecycle and DynamoDB TTL are asynchronous, not exact deletion deadlines.
- Deleting a search removes its application data from S3 and DynamoDB when allowed. Deletion is rejected while the workflow is running. Step Functions history can remain for up to 90 days and contains identifiers and object-key references; the app cannot purge it.
- Keep S3 public access blocked, HTTPS enforced, API CORS limited to the exact frontend origin, and IAM permissions scoped to the application resources.

### Reliability and cost controls

- Model-provider outages (including HTTP 503), GetProspect limits, and Logo.dev failures must surface as errors or missing optional data. Never replace a failed live result with fictional sample results.
- Monitor Lambda and API Gateway errors, Step Functions failures, throttles, and provider usage. Do not log CV text, prompts, result bodies, email addresses, signed upload URLs, or credentials.
- Review AWS budgets and provider credit usage. Lambda, API Gateway, Step Functions, S3, DynamoDB, CloudWatch, model calls, and GetProspect usage may incur charges.

### Showcase release gates

- Run the test suites, production build, CloudFormation validation, and secret scan using the documented Node.js 24 runtime.
- In a production-like deployment, verify: Cognito sign-in; authenticated API calls; company lookup; a fictional CV reaching workflow completion; populated and zero-contact result states; logo loading; and deletion of a completed search.
- Verify `/runtime-config.json` contains only public settings and that the browser bundle contains no provider keys.
- Test a rejected unauthenticated request, an invalid/oversized upload, provider failure handling, and a failed workflow. Keep the previous Cloudflare Worker version available for rollback.
- Do not call the AWS deployment production-verified until these checks have passed against the deployed stack, not only in local unit tests.

## Legacy Azure deployment

The `azure` branch and its Cloudflare Access/Function-key deployment use a separate Azure Functions and Durable Functions path. Its function key, Durable management URLs, Key Vault, Blob Storage, cleanup timer, and scheduler retention instructions apply only to that legacy deployment. Do not use those settings for the current AWS/Cognito deployment.
