/**
 * Follow-Up Scheduling Service for NovaSupport
 * Schedules follow-up messages and satisfaction surveys, personalizes content
 * with ticket context, and cancels pending follow-ups when users respond.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import { putItem, queryItems, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { Ticket } from '../types/ticket';

const logger = createLogger('FollowUpScheduler');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default follow-up delay: 48 hours in milliseconds */
export const DEFAULT_FOLLOWUP_DELAY_MS = 48 * 60 * 60 * 1000;

/** Default survey delay: 24 hours in milliseconds */
export const DEFAULT_SURVEY_DELAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum FollowUpType {
  FOLLOW_UP = 'FOLLOW_UP',
  SATISFACTION_SURVEY = 'SATISFACTION_SURVEY',
}

export enum FollowUpStatus {
  PENDING = 'pending',
  SENT = 'sent',
  CANCELLED = 'cancelled',
}

export interface FollowUpRecord {
  ticketId: string;
  type: FollowUpType;
  status: FollowUpStatus;
  scheduledAt: string; // ISO 8601
  message: string;
  createdAt: string;   // ISO 8601
  cancelledAt?: string; // ISO 8601
}

export interface ScheduleOptions {
  /** Override the default delay in milliseconds */
  delayMs?: number;
  /** Override the generated message content */
  customMessage?: string;
}

// ---------------------------------------------------------------------------
// DynamoDB key helpers
// ---------------------------------------------------------------------------

function followUpPK(ticketId: string): string {
  return `FOLLOWUP#${ticketId}`;
}

function followUpSK(type: FollowUpType, scheduledAt: string): string {
  return `${type}#${scheduledAt}`;
}

// ---------------------------------------------------------------------------
// Message generation (Requirement 11.3 – personalization)
// ---------------------------------------------------------------------------

/**
 * Generate a personalized follow-up message that includes ticket-specific
 * information such as ticket ID, subject, and description excerpt.
 *
 * Requirement 11.3: Personalize messages based on ticket context
 */
export function generateFollowUpMessage(ticket: Ticket): string {
  const descriptionExcerpt = ticket.description.length > 120
    ? ticket.description.slice(0, 120) + '...'
    : ticket.description;

  return (
    `Hi there, we noticed your support ticket #${ticket.id} ("${ticket.subject}") ` +
    `is still awaiting your response. ` +
    `For reference, your original issue was: "${descriptionExcerpt}" ` +
    `Please let us know if you need further assistance or if the issue has been resolved.`
  );
}

/**
 * Generate a personalized satisfaction survey message that includes
 * ticket-specific information.
 *
 * Requirement 11.3: Personalize messages based on ticket context
 */
export function generateSurveyMessage(ticket: Ticket): string {
  return (
    `Your support ticket #${ticket.id} ("${ticket.subject}") has been resolved. ` +
    `We'd love to hear about your experience. ` +
    `Please take a moment to rate your satisfaction with the resolution of your issue.`
  );
}

// ---------------------------------------------------------------------------
// Scheduling (Requirements 11.1, 11.2, 11.5)
// ---------------------------------------------------------------------------

/**
 * Schedule a follow-up message 48 hours (default) after a ticket enters
 * "pending user response" status.
 *
 * Requirement 11.1: Schedule follow-up after 48 hours
 * Requirement 11.5: Allow agent customization of timing and content
 */
export async function scheduleFollowUp(
  ticket: Ticket,
  options: ScheduleOptions = {},
): Promise<FollowUpRecord> {
  const delayMs = options.delayMs ?? DEFAULT_FOLLOWUP_DELAY_MS;
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();
  const message = options.customMessage ?? generateFollowUpMessage(ticket);
  const now = new Date().toISOString();

  const record: FollowUpRecord = {
    ticketId: ticket.id,
    type: FollowUpType.FOLLOW_UP,
    status: FollowUpStatus.PENDING,
    scheduledAt,
    message,
    createdAt: now,
  };

  logger.info('Scheduling follow-up', { ticketId: ticket.id, scheduledAt });

  await putItem({
    PK: followUpPK(ticket.id),
    SK: followUpSK(FollowUpType.FOLLOW_UP, scheduledAt),
    ...record,
  });

  logger.info('Follow-up scheduled', { ticketId: ticket.id, scheduledAt });

  return record;
}

/**
 * Schedule a satisfaction survey 24 hours (default) after ticket resolution.
 *
 * Requirement 11.2: Send satisfaction survey after 24 hours
 * Requirement 11.5: Allow agent customization of timing and content
 */
export async function scheduleSatisfactionSurvey(
  ticket: Ticket,
  options: ScheduleOptions = {},
): Promise<FollowUpRecord> {
  const delayMs = options.delayMs ?? DEFAULT_SURVEY_DELAY_MS;
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();
  const message = options.customMessage ?? generateSurveyMessage(ticket);
  const now = new Date().toISOString();

  const record: FollowUpRecord = {
    ticketId: ticket.id,
    type: FollowUpType.SATISFACTION_SURVEY,
    status: FollowUpStatus.PENDING,
    scheduledAt,
    message,
    createdAt: now,
  };

  logger.info('Scheduling satisfaction survey', { ticketId: ticket.id, scheduledAt });

  await putItem({
    PK: followUpPK(ticket.id),
    SK: followUpSK(FollowUpType.SATISFACTION_SURVEY, scheduledAt),
    ...record,
  });

  logger.info('Satisfaction survey scheduled', { ticketId: ticket.id, scheduledAt });

  return record;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/**
 * Get all pending follow-ups for a ticket.
 */
export async function getPendingFollowUps(ticketId: string): Promise<FollowUpRecord[]> {
  logger.info('Fetching pending follow-ups', { ticketId });

  const items = await queryItems(
    'PK = :pk',
    { ':pk': followUpPK(ticketId) },
  );

  const pending = items
    .filter((item) => item.status === FollowUpStatus.PENDING)
    .map((item) => ({
      ticketId: item.ticketId as string,
      type: item.type as FollowUpType,
      status: item.status as FollowUpStatus,
      scheduledAt: item.scheduledAt as string,
      message: item.message as string,
      createdAt: item.createdAt as string,
      cancelledAt: item.cancelledAt as string | undefined,
    }));

  logger.info('Found pending follow-ups', { ticketId, count: pending.length });

  return pending;
}

// ---------------------------------------------------------------------------
// Cancellation (Requirement 11.4)
// ---------------------------------------------------------------------------

/**
 * Cancel all pending follow-ups for a ticket. Called when a user responds.
 *
 * Requirement 11.4: Cancel pending follow-ups when user responds
 */
export async function cancelPendingFollowUps(ticketId: string): Promise<number> {
  logger.info('Cancelling pending follow-ups', { ticketId });

  const pending = await getPendingFollowUps(ticketId);

  if (pending.length === 0) {
    logger.info('No pending follow-ups to cancel', { ticketId });
    return 0;
  }

  const now = new Date().toISOString();

  const updatePromises = pending.map((record) =>
    updateItem(
      followUpPK(ticketId),
      followUpSK(record.type, record.scheduledAt),
      'SET #status = :status, cancelledAt = :cancelledAt',
      {
        ':status': FollowUpStatus.CANCELLED,
        ':cancelledAt': now,
      },
      { '#status': 'status' },
    ),
  );

  await Promise.all(updatePromises);

  logger.info('Cancelled pending follow-ups', { ticketId, count: pending.length });

  return pending.length;
}
