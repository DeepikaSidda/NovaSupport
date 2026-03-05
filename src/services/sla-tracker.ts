/**
 * SLA Tracking Service for NovaSupport
 * Defines SLA targets per priority, calculates deadlines, tracks breaches,
 * and uses Nova to intelligently detect ticket category when not provided.
 */

import { Priority, SLADefinition, SLAStatus } from '../types/ticket';
import { updateItem, getItem } from '../utils/dynamodb-client';
import { invokeNova2LiteWithFallback } from '../utils/nova-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('SLATracker');

/**
 * SLA definitions per priority level
 * Based on IT best practices:
 * - Critical: 15 min response, 4 hour resolution
 * - High: 1 hour response, 8 hour resolution
 * - Medium: 4 hour response, 24 hour resolution
 * - Low: 8 hour response, 72 hour resolution
 */
export const SLA_DEFINITIONS: SLADefinition[] = [
  { priority: Priority.CRITICAL, responseTimeMinutes: 15, resolutionTimeMinutes: 240 },
  { priority: Priority.HIGH, responseTimeMinutes: 60, resolutionTimeMinutes: 480 },
  { priority: Priority.MEDIUM, responseTimeMinutes: 240, resolutionTimeMinutes: 1440 },
  { priority: Priority.LOW, responseTimeMinutes: 480, resolutionTimeMinutes: 4320 },
];

/**
 * Get SLA definition for a given priority score.
 * Maps numeric priority (1-10) to the closest SLA tier.
 */
export function getSLAForPriority(priority: number): SLADefinition {
  if (priority >= 10) return SLA_DEFINITIONS[0]; // Critical
  if (priority >= 8) return SLA_DEFINITIONS[1];  // High
  if (priority >= 5) return SLA_DEFINITIONS[2];  // Medium
  return SLA_DEFINITIONS[3];                      // Low
}

/**
 * Calculate SLA deadlines based on ticket creation time and priority.
 */
export function calculateSLADeadlines(
  createdAt: string,
  priority: number
): { responseDeadline: string; resolutionDeadline: string } {
  const sla = getSLAForPriority(priority);
  const created = new Date(createdAt);

  const responseDeadline = new Date(created.getTime() + sla.responseTimeMinutes * 60 * 1000);
  const resolutionDeadline = new Date(created.getTime() + sla.resolutionTimeMinutes * 60 * 1000);

  return {
    responseDeadline: responseDeadline.toISOString(),
    resolutionDeadline: resolutionDeadline.toISOString(),
  };
}

/**
 * Get current SLA status for a ticket.
 */
export function getSLAStatus(
  responseDeadline: string,
  resolutionDeadline: string,
  firstResponseAt?: string,
  resolvedAt?: string
): SLAStatus {
  const now = new Date();
  const respDeadline = new Date(responseDeadline);
  const resDeadline = new Date(resolutionDeadline);

  const responseBreached = firstResponseAt
    ? new Date(firstResponseAt) > respDeadline
    : now > respDeadline;

  const resolutionBreached = resolvedAt
    ? new Date(resolvedAt) > resDeadline
    : now > resDeadline;

  const responseTimeRemaining = firstResponseAt
    ? Math.round((respDeadline.getTime() - new Date(firstResponseAt).getTime()) / 60000)
    : Math.round((respDeadline.getTime() - now.getTime()) / 60000);

  const resolutionTimeRemaining = resolvedAt
    ? Math.round((resDeadline.getTime() - new Date(resolvedAt).getTime()) / 60000)
    : Math.round((resDeadline.getTime() - now.getTime()) / 60000);

  return {
    responseDeadline,
    resolutionDeadline,
    responseBreached,
    resolutionBreached,
    responseTimeRemaining,
    resolutionTimeRemaining,
    firstResponseAt,
  };
}

/**
 * Initialize SLA tracking for a new ticket in DynamoDB.
 * Sets response and resolution deadlines based on priority.
 */
export async function initializeSLA(ticketId: string, createdAt: string, priority: number): Promise<void> {
  const deadlines = calculateSLADeadlines(createdAt, priority);

  logger.info('Initializing SLA tracking', { ticketId, ...deadlines });

  await updateItem(
    `TICKET#${ticketId}`,
    'METADATA',
    'SET slaResponseDeadline = :rd, slaResolutionDeadline = :resd, slaBreached = :breached',
    {
      ':rd': deadlines.responseDeadline,
      ':resd': deadlines.resolutionDeadline,
      ':breached': false,
    }
  );
}

/**
 * Record first response time and check SLA breach.
 */
export async function recordFirstResponse(ticketId: string): Promise<void> {
  const now = new Date().toISOString();

  const record = await getItem(`TICKET#${ticketId}`, 'METADATA');
  if (!record) return;

  // Only set firstResponseAt if not already set
  if (record.firstResponseAt) return;

  const responseBreached = record.slaResponseDeadline
    ? new Date(now) > new Date(record.slaResponseDeadline as string)
    : false;

  logger.info('Recording first response', { ticketId, responseBreached });

  await updateItem(
    `TICKET#${ticketId}`,
    'METADATA',
    'SET firstResponseAt = :fra, slaBreached = :breached, updatedAt = :u',
    {
      ':fra': now,
      ':breached': responseBreached,
      ':u': now,
    }
  );
}

/**
 * Use Nova to detect the ticket category from subject + description.
 * Falls back to 'Other' if Nova is unavailable.
 */
export async function detectCategory(subject: string, description: string): Promise<string> {
  const prompt = `Classify this IT support ticket into exactly ONE category.

Subject: ${subject}
Description: ${description}

Categories: Hardware, Software, Network, Account & Access, Email, Security, Database, Cloud Infrastructure, Performance, Other

Respond with ONLY the category name, nothing else.`;

  try {
    const response = await invokeNova2LiteWithFallback(
      { prompt, temperature: 0.1, maxTokens: 20 },
      'Other'
    );
    const category = response.text.trim().replace(/['"]/g, '');
    // Validate it's one of our categories
    const valid = ['Hardware', 'Software', 'Network', 'Account & Access', 'Email', 'Security', 'Database', 'Cloud Infrastructure', 'Performance', 'Other'];
    return valid.includes(category) ? category : 'Other';
  } catch {
    return 'Other';
  }
}

/**
 * Set category on a ticket in DynamoDB.
 */
export async function updateTicketCategory(ticketId: string, category: string): Promise<void> {
  logger.info('Updating ticket category', { ticketId, category });

  await updateItem(
    `TICKET#${ticketId}`,
    'METADATA',
    'SET category = :cat, updatedAt = :u',
    {
      ':cat': category,
      ':u': new Date().toISOString(),
    }
  );
}
