/**
 * Analytics Engine for NovaSupport
 * Tracks resolution metrics, calculates performance statistics,
 * and aggregates satisfaction scores by team, agent, and category.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.5
 */

import { v4 as uuidv4 } from 'uuid';
import { putItem, queryItems, scanItems } from '../utils/dynamodb-client';
import { formatDate } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import {
  Resolution,
  Trend,
  Alert,
  TimeRange,
  TeamMetrics,
  PerformanceReport,
} from '../types/analytics';

/** Escalation info returned when a critical service alert is detected */
export interface EscalationInfo {
  alert: Alert;
  escalatedTo: 'on-call-engineers';
  matchedService: string;
}

const logger = createLogger('AnalyticsEngine');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Optional metadata attached when tracking a resolution */
export interface ResolutionMetadata {
  team?: string;
  category?: string;
}

/** Satisfaction scores grouped by a dimension */
export interface SatisfactionGroup {
  groupKey: string;
  averageScore: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date to YYYY-MM-DD for use as the date partition key.
 */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Track Resolution (Requirement 15.1, 15.2)
// ---------------------------------------------------------------------------

/**
 * Store a resolution metric in DynamoDB.
 *
 * Creates three metric records per resolution:
 * - `resolution` – time-to-resolution
 * - `response`   – first response time
 * - `satisfaction` – satisfaction score (if provided)
 *
 * Each record is keyed by date and metric type for efficient time-range queries.
 */
export async function trackResolution(
  resolution: Resolution,
  metadata?: ResolutionMetadata,
): Promise<void> {
  const dateKey = toDateKey(resolution.resolvedAt);

  logger.info('Tracking resolution metrics', {
    ticketId: resolution.ticketId,
    dateKey,
    resolvedBy: resolution.resolvedBy,
  });

  const baseFields = {
    ticketId: resolution.ticketId,
    date: dateKey,
    resolvedBy: resolution.resolvedBy,
    resolvedAt: formatDate(resolution.resolvedAt),
    ...(metadata?.team && { team: metadata.team }),
    ...(metadata?.category && { category: metadata.category }),
  };

  // 1. Resolution time metric
  await putItem({
    PK: `METRIC#${dateKey}`,
    SK: `resolution#${resolution.ticketId}`,
    ...baseFields,
    metricType: 'resolution',
    value: resolution.resolutionTime,
    GSI1PK: 'TIMESERIES#resolution',
    GSI1SK: `${dateKey}#${resolution.ticketId}`,
  });

  // 2. First response time metric
  await putItem({
    PK: `METRIC#${dateKey}`,
    SK: `response#${resolution.ticketId}`,
    ...baseFields,
    metricType: 'response',
    value: resolution.firstResponseTime,
    GSI1PK: 'TIMESERIES#response',
    GSI1SK: `${dateKey}#${resolution.ticketId}`,
  });

  // 3. Satisfaction score (optional)
  if (resolution.satisfactionScore !== undefined) {
    await putItem({
      PK: `METRIC#${dateKey}`,
      SK: `satisfaction#${resolution.ticketId}`,
      ...baseFields,
      metricType: 'satisfaction',
      value: resolution.satisfactionScore,
      GSI1PK: 'TIMESERIES#satisfaction',
      GSI1SK: `${dateKey}#${resolution.ticketId}`,
    });
  }

  logger.info('Resolution metrics tracked', { ticketId: resolution.ticketId });
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve all metric records of a given type within a time range
 * using the GSI1 time-series index.
 */
async function queryMetricsByType(
  metricType: string,
  timeRange: TimeRange,
): Promise<Record<string, any>[]> {
  const startKey = toDateKey(timeRange.start);
  const endKey = toDateKey(timeRange.end);

  return queryItems(
    'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
    {
      ':pk': `TIMESERIES#${metricType}`,
      ':start': startKey,
      // Use a high suffix so the end date is fully inclusive
      ':end': `${endKey}~`,
    },
    'GSI1Index',
  );
}

// ---------------------------------------------------------------------------
// Get Resolution Metrics (Requirement 15.1, 15.2)
// ---------------------------------------------------------------------------

/**
 * Retrieve all resolution metric records for a time range.
 */
export async function getResolutionMetrics(
  timeRange: TimeRange,
): Promise<Record<string, any>[]> {
  logger.info('Fetching resolution metrics', {
    start: formatDate(timeRange.start),
    end: formatDate(timeRange.end),
  });

  return queryMetricsByType('resolution', timeRange);
}

// ---------------------------------------------------------------------------
// AI Resolution Percentage (Requirement 15.5)
// ---------------------------------------------------------------------------

/**
 * Calculate the percentage of tickets resolved by AI within a time range.
 *
 * Returns 0 when there are no resolutions in the range.
 */
export async function getAIResolutionPercentage(
  timeRange: TimeRange,
): Promise<number> {
  const metrics = await queryMetricsByType('resolution', timeRange);

  if (metrics.length === 0) {
    logger.info('No resolution metrics found for AI percentage calculation');
    return 0;
  }

  const aiCount = metrics.filter((m) => m.resolvedBy === 'ai').length;
  const percentage = (aiCount / metrics.length) * 100;

  logger.info('AI resolution percentage calculated', {
    total: metrics.length,
    aiCount,
    percentage,
  });

  return percentage;
}

// ---------------------------------------------------------------------------
// Average Resolution Time (Requirement 15.1)
// ---------------------------------------------------------------------------

/**
 * Calculate the average resolution time (in ms) for a time range.
 *
 * Returns 0 when there are no resolutions.
 */
export async function getAverageResolutionTime(
  timeRange: TimeRange,
): Promise<number> {
  const metrics = await queryMetricsByType('resolution', timeRange);

  if (metrics.length === 0) {
    return 0;
  }

  const total = metrics.reduce((sum, m) => sum + (m.value as number), 0);
  return total / metrics.length;
}

// ---------------------------------------------------------------------------
// Average First Response Time (Requirement 15.2)
// ---------------------------------------------------------------------------

/**
 * Calculate the average first response time (in ms) for a time range.
 *
 * Returns 0 when there are no response metrics.
 */
export async function getAverageFirstResponseTime(
  timeRange: TimeRange,
): Promise<number> {
  const metrics = await queryMetricsByType('response', timeRange);

  if (metrics.length === 0) {
    return 0;
  }

  const total = metrics.reduce((sum, m) => sum + (m.value as number), 0);
  return total / metrics.length;
}

// ---------------------------------------------------------------------------
// Satisfaction Scores (Requirement 15.3)
// ---------------------------------------------------------------------------

/**
 * Aggregate satisfaction scores, optionally grouped by team or category.
 *
 * When `groupBy` is omitted, returns a single group with key `"all"`.
 */
export async function getSatisfactionScores(
  timeRange: TimeRange,
  groupBy?: 'team' | 'category',
): Promise<SatisfactionGroup[]> {
  const metrics = await queryMetricsByType('satisfaction', timeRange);

  if (metrics.length === 0) {
    return [];
  }

  if (!groupBy) {
    const total = metrics.reduce((sum, m) => sum + (m.value as number), 0);
    return [
      {
        groupKey: 'all',
        averageScore: total / metrics.length,
        count: metrics.length,
      },
    ];
  }

  // Group by the requested dimension
  const groups = new Map<string, { total: number; count: number }>();

  for (const m of metrics) {
    const key = (m[groupBy] as string) || 'unknown';
    const existing = groups.get(key) || { total: 0, count: 0 };
    existing.total += m.value as number;
    existing.count += 1;
    groups.set(key, existing);
  }

  return Array.from(groups.entries()).map(([groupKey, { total, count }]) => ({
    groupKey,
    averageScore: total / count,
    count,
  }));
}

// ---------------------------------------------------------------------------
// Performance Report (Requirements 15.1, 15.2, 15.3, 15.5)
// ---------------------------------------------------------------------------

/**
 * Generate a comprehensive performance report for a time range.
 */
export async function getPerformanceReport(
  timeRange: TimeRange,
): Promise<PerformanceReport> {
  logger.info('Generating performance report', {
    start: formatDate(timeRange.start),
    end: formatDate(timeRange.end),
  });

  // Fetch all metric types in parallel
  const [resolutionMetrics, responseMetrics, satisfactionMetrics] =
    await Promise.all([
      queryMetricsByType('resolution', timeRange),
      queryMetricsByType('response', timeRange),
      queryMetricsByType('satisfaction', timeRange),
    ]);

  const totalTickets = resolutionMetrics.length;

  // AI resolution percentage
  const aiCount = resolutionMetrics.filter((m) => m.resolvedBy === 'ai').length;
  const aiResolvedPercentage = totalTickets > 0 ? (aiCount / totalTickets) * 100 : 0;

  // Average resolution time
  const avgResolutionTime =
    totalTickets > 0
      ? resolutionMetrics.reduce((s, m) => s + (m.value as number), 0) / totalTickets
      : 0;

  // Average first response time
  const avgFirstResponseTime =
    responseMetrics.length > 0
      ? responseMetrics.reduce((s, m) => s + (m.value as number), 0) / responseMetrics.length
      : 0;

  // Average satisfaction score
  const avgSatisfaction =
    satisfactionMetrics.length > 0
      ? satisfactionMetrics.reduce((s, m) => s + (m.value as number), 0) / satisfactionMetrics.length
      : 0;

  // Top issues – count tickets by category
  const issueCounts = new Map<string, number>();
  for (const m of resolutionMetrics) {
    const cat = (m.category as string) || 'uncategorized';
    issueCounts.set(cat, (issueCounts.get(cat) || 0) + 1);
  }
  const topIssues = Array.from(issueCounts.entries())
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count);

  // Team performance
  const teamMap = new Map<
    string,
    {
      totalTickets: number;
      aiCount: number;
      resolutionTimeSum: number;
      responseTimeSum: number;
      responseCount: number;
      satisfactionSum: number;
      satisfactionCount: number;
    }
  >();

  const initTeam = () => ({
    totalTickets: 0,
    aiCount: 0,
    resolutionTimeSum: 0,
    responseTimeSum: 0,
    responseCount: 0,
    satisfactionSum: 0,
    satisfactionCount: 0,
  });

  for (const m of resolutionMetrics) {
    const team = (m.team as string) || 'unassigned';
    const t = teamMap.get(team) || initTeam();
    t.totalTickets += 1;
    t.resolutionTimeSum += m.value as number;
    if (m.resolvedBy === 'ai') t.aiCount += 1;
    teamMap.set(team, t);
  }

  for (const m of responseMetrics) {
    const team = (m.team as string) || 'unassigned';
    const t = teamMap.get(team) || initTeam();
    t.responseTimeSum += m.value as number;
    t.responseCount += 1;
    teamMap.set(team, t);
  }

  for (const m of satisfactionMetrics) {
    const team = (m.team as string) || 'unassigned';
    const t = teamMap.get(team) || initTeam();
    t.satisfactionSum += m.value as number;
    t.satisfactionCount += 1;
    teamMap.set(team, t);
  }

  const teamPerformance = Array.from(teamMap.entries()).map(
    ([team, t]): { team: string; metrics: TeamMetrics } => ({
      team,
      metrics: {
        totalTickets: t.totalTickets,
        averageResolutionTime:
          t.totalTickets > 0 ? t.resolutionTimeSum / t.totalTickets : 0,
        averageFirstResponseTime:
          t.responseCount > 0 ? t.responseTimeSum / t.responseCount : 0,
        satisfactionScore:
          t.satisfactionCount > 0 ? t.satisfactionSum / t.satisfactionCount : 0,
        aiResolvedPercentage:
          t.totalTickets > 0 ? (t.aiCount / t.totalTickets) * 100 : 0,
      },
    }),
  );

  const report: PerformanceReport = {
    timeRange,
    totalTickets,
    aiResolvedPercentage,
    averageResolutionTime: avgResolutionTime,
    averageFirstResponseTime: avgFirstResponseTime,
    satisfactionScore: avgSatisfaction,
    topIssues,
    teamPerformance,
  };

  logger.info('Performance report generated', {
    totalTickets,
    aiResolvedPercentage,
  });

  return report;
}


// ---------------------------------------------------------------------------
// Report Period Helpers (Requirement 15.4)
// ---------------------------------------------------------------------------

/** Supported report periods */
export type ReportPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Compute the TimeRange for a given report period ending at `referenceDate`.
 *
 * - daily:   previous 24 hours
 * - weekly:  previous 7 days
 * - monthly: previous 30 days
 */
export function getTimeRangeForPeriod(
  period: ReportPeriod,
  referenceDate: Date = new Date(),
): TimeRange {
  const end = new Date(referenceDate);
  const start = new Date(referenceDate);

  switch (period) {
    case 'daily':
      start.setDate(start.getDate() - 1);
      break;
    case 'weekly':
      start.setDate(start.getDate() - 7);
      break;
    case 'monthly':
      start.setDate(start.getDate() - 30);
      break;
  }

  return { start, end };
}

/**
 * Generate a performance report for a named period (daily, weekly, monthly).
 *
 * This is a convenience wrapper around `getPerformanceReport` that computes
 * the correct time range from the period name.
 *
 * Requirement 15.4: provide daily, weekly, and monthly views.
 */
export async function generatePerformanceReport(
  period: ReportPeriod,
  referenceDate: Date = new Date(),
): Promise<PerformanceReport> {
  logger.info('Generating performance report for period', { period });
  const timeRange = getTimeRangeForPeriod(period, referenceDate);
  return getPerformanceReport(timeRange);
}

// ---------------------------------------------------------------------------
// Trend Detection (Requirements 14.1, 14.2, 14.3, 14.4)
// ---------------------------------------------------------------------------

/**
 * Internal representation of a ticket record used for trend clustering.
 */
interface TicketRecord {
  ticketId: string;
  userId: string;
  category: string;
  subject?: string;
  description?: string;
  createdAt: string;
  tags?: string[];
}

/**
 * Determine severity from growth rate.
 *  - high   if growthRate > 1.0
 *  - medium if growthRate > 0.5
 *  - low    otherwise
 */
function calculateSeverity(growthRate: number): 'low' | 'medium' | 'high' {
  if (growthRate > 1.0) return 'high';
  if (growthRate > 0.5) return 'medium';
  return 'low';
}

/**
 * Split a time range into two equal halves (previous period and current period).
 * Used for growth rate calculation.
 */
function splitTimeRange(timeRange: TimeRange): { previous: TimeRange; current: TimeRange } {
  const midMs = (timeRange.start.getTime() + timeRange.end.getTime()) / 2;
  const mid = new Date(midMs);
  return {
    previous: { start: timeRange.start, end: mid },
    current: { start: mid, end: timeRange.end },
  };
}

/**
 * Detect trends by clustering tickets by category, calculating frequency
 * and growth rate, and persisting the results to DynamoDB.
 *
 * Clustering approach (hackathon-simple):
 *   1. Scan tickets within the time range
 *   2. Group by category
 *   3. For each category compute:
 *      - frequency (total ticket count)
 *      - unique affected users
 *      - affected products (from tags or category)
 *      - growth rate = (current_count - previous_count) / previous_count
 *   4. Assign severity based on growth rate
 *   5. Store each trend in DynamoDB
 */
export async function detectTrends(timeRange: TimeRange): Promise<Trend[]> {
  logger.info('Detecting trends', {
    start: formatDate(timeRange.start),
    end: formatDate(timeRange.end),
  });

  // Scan all ticket records in the time range
  const tickets = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk AND createdAt BETWEEN :start AND :end',
    {
      ':prefix': 'TICKET#',
      ':sk': 'METADATA',
      ':start': formatDate(timeRange.start),
      ':end': formatDate(timeRange.end),
    },
  ) as unknown as TicketRecord[];

