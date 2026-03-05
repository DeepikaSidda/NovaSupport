/**
 * Ticket Prioritization Service for NovaSupport
 * Combines urgency indicators, sentiment analysis, and business impact
 * to assign a priority score in range [1, 10]
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5
 */

import { Ticket, TicketStatus } from '../types/ticket';
import { TicketAnalysis } from '../utils/ticket-analyzer';
import { updateItem, queryItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('TicketPrioritization');

/**
 * Business impact factors for priority calculation
 */
export interface BusinessImpact {
  affectedUserCount: number;
  serviceCriticality: 'low' | 'medium' | 'high' | 'critical';
  revenueImpact: boolean;
}

/**
 * Result of priority calculation
 */
export interface PriorityResult {
  ticketId: string;
  priorityScore: number; // Integer in [1, 10]
  urgencyComponent: number;
  sentimentComponent: number;
  businessImpactComponent: number;
  calculatedAt: Date;
}

/**
 * Weights for each component of the priority score.
 * These sum to 1.0 to produce a weighted average.
 */
const WEIGHTS = {
  urgency: 0.4,
  sentiment: 0.25,
  businessImpact: 0.35,
} as const;

/**
 * Calculate priority score for a ticket based on its analysis and business impact.
 * Returns an integer in range [1, 10].
 *
 * Requirements: 3.1 (urgency), 3.2 (sentiment), 3.3 (score 1-10), 3.5 (business impact)
 */
export function calculatePriorityScore(
  analysis: TicketAnalysis,
  businessImpact: BusinessImpact
): PriorityResult {
  // Normalize urgency to [0, 1] — urgencyScore is on a 0-10 scale
  const urgencyComponent = analysis.urgency.urgencyScore / 10;

  // Normalize sentiment to [0, 1] where negative sentiment → higher value
  // sentimentScore is [-1, 1]; we invert and shift so -1 → 1, 0 → 0.5, 1 → 0
  const sentimentComponent = calculateSentimentComponent(analysis);

  // Normalize business impact to [0, 1]
  const businessImpactComponent = calculateBusinessImpactComponent(businessImpact);

  // Weighted combination → [0, 1]
  const rawScore =
    WEIGHTS.urgency * urgencyComponent +
    WEIGHTS.sentiment * sentimentComponent +
    WEIGHTS.businessImpact * businessImpactComponent;

  // Map to [1, 10] and round to integer
  const priorityScore = clampPriority(Math.round(rawScore * 9 + 1));

  logger.info('Priority score calculated', {
    ticketId: analysis.ticketId,
    priorityScore,
    urgencyComponent: Number(urgencyComponent.toFixed(3)),
    sentimentComponent: Number(sentimentComponent.toFixed(3)),
    businessImpactComponent: Number(businessImpactComponent.toFixed(3)),
  });

  return {
    ticketId: analysis.ticketId,
    priorityScore,
    urgencyComponent,
    sentimentComponent,
    businessImpactComponent,
    calculatedAt: new Date(),
  };
}

/**
 * Calculate the sentiment component for priority scoring.
 * Negative sentiment increases priority (Requirement 3.2).
 *
 * sentimentScore: [-1, 1] where -1 is very negative, 1 is very positive
 * Returns: [0, 1] where 1 means highest priority boost from sentiment
 */
export function calculateSentimentComponent(analysis: TicketAnalysis): number {
  // Invert sentiment: -1 → 1.0, 0 → 0.5, 1 → 0.0
  let component = (1 - analysis.sentiment.sentimentScore) / 2;

  // Boost for frustrated or angry customers
  if (analysis.sentiment.isFrustrated) {
    component = Math.min(1, component + 0.15);
  }
  if (analysis.sentiment.isAngry) {
    component = Math.min(1, component + 0.2);
  }

  return Math.max(0, Math.min(1, component));
}

/**
 * Calculate the business impact component for priority scoring.
 * Considers affected user count and service criticality (Requirement 3.5).
 *
 * Returns: [0, 1] where 1 means highest business impact
 */
export function calculateBusinessImpactComponent(impact: BusinessImpact): number {
  // Service criticality score
  const criticalityScores: Record<string, number> = {
    low: 0.1,
    medium: 0.35,
    high: 0.65,
    critical: 1.0,
  };
  const criticalityScore = criticalityScores[impact.serviceCriticality] ?? 0.35;

  // Affected user count score — logarithmic scale, capped at 1
  // 1 user → ~0, 10 users → ~0.5, 100 users → ~1.0
  const userCountScore = impact.affectedUserCount <= 0
    ? 0
    : Math.min(1, Math.log10(impact.affectedUserCount) / 2);

  // Revenue impact adds a flat boost
  const revenueBoost = impact.revenueImpact ? 0.15 : 0;

  // Weighted combination of sub-factors
  const component = criticalityScore * 0.5 + userCountScore * 0.35 + revenueBoost;

  return Math.max(0, Math.min(1, component));
}

/**
 * Clamp priority score to valid integer range [1, 10]
 */
export function clampPriority(score: number): number {
  if (!Number.isFinite(score)) {
    return 5; // Default for NaN/Infinity
  }
  return Math.max(1, Math.min(10, Math.round(score)));
}

/**
 * Update ticket priority in DynamoDB
 */
export async function updateTicketPriority(
  ticketId: string,
  priorityResult: PriorityResult
): Promise<void> {
  logger.info('Updating ticket priority in DynamoDB', {
    ticketId,
    priorityScore: priorityResult.priorityScore,
  });

  const pk = `TICKET#${ticketId}`;
  const sk = 'METADATA';
  const now = new Date().toISOString();

  const updateExpression =
    'SET priority = :priority, ' +
    'updatedAt = :updatedAt, ' +
    'GSI2SK = :gsi2sk';

  const expressionAttributeValues = {
    ':priority': priorityResult.priorityScore,
    ':updatedAt': now,
    ':gsi2sk': `${priorityResult.priorityScore}#${now}`,
  };

  await updateItem(pk, sk, updateExpression, expressionAttributeValues);

  logger.info('Ticket priority updated', {
    ticketId,
    priorityScore: priorityResult.priorityScore,
  });
}

/**
 * Full prioritization flow: calculate score and update DynamoDB.
 * Convenience function that combines calculation and persistence.
 */
export async function prioritizeTicket(
  ticket: Ticket,
  analysis: TicketAnalysis,
  businessImpact: BusinessImpact
): Promise<PriorityResult> {
  const result = calculatePriorityScore(analysis, businessImpact);
  await updateTicketPriority(ticket.id, result);
  return result;
}

/**
 * Create a default business impact when no specific data is available
 */
export function defaultBusinessImpact(): BusinessImpact {
  return {
    affectedUserCount: 1,
    serviceCriticality: 'medium',
    revenueImpact: false,
  };
}

/**
 * Item in the ticket queue, representing a ticket ordered by priority.
 */
export interface TicketQueueItem {
  ticketId: string;
  subject: string;
  priority: number;
  createdAt: string;
  assignedTo?: string;
}

/**
 * Query tickets by status, sorted by priority descending (highest first).
 * Uses GSI2 with GSI2PK = "STATUS#<status>" and GSI2SK = "<priority>#<createdAt>".
 *
 * Requirements: 3.4
 */
export async function getTicketQueue(status: TicketStatus): Promise<TicketQueueItem[]> {
  logger.info('Querying ticket queue', { status });

  const items = await queryItems(
    'GSI2PK = :statusKey',
    { ':statusKey': `STATUS#${status}` },
    'GSI2'
  );

  const queueItems: TicketQueueItem[] = items.map((item) => ({
    ticketId: item.ticketId,
    subject: item.subject,
    priority: Number(item.priority),
    createdAt: item.createdAt,
    assignedTo: item.assignedTo,
  }));

  // Sort by priority descending; for equal priority, sort by createdAt ascending (older first)
  queueItems.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  logger.info('Ticket queue retrieved', { status, count: queueItems.length });

  return queueItems;
}

/**
 * Re-query and return the ordered queue for a given status.
 * Convenience wrapper that always fetches the latest state from DynamoDB.
 *
 * Requirements: 3.4
 */
export async function reorderQueue(status: TicketStatus): Promise<TicketQueueItem[]> {
  logger.info('Reordering queue', { status });
  return getTicketQueue(status);
}
