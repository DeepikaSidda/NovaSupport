#!/usr/bin/env bash
# =============================================================================
# NovaSupport Monitoring Setup Script
# =============================================================================
# Configures SNS alarm notifications, CloudWatch Logs metric filters, and
# custom alarms for ongoing monitoring of the deployed NovaSupport stack.
#
# Usage:
#   ./scripts/setup-monitoring.sh <NOTIFICATION_EMAIL> [REGION] [STACK_NAME]
#
# Example:
#   ./scripts/setup-monitoring.sh ops-team@example.com us-east-1 NovaSupportStack
#
# What this script does:
#   1. Creates an SNS topic for alarm notifications
#   2. Subscribes the provided email to the topic
#   3. Wires existing CloudWatch alarms to send to the SNS topic
#   4. Creates a CloudWatch Logs metric filter for ERROR patterns
#   5. Creates a custom alarm on the error-rate metric
#
# Prerequisites:
#   - AWS CLI v2 configured with valid credentials
#   - The NovaSupport CDK stack already deployed
# =============================================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- Helpers ---
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error()   { echo -e "${RED}[ERR]${NC}   $1"; }

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: $0 <NOTIFICATION_EMAIL> [REGION] [STACK_NAME]"
  echo ""
  echo "  NOTIFICATION_EMAIL  Email address for alarm notifications"
  echo "  REGION              AWS region (default: us-east-1)"
  echo "  STACK_NAME          CloudFormation stack name (default: NovaSupportStack)"
  exit 1
fi