  if (tickets.length === 0) {
    logger.info('No tickets found for trend detection');
    return [];
  }

  // Split time range for growth rate calculation
  const { current } = splitTimeRange(timeRange);

  // Group tickets by category
  const categoryMap = new Map<
    string,
    {
      tickets: TicketRecord[];
      previousCount: number;
      currentCount: number;
      users: Set<string>;
      products: Set<string>;
      firstSeen: Date;
    }
  >();

  for (const ticket of tickets) {
    const cat = ticket.category || 'uncategorized';
    const entry = categoryMap.get(cat) || {
      tickets: [],
      previousCount: 0,
      currentCount: 0,
      users: new Set<string>(),
      products: new Set<string>(),
      firstSeen: new Date(ticket.createdAt),
    };

    entry.tickets.push(ticket);
    if (ticket.userId) entry.users.add(ticket.userId);

    // Determine which half the ticket falls into
    const ticketDate = new Date(ticket.createdAt);
    if (ticketDate < current.start) {
      entry.previousCount += 1;
    } else {
      entry.currentCount += 1;
    }

    // Collect products from tags or use category as product
    if (ticket.tags && ticket.tags.length > 0) {
      for (const tag of ticket.tags) {
        entry.products.add(tag);
      }
    } else {
      entry.products.add(cat);
    }

    // Track earliest ticket
    if (ticketDate < entry.firstSeen) {
      entry.firstSeen = ticketDate;
    }

    categoryMap.set(cat, entry);
  }

