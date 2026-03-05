/**
 * Notification Service for NovaSupport
 * Handles email notifications (via SNS), in-app notifications (via DynamoDB),
 * escalation alerts, follow-up messages, and notification management.
 *
 * Requirements: 4.4, 4.5, 11.3, 16.3, 16.5
 */

import { v4 as uuidv4 } from 'uuid';
import { EscalationDecision } from '../types/agent';
import { Alert } from '../types/analytics';
import { putItem, updateItem, queryItems, docClient, TABLE_NAME } from '../utils/dynamodb-client';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { formatDate } from '../utils/helpers';
import { createLogger } from '../utils/logger';

const logger = createLogger('NotificationService');

// ── SNS Configuration ────────────────────────────────────────────────────────

/** SNS topic ARNs – resolved from environment or defaults for local/test */
export const SNS_TOPICS = {
  escalation: process.env.SNS_ESCALATION_TOPIC_ARN || 'arn:aws:sns:us-east-1:000000000000:novasupport-escalations',
  alerts: process.env.SNS_ALERTS_TOPIC_ARN || 'arn:aws:sns:us-east-1:000000000000:novasupport-alerts',
  followUps: process.env.SNS_FOLLOWUPS_TOPIC_ARN || 'arn:aws:sns:us-east-1:000000000000:novasupport-followups',
};

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * In-app notification stored in DynamoDB
 */
export interface InAppNotification {
  notificationId: string;
  userId: string;
  type: 'escalation' | 'alert' | 'follow_up';
  title: string;
  message: string;
  ticketId?: string;
  read: boolean;
  createdAt: Date;
}

/**
 * Result of an SNS publish operation (mock or real).
 */
export interface EmailResult {
  messageId: string;
  topicArn: string;
  timestamp: string;
}

// ── SNS Publishing (mock for hackathon) ──────────────────────────────────────

/**
 * Publish a message to an SNS topic.
 * In production this calls the SNS SDK; for the hackathon we mock it.
 */
export async function publishToSNS(
  topicArn: string,
  subject: string,
  message: string,
): Promise<EmailResult> {
  logger.info('Publishing to SNS', { topicArn, subject });

  // Hackathon mock – log instead of calling SNS
  const result: EmailResult = {
    messageId: `msg-${uuidv4()}`,
    topicArn,
    timestamp: formatDate(new Date()),
  };

  logger.info('SNS message published (mock)', result);
  return result;
}

// ── Email Notification Functions (Task 24.1) ─────────────────────────────────

/**
 * Send a generic email notification via SNS.
 * Logs the email payload; in production this would publish to an SNS topic.
 */
export async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  logger.info('Sending email notification', { to, subject });

  try {
    await publishToSNS(SNS_TOPICS.escalation, subject, body);
    logger.info('Email sent', {
      to,
      subject,
      bodyLength: body.length,
      timestamp: formatDate(new Date()),
    });
  } catch (error) {
    logger.error('Failed to send email notification', error as Error, { to, subject });
    // Swallow – escalation should not fail because of email delivery
  }
}

/**
 * Send an escalation email notification.
 * Uses the escalation SNS topic and a structured email template.
 *
 * Requirement 4.5 – notify assigned human within 30 seconds of escalation.
 */
export async function sendEscalationEmail(
  ticketId: string,
  decision: EscalationDecision,
): Promise<EmailResult | null> {
  const assignee = decision.assignTo || 'senior-support';
  const subject = `[${decision.urgency.toUpperCase()}] Escalation: Ticket ${ticketId}`;
  const body = buildEscalationEmailBody(ticketId, decision);

  logger.info('Sending escalation email', { ticketId, assignee, urgency: decision.urgency });

  try {
    const result = await publishToSNS(SNS_TOPICS.escalation, subject, body);
    logger.info('Escalation email sent', { ticketId, assignee, messageId: result.messageId });
    return result;
  } catch (error) {
    logger.error('Failed to send escalation email', error as Error, { ticketId });
    return null;
  }
}

/**
 * Send an alert email notification.
 * Uses the alerts SNS topic with alert-specific template.
 *
 * Requirement 16.5 – send alerts via email within 5 minutes of detection.
 */
