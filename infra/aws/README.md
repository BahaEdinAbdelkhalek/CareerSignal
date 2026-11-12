# CareerSignal AWS path

`main` is the AWS backend path. `azure` is intended to retain the Azure backend. Both use the same candidate workflow: CV analysis, company ranking, HR contact discovery, at most five sequential email-enrichment attempts, and reviewed email drafts that are not sent.

The Angular app can be hosted as static files on Cloudflare Pages. It signs in with Cognito using authorization-code + PKCE, then calls API Gateway directly with a Cognito access token. API Gateway verifies JWTs; Lambda scopes search data to the verified Cognito `sub`. PDF files upload directly to private S3 using short-lived presigned URLs. No Cloudflare Worker or browser-held provider/AWS secret is needed.

The AWS model adapter supports **Google Gemini** (`generateContent`) and OpenAI-compatible Chat Completions endpoints. For Gemini, set the provider to `gemini`, endpoint to `https://generativelanguage.googleapis.com/v1beta`, and model to an available Gemini model such as `gemini-2.5-flash` (confirm current model availability in Google AI Studio). Store the Gemini API key in the existing SSM `modelApiKey` field. Bedrock is not assumed available in this lab. A model API key and GetProspect API key are still required, and provider usage may cost money or consume credits. Before processing real CVs, review the provider plans' privacy terms and costs and obtain candidate consent.

## What the templates create

### Foundation: `foundation.yml`

Creates a private, SSE-S3-encrypted S3 bucket and an on-demand DynamoDB table. Both are retained if the stack is deleted or either resource is replaced, to prevent accidental data loss. It creates no roles or compute. Set `AllowedOrigin` to the exact HTTPS Cloudflare Worker origin so the browser can upload PDFs to S3.

- CV objects under `cv/` and processing objects under `jobs/` are set to expire after two days.
- Results under `results/` are set to expire after 30 days.
- Search rows and replay-protection nonces use DynamoDB TTL. TTL and S3 lifecycle deletion are asynchronous, not exact deadlines.

### Application: `application.yml`

Reuses the foundation bucket/table and existing IAM roles. It creates a Cognito user pool/client/domain, API Gateway HTTP API with a Cognito JWT authorizer and origin-restricted CORS, two Node.js 24 Lambda functions, a Standard Step Functions state machine, and Lambda log groups with seven-day retention. The API stage is throttled to 2 requests per second with a burst of 4, and each Lambda is capped at 2 concurrent executions. No model endpoint, API key, IAM role, static frontend host, or custom domain is created. Set `AllowedOrigin` to the exact HTTPS Cloudflare Worker origin and choose a globally unique `CognitoDomainPrefix`.

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

1. In CloudFormation, create a stack from `infra/aws/foundation.yml`, named `careersignal-aws-foundation`. Set `AllowedOrigin` to the exact public Cloudflare Worker origin (for example `https://careersignal.<your-account>.workers.dev`). Review the change set; save the `CvBucketName` and `SearchesTableName` outputs.
2. Build the Lambda zip as described above. Upload it to the foundation bucket using the S3 console, at `artifacts/careersignal-aws.zip`.
3. In Systems Manager → Parameter Store, create a **Standard SecureString** named `/careersignal/providers`. Its JSON value must have `getProspectApiKey` and `modelApiKey`. Do not paste keys into chat, source files, or terminal command history. Do not use real keys until you are ready to incur provider usage.
4. Create a second CloudFormation stack from `infra/aws/application.yml`, named `careersignal-aws-app`. Set the foundation bucket/table, artifact bucket/key, SecureString name, model provider/endpoint/name, existing role ARNs, the same `AllowedOrigin`, and a unique `CognitoDomainPrefix`. For Gemini, use provider `gemini`, endpoint `https://generativelanguage.googleapis.com/v1beta`, and a currently available model ID. Review the change set; it should not create IAM roles.
5. Create a Cognito user in the new pool with verified email, then set a permanent password. For example, use `aws cognito-idp admin-create-user --user-pool-id POOL_ID --username YOUR_EMAIL --user-attributes Name=email,Value=YOUR_EMAIL Name=email_verified,Value=true --message-action SUPPRESS`, followed by `aws cognito-idp admin-set-user-password --user-pool-id POOL_ID --username YOUR_EMAIL --password 'A-Strong-Unique-Password' --permanent`. Do not put the password in shared shell history.
6. Before deploying the frontend, set these Cloudflare Worker variables from the application stack outputs: `CAREERSIGNAL_PUBLIC_API_BASE_URL` = `ApiBaseUrl`, `CAREERSIGNAL_COGNITO_DOMAIN` = `CognitoDomain`, and `CAREERSIGNAL_COGNITO_CLIENT_ID` = `CognitoUserPoolClientId`. They are public client configuration, not secrets. The Worker serves them through `/runtime-config.json`. Keep existing values in place during a frontend update, then build and deploy `CareerSignal-Web` with Wrangler. Use the exact same Worker origin for both stacks.
7. Test login, then run the workflow with a PDF you are authorized to process. Verify direct browser requests without a token fail, the authenticated workflow reaches `Completed`, and deleting a search removes its S3/DynamoDB application data.

The browser uploads PDFs to S3 through a five-minute presigned URL. Lambda checks uploaded object size and PDF format before processing. The original PDF and extracted text are deleted during analysis; S3 lifecycle rules are fallback cleanup.

## Secret and provider format

The SSM SecureString must decode to an object with these exact keys:

```json
{
  "getProspectApiKey": "provider-key",
  "modelApiKey": "model-provider-key"
}
```

Do not put these values in this repository. The model endpoint and model name are non-secret CloudFormation parameters; provider keys stay in SSM. GetProspect email enrichment can consume credits, and the workflow intentionally caps it at five sequential attempts.

## Cleanup and retention

The app delete endpoint removes a completed/failed search's DynamoDB row and associated S3 CV, processing, and result objects. It rejects deletion while a workflow is running. S3 lifecycle and DynamoDB TTL are fallback cleanup and may run later than the configured age. Step Functions history is not purged; it contains only IDs and object-key references. To remove the stack, first delete the application stack and the SSM parameter. The foundation stack retains its bucket and table when deleted. After confirming you no longer need the data, empty and delete the bucket, then delete the DynamoDB table manually. This is intentionally explicit because deleting the table permanently removes its rows.
