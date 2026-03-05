/**
 * Lambda handler for analytics data
 * Returns performance reports, trends, and alerts
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { generatePerformanceReport, detectTrends, generateTrendAlerts, getTimeRangeForPeriod } from '../services/analytics-engine';
import { scanItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('GetAnalyticsHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const period = (event.queryStringParameters?.period as 'daily' | 'weekly' | 'monthly') || 'weekly';

    logger.info('Fetching analytics', { period });

    // Get ticket counts by status for overview
    const allTickets = await scanItems(
      'begins_with(PK, :prefix) AND SK = :sk',
      { ':prefix': 'TICKET#', ':sk': 'METADATA' }
    );

    const statusCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    let totalTickets = allTickets.length;

    for (const t of allTickets) {
      const s = (t.status as string) || 'unknown';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
      const p = String(t.priority || 5);
      priorityCounts[p] = (priorityCounts[p] || 0) + 1;
      const c = (t.category as string) || 'uncategorized';
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    }

    // Compute time-series ticket counts (tickets per day) for the selected period
    const timeRange = getTimeRangeForPeriod(period);
    const dateCountMap: Record<string, number> = {};

    for (const t of allTickets) {
      const createdAt = t.createdAt as string | undefined;
      if (!createdAt) continue;
      const date = createdAt.slice(0, 10); // YYYY-MM-DD
      const ticketDate = new Date(date);
      if (ticketDate >= timeRange.start && ticketDate <= timeRange.end) {
        dateCountMap[date] = (dateCountMap[date] || 0) + 1;
      }
    }

    const timeSeries = Object.keys(dateCountMap)
      .sort()
      .map((date) => ({ date, count: dateCountMap[date] }));

    // Try to get performance report
    let performanceReport = null;
    try {
      performanceReport = await generatePerformanceReport(period);
    } catch (e) { logger.warn('Performance report unavailable', { error: (e as Error).message }); }

    // Try to detect trends
    let trends = null;
    let alerts = null;
    try {
      trends = await detectTrends(timeRange);
      if (trends) alerts = generateTrendAlerts(trends);
    } catch (e) { logger.warn('Trend detection unavailable', { error: (e as Error).message }); }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        overview: { totalTickets, statusCounts, priorityCounts, categoryCounts },
        performanceReport,
        trends,
        alerts,
        period,
        timeSeries,
        topIssues: performanceReport?.topIssues || [],
        teamPerformance: performanceReport?.teamPerformance || [],
      }),
    };
  } catch (error) {
    logger.error('Error fetching analytics', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Failed to fetch analytics' } }) };
  }
}
