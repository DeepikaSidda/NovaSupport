/**
 * Process Follow-Ups Lambda Handler
 *
 * Scheduled handler (EventBridge, every 15 minutes) that scans for due
 * follow-up records and sends notifications.
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import { ScheduledEvent } from 'aws-lambda';
import { scanItems, updateItem } from '../utils/dynamodb-client';
import { sendFollowUpNotification } from '../services/notification-service';
import { FollowUpRecord, FollowUpStatus, FollowUpType } from '../services/follow-up-scheduler';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';

const logger = createLogger('ProcessFollowUps');

export interface ProcessFollowUpsResult {
  processed: number;
  failed: number;
  errors: Array<{ ticketId: string; error: string }>;
}

/**
 * Build the DynamoDB sort key for a follow-up record.
 */
function followUpSK(type: FollowUpType, scheduledAt: string): string {
  return `${type}#${scheduledAt}`;
}

/**
 * Scan DynamoDB for all follow-up records with status "pending" and
 * scheduledAt <= now, send notifications, and update status to "sent".
 *
 * Requirement 4.1 – query pending records with scheduledAt in the past
 * Requirement 4.2 – send via notification service and mark "sent"
 * Requirement 4.3 – on failure, log error and leave as "pending" for retry
 */
export async function handler(
  _event: ScheduledEvent | Record<string, unknown>,
): Promise<ProcessFollowUpsResult> {
  const now = new Date().toISOString();
  logger.info('Processing follow-ups', { now });

  const result: ProcessFollowUpsResult = {
    processed: 0,
    failed: 0,
    errors: [],
  };

  // Requirement 4.1: scan for pending follow-ups with scheduledAt <= now
  // Scan all FOLLOWUP# records and filter in application code because
  // scanItems does not support ExpressionAttributeNames (needed for the
  // reserved word "status").
  let items: Record<string, unknown>[];
  try {
    const allFollowUps = await scanItems(
      'begins_with(PK, :prefix)',
      { ':prefix': 'FOLLOWUP#' },
    );
    items = allFollowUps.filter(
      (item) =>
        item.status === FollowUpStatus.PENDING &&
        (item.scheduledAt as string) <= now,
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Failed to scan for pending follow-ups', error);
    return result;
  }

  logger.info('Found due follow-ups', { count: items.length });

  for (const item of items) {
    const record: FollowUpRecord = {
      ticketId: item.ticketId as string,
      type: item.type as FollowUpType,
      status: item.status as FollowUpStatus,
      scheduledAt: item.scheduledAt as string,
      message: item.message as string,
      createdAt: item.createdAt as string,
    };

    try {
      // Requirement 4.2: send notification and update status to "sent"
      await sendFollowUpNotification(
        record.ticketId, // userId — use ticketId as recipient identifier
        record.ticketId,
        record.message,
      );

      await updateItem(
        `FOLLOWUP#${record.ticketId}`,
        followUpSK(record.type, record.scheduledAt),
        'SET #status = :status, sentAt = :sentAt',
        {
          ':status': FollowUpStatus.SENT,
          ':sentAt': formatDate(new Date()),
        },
        { '#status': 'status' },
      );

      result.processed += 1;
      logger.info('Follow-up processed', {
        ticketId: record.ticketId,
        type: record.type,
      });
    } catch (err) {
      // Requirement 4.3: log error, leave as "pending" for retry
      const error = err instanceof Error ? err : new Error(String(err));
      result.failed += 1;
      result.errors.push({
        ticketId: record.ticketId,
        error: error.message,
      });
      logger.error('Failed to process follow-up', error, {
        ticketId: record.ticketId,
        type: record.type,
      });
    }
  }

  logger.info('Follow-up processing complete', {
    processed: result.processed,
    failed: result.failed,
  });

  return result;
}