  // Build trends
  const dateKey = toDateKey(timeRange.end);
  const trends: Trend[] = [];

  for (const [category, data] of categoryMap.entries()) {
    const frequency = data.tickets.length;

    // Growth rate: (current - previous) / previous. If previous is 0, use current count as rate.
    const growthRate =
      data.previousCount > 0
        ? (data.currentCount - data.previousCount) / data.previousCount
        : data.currentCount > 0
          ? data.currentCount
          : 0;

    const severity = calculateSeverity(growthRate);

    const trend: Trend = {
      trendId: uuidv4(),
      issueDescription: category,
      affectedUsers: data.users.size,
      frequency,
      growthRate,
      affectedProducts: Array.from(data.products),
      firstDetected: data.firstSeen,
      severity,
    };

    trends.push(trend);

    // Persist to DynamoDB
    await putItem({
      PK: `TREND#${dateKey}`,
      SK: trend.trendId,
      trendId: trend.trendId,
      issueDescription: trend.issueDescription,
      affectedUsers: trend.affectedUsers,
      frequency: trend.frequency,
      growthRate: trend.growthRate,
      affectedProducts: trend.affectedProducts,
      severity: trend.severity,
      firstDetected: formatDate(trend.firstDetected),
      lastUpdated: formatDate(new Date()),
    });
  }