EMAIL="$1"
REGION="${2:-us-east-1}"
STACK_NAME="${3:-NovaSupportStack}"
SNS_TOPIC_NAME="novasupport-alarms"
LOG_GROUP="/aws/novasupport"
METRIC_NAMESPACE="NovaSupport/Custom"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  NovaSupport Monitoring Setup${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Email      : ${EMAIL}"
echo -e "  Region     : ${REGION}"
echo -e "  Stack      : ${STACK_NAME}"
echo ""

# =============================================================================
# Step 1: Create SNS Topic for Alarm Notifications
# =============================================================================
info "Creating SNS topic '${SNS_TOPIC_NAME}'..."

TOPIC_ARN=$(aws sns create-topic \
  --name "$SNS_TOPIC_NAME" \
  --region "$REGION" \
  --tags "Key=Project,Value=NovaSupport" "Key=Purpose,Value=AlarmNotifications" \
  --query "TopicArn" \
  --output text 2>/dev/null)

if [ -z "$TOPIC_ARN" ]; then
  error "Failed to create SNS topic"
  exit 1
fi
success "SNS topic created: ${TOPIC_ARN}"

# =============================================================================
# Step 2: Subscribe Email to SNS Topic
# =============================================================================
info "Subscribing '${EMAIL}' to alarm notifications..."

SUB_ARN=$(aws sns subscribe \
  --topic-arn "$TOPIC_ARN" \
  --protocol email \
  --notification-endpoint "$EMAIL" \
  --region "$REGION" \
  --query "SubscriptionArn" \
  --output text 2>/dev/null)

if [ "$SUB_ARN" = "pending confirmation" ] || [ -n "$SUB_ARN" ]; then
  success "Subscription created (status: ${SUB_ARN})"
  warn "Check your email and confirm the subscription to start receiving alerts"
else
  error "Failed to subscribe email"
fi

# =============================================================================
# Step 3: Configure Existing CloudWatch Alarms to Notify via SNS
# =============================================================================
info "Wiring existing CloudWatch alarms to SNS topic..."

# List of alarms created by the CDK stack
ALARM_NAMES=(
  "NovaSupport-High5xxErrorRate"
  "NovaSupport-HighApiLatency"
  "NovaSupport-DLQMessages"
  "NovaSupport-LambdaErrors"
)

for ALARM_NAME in "${ALARM_NAMES[@]}"; do
  # Check if alarm exists
  EXISTS=$(aws cloudwatch describe-alarms \
    --alarm-names "$ALARM_NAME" \
    --region "$REGION" \
    --query "length(MetricAlarms)" \
    --output text 2>/dev/null || echo "0")

  if [ "$EXISTS" = "0" ]; then
    warn "Alarm '${ALARM_NAME}' not found — skipping"
    continue
  fi

  # Add SNS action to the alarm (set-alarm-state won't work; we use put-metric-alarm
  # to update the alarm actions). We need to read the existing config first.
  ALARM_JSON=$(aws cloudwatch describe-alarms \
    --alarm-names "$ALARM_NAME" \
    --region "$REGION" \
    --query "MetricAlarms[0]" \
    --output json 2>/dev/null)

  # Extract existing alarm properties
  METRIC_NAME=$(echo "$ALARM_JSON" | jq -r '.MetricName')
  NAMESPACE=$(echo "$ALARM_JSON" | jq -r '.Namespace')
  STATISTIC=$(echo "$ALARM_JSON" | jq -r '.Statistic // "Sum"')
  PERIOD=$(echo "$ALARM_JSON" | jq -r '.Period')
  THRESHOLD=$(echo "$ALARM_JSON" | jq -r '.Threshold')
  EVAL_PERIODS=$(echo "$ALARM_JSON" | jq -r '.EvaluationPeriods')
  COMPARISON=$(echo "$ALARM_JSON" | jq -r '.ComparisonOperator')
  DESCRIPTION=$(echo "$ALARM_JSON" | jq -r '.AlarmDescription // ""')
  TREAT_MISSING=$(echo "$ALARM_JSON" | jq -r '.TreatMissingData // "missing"')

  # Build dimensions argument
  DIMENSIONS=$(echo "$ALARM_JSON" | jq -c '[.Dimensions[]? | {Name: .Name, Value: .Value}]' 2>/dev/null || echo "[]")

  # Update alarm with SNS alarm action
  aws cloudwatch put-metric-alarm \
    --alarm-name "$ALARM_NAME" \
    --alarm-description "$DESCRIPTION" \
    --metric-name "$METRIC_NAME" \
    --namespace "$NAMESPACE" \
    --statistic "$STATISTIC" \
    --period "$PERIOD" \
    --threshold "$THRESHOLD" \
    --evaluation-periods "$EVAL_PERIODS" \
    --comparison-operator "$COMPARISON" \
    --treat-missing-data "$TREAT_MISSING" \
    --alarm-actions "$TOPIC_ARN" \
    --ok-actions "$TOPIC_ARN" \
    --dimensions "$(echo "$DIMENSIONS" | jq -c '.')" \
    --region "$REGION" 2>/dev/null && \
    success "Alarm '${ALARM_NAME}' → SNS notifications enabled" || \
    warn "Could not update alarm '${ALARM_NAME}' (may need different metric config)"
done


# =============================================================================
# Step 4: Create CloudWatch Logs Metric Filter for ERROR Patterns
# =============================================================================
info "Creating CloudWatch Logs metric filter for ERROR patterns..."

# Check if the log group exists
LOG_EXISTS=$(aws logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" \
  --region "$REGION" \
  --query "logGroups[?logGroupName=='${LOG_GROUP}'].logGroupName" \
  --output text 2>/dev/null || echo "")

if [ -z "$LOG_EXISTS" ]; then
  warn "Log group '${LOG_GROUP}' not found — skipping metric filter"
else
  FILTER_NAME="NovaSupport-ErrorCount"

  aws logs put-metric-filter \
    --log-group-name "$LOG_GROUP" \
    --filter-name "$FILTER_NAME" \
    --filter-pattern "ERROR" \
    --metric-transformations \
      metricName="ErrorCount",metricNamespace="${METRIC_NAMESPACE}",metricValue="1",defaultValue="0" \
    --region "$REGION" 2>/dev/null && \
    success "Metric filter '${FILTER_NAME}' created on '${LOG_GROUP}'" || \
    error "Failed to create metric filter"

  # Also create a filter for WARN patterns
  WARN_FILTER_NAME="NovaSupport-WarnCount"

  aws logs put-metric-filter \
    --log-group-name "$LOG_GROUP" \
    --filter-name "$WARN_FILTER_NAME" \
    --filter-pattern "WARN" \
    --metric-transformations \
      metricName="WarnCount",metricNamespace="${METRIC_NAMESPACE}",metricValue="1",defaultValue="0" \
    --region "$REGION" 2>/dev/null && \
    success "Metric filter '${WARN_FILTER_NAME}' created on '${LOG_GROUP}'" || \
    warn "Failed to create WARN metric filter"
fi

# =============================================================================
# Step 5: Create Custom Alarm for Error Rate
# =============================================================================
info "Creating custom alarm for application error rate..."

ERROR_ALARM_NAME="NovaSupport-AppErrorRate"

aws cloudwatch put-metric-alarm \
  --alarm-name "$ERROR_ALARM_NAME" \
  --alarm-description "Application ERROR log entries exceed threshold (>10 errors in 5 min)" \
  --metric-name "ErrorCount" \
  --namespace "$METRIC_NAMESPACE" \
  --statistic "Sum" \
  --period 300 \
  --threshold 10 \
  --evaluation-periods 2 \
  --comparison-operator "GreaterThanOrEqualToThreshold" \
  --treat-missing-data "notBreaching" \
  --alarm-actions "$TOPIC_ARN" \
  --ok-actions "$TOPIC_ARN" \
  --region "$REGION" 2>/dev/null && \
  success "Alarm '${ERROR_ALARM_NAME}' created (threshold: ≥10 errors in 5 min)" || \
  error "Failed to create error rate alarm"

# Create a high-warn-rate alarm as well
WARN_ALARM_NAME="NovaSupport-HighWarnRate"

aws cloudwatch put-metric-alarm \
  --alarm-name "$WARN_ALARM_NAME" \
  --alarm-description "Application WARN log entries exceed threshold (>50 warnings in 5 min)" \
  --metric-name "WarnCount" \
  --namespace "$METRIC_NAMESPACE" \
  --statistic "Sum" \
  --period 300 \
  --threshold 50 \
  --evaluation-periods 2 \
  --comparison-operator "GreaterThanOrEqualToThreshold" \
  --treat-missing-data "notBreaching" \
  --alarm-actions "$TOPIC_ARN" \
  --region "$REGION" 2>/dev/null && \
  success "Alarm '${WARN_ALARM_NAME}' created (threshold: ≥50 warnings in 5 min)" || \
  warn "Failed to create warn rate alarm"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Setup Complete${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  SNS Topic ARN : ${TOPIC_ARN}"
echo -e "  Alarms wired  : ${#ALARM_NAMES[@]} existing + 2 custom"
echo -e "  Metric filters: ErrorCount, WarnCount"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Confirm the SNS subscription in your email inbox"
echo -e "  2. Verify alarms in the CloudWatch console:"
echo -e "     https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#alarmsV2:"
echo -e "  3. View the NovaSupport dashboard:"
echo -e "     https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:name=NovaSupport-Metrics"
echo ""
success "Monitoring setup complete!"