export async function sendAlertEmail(alert: Alert): Promise<EmailResult | null> {
  const subject = `[ALERT] ${alert.type.toUpperCase()}: ${alert.description.slice(0, 80)}`;
  const body = buildAlertEmailBody(alert);

  logger.info('Sending alert email', { alertId: alert.alertId, type: alert.type });

  try {
    const result = await publishToSNS(SNS_TOPICS.alerts, subject, body);
    logger.info('Alert email sent', { alertId: alert.alertId, messageId: result.messageId });
    return result;
  } catch (error) {
    logger.error('Failed to send alert email', error as Error, { alertId: alert.alertId });
    return null;
  }
}

/**
 * Send a follow-up email notification.
 * Uses the follow-ups SNS topic with personalized content.
 *
 * Requirement 11.3 – personalize messages based on ticket context.
 */
export async function sendFollowUpEmail(
  to: string,
  ticketId: string,
  message: string,
): Promise<EmailResult | null> {
  const subject = `Follow-up: Ticket ${ticketId}`;
  const body = buildFollowUpEmailBody(ticketId, message);

  logger.info('Sending follow-up email', { to, ticketId });

  try {
    const result = await publishToSNS(SNS_TOPICS.followUps, subject, body);
    logger.info('Follow-up email sent', { ticketId, messageId: result.messageId });
    return result;
  } catch (error) {
    logger.error('Failed to send follow-up email', error as Error, { ticketId });
    return null;
  }
}

// ── In-App Notification Functions (Task 24.2) ────────────────────────────────

/**
 * Create and store an in-app notification in DynamoDB.
 * PK: NOTIFICATION#<userId>, SK: <notificationId>
 *
 * This is the primary entry point for creating any type of in-app notification.
 */
export async function createInAppNotification(
  userId: string,
  type: 'escalation' | 'alert' | 'follow_up',
  title: string,
  message: string,
  ticketId?: string,
): Promise<InAppNotification> {
  const notification: InAppNotification = {
    notificationId: `NOTIF-${uuidv4()}`,
    userId,
    type,
    title,
    message,
    ticketId,
    read: false,
    createdAt: new Date(),
  };

  logger.info('Creating in-app notification', {
    notificationId: notification.notificationId,
    userId,
    type,
  });

  await putItem({
    PK: `NOTIFICATION#${userId}`,
    SK: notification.notificationId,
    notificationId: notification.notificationId,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    ticketId: notification.ticketId,
    read: notification.read,
    createdAt: formatDate(notification.createdAt),
  });

  return notification;
}

/**
 * Store an in-app notification in DynamoDB (lower-level, accepts pre-built notification).
 * PK: NOTIFICATION#<userId>, SK: <notificationId>
 */
export async function sendInAppNotification(
  userId: string,
  notification: InAppNotification,
): Promise<void> {
  logger.info('Storing in-app notification', {
    notificationId: notification.notificationId,
    userId,
    type: notification.type,
  });

  await putItem({
    PK: `NOTIFICATION#${userId}`,
    SK: notification.notificationId,
    notificationId: notification.notificationId,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    ticketId: notification.ticketId,
    read: notification.read,
    createdAt: formatDate(notification.createdAt),
  });
}

/**
 * Retrieve in-app notifications for a user.
 * Optionally filter by read/unread status.
 */
export async function getNotifications(
  userId: string,
  options?: { unreadOnly?: boolean },
): Promise<InAppNotification[]> {
  const items = await queryItems(
    'PK = :pk',
    { ':pk': `NOTIFICATION#${userId}` },
  );

  let notifications = items.map((item) => ({
    notificationId: item.notificationId as string,
    userId: item.userId as string,
    type: item.type as 'escalation' | 'alert' | 'follow_up',
    title: item.title as string,
    message: item.message as string,
    ticketId: item.ticketId as string | undefined,
    read: item.read as boolean,
    createdAt: new Date(item.createdAt as string),
  }));

  if (options?.unreadOnly) {
    notifications = notifications.filter((n) => !n.read);
  }

  // Sort most recent first
  notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return notifications;
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  await updateItem(
    `NOTIFICATION#${userId}`,
    notificationId,
    'SET #read = :read, readAt = :readAt',
    { ':read': true, ':readAt': formatDate(new Date()) },
    { '#read': 'read' },
  );
}