  logger.info('Trends detected', { count: trends.length });
  return trends;
}

// ---------------------------------------------------------------------------
// Trend Alerts (Requirement 14.3)
// ---------------------------------------------------------------------------

/**
 * Generate alerts for trends that affect more than 10 users.
 *
 * Alert type is determined by severity:
 *  - high   → "spike"
 *  - medium → "emerging_issue"
 *  - low    → "emerging_issue"
 */
export function generateTrendAlerts(trends: Trend[]): Alert[] {
  const alerts: Alert[] = [];

  for (const trend of trends) {
    if (trend.affectedUsers > 10) {
      const alertType: Alert['type'] =
        trend.severity === 'high' ? 'spike' : 'emerging_issue';

      const actions: string[] = [];
      if (trend.severity === 'high') {
        actions.push('Investigate root cause immediately');
        actions.push('Notify engineering team');
      }
      if (trend.severity === 'medium') {
        actions.push('Monitor closely for further growth');
        actions.push('Review recent changes to affected products');
      }
      if (trend.severity === 'low') {
        actions.push('Continue monitoring');
      }
      actions.push(`Review tickets in category: ${trend.issueDescription}`);

      alerts.push({
        alertId: uuidv4(),
        type: alertType,
        description: `Trend detected: "${trend.issueDescription}" affecting ${trend.affectedUsers} users with growth rate ${(trend.growthRate * 100).toFixed(0)}%`,
        affectedUsers: trend.affectedUsers,
        recommendedActions: actions,
        createdAt: new Date(),
      });
    }
  }

  logger.info('Trend alerts generated', { count: alerts.length });
  return alerts;
}


