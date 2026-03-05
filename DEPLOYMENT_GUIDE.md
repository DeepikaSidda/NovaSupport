# NovaSupport Deployment Guide

## Prerequisites

- **Node.js** >= 18.x
- **AWS CLI** v2 configured with credentials (`aws configure`)
- **AWS CDK** v2 (`npm install -g aws-cdk`)
- **TypeScript** (`npm install -g typescript`)
- AWS account with permissions for: Lambda, DynamoDB, S3, SQS, API Gateway, Cognito, CloudWatch, Bedrock, IAM, X-Ray

## Architecture Overview

NovaSupport deploys as a serverless stack on AWS:

| Service | Purpose |
|---------|---------|
| DynamoDB | Tickets, attachments, knowledge base, analytics (single table with 3 GSIs) |
| S3 | Attachment storage (versioned, encrypted, 90-day lifecycle) |
| SQS | Ticket processing queue + multimodal processing queue (with DLQs) |
| Lambda | API handlers (create/get/list tickets, upload attachments, analytics) |
| API Gateway | REST API with Cognito auth, CORS, rate limiting (100 req/s) |
| Cognito | User pools with admin/support_agent/user roles |
| CloudWatch | Dashboard (NovaSupport-Metrics), log group, 4 alarms, X-Ray tracing |
| Bedrock | Amazon Nova models (Lite, Sonic, Multimodal, Embeddings) |

## Step-by-Step Deployment

### 1. Install dependencies

```bash
npm install
```

### 2. Build the TypeScript project

```bash
npm run build
```

### 3. Run tests to verify

```bash
npx jest --no-coverage
```

### 4. Bootstrap CDK (first time only)

```bash
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

### 5. Deploy the stack

```bash
cdk deploy --require-approval broadening
```

CDK will output the following values after deployment:
- `ApiGatewayUrl` — Base URL for the REST API
- `TicketsTableName` — DynamoDB table name
- `AttachmentsBucketName` — S3 bucket name
- `TicketProcessingQueueUrl` — SQS queue URL
- `MultimodalProcessingQueueUrl` — Multimodal SQS queue URL
- `UserPoolId` — Cognito User Pool ID
- `UserPoolClientId` — Cognito App Client ID
- `DashboardUrl` — CloudWatch dashboard link
- `LogGroupName` — CloudWatch log group

## Environment Variables

Lambda functions receive these automatically via CDK:

| Variable | Description |
|----------|-------------|
| `TICKETS_TABLE_NAME` | DynamoDB table name |
| `ATTACHMENTS_BUCKET_NAME` | S3 bucket for attachments |
| `TICKET_PROCESSING_QUEUE_URL` | SQS ticket processing queue |
| `MULTIMODAL_PROCESSING_QUEUE_URL` | SQS multimodal processing queue |
| `COGNITO_USER_POOL_ID` | Cognito user pool ID |
| `COGNITO_CLIENT_ID` | Cognito app client ID |

## Post-Deployment Validation

### 1. Verify API Gateway

```bash
# Get the API URL from CDK output
curl -s <ApiGatewayUrl>/tickets | jq .
```

### 2. Create a test user in Cognito

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username testuser@example.com \
  --temporary-password TempPass1! \
  --user-attributes Name=email,Value=testuser@example.com

aws cognito-idp admin-add-user-to-group \
  --user-pool-id <UserPoolId> \
  --username testuser@example.com \
  --group-name admin
```

### 3. Verify DynamoDB table

```bash
aws dynamodb describe-table --table-name <TicketsTableName> --query "Table.GlobalSecondaryIndexes[*].IndexName"
# Expected: ["GSI1", "GSI2", "GSI3"]
```

### 4. Verify SQS queues

```bash
aws sqs get-queue-attributes --queue-url <TicketProcessingQueueUrl> --attribute-names All
```

### 5. Check CloudWatch dashboard

Open the `DashboardUrl` from CDK output. Verify widgets for:
- API request volume, latency, and errors
- Ticket queue depth and DLQ messages
- Lambda errors and duration
- DynamoDB capacity consumption

### 6. Verify Bedrock model access

```bash
aws bedrock list-foundation-models --query "modelSummaries[?starts_with(modelId, 'amazon.nova')].modelId"
```

## Monitoring & Troubleshooting

### CloudWatch Alarms

| Alarm | Trigger | Action |
|-------|---------|--------|
| `NovaSupport-High5xxErrorRate` | ≥10 5xx errors in 3 consecutive 1-min periods | Check Lambda logs for errors |
| `NovaSupport-HighApiLatency` | p50 latency ≥5s in 3 consecutive 1-min periods | Check Lambda cold starts, DynamoDB throttling |
| `NovaSupport-DLQMessages` | ≥1 message in DLQ | Inspect DLQ messages, check processing Lambda |
| `NovaSupport-LambdaErrors` | ≥5 CreateTicket errors in 2 consecutive 5-min periods | Check Lambda logs, validate input |

### Viewing Logs

```bash
# Tail application logs
aws logs tail /aws/novasupport --follow

# Search for errors
aws logs filter-log-events --log-group-name /aws/novasupport --filter-pattern "ERROR"
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 403 on API calls | Missing/invalid Cognito token | Authenticate via Cognito and pass JWT in Authorization header |
| Nova model errors | Bedrock access not enabled | Enable Amazon Nova models in the Bedrock console for your region |
| DLQ messages growing | Processing Lambda failures | Check Lambda logs, verify DynamoDB permissions |
| High latency | Lambda cold starts | Consider provisioned concurrency for critical functions |

### Cleanup

```bash
cdk destroy
```

## Test Results Summary

Full test suite: **923 tests passed** across **46 test suites** (0 failures).

Coverage includes:
- Unit tests for all services (routing, response, escalation, analytics, multimodal, voice)
- Property-based tests (40 properties) validating correctness across randomized inputs
- Integration tests for end-to-end workflows
- Performance tests for latency and throughput requirements
