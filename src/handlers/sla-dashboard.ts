/**
 * Lambda handler for Admin SLA Dashboard
 * GET /admin/sla-dashboard
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.7, 7.9
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client';
import { getSLAStatus } from '../services/sla-tracker';
import { createLogger } from '../utils/logger';

const logger = createLogger('SLADashboardHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/** At-risk threshold in minutes */
const AT_RISK_THRESHOLD_MINUTES = 30;

interface BreachedTicket {
  ticketId: string;
  subject: string;
  priority: string;
  timeSinceBreach: number;
  assignedTeam: string;
}

interface AtRiskTicket {
  ticketId: string;
  subject: string;
  priority: string;
  timeRemaining: number;
  assignedTeam: string;
}

interface PriorityBreakdown {
  priority: string;
  total: number;
  breachedCount: number;
  compliancePercentage: number;
}

/**
 * Map a numeric priority to its label. Falls back to 'Unknown'.
 */
function getPriorityLabel(priority: number): string {
  if (priority >= 10) return 'Critical';
  if (priority >= 8) return 'High';
  if (priority >= 5) return 'Medium';
  if (priority >= 1) return 'Low';
  return 'Unknown';
}

/**
 * Lambda handler for GET /admin/sla-dashboard
 * Fetches all open tickets, computes SLA metrics, and returns dashboard data.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Fetching SLA dashboard data');

    // Fetch all open tickets via scan with filter on status
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(PK, :pkPrefix) AND SK = :sk AND #s IN (:s1, :s2, :s3, :s4, :s5, :s6)',
      ExpressionAttributeNames: {
        '#s': 'status',
      },
      ExpressionAttributeValues: {
        ':pkPrefix': 'TICKET#',
        ':sk': 'METADATA',
        ':s1': 'new',
        ':s2': 'analyzing',
        ':s3': 'assigned',
        ':s4': 'in_progress',
        ':s5': 'pending_user',
        ':s6': 'escalated',
      },
    }));
    const tickets = result.Items || [];

    const totalOpen = tickets.length;
    let breachedCount = 0;
    let atRiskCount = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    let totalResolutionTime = 0;
    let resolutionTimeCount = 0;

    const breachedTickets: BreachedTicket[] = [];
    const atRiskTickets: AtRiskTicket[] = [];

    // Per-priority tracking
    const priorityStats: Record<string, { total: number; breached: number }> = {
      Critical: { total: 0, breached: 0 },
      High: { total: 0, breached: 0 },
      Medium: { total: 0, breached: 0 },
      Low: { total: 0, breached: 0 },
    };

    for (const ticket of tickets) {
      const responseDeadline = ticket.slaResponseDeadline;
      const resolutionDeadline = ticket.slaResolutionDeadline;

      // Skip tickets without SLA deadlines
      if (!responseDeadline || !resolutionDeadline) {
        continue;
      }

      const slaStatus = getSLAStatus(
        responseDeadline,
        resolutionDeadline,
        ticket.firstResponseAt,
        ticket.resolvedAt
      );

      const priorityLabel = getPriorityLabel(ticket.priority || 1);

      // Track per-priority stats
      if (priorityStats[priorityLabel]) {
        priorityStats[priorityLabel].total++;
      }

      // Check if breached (response OR resolution)
      const isBreach = slaStatus.responseBreached || slaStatus.resolutionBreached;
      if (isBreach) {
        breachedCount++;
        if (priorityStats[priorityLabel]) {
          priorityStats[priorityLabel].breached++;
        }

        // Compute time since breach (use the worse breach)
        const timeSinceBreach = Math.abs(
          Math.min(slaStatus.responseTimeRemaining, slaStatus.resolutionTimeRemaining)
        );

        breachedTickets.push({
          ticketId: ticket.ticketId || ticket.PK?.replace('TICKET#', ''),
          subject: ticket.subject || '',
          priority: priorityLabel,
          timeSinceBreach,
          assignedTeam: ticket.assignedTeam || 'Unassigned',
        });
      } else {
        // Check if at-risk (within 30 min of breach on either response or resolution)
        const minRemaining = Math.min(
          slaStatus.responseTimeRemaining,
          slaStatus.resolutionTimeRemaining
        );

        if (minRemaining <= AT_RISK_THRESHOLD_MINUTES && minRemaining > 0) {
          atRiskCount++;
          atRiskTickets.push({
            ticketId: ticket.ticketId || ticket.PK?.replace('TICKET#', ''),
            subject: ticket.subject || '',
            priority: priorityLabel,
            timeRemaining: minRemaining,
            assignedTeam: ticket.assignedTeam || 'Unassigned',
          });
        }
      }

      // Compute average response time (only for tickets that have a first response)
      if (ticket.firstResponseAt && ticket.createdAt) {
        const responseTime = (new Date(ticket.firstResponseAt).getTime() - new Date(ticket.createdAt).getTime()) / 60000;
        totalResponseTime += responseTime;
        responseTimeCount++;
      }

      // Compute average resolution time (only for resolved tickets — though open tickets won't have this)
      if (ticket.resolvedAt && ticket.createdAt) {
        const resolutionTime = (new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime()) / 60000;
        totalResolutionTime += resolutionTime;
        resolutionTimeCount++;
      }
    }

    const compliancePercentage = totalOpen > 0
      ? Math.round(((totalOpen - breachedCount) / totalOpen) * 100)
      : 100;

    const averageResponseTime = responseTimeCount > 0
      ? Math.round(totalResponseTime / responseTimeCount)
      : 0;

    const averageResolutionTime = resolutionTimeCount > 0
      ? Math.round(totalResolutionTime / resolutionTimeCount)
      : 0;

    // Build per-priority breakdown
    const priorityBreakdown: PriorityBreakdown[] = ['Critical', 'High', 'Medium', 'Low'].map(
      (priority) => {
        const stats = priorityStats[priority];
        return {
          priority,
          total: stats.total,
          breachedCount: stats.breached,
          compliancePercentage: stats.total > 0
            ? Math.round(((stats.total - stats.breached) / stats.total) * 100)
            : 100,
        };
      }
    );

    const dashboard = {
      metrics: {
        totalOpen,
        breachedCount,
        atRiskCount,
        compliancePercentage,
        averageResponseTime,
        averageResolutionTime,
      },
      priorityBreakdown,
      breachedTickets,
      atRiskTickets,
    };

    logger.info('SLA dashboard data computed', {
      totalOpen,
      breachedCount,
      atRiskCount,
      compliancePercentage,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(dashboard),
    };
  } catch (error) {
    logger.error('Error computing SLA dashboard', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to compute SLA dashboard' } }),
    };
  }
}