// ---------------------------------------------------------------------------
// Proactive Alerting (Requirements 16.1, 16.2, 16.3, 16.4)
// ---------------------------------------------------------------------------

/**
 * Detect whether a spike has occurred for a category.
 *
 * A spike is defined as the current count being >= 50% higher than the
 * 7-day average (Requirement 16.2).
 *
 * Returns false when the sevenDayAverage is 0 (no baseline to compare against).
 */
export function detectSpikes(
  _category: string,
  currentCount: number,
  sevenDayAverage: number,
): boolean {
  if (sevenDayAverage <= 0) {
    return false;
  }
  return currentCount >= sevenDayAverage * 1.5;
}

/**
 * Generate an Alert object for a detected spike (Requirement 16.3).
 *
 * The alert includes the affected user count, a human-readable description,
 * and recommended actions.
 */
export function generateSpikeAlert(
  category: string,
  currentCount: number,
  sevenDayAverage: number,
  affectedUsers: number,
): Alert {
  const increasePercent = sevenDayAverage > 0
    ? Math.round(((currentCount - sevenDayAverage) / sevenDayAverage) * 100)
    : 100;

  return {
    alertId: uuidv4(),
    type: 'spike',
    description: `Spike detected in "${category}": ${currentCount} tickets today vs ${sevenDayAverage.toFixed(1)} 7-day avg (${increasePercent}% increase)`,
    affectedUsers,
    recommendedActions: [
      `Investigate root cause for "${category}"`,
      'Allocate additional support resources',
      'Notify affected users of known issue',
    ],
    createdAt: new Date(),
  };
}

