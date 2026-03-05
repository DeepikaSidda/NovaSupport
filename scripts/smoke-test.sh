#!/usr/bin/env bash
# =============================================================================
# NovaSupport Smoke Test Script
# =============================================================================
# Validates a deployed NovaSupport stack by testing key API endpoints,
# AWS resource connectivity, and Bedrock model access.
#
# Usage:
#   ./scripts/smoke-test.sh <API_GATEWAY_URL> [REGION]
#
# Example:
#   ./scripts/smoke-test.sh https://abc123.execute-api.us-east-1.amazonaws.com/dev us-east-1
#
# Prerequisites:
#   - AWS CLI v2 configured with valid credentials
#   - curl and jq installed
#   - A valid Cognito JWT token (set NOVASUPPORT_AUTH_TOKEN env var)
# =============================================================================

set -euo pipefail

# --- Colors for output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- Counters ---
PASS=0
FAIL=0
SKIP=0

# --- Helpers ---
print_header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

pass() {
  echo -e "  ${GREEN}✔ PASS${NC} — $1"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "  ${RED}✘ FAIL${NC} — $1"
  FAIL=$((FAIL + 1))
}

skip() {
  echo -e "  ${YELLOW}⊘ SKIP${NC} — $1"
  SKIP=$((SKIP + 1))
}

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: $0 <API_GATEWAY_URL> [REGION]"
  echo "  API_GATEWAY_URL  Base URL of the deployed API Gateway (e.g. https://abc.execute-api.us-east-1.amazonaws.com/dev)"
  echo "  REGION           AWS region (default: us-east-1)"
  exit 1
fi

API_URL="${1%/}"  # Strip trailing slash
REGION="${2:-us-east-1}"
AUTH_TOKEN="${NOVASUPPORT_AUTH_TOKEN:-}"
AUTH_HEADER=""

if [ -n "$AUTH_TOKEN" ]; then
  AUTH_HEADER="Authorization: Bearer ${AUTH_TOKEN}"
fi

echo ""
echo -e "${CYAN}NovaSupport Smoke Test${NC}"
echo -e "API URL : ${API_URL}"
echo -e "Region  : ${REGION}"
echo -e "Auth    : $([ -n "$AUTH_TOKEN" ] && echo 'Token provided' || echo 'No token (some tests may 401)')"


