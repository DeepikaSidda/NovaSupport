/**
 * Unit tests for Analytics Engine
 *
 * Requirements: 15.1, 15.2, 15.3, 15.5
 */

import {
  trackResolution,
  getResolutionMetrics,
  getAIResolutionPercentage,
  getAverageResolutionTime,
  getAverageFirstResponseTime,
  getSatisfactionScores,
  getPerformanceReport,
  generatePerformanceReport,
  getTimeRangeForPeriod,
  detectTrends,
  generateTrendAlerts,
  detectSpikes,
  generateSpikeAlert,
  escalateCriticalAlert,
  getSevenDayAverage,
  runProactiveAlertCheck,
} from '../src/services/analytics-engine';
import { Resolution, Trend, TimeRange } from '../src/types/analytics';
import * as dynamodbClient from '../src/utils/dynamodb-client';

jest.mock('../src/utils/dynamodb-client');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedPutItem = jest.mocked(dynamodbClient.putItem);
const mockedQueryItems = jest.mocked(dynamodbClient.queryItems);
const mockedScanItems = jest.mocked(dynamodbClient.scanItems);

function makeResolution(overrides?: Partial<Resolution>): Resolution {
  return {
    ticketId: 'TKT-001',
    resolvedAt: new Date('2024-06-15T10:00:00Z'),
    resolvedBy: 'ai',
    resolutionTime: 3600000, // 1 hour
    firstResponseTime: 300000, // 5 min
    satisfactionScore: 4.5,
    ...overrides,
  };
}