/**
 * Alias for markNotificationRead – matches the task spec naming.
 */
export async function markAsRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  return markNotificationRead(notificationId, userId);
}

/**
 * Mark multiple notifications as read in a batch.
 */
export async function markMultipleAsRead(
  notificationIds: string[],
  userId: string,
): Promise<void> {
  await Promise.all(
    notificationIds.map((id) => markNotificationRead(id, userId)),
  );
}

// ── Orchestration Functions ──────────────────────────────────────────────────

/**
 * Orchestrate sending both email and in-app notifications for an escalation.
 * Requirement 4.5 – notify assigned human within 30 seconds.
 */
export async function sendEscalationNotification(
  ticketId: string,
  decision: EscalationDecision,
): Promise<void> {
  logger.info('Sending escalation notification', {
    ticketId,
    urgency: decision.urgency,
    assignTo: decision.assignTo,
  });

  const assignee = decision.assignTo || 'senior-support';

  // Build in-app notification
  const inAppNotification: InAppNotification = {
    notificationId: `NOTIF-${uuidv4()}`,
    userId: assignee,
    type: 'escalation',
    title: `Escalation: Ticket ${ticketId}`,
    message: decision.summary,
    ticketId,
    read: false,
    createdAt: new Date(),
  };

  // Send both email and in-app in parallel – neither should block the other
  await Promise.all([
    sendEscalationEmail(ticketId, decision),
    sendInAppNotification(assignee, inAppNotification),
  ]);

  logger.info('Escalation notification sent', { ticketId, assignee });
}

/**
 * Send both email and in-app notifications for an alert.
 * Requirement 16.5 – send alerts via email and in-app within 5 minutes.
 */
export async function sendAlertNotification(
  alert: Alert,
  recipientUserIds: string[],
): Promise<void> {
  logger.info('Sending alert notification', {
    alertId: alert.alertId,
    type: alert.type,
    recipientCount: recipientUserIds.length,
  });

  // Send email alert
  const emailPromise = sendAlertEmail(alert);

  // Send in-app notifications to all recipients
  const inAppPromises = recipientUserIds.map((userId) =>
    createInAppNotification(
      userId,
      'alert',
      `Alert: ${alert.type}`,
      alert.description,
    ),
  );

  await Promise.all([emailPromise, ...inAppPromises]);

  logger.info('Alert notifications sent', { alertId: alert.alertId });
}

/**
 * Send both email and in-app notifications for a follow-up message.
 * Requirement 11.3 – personalize messages based on ticket context.
 */
export async function sendFollowUpNotification(
  userId: string,
  ticketId: string,
  message: string,
): Promise<void> {
  logger.info('Sending follow-up notification', { userId, ticketId });

  await Promise.all([
    sendFollowUpEmail(userId, ticketId, message),
    createInAppNotification(
      userId,
      'follow_up',
      `Follow-up: Ticket ${ticketId}`,
      message,
      ticketId,
    ),
  ]);

  logger.info('Follow-up notification sent', { userId, ticketId });
}

/**
 * Update ticket status to escalated and persist escalation metadata.
 */
export async function updateTicketStatusToEscalated(
  ticketId: string,
  decision: EscalationDecision,
): Promise<void> {
  logger.info('Updating ticket status to escalated', { ticketId });

  await updateItem(
    `TICKET#${ticketId}`,
    'METADATA',
    'SET #status = :status, escalationReason = :reason, escalationUrgency = :urgency, assignedTo = :assignTo, escalationSummary = :summary, attemptedSolutions = :solutions, updatedAt = :updatedAt',
    {
      ':status': 'escalated',
      ':reason': decision.reason,
      ':urgency': decision.urgency,
      ':assignTo': decision.assignTo || 'senior-support',
      ':summary': decision.summary,
      ':solutions': decision.attemptedSolutions,
      ':updatedAt': formatDate(new Date()),
    },
    { '#status': 'status' },
  );
}