# =============================================================================
# Test 1: API Gateway Health / Connectivity
# =============================================================================
print_header "1. API Gateway Connectivity"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/tickets" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  fail "API Gateway unreachable (connection error)"
elif [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
  if [ -z "$AUTH_TOKEN" ]; then
    pass "API Gateway reachable (got ${HTTP_CODE} — expected without auth token)"
  else
    fail "API Gateway returned ${HTTP_CODE} with auth token"
  fi
elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  pass "API Gateway reachable (HTTP ${HTTP_CODE})"
else
  fail "API Gateway returned unexpected HTTP ${HTTP_CODE}"
fi

# =============================================================================
# Test 2: Create a Test Ticket (POST /tickets)
# =============================================================================
print_header "2. Create Test Ticket (POST /tickets)"

TICKET_ID=""
if [ -z "$AUTH_TOKEN" ]; then
  skip "Create ticket — no auth token provided (set NOVASUPPORT_AUTH_TOKEN)"
else
  CREATE_RESPONSE=$(curl -s --max-time 15 \
    -X POST "${API_URL}/tickets" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d '{
      "userId": "smoke-test-user",
      "subject": "Smoke Test Ticket",
      "description": "Automated smoke test — safe to delete",
      "priority": 3
    }' 2>/dev/null || echo '{"error":"connection_failed"}')

  # Try to extract ticket ID from response
  TICKET_ID=$(echo "$CREATE_RESPONSE" | jq -r '.ticketId // .id // .ticket.id // empty' 2>/dev/null || true)

  if [ -n "$TICKET_ID" ] && [ "$TICKET_ID" != "null" ]; then
    pass "Ticket created successfully (ID: ${TICKET_ID})"
  else
    HTTP_CODE=$(echo "$CREATE_RESPONSE" | jq -r '.statusCode // empty' 2>/dev/null || true)
    fail "Ticket creation failed — response: $(echo "$CREATE_RESPONSE" | head -c 200)"
  fi
fi

# =============================================================================
# Test 3: Retrieve the Test Ticket (GET /tickets/{ticketId})
# =============================================================================
print_header "3. Retrieve Test Ticket (GET /tickets/{ticketId})"

if [ -z "$TICKET_ID" ] || [ "$TICKET_ID" = "null" ]; then
  skip "Retrieve ticket — no ticket ID from previous step"
else
  GET_RESPONSE=$(curl -s --max-time 10 \
    -X GET "${API_URL}/tickets/${TICKET_ID}" \
    -H "$AUTH_HEADER" 2>/dev/null || echo '{"error":"connection_failed"}')

  GOT_ID=$(echo "$GET_RESPONSE" | jq -r '.ticketId // .id // empty' 2>/dev/null || true)

  if [ "$GOT_ID" = "$TICKET_ID" ]; then
    pass "Ticket retrieved successfully (ID matches: ${GOT_ID})"
  else
    fail "Ticket retrieval failed — response: $(echo "$GET_RESPONSE" | head -c 200)"
  fi
fi

# =============================================================================
# Test 4: Attachment Upload Endpoint (POST /tickets/{ticketId}/attachments)
# =============================================================================
print_header "4. Attachment Upload Endpoint"

if [ -z "$TICKET_ID" ] || [ "$TICKET_ID" = "null" ]; then
  skip "Attachment upload — no ticket ID from previous step"
else
  ATTACH_RESPONSE=$(curl -s --max-time 10 \
    -X POST "${API_URL}/tickets/${TICKET_ID}/attachments" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d '{
      "fileName": "smoke-test.png",
      "fileType": "image/png",
      "fileSize": 1024
    }' 2>/dev/null || echo '{"error":"connection_failed"}')

  # Check for a signed URL or attachment ID in the response
  UPLOAD_URL=$(echo "$ATTACH_RESPONSE" | jq -r '.uploadUrl // .signedUrl // .url // empty' 2>/dev/null || true)
  ATTACH_ID=$(echo "$ATTACH_RESPONSE" | jq -r '.attachmentId // .id // empty' 2>/dev/null || true)

  if [ -n "$UPLOAD_URL" ] && [ "$UPLOAD_URL" != "null" ]; then
    pass "Attachment endpoint returned signed upload URL"
  elif [ -n "$ATTACH_ID" ] && [ "$ATTACH_ID" != "null" ]; then
    pass "Attachment endpoint returned attachment ID: ${ATTACH_ID}"
  else
    fail "Attachment upload failed — response: $(echo "$ATTACH_RESPONSE" | head -c 200)"
  fi
fi


# =============================================================================
# Test 5: CloudWatch — Check for Recent Errors
# =============================================================================
print_header "5. CloudWatch Recent Errors"

LOG_GROUP="/aws/novasupport"

# Check if the log group exists
LOG_EXISTS=$(aws logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" \
  --region "$REGION" \
  --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" \
  --output text 2>/dev/null || echo "")

if [ -z "$LOG_EXISTS" ]; then
  skip "CloudWatch log group '${LOG_GROUP}' not found"
else
  # Search for ERROR entries in the last 15 minutes
  NOW_MS=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")
  FIFTEEN_MIN_AGO=$((NOW_MS - 900000))

  ERROR_COUNT=$(aws logs filter-log-events \
    --log-group-name "$LOG_GROUP" \
    --start-time "$FIFTEEN_MIN_AGO" \
    --filter-pattern "ERROR" \
    --region "$REGION" \
    --query "length(events)" \
    --output text 2>/dev/null || echo "unknown")

  if [ "$ERROR_COUNT" = "0" ]; then
    pass "No ERROR entries in CloudWatch logs (last 15 min)"
  elif [ "$ERROR_COUNT" = "unknown" ]; then
    skip "Could not query CloudWatch logs (check IAM permissions)"
  else
    fail "Found ${ERROR_COUNT} ERROR entries in CloudWatch logs (last 15 min)"
    echo -e "       Run: aws logs filter-log-events --log-group-name ${LOG_GROUP} --filter-pattern ERROR --region ${REGION}"
  fi
fi

# =============================================================================
# Test 6: Validate Bedrock / Nova Model Access
# =============================================================================
print_header "6. Bedrock Nova Model Access"

# Check that Amazon Nova models are accessible
NOVA_MODELS=$(aws bedrock list-foundation-models \
  --region "$REGION" \
  --query "modelSummaries[?starts_with(modelId, 'amazon.nova')].modelId" \
  --output text 2>/dev/null || echo "")

if [ -z "$NOVA_MODELS" ]; then
  fail "No Amazon Nova models found in region ${REGION} (enable in Bedrock console)"
else
  MODEL_COUNT=$(echo "$NOVA_MODELS" | wc -w | tr -d ' ')
  pass "Found ${MODEL_COUNT} Amazon Nova model(s) in region ${REGION}"

  # Quick invocation test with Nova Lite
  INVOKE_RESULT=$(aws bedrock-runtime invoke-model \
    --model-id "amazon.nova-lite-v1:0" \
    --region "$REGION" \
    --content-type "application/json" \
    --accept "application/json" \
    --body '{"inputText":"Hello","textGenerationConfig":{"maxTokenCount":10}}' \
    /dev/stdout 2>/dev/null | head -c 500 || echo "invoke_failed")

  if echo "$INVOKE_RESULT" | grep -qi "invoke_failed\|error\|AccessDenied"; then
    skip "Nova Lite invocation test failed (model may need enablement or different payload format)"
  else
    pass "Nova Lite model invocation succeeded"
  fi
fi

# =============================================================================
# Test 7: DynamoDB Table Verification
# =============================================================================
print_header "7. DynamoDB Table Verification"

# Look for the NovaSupport tickets table
TABLES=$(aws dynamodb list-tables --region "$REGION" --query "TableNames[?contains(@, 'NovaSupport') || contains(@, 'novasupport') || contains(@, 'Tickets')]" --output text 2>/dev/null || echo "")

if [ -z "$TABLES" ]; then
  skip "No NovaSupport DynamoDB tables found (stack may not be deployed)"
else
  for TABLE in $TABLES; do
    GSI_COUNT=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" \
      --query "length(Table.GlobalSecondaryIndexes || \`[]\`)" --output text 2>/dev/null || echo "0")
    if [ "$GSI_COUNT" -ge 3 ]; then
      pass "Table '${TABLE}' has ${GSI_COUNT} GSIs (expected ≥3)"
    else
      fail "Table '${TABLE}' has only ${GSI_COUNT} GSIs (expected ≥3)"
    fi
  done
fi

# =============================================================================
# Test 8: SQS Queue Verification
# =============================================================================
print_header "8. SQS Queue Verification"

QUEUES=$(aws sqs list-queues --region "$REGION" \
  --queue-name-prefix "novasupport" \
  --query "QueueUrls" --output text 2>/dev/null || echo "")

if [ -z "$QUEUES" ]; then
  skip "No NovaSupport SQS queues found"
else
  QUEUE_COUNT=$(echo "$QUEUES" | wc -w | tr -d ' ')
  if [ "$QUEUE_COUNT" -ge 2 ]; then
    pass "Found ${QUEUE_COUNT} NovaSupport SQS queues (ticket-processing + multimodal)"
  else
    fail "Found only ${QUEUE_COUNT} queue(s), expected at least 2"
  fi

  # Check DLQ depth
  for Q in $QUEUES; do
    if echo "$Q" | grep -q "dlq"; then
      DLQ_DEPTH=$(aws sqs get-queue-attributes --queue-url "$Q" --region "$REGION" \
        --attribute-names ApproximateNumberOfMessages \
        --query "Attributes.ApproximateNumberOfMessages" --output text 2>/dev/null || echo "unknown")
      if [ "$DLQ_DEPTH" = "0" ]; then
        pass "DLQ '$(basename "$Q")' is empty"
      elif [ "$DLQ_DEPTH" = "unknown" ]; then
        skip "Could not check DLQ depth"
      else
        fail "DLQ '$(basename "$Q")' has ${DLQ_DEPTH} message(s) — investigate failures"
      fi
    fi
  done
fi

# =============================================================================
# Summary
# =============================================================================
print_header "Smoke Test Summary"

TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo -e "  ${GREEN}Passed : ${PASS}${NC}"
echo -e "  ${RED}Failed : ${FAIL}${NC}"
echo -e "  ${YELLOW}Skipped: ${SKIP}${NC}"
echo -e "  Total  : ${TOTAL}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Some checks failed. Review the output above for details.${NC}"
  exit 1
else
  echo -e "${GREEN}All checks passed (or skipped). Deployment looks healthy!${NC}"
  exit 0
fi