/**
 * Check whether an alert relates to a critical service and return escalation
 * info if so (Requirement 16.4).
 *
 * Matching is case-insensitive: the alert description is checked for each
 * critical service name.
 *
 * Returns `null` when the alert does not match any critical service.
 */
export function escalateCriticalAlert(
  alert: Alert,
  criticalServices: string[],
): EscalationInfo | null {
  const descLower = alert.description.toLowerCase();

  for (const service of criticalServices) {
    if (descLower.includes(service.toLowerCase())) {
      logger.info('Escalating critical service alert', {
        alertId: alert.alertId,
        matchedService: service,
      });

      return {
        alert,
        escalatedTo: 'on-call-engineers',
        matchedService: service,
      };
    }
  }

  return null;
}

/**
 * Query DynamoDB for the 7-day rolling average ticket count for a category.
 *
 * Scans tickets with the given category created in the 7 days ending at
 * `endDate` and divides the total count by 7.
 */
export async function getSevenDayAverage(
  category: string,
  endDate: Date,
): Promise<number> {
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);

  const tickets = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk AND category = :cat AND createdAt BETWEEN :start AND :end',
    {
      ':prefix': 'TICKET#',
      ':sk': 'METADATA',
      ':cat': category,
      ':start': formatDate(startDate),
      ':end': formatDate(endDate),
    },
  );

  return tickets.length / 7;
}

/**
 * Orchestrate a full proactive alert check across all provided categories
 * (Requirements 16.1, 16.2, 16.3, 16.4).
 *
 * For each category:
 *  1. Get the 7-day average ticket count
 *  2. Get today's ticket count
 *  3. Detect spikes
 *  4. Generate alerts for spikes
 *  5. Escalate alerts that match critical services
 *
 * Returns all generated alerts (with escalation info attached where applicable).
 */
export async function runProactiveAlertCheck(
  categories: string[],
  criticalServices: string[],
): Promise<{ alerts: Alert[]; escalations: EscalationInfo[] }> {
  logger.info('Running proactive alert check', {
    categories,
    criticalServices,
  });

  const now = new Date();
  const alerts: Alert[] = [];
  const escalations: EscalationInfo[] = [];

  for (const category of categories) {
    const sevenDayAvg = await getSevenDayAverage(category, now);

    // Get today's tickets for this category
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayTickets = await scanItems(
      'begins_with(PK, :prefix) AND SK = :sk AND category = :cat AND createdAt >= :start',
      {
        ':prefix': 'TICKET#',
        ':sk': 'METADATA',
        ':cat': category,
        ':start': formatDate(todayStart),
      },
    );

    const currentCount = todayTickets.length;

    // Count unique affected users
    const userIds = new Set<string>();
    for (const ticket of todayTickets) {
      if (ticket.userId) {
        userIds.add(ticket.userId as string);
      }
    }

    if (detectSpikes(category, currentCount, sevenDayAvg)) {
      const alert = generateSpikeAlert(
        category,
        currentCount,
        sevenDayAvg,
        userIds.size,
      );
      alerts.push(alert);

      // Persist alert
      await putItem({
        PK: `ALERT#${toDateKey(now)}`,
        SK: alert.alertId,
        ...alert,
        createdAt: formatDate(alert.createdAt),
      });

      // Check for critical service escalation
      const escalation = escalateCriticalAlert(alert, criticalServices);
      if (escalation) {
        escalations.push(escalation);
      }
    }
  }

  logger.info('Proactive alert check complete', {
    alertCount: alerts.length,
    escalationCount: escalations.length,
  });

  return { alerts, escalations };
}