const defaultTimeRange: TimeRange = {
  start: new Date('2024-06-01'),
  end: new Date('2024-06-30'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Analytics Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPutItem.mockResolvedValue(undefined);
    mockedQueryItems.mockResolvedValue([]);
  });

  // -----------------------------------------------------------------------
  // 1. trackResolution
  // -----------------------------------------------------------------------
  describe('trackResolution', () => {
    it('should store resolution, response, and satisfaction metrics in DynamoDB', async () => {
      const resolution = makeResolution();

      await trackResolution(resolution, { team: 'billing', category: 'payment' });

      // 3 putItem calls: resolution, response, satisfaction
      expect(mockedPutItem).toHaveBeenCalledTimes(3);

      // Resolution metric
      expect(mockedPutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: 'METRIC#2024-06-15',
          SK: 'resolution#TKT-001',
          metricType: 'resolution',
          value: 3600000,
          resolvedBy: 'ai',
          team: 'billing',
          category: 'payment',
          GSI1PK: 'TIMESERIES#resolution',
          GSI1SK: '2024-06-15#TKT-001',
        }),
      );

      // Response metric
      expect(mockedPutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: 'METRIC#2024-06-15',
          SK: 'response#TKT-001',
          metricType: 'response',
          value: 300000,
        }),
      );

      // Satisfaction metric
      expect(mockedPutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: 'METRIC#2024-06-15',
          SK: 'satisfaction#TKT-001',
          metricType: 'satisfaction',
          value: 4.5,
        }),
      );
    });

    it('should skip satisfaction metric when score is not provided', async () => {
      const resolution = makeResolution({ satisfactionScore: undefined });

      await trackResolution(resolution);

      // Only resolution + response = 2 calls
      expect(mockedPutItem).toHaveBeenCalledTimes(2);
      const calls = mockedPutItem.mock.calls.map((c) => c[0]);
      expect(calls.find((c: any) => c.metricType === 'satisfaction')).toBeUndefined();
    });

    it('should not include team/category when metadata is omitted', async () => {
      const resolution = makeResolution();

      await trackResolution(resolution);

      const firstCall = mockedPutItem.mock.calls[0][0] as any;
      expect(firstCall.team).toBeUndefined();
      expect(firstCall.category).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. getAIResolutionPercentage
  // -----------------------------------------------------------------------
  describe('getAIResolutionPercentage', () => {
    it('should calculate correct AI resolution percentage', async () => {
      mockedQueryItems.mockResolvedValue([
        { resolvedBy: 'ai', value: 1000 },
        { resolvedBy: 'ai', value: 2000 },
        { resolvedBy: 'human', value: 3000 },
        { resolvedBy: 'ai', value: 1500 },
      ]);

      const pct = await getAIResolutionPercentage(defaultTimeRange);

      expect(pct).toBe(75); // 3 out of 4
    });

    it('should return 100 when all tickets resolved by AI', async () => {
      mockedQueryItems.mockResolvedValue([
        { resolvedBy: 'ai', value: 1000 },
        { resolvedBy: 'ai', value: 2000 },
      ]);

      const pct = await getAIResolutionPercentage(defaultTimeRange);
      expect(pct).toBe(100);
    });

    it('should return 0 when all tickets resolved by humans', async () => {
      mockedQueryItems.mockResolvedValue([
        { resolvedBy: 'human', value: 1000 },
        { resolvedBy: 'human', value: 2000 },
      ]);

      const pct = await getAIResolutionPercentage(defaultTimeRange);
      expect(pct).toBe(0);
    });

    it('should return 0 when no resolution data exists', async () => {
      mockedQueryItems.mockResolvedValue([]);

      const pct = await getAIResolutionPercentage(defaultTimeRange);
      expect(pct).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. getAverageResolutionTime
  // -----------------------------------------------------------------------
  describe('getAverageResolutionTime', () => {
    it('should calculate average resolution time', async () => {
      mockedQueryItems.mockResolvedValue([
        { value: 1000 },
        { value: 3000 },
        { value: 5000 },
      ]);

      const avg = await getAverageResolutionTime(defaultTimeRange);
      expect(avg).toBe(3000);
    });

    it('should return 0 when no data exists', async () => {
      mockedQueryItems.mockResolvedValue([]);

      const avg = await getAverageResolutionTime(defaultTimeRange);
      expect(avg).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. getAverageFirstResponseTime
  // -----------------------------------------------------------------------
  describe('getAverageFirstResponseTime', () => {
    it('should calculate average first response time', async () => {
      mockedQueryItems.mockResolvedValue([
        { value: 60000 },
        { value: 120000 },
      ]);

      const avg = await getAverageFirstResponseTime(defaultTimeRange);
      expect(avg).toBe(90000);
    });

    it('should return 0 when no data exists', async () => {
      mockedQueryItems.mockResolvedValue([]);

      const avg = await getAverageFirstResponseTime(defaultTimeRange);
      expect(avg).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. getSatisfactionScores
  // -----------------------------------------------------------------------
  describe('getSatisfactionScores', () => {
    it('should aggregate all satisfaction scores without grouping', async () => {
      mockedQueryItems.mockResolvedValue([
        { value: 4.0 },
        { value: 5.0 },
        { value: 3.0 },
      ]);

      const groups = await getSatisfactionScores(defaultTimeRange);

      expect(groups).toHaveLength(1);
      expect(groups[0].groupKey).toBe('all');
      expect(groups[0].averageScore).toBe(4.0);
      expect(groups[0].count).toBe(3);
    });

    it('should aggregate satisfaction scores by team', async () => {
      mockedQueryItems.mockResolvedValue([
        { value: 4.0, team: 'billing' },
        { value: 5.0, team: 'billing' },
        { value: 3.0, team: 'support' },
      ]);

      const groups = await getSatisfactionScores(defaultTimeRange, 'team');

      expect(groups).toHaveLength(2);

      const billing = groups.find((g) => g.groupKey === 'billing');
      expect(billing).toBeDefined();
      expect(billing!.averageScore).toBe(4.5);
      expect(billing!.count).toBe(2);

      const support = groups.find((g) => g.groupKey === 'support');
      expect(support).toBeDefined();
      expect(support!.averageScore).toBe(3.0);
      expect(support!.count).toBe(1);
    });

    it('should aggregate satisfaction scores by category', async () => {
      mockedQueryItems.mockResolvedValue([
        { value: 5.0, category: 'payment' },
        { value: 3.0, category: 'payment' },
        { value: 4.0, category: 'login' },
      ]);

      const groups = await getSatisfactionScores(defaultTimeRange, 'category');

      expect(groups).toHaveLength(2);

      const payment = groups.find((g) => g.groupKey === 'payment');
      expect(payment!.averageScore).toBe(4.0);
      expect(payment!.count).toBe(2);

      const login = groups.find((g) => g.groupKey === 'login');
      expect(login!.averageScore).toBe(4.0);
      expect(login!.count).toBe(1);
    });

    it('should return empty array when no satisfaction data exists', async () => {
      mockedQueryItems.mockResolvedValue([]);

      const groups = await getSatisfactionScores(defaultTimeRange);
      expect(groups).toEqual([]);
    });

    it('should group missing team/category as "unknown"', async () => {
      mockedQueryItems.mockResolvedValue([
        { value: 4.0 },
        { value: 3.0 },
      ]);

      const groups = await getSatisfactionScores(defaultTimeRange, 'team');

      expect(groups).toHaveLength(1);
      expect(groups[0].groupKey).toBe('unknown');
    });
  });

  // -----------------------------------------------------------------------
  // 6. getPerformanceReport
  // -----------------------------------------------------------------------
  describe('getPerformanceReport', () => {
    it('should generate a complete performance report', async () => {
      // Mock queryItems to return different data per call
      // Call order: resolution, response, satisfaction
      mockedQueryItems
        .mockResolvedValueOnce([
          { value: 3600000, resolvedBy: 'ai', team: 'billing', category: 'payment' },
          { value: 7200000, resolvedBy: 'human', team: 'billing', category: 'payment' },
          { value: 1800000, resolvedBy: 'ai', team: 'support', category: 'login' },
        ])
        .mockResolvedValueOnce([
          { value: 300000, team: 'billing' },
          { value: 600000, team: 'billing' },
          { value: 120000, team: 'support' },
        ])
        .mockResolvedValueOnce([
          { value: 4.5, team: 'billing' },
          { value: 3.0, team: 'support' },
        ]);

      const report = await getPerformanceReport(defaultTimeRange);

      expect(report.timeRange).toEqual(defaultTimeRange);
      expect(report.totalTickets).toBe(3);

      // AI resolved: 2 out of 3
      expect(report.aiResolvedPercentage).toBeCloseTo(66.67, 1);

      // Average resolution time: (3600000 + 7200000 + 1800000) / 3
      expect(report.averageResolutionTime).toBeCloseTo(4200000);

      // Average first response time: (300000 + 600000 + 120000) / 3
      expect(report.averageFirstResponseTime).toBeCloseTo(340000);

      // Average satisfaction: (4.5 + 3.0) / 2
      expect(report.satisfactionScore).toBe(3.75);

      // Top issues
      expect(report.topIssues).toEqual(
        expect.arrayContaining([
          { issue: 'payment', count: 2 },
          { issue: 'login', count: 1 },
        ]),
      );
      // Payment should be first (higher count)
      expect(report.topIssues[0].issue).toBe('payment');

      // Team performance
      expect(report.teamPerformance).toHaveLength(2);

      const billingTeam = report.teamPerformance.find((t) => t.team === 'billing');
      expect(billingTeam).toBeDefined();
      expect(billingTeam!.metrics.totalTickets).toBe(2);
      expect(billingTeam!.metrics.aiResolvedPercentage).toBe(50);

      const supportTeam = report.teamPerformance.find((t) => t.team === 'support');
      expect(supportTeam).toBeDefined();
      expect(supportTeam!.metrics.totalTickets).toBe(1);
      expect(supportTeam!.metrics.aiResolvedPercentage).toBe(100);
    });

    it('should handle empty data gracefully', async () => {
      mockedQueryItems.mockResolvedValue([]);

      const report = await getPerformanceReport(defaultTimeRange);

      expect(report.totalTickets).toBe(0);
      expect(report.aiResolvedPercentage).toBe(0);
      expect(report.averageResolutionTime).toBe(0);
      expect(report.averageFirstResponseTime).toBe(0);
      expect(report.satisfactionScore).toBe(0);
      expect(report.topIssues).toEqual([]);
      expect(report.teamPerformance).toEqual([]);
    });

    it('should handle report with no satisfaction scores', async () => {
      mockedQueryItems
        .mockResolvedValueOnce([
          { value: 2000000, resolvedBy: 'ai', team: 'support', category: 'bug' },
        ])
        .mockResolvedValueOnce([
          { value: 100000, team: 'support' },
        ])
        .mockResolvedValueOnce([]); // no satisfaction data

      const report = await getPerformanceReport(defaultTimeRange);

      expect(report.totalTickets).toBe(1);
      expect(report.satisfactionScore).toBe(0);
      expect(report.aiResolvedPercentage).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // 7. getResolutionMetrics
  // -----------------------------------------------------------------------
  describe('getResolutionMetrics', () => {
    it('should query resolution metrics using the GSI1 index', async () => {
      const mockData = [
        { value: 1000, resolvedBy: 'ai', ticketId: 'TKT-001' },
        { value: 2000, resolvedBy: 'human', ticketId: 'TKT-002' },
      ];
      mockedQueryItems.mockResolvedValue(mockData);

      const result = await getResolutionMetrics(defaultTimeRange);

      expect(result).toEqual(mockData);
      expect(mockedQueryItems).toHaveBeenCalledWith(
        'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
        {
          ':pk': 'TIMESERIES#resolution',
          ':start': '2024-06-01',
          ':end': '2024-06-30~',
        },
        'GSI1Index',
      );
    });
  });

  // -----------------------------------------------------------------------
  // 8. detectTrends
  // -----------------------------------------------------------------------
  describe('detectTrends', () => {
    it('should detect trends from multiple categories', async () => {
      const midDate = new Date('2024-06-15T12:00:00Z');
      // Tickets in previous half (before midpoint)
      const previousTickets = [
        { ticketId: 'TKT-001', userId: 'U1', category: 'billing', createdAt: '2024-06-05T10:00:00.000Z', tags: ['payments'] },
        { ticketId: 'TKT-002', userId: 'U2', category: 'billing', createdAt: '2024-06-08T10:00:00.000Z', tags: ['payments'] },
        { ticketId: 'TKT-003', userId: 'U3', category: 'login', createdAt: '2024-06-10T10:00:00.000Z', tags: ['auth'] },
      ];
      // Tickets in current half (after midpoint)
      const currentTickets = [
        { ticketId: 'TKT-004', userId: 'U4', category: 'billing', createdAt: '2024-06-20T10:00:00.000Z', tags: ['payments'] },
        { ticketId: 'TKT-005', userId: 'U5', category: 'billing', createdAt: '2024-06-22T10:00:00.000Z', tags: ['payments'] },
        { ticketId: 'TKT-006', userId: 'U6', category: 'billing', createdAt: '2024-06-25T10:00:00.000Z', tags: ['payments'] },
        { ticketId: 'TKT-007', userId: 'U7', category: 'login', createdAt: '2024-06-18T10:00:00.000Z', tags: ['auth'] },
        { ticketId: 'TKT-008', userId: 'U8', category: 'login', createdAt: '2024-06-20T10:00:00.000Z', tags: ['auth'] },
        { ticketId: 'TKT-009', userId: 'U9', category: 'login', createdAt: '2024-06-25T10:00:00.000Z', tags: ['auth'] },
      ];

      mockedScanItems.mockResolvedValue([...previousTickets, ...currentTickets]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toHaveLength(2);

      const billingTrend = trends.find((t) => t.issueDescription === 'billing');
      expect(billingTrend).toBeDefined();
      expect(billingTrend!.frequency).toBe(5); // 2 previous + 3 current
      expect(billingTrend!.affectedUsers).toBe(5);
      expect(billingTrend!.affectedProducts).toContain('payments');
      // Growth rate: (3 - 2) / 2 = 0.5
      expect(billingTrend!.growthRate).toBe(0.5);
      expect(billingTrend!.severity).toBe('low'); // 0.5 is not > 0.5

      const loginTrend = trends.find((t) => t.issueDescription === 'login');
      expect(loginTrend).toBeDefined();
      expect(loginTrend!.frequency).toBe(4); // 1 previous + 3 current
      expect(loginTrend!.affectedUsers).toBe(4);
      // Growth rate: (3 - 1) / 1 = 2.0
      expect(loginTrend!.growthRate).toBe(2.0);
      expect(loginTrend!.severity).toBe('high');

      // Should persist trends to DynamoDB
      expect(mockedPutItem).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no tickets exist', async () => {
      mockedScanItems.mockResolvedValue([]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toEqual([]);
      expect(mockedPutItem).not.toHaveBeenCalled();
    });

    it('should calculate severity as high when growth rate > 1.0', async () => {
      // 1 ticket in previous half, 3 in current → growth rate = 2.0
      mockedScanItems.mockResolvedValue([
        { ticketId: 'TKT-001', userId: 'U1', category: 'outage', createdAt: '2024-06-05T10:00:00.000Z' },
        { ticketId: 'TKT-002', userId: 'U2', category: 'outage', createdAt: '2024-06-20T10:00:00.000Z' },
        { ticketId: 'TKT-003', userId: 'U3', category: 'outage', createdAt: '2024-06-22T10:00:00.000Z' },
        { ticketId: 'TKT-004', userId: 'U4', category: 'outage', createdAt: '2024-06-25T10:00:00.000Z' },
      ]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toHaveLength(1);
      expect(trends[0].growthRate).toBe(2.0);
      expect(trends[0].severity).toBe('high');
    });

    it('should calculate severity as medium when growth rate > 0.5 and <= 1.0', async () => {
      // 2 tickets in previous half, 3 in current → growth rate = 0.5... but 0.5 is not > 0.5
      // Need: 3 previous, 5 current → growth rate = (5-3)/3 ≈ 0.667
      mockedScanItems.mockResolvedValue([
        { ticketId: 'TKT-001', userId: 'U1', category: 'bug', createdAt: '2024-06-02T10:00:00.000Z' },
        { ticketId: 'TKT-002', userId: 'U2', category: 'bug', createdAt: '2024-06-05T10:00:00.000Z' },
        { ticketId: 'TKT-003', userId: 'U3', category: 'bug', createdAt: '2024-06-10T10:00:00.000Z' },
        { ticketId: 'TKT-004', userId: 'U4', category: 'bug', createdAt: '2024-06-18T10:00:00.000Z' },
        { ticketId: 'TKT-005', userId: 'U5', category: 'bug', createdAt: '2024-06-20T10:00:00.000Z' },
        { ticketId: 'TKT-006', userId: 'U6', category: 'bug', createdAt: '2024-06-22T10:00:00.000Z' },
        { ticketId: 'TKT-007', userId: 'U7', category: 'bug', createdAt: '2024-06-25T10:00:00.000Z' },
        { ticketId: 'TKT-008', userId: 'U8', category: 'bug', createdAt: '2024-06-28T10:00:00.000Z' },
      ]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toHaveLength(1);
      // 3 previous, 5 current → (5-3)/3 ≈ 0.667
      expect(trends[0].growthRate).toBeCloseTo(0.667, 2);
      expect(trends[0].severity).toBe('medium');
    });

    it('should calculate severity as low when growth rate <= 0.5', async () => {
      // Equal distribution: 2 previous, 2 current → growth rate = 0
      mockedScanItems.mockResolvedValue([
        { ticketId: 'TKT-001', userId: 'U1', category: 'question', createdAt: '2024-06-05T10:00:00.000Z' },
        { ticketId: 'TKT-002', userId: 'U2', category: 'question', createdAt: '2024-06-10T10:00:00.000Z' },
        { ticketId: 'TKT-003', userId: 'U3', category: 'question', createdAt: '2024-06-20T10:00:00.000Z' },
        { ticketId: 'TKT-004', userId: 'U4', category: 'question', createdAt: '2024-06-25T10:00:00.000Z' },
      ]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toHaveLength(1);
      expect(trends[0].growthRate).toBe(0);
      expect(trends[0].severity).toBe('low');
    });

    it('should handle tickets with no previous period (all in current)', async () => {
      mockedScanItems.mockResolvedValue([
        { ticketId: 'TKT-001', userId: 'U1', category: 'new-issue', createdAt: '2024-06-20T10:00:00.000Z' },
        { ticketId: 'TKT-002', userId: 'U2', category: 'new-issue', createdAt: '2024-06-25T10:00:00.000Z' },
      ]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toHaveLength(1);
      // No previous tickets → growth rate = currentCount = 2
      expect(trends[0].growthRate).toBe(2);
      expect(trends[0].severity).toBe('high');
    });

    it('should count unique affected users correctly', async () => {
      // Same user submitting multiple tickets
      mockedScanItems.mockResolvedValue([
        { ticketId: 'TKT-001', userId: 'U1', category: 'billing', createdAt: '2024-06-05T10:00:00.000Z' },
        { ticketId: 'TKT-002', userId: 'U1', category: 'billing', createdAt: '2024-06-10T10:00:00.000Z' },
        { ticketId: 'TKT-003', userId: 'U2', category: 'billing', createdAt: '2024-06-20T10:00:00.000Z' },
      ]);

      const trends = await detectTrends(defaultTimeRange);

      expect(trends).toHaveLength(1);
      expect(trends[0].affectedUsers).toBe(2); // U1 and U2, not 3
    });
  });

  // -----------------------------------------------------------------------
  // 9. generateTrendAlerts
  // -----------------------------------------------------------------------
  describe('generateTrendAlerts', () => {
    function makeTrend(overrides?: Partial<Trend>): Trend {
      return {
        trendId: 'trend-1',
        issueDescription: 'billing',
        affectedUsers: 15,
        frequency: 20,
        growthRate: 1.5,
        affectedProducts: ['payments'],
        firstDetected: new Date('2024-06-01'),
        severity: 'high',
        ...overrides,
      };
    }

    it('should generate alerts for trends affecting >10 users', async () => {
      const trends = [
        makeTrend({ affectedUsers: 15, severity: 'high' }),
        makeTrend({ trendId: 'trend-2', issueDescription: 'login', affectedUsers: 12, severity: 'medium' }),
      ];

      const alerts = generateTrendAlerts(trends);

      expect(alerts).toHaveLength(2);
      expect(alerts[0].affectedUsers).toBe(15);
      expect(alerts[0].type).toBe('spike'); // high severity
      expect(alerts[1].affectedUsers).toBe(12);
      expect(alerts[1].type).toBe('emerging_issue'); // medium severity
    });

    it('should NOT generate alerts for trends affecting <=10 users', async () => {
      const trends = [
        makeTrend({ affectedUsers: 10 }),
        makeTrend({ trendId: 'trend-2', affectedUsers: 5 }),
        makeTrend({ trendId: 'trend-3', affectedUsers: 1 }),
      ];

      const alerts = generateTrendAlerts(trends);

      expect(alerts).toHaveLength(0);
    });

    it('should generate spike alert for high severity trends', async () => {
      const trends = [makeTrend({ affectedUsers: 20, severity: 'high' })];

      const alerts = generateTrendAlerts(trends);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('spike');
      expect(alerts[0].recommendedActions).toContain('Investigate root cause immediately');
      expect(alerts[0].recommendedActions).toContain('Notify engineering team');
    });

    it('should generate emerging_issue alert for medium severity trends', async () => {
      const trends = [makeTrend({ affectedUsers: 20, severity: 'medium' })];

      const alerts = generateTrendAlerts(trends);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('emerging_issue');
      expect(alerts[0].recommendedActions).toContain('Monitor closely for further growth');
    });

    it('should generate emerging_issue alert for low severity trends', async () => {
      const trends = [makeTrend({ affectedUsers: 20, severity: 'low' })];

      const alerts = generateTrendAlerts(trends);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('emerging_issue');
      expect(alerts[0].recommendedActions).toContain('Continue monitoring');
    });

    it('should return empty array when no trends provided', async () => {
      const alerts = generateTrendAlerts([]);
      expect(alerts).toEqual([]);
    });

    it('should include description with affected users and growth rate', async () => {
      const trends = [makeTrend({ affectedUsers: 25, growthRate: 1.5, issueDescription: 'outage' })];

      const alerts = generateTrendAlerts(trends);

      expect(alerts[0].description).toContain('outage');
      expect(alerts[0].description).toContain('25');
      expect(alerts[0].description).toContain('150%');
    });

    it('should handle mix of alertable and non-alertable trends', async () => {
      const trends = [
        makeTrend({ trendId: 't1', affectedUsers: 5 }),   // no alert
        makeTrend({ trendId: 't2', affectedUsers: 15 }),  // alert
        makeTrend({ trendId: 't3', affectedUsers: 8 }),   // no alert
        makeTrend({ trendId: 't4', affectedUsers: 50 }),  // alert
      ];

      const alerts = generateTrendAlerts(trends);

      expect(alerts).toHaveLength(2);
      expect(alerts[0].affectedUsers).toBe(15);
      expect(alerts[1].affectedUsers).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // 10. detectSpikes (Requirement 16.2)
  // -----------------------------------------------------------------------
  describe('detectSpikes', () => {
    it('should detect a spike at exactly 50% threshold', () => {
      // 15 is exactly 50% above 10
      expect(detectSpikes('billing', 15, 10)).toBe(true);
    });

    it('should detect a spike above 50% threshold', () => {
      expect(detectSpikes('billing', 20, 10)).toBe(true);
    });

    it('should NOT detect a spike below 50% threshold', () => {
      // 14 is 40% above 10
      expect(detectSpikes('billing', 14, 10)).toBe(false);
    });

    it('should return false when 7-day average is zero', () => {
      expect(detectSpikes('billing', 5, 0)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 11. generateSpikeAlert (Requirement 16.3)
  // -----------------------------------------------------------------------
  describe('generateSpikeAlert', () => {
    it('should generate an alert with correct fields', () => {
      const alert = generateSpikeAlert('billing', 20, 10, 15);

      expect(alert.alertId).toBeDefined();
      expect(alert.type).toBe('spike');
      expect(alert.description).toContain('billing');
      expect(alert.description).toContain('20');
      expect(alert.description).toContain('10.0');
      expect(alert.affectedUsers).toBe(15);
      expect(alert.recommendedActions.length).toBeGreaterThan(0);
      expect(alert.createdAt).toBeInstanceOf(Date);
    });

    it('should include increase percentage in description', () => {
      const alert = generateSpikeAlert('login', 30, 10, 8);

      // (30 - 10) / 10 = 200%
      expect(alert.description).toContain('200%');
    });
  });

  // -----------------------------------------------------------------------
  // 12. escalateCriticalAlert (Requirement 16.4)
  // -----------------------------------------------------------------------
  describe('escalateCriticalAlert', () => {
    it('should escalate when alert matches a critical service', () => {
      const alert = generateSpikeAlert('payment-gateway', 20, 10, 15);
      const result = escalateCriticalAlert(alert, ['payment-gateway', 'auth-service']);

      expect(result).not.toBeNull();
      expect(result!.escalatedTo).toBe('on-call-engineers');
      expect(result!.matchedService).toBe('payment-gateway');
      expect(result!.alert).toBe(alert);
    });

    it('should NOT escalate when alert does not match any critical service', () => {
      const alert = generateSpikeAlert('general-inquiry', 20, 10, 15);
      const result = escalateCriticalAlert(alert, ['payment-gateway', 'auth-service']);

      expect(result).toBeNull();
    });

    it('should match critical services case-insensitively', () => {
      const alert = generateSpikeAlert('Payment-Gateway', 20, 10, 15);
      const result = escalateCriticalAlert(alert, ['payment-gateway']);

      expect(result).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 13. getSevenDayAverage
  // -----------------------------------------------------------------------
  describe('getSevenDayAverage', () => {
    it('should calculate 7-day average from scanned tickets', async () => {
      mockedScanItems.mockResolvedValue([
        { ticketId: 'T1' },
        { ticketId: 'T2' },
        { ticketId: 'T3' },
        { ticketId: 'T4' },
        { ticketId: 'T5' },
        { ticketId: 'T6' },
        { ticketId: 'T7' },
      ]);

      const avg = await getSevenDayAverage('billing', new Date('2024-06-15'));

      expect(avg).toBe(1); // 7 tickets / 7 days
      expect(mockedScanItems).toHaveBeenCalledWith(
        expect.stringContaining('category = :cat'),
        expect.objectContaining({ ':cat': 'billing' }),
      );
    });

    it('should return 0 when no tickets exist', async () => {
      mockedScanItems.mockResolvedValue([]);

      const avg = await getSevenDayAverage('billing', new Date('2024-06-15'));

      expect(avg).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 14. runProactiveAlertCheck (Requirements 16.1, 16.2, 16.3, 16.4)
  // -----------------------------------------------------------------------
  describe('runProactiveAlertCheck', () => {
    it('should generate alerts and escalations for spiking critical categories', async () => {
      // First call: getSevenDayAverage scan for 'payment-gateway'
      // Second call: today's tickets for 'payment-gateway'
      mockedScanItems
        .mockResolvedValueOnce([
          { ticketId: 'T1' }, { ticketId: 'T2' }, { ticketId: 'T3' },
          { ticketId: 'T4' }, { ticketId: 'T5' }, { ticketId: 'T6' },
          { ticketId: 'T7' },
        ]) // 7 tickets in 7 days → avg = 1
        .mockResolvedValueOnce([
          { ticketId: 'T8', userId: 'U1' },
          { ticketId: 'T9', userId: 'U2' },
          { ticketId: 'T10', userId: 'U3' },
        ]); // 3 today, avg is 1 → 3 >= 1.5 → spike

      const result = await runProactiveAlertCheck(
        ['payment-gateway'],
        ['payment-gateway'],
      );

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].type).toBe('spike');
      expect(result.alerts[0].affectedUsers).toBe(3);
      expect(result.escalations).toHaveLength(1);
      expect(result.escalations[0].matchedService).toBe('payment-gateway');

      // Should persist alert to DynamoDB
      expect(mockedPutItem).toHaveBeenCalled();
    });

    it('should not generate alerts when no spike detected', async () => {
      // 7-day: 14 tickets → avg = 2
      mockedScanItems
        .mockResolvedValueOnce(Array.from({ length: 14 }, (_, i) => ({ ticketId: `T${i}` })))
        .mockResolvedValueOnce([
          { ticketId: 'T20', userId: 'U1' },
          { ticketId: 'T21', userId: 'U2' },
        ]); // 2 today, avg is 2 → 2 < 3 → no spike

      const result = await runProactiveAlertCheck(['billing'], []);

      expect(result.alerts).toHaveLength(0);
      expect(result.escalations).toHaveLength(0);
    });

    it('should handle multiple categories', async () => {
      // Category 1: billing - spike
      mockedScanItems
        .mockResolvedValueOnce([{ ticketId: 'T1' }]) // 7-day: 1 ticket → avg ≈ 0.14
        .mockResolvedValueOnce([
          { ticketId: 'T2', userId: 'U1' },
          { ticketId: 'T3', userId: 'U2' },
        ]) // 2 today → 2 >= 0.21 → spike
        // Category 2: login - no spike
        .mockResolvedValueOnce(Array.from({ length: 70 }, (_, i) => ({ ticketId: `T${i + 10}` }))) // avg = 10
        .mockResolvedValueOnce([
          { ticketId: 'T100', userId: 'U3' },
        ]); // 1 today → 1 < 15 → no spike

      const result = await runProactiveAlertCheck(['billing', 'login'], []);

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].description).toContain('billing');
    });
  });

  // -----------------------------------------------------------------------
  // 15. getTimeRangeForPeriod (Requirement 15.4)
  // -----------------------------------------------------------------------
  describe('getTimeRangeForPeriod', () => {
    const refDate = new Date('2024-06-15T12:00:00Z');

    it('should return a 1-day range for daily period', () => {
      const range = getTimeRangeForPeriod('daily', refDate);
      const diffMs = range.end.getTime() - range.start.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
      expect(range.end).toEqual(refDate);
    });

    it('should return a 7-day range for weekly period', () => {
      const range = getTimeRangeForPeriod('weekly', refDate);
      const diffMs = range.end.getTime() - range.start.getTime();
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(range.end).toEqual(refDate);
    });

    it('should return a 30-day range for monthly period', () => {
      const range = getTimeRangeForPeriod('monthly', refDate);
      const diffMs = range.end.getTime() - range.start.getTime();
      expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000);
      expect(range.end).toEqual(refDate);
    });
  });

  // -----------------------------------------------------------------------
  // 16. generatePerformanceReport (Requirement 15.4)
  // -----------------------------------------------------------------------
  describe('generatePerformanceReport', () => {
    it('should generate a daily report with correct time range', async () => {
      mockedQueryItems.mockResolvedValue([]);
      const refDate = new Date('2024-06-15T12:00:00Z');

      const report = await generatePerformanceReport('daily', refDate);

      expect(report.timeRange.end).toEqual(refDate);
      const diffMs = report.timeRange.end.getTime() - report.timeRange.start.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
      expect(report.totalTickets).toBe(0);
    });

    it('should generate a weekly report with correct time range', async () => {
      mockedQueryItems.mockResolvedValue([]);
      const refDate = new Date('2024-06-15T12:00:00Z');

      const report = await generatePerformanceReport('weekly', refDate);

      const diffMs = report.timeRange.end.getTime() - report.timeRange.start.getTime();
      expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should generate a monthly report with correct time range', async () => {
      mockedQueryItems.mockResolvedValue([]);
      const refDate = new Date('2024-06-15T12:00:00Z');

      const report = await generatePerformanceReport('monthly', refDate);

      const diffMs = report.timeRange.end.getTime() - report.timeRange.start.getTime();
      expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('should include all report fields from underlying getPerformanceReport', async () => {
      mockedQueryItems
        .mockResolvedValueOnce([
          { value: 3600000, resolvedBy: 'ai', team: 'billing', category: 'payment' },
          { value: 1800000, resolvedBy: 'human', team: 'support', category: 'login' },
        ])
        .mockResolvedValueOnce([
          { value: 300000, team: 'billing' },
          { value: 120000, team: 'support' },
        ])
        .mockResolvedValueOnce([
          { value: 4.5, team: 'billing' },
        ]);

      const report = await generatePerformanceReport('weekly', new Date('2024-06-15T12:00:00Z'));

      expect(report.totalTickets).toBe(2);
      expect(report.aiResolvedPercentage).toBe(50);
      expect(report.averageResolutionTime).toBe(2700000);
      expect(report.averageFirstResponseTime).toBe(210000);
      expect(report.satisfactionScore).toBe(4.5);
      expect(report.topIssues.length).toBeGreaterThan(0);
      expect(report.teamPerformance.length).toBeGreaterThan(0);
    });
  });
});