// ── Email Template Helpers ───────────────────────────────────────────────────

function buildEscalationEmailBody(
  ticketId: string,
  decision: EscalationDecision,
): string {
  const lines: string[] = [];
  lines.push(`Ticket ${ticketId} has been escalated and requires your attention.`);
  lines.push('');
  lines.push(`Urgency: ${decision.urgency.toUpperCase()}`);
  lines.push(`Reason: ${decision.reason}`);
  lines.push('');
  lines.push('Summary:');
  lines.push(decision.summary);
  lines.push('');
  if (decision.attemptedSolutions.length > 0) {
    lines.push('Attempted Solutions:');
    for (const solution of decision.attemptedSolutions) {
      lines.push(`  - ${solution}`);
    }
  }
  return lines.join('\n');
}

function buildAlertEmailBody(alert: Alert): string {
  const lines: string[] = [];
  lines.push(`Alert: ${alert.type.toUpperCase()}`);
  lines.push('');
  lines.push(`Description: ${alert.description}`);
  lines.push(`Affected Users: ${alert.affectedUsers}`);
  lines.push(`Detected At: ${formatDate(alert.createdAt)}`);
  lines.push('');
  if (alert.recommendedActions.length > 0) {
    lines.push('Recommended Actions:');
    for (const action of alert.recommendedActions) {
      lines.push(`  - ${action}`);
    }
  }
  return lines.join('\n');
}

function buildFollowUpEmailBody(ticketId: string, message: string): string {
  const lines: string[] = [];
  lines.push(`Follow-up regarding Ticket ${ticketId}:`);
  lines.push('');
  lines.push(message);
  lines.push('');
  lines.push('Please reply to this email or update your ticket directly.');
  return lines.join('\n');
}


// ── WebSocket Broadcast (Task 9.2) ───────────────────────────────────────────

/**
 * Broadcast a message to all active WebSocket connections for a given user.
 * Queries GSI1 for connections with GSI1PK `USER#<userId>` and GSI1SK begins_with `WSCONN#`.
 * Sends the message via API Gateway Management API. Stale connections (410 Gone) are cleaned up.
 *
 * The entire function is wrapped in try/catch so broadcast failures never block the caller.
 *
 * Requirements: 6.4, 6.5
 */
export async function broadcastToUser(userId: string, message: Record<string, any>): Promise<void> {
  try {
    const endpoint = process.env.WEBSOCKET_API_ENDPOINT;
    if (!endpoint) {
      logger.warn('WEBSOCKET_API_ENDPOINT not configured, skipping broadcast', { userId });
      return;
    }

    // Query all WebSocket connections for this user via GSI1
    const connections = await queryItems(
      'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      { ':pk': `USER#${userId}`, ':skPrefix': 'WSCONN#' },
      'GSI1',
    );

    if (connections.length === 0) {
      logger.info('No active WebSocket connections for user', { userId });
      return;
    }

    const apiClient = new ApiGatewayManagementApiClient({ endpoint });
    const payload = JSON.stringify(message);

    const sendPromises = connections.map(async (conn) => {
      const connectionId = conn.connectionId as string;
      try {
        await apiClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: new TextEncoder().encode(payload),
          }),
        );
        logger.info('WebSocket message sent', { connectionId, userId });
      } catch (err: any) {
        if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
          // Stale connection – clean up the record
          logger.info('Stale WebSocket connection, deleting', { connectionId, userId });
          try {
            await docClient.send(
              new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: `WSCONN#${connectionId}`, SK: 'METADATA' },
              }),
            );
          } catch (deleteErr) {
            logger.error('Failed to delete stale connection', deleteErr instanceof Error ? deleteErr : undefined, { connectionId });
          }
        } else {
          logger.error('Failed to send WebSocket message', err instanceof Error ? err : undefined, { connectionId, userId });
        }
      }
    });

    await Promise.all(sendPromises);
    logger.info('Broadcast complete', { userId, connectionCount: connections.length });
  } catch (error) {
    logger.error('broadcastToUser failed', error instanceof Error ? error : undefined, { userId });
    // Swallow – broadcast failures must never block the caller
  }
}
