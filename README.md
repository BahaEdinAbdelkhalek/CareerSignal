# CareerSignal

![CareerSignal cover](CareerSignal-Web/public/assets/CareerSignal_Cover_Centered.png)

Node.js 24+ · Angular 20 · AWS Lambda · Step Functions · Cloudflare Worker · Demo uses fictional data

CareerSignal turns a CV and search preferences into a ranked shortlist of relevant companies and HR or Talent Acquisition contacts, then prepares one outreach draft per selected contact. It does not discover vacancies, verify that a company is hiring, or send email.

## Platform branches

- `main` is the AWS backend path. It uses S3, DynamoDB, Lambda, Step Functions, API Gateway, and Systems Manager Parameter Store. The public Angular app and Access gateway remain on Cloudflare for now.
- `azure` retains the Azure Functions/Durable Functions implementation. Its hosting and deployment are separate from the AWS implementation.

Both paths are intended to preserve the same workflow and browser API behavior. The AWS code and CloudFormation are local and **have not been deployed or verified in the AWS Academy account**. Its use of `LabRole` is still subject to the lab's trust-policy, permission, and `iam:PassRole` limits. Do not treat the AWS path as live until those checks pass and a fictional end-to-end test succeeds.

## Workflow

1. Accepts plain-text CV content or a text-based PDF up to 10 MB. Scanned PDFs are not OCR'd.
2. Extracts CV text and stores it temporarily in private S3.
3. Uses a configured OpenAI-compatible Chat Completions endpoint to extract evidence-based skills, roles, search keywords, countries, and gaps.
4. Searches GetProspect for companies and ranks a bounded result set using deterministic matching rules.
5. Searches those companies for HR/Talent Acquisition contacts, ranks them, and selects no more than five (at most two per company).
6. Attempts sequential email enrichment for those five contacts only.
7. Generates one editable outreach draft per contact. Recipient name, company, and email come from provider data, not model claims.

GetProspect email enrichment can consume credits. The model endpoint can also charge and receives CV information. Bedrock is not assumed to be available in the Learner Lab. Review provider pricing and privacy terms before using real CVs.

## Matching model

Company fit is a weighted heuristic: keyword relevance (45%), candidate skills (25%), target roles (15%), and additional matching criteria (15%). If country data exists on both sides, up to 15 points are reserved for country match.

Contact fit uses HR role relevance (65%), company fit (30%), and email availability (5%). Non-HR titles and weak company matches are filtered. Scores are not probabilities; results include score breakdowns and match reasons for inspection.

## AWS deployment

The CloudFormation templates are under [`infra/aws/`](infra/aws/README.md):

- `foundation.yml` creates private, encrypted S3 storage and an on-demand DynamoDB table. CV and processing objects expire after two days; results after 30 days. S3 lifecycle and DynamoDB TTL cleanup are asynchronous.
- `application.yml` creates an HTTP API, Node.js 24 Lambda handlers, a Standard Step Functions workflow, and seven-day Lambda log retention. It reuses existing role ARNs and creates no IAM roles.

The AWS API accepts only signed requests from the Cloudflare Worker. The Worker verifies the configured Cloudflare Access identity and allowlisted email, applies a rate limit, and keeps search handles opaque and owner-bound. PDF uploads use a short-lived presigned S3 URL. See [`docs/aws-cloudflare-gateway.md`](docs/aws-cloudflare-gateway.md) and follow the role/budget checks in [`infra/aws/README.md`](infra/aws/README.md) before provisioning.

The package requires Node.js 24 and a Linux build environment such as AWS CloudShell:

```sh
cd aws
npm ci
cd ..
python aws/scripts/package.py
```

This creates `aws/build/careersignal-aws.zip`; it does not deploy anything. AWS API Gateway, Lambda, Step Functions, S3, DynamoDB, KMS/SSM, and CloudWatch usage is not guaranteed free. Learner Lab budget updates can lag by 8–12 hours.

## Azure branch

The `azure` branch keeps the existing Azure Functions v4, Durable Functions, Blob Storage, Key Vault, and Foundry implementation. Its deployment instructions remain in that branch's README and `docs/` files. Do not deploy both backend paths for the same UI without deliberately configuring which API the Worker calls.

## Frontend and local tests

The Angular app in [`CareerSignal-Web/`](CareerSignal-Web/README.md) has a fictional-data Demo mode and a Live mode through the same-origin Worker gateway. Demo mode never calls the backend or GetProspect. The selected PDF in Demo mode is validated locally but not uploaded or parsed.

Run the backend and AWS adapter tests from the repository root:

```sh
npm ci
npm run check
npm test
```

Run the frontend/gateway tests and build from `CareerSignal-Web/`:

```sh
npm ci
npm test
npm run build
```

The AWS path has unit tests for request signing, input validation, model-adapter behavior, and workflow stages. Those tests do not verify AWS permissions or make calls to AWS, GetProspect, or a model provider.

## Privacy and limits

- The original PDF is deleted after analysis; lifecycle expiry is a fallback, not an exact deletion deadline.
- Processing objects are removed after successful completion or failure where possible, with two-day lifecycle expiry as a fallback. Results are configured for 30-day S3 expiry and DynamoDB TTL.
- Standard Step Functions history remains for up to 90 days and cannot be purged by the delete endpoint. The state machine passes S3 keys and IDs, not CV text, analysis, contacts, or result bodies.
- The AWS Live path is restricted to one Cloudflare Access identity. Do not expose the gateway HMAC key or status-encryption key. Anyone with the HMAC key can impersonate the Worker to the AWS API.
- Email drafts are suggestions for human review. Verify the company, recipient's current role, email validity, and internship availability before contacting anyone.
