# CareerSignal AWS path

`main` is the AWS backend path. `azure` is intended to retain the Azure backend. Both use the same candidate workflow and browser API contract: CV analysis, company ranking, HR contact discovery, at most five sequential email-enrichment attempts, and one reviewed draft per shortlisted contact.

The Angular app and Cloudflare Worker remain the public UI/auth edge for now. The Worker verifies the configured Cloudflare Access identity, rate-limits searches, signs backend requests, and keeps opaque owner-bound search handles. AWS hosts the API and workflow. This is a hybrid deployment, not an all-AWS frontend move; CloudFront is not assumed available in the Learner Lab.

The AWS model adapter expects an **OpenAI-compatible Chat Completions endpoint**. Bedrock is not assumed available in this lab. A model API key and GetProspect API key are still required, and either provider may charge or consume credits. Do not send real CVs until you have reviewed the provider privacy terms and confirmed the costs.

## What the templates create

### Foundation: `foundation.yml`

Creates a private, SSE-S3-encrypted S3 bucket and an on-demand DynamoDB table. It creates no roles or compute.

- CV objects under `cv/` and processing objects under `jobs/` are set to expire after two days.
- Results under `results/` are set to expire after 30 days.
- Search rows and replay-protection nonces use DynamoDB TTL. TTL and S3 lifecycle deletion are asynchronous, not exact deadlines.

### Application: `application.yml`

Reuses the foundation bucket/table and existing IAM roles. It creates API Gateway HTTP API, two Node.js 24 Lambda functions, a Standard Step Functions state machine, and Lambda log groups with seven-day retention. The API stage is throttled to 2 requests per second with a burst of 4, and each Lambda is capped at 2 concurrent executions. No model endpoint, API key, IAM role, static frontend host, or custom domain is created.

The Step Functions state contains owner/search IDs and S3 object keys, not CV text, analysis, contacts, or results. Standard execution history still retains those references for up to 90 days and cannot be purged by the app's delete endpoint. Result bodies live in S3 and are configured for 30-day expiry.

## Do not deploy until these lab checks pass

The Learner Lab's service allowlist does not prove that its pre-created `LabRole` can be passed to these resources. Before creating the application stack, check that:

1. The Lambda role ARN trusts `lambda.amazonaws.com` and has the required S3, DynamoDB, Step Functions `StartExecution`, SSM `GetParameter`, KMS `Decrypt`, and CloudWatch Logs actions.
2. The Step Functions role ARN trusts `states.amazonaws.com` and can invoke the task Lambda.
3. Your CloudFormation caller can pass those roles (`iam:PassRole`). The template creates no roles.

If `LabRole` cannot be used by Step Functions, **stop**. Do not try to work around the lab's IAM limits by creating resources or roles outside its rules.

The templates do not guarantee zero cost. Lambda/API Gateway/Step Functions charge per use; S3 and DynamoDB charge for requests/storage; CloudWatch can charge for logs. Standard SSM parameters avoid a Secrets Manager per-secret monthly fee, but KMS/API usage may still be billable. Check the current Learner Lab budget; it can lag by 8–12 hours.

## Prepare the runtime package

Use a Linux environment such as AWS CloudShell so optional native packages are not copied from Windows into Lambda:

```sh
cd aws
npm ci
cd ..
python aws/scripts/package.py
```

This creates `aws/build/careersignal-aws.zip`. It contains Lambda code, the pinned AWS SDK packages and PDF parser, plus the shared matching/model/provider logic. It contains no credentials.

## Provision in `us-east-1`

Start the Learner Lab, open CloudShell, and select **US East (N. Virginia), `us-east-1`**. Run validation from CloudShell after starting the lab session; local AWS CLI credentials outside the lab may be invalid:

```sh
aws cloudformation validate-template --template-body file://infra/aws/foundation.yml --region us-east-1
aws cloudformation validate-template --template-body file://infra/aws/application.yml --region us-east-1
```

Then proceed only if the role checks above are confirmed:

1. In CloudFormation, create a stack from `infra/aws/foundation.yml`, named `careersignal-aws-foundation`. Review the change set: it should contain only an S3 bucket, its policy, and a DynamoDB table. Save the `CvBucketName` and `SearchesTableName` outputs.
2. Build the Lambda zip as described above. Upload it to the foundation bucket using the S3 console, at `artifacts/careersignal-aws.zip`.
3. In Systems Manager → Parameter Store, create a **Standard SecureString** named `/careersignal/providers`. Its JSON value must have `gatewayHmacKey`, `getProspectApiKey`, and `modelApiKey`. Generate a new random 32-byte gateway key locally; do not paste it into chat, source files, CloudFormation values, or terminal command history. Do not use real keys until you are ready to incur provider usage.
4. Create a second CloudFormation stack from `infra/aws/application.yml`, named `careersignal-aws-app`. Set the data bucket and table outputs, code bucket to the same foundation bucket, code key to `artifacts/careersignal-aws.zip`, SecureString name to `/careersignal/providers`, model endpoint/name, and the three verified existing role ARNs. Review the change set before creating it. It should not create IAM roles.
5. Copy the `ApiBaseUrl` output into the Cloudflare Worker variable `CAREERSIGNAL_AWS_API_URL`. Set the matching gateway key as the Worker secret `CAREERSIGNAL_GATEWAY_HMAC_KEY`. Keep the existing Cloudflare Access issuer, audience, and allowed-email configuration, and generate a separate random 32-byte hex value for `CAREERSIGNAL_STATUS_ENCRYPTION_KEY`.
6. Deploy the Worker and Angular assets from `CareerSignal-Web/`, then test with a fictional text CV first. Verify unauthenticated API calls fail, the authorized flow reaches `Completed`, and deletion removes the S3/DynamoDB application data.

The Worker upload path stores PDFs in S3 through a five-minute presigned URL. Lambda checks the uploaded object size and PDF format before processing. The original PDF and extracted text are deleted during analysis; the S3 lifecycle rules are fallback cleanup.

## Secret and provider format

The SSM SecureString must decode to an object with these exact keys:

```json
{
  "gatewayHmacKey": "generated-random-value",
  "getProspectApiKey": "provider-key",
  "modelApiKey": "model-provider-key"
}
```

Do not put these values in this repository. The model endpoint and deployment/model name are non-secret CloudFormation parameters; the key stays in SSM. GetProspect email enrichment can consume credits, and the workflow intentionally caps it at five sequential attempts.

## Cleanup and retention

The app delete endpoint removes a completed/failed search's DynamoDB row and associated S3 CV, processing, and result objects. It rejects deletion while a workflow is running. S3 lifecycle and DynamoDB TTL are fallback cleanup and may run later than the configured age. Step Functions history is not purged; it contains only IDs and object-key references. To remove the stack, first delete the application stack, remove the uploaded Lambda artifact and all remaining objects from the foundation bucket, delete the SSM parameter, then delete the foundation stack. Deleting the table permanently deletes its rows.
