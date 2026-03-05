/**
 * Property-based tests for Analytics Engine
 * Tests tasks 20.4 through 20.12 (Properties 30–38)
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import {
  trackResolution,
  getSatisfactionScores,
  getAIResolutionPercentage,
  detectTrends,
  generateTrendAlerts,
  detectSpikes,
  generateSpikeAlert,
  escalateCriticalAlert,
  EscalationInfo,
} from '../src/services/analytics-engine';
import { Resolution, Trend, Alert, TimeRange } from '../src/types/analytics';
import * as dynamodbClient from '../src/utils/dynamodb-client';

jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockedPutItem = jest.mocked(dynamodbClient.putItem);
const mockedQueryItems = jest.mocked(dynamodbClient.queryItems);
const mockedScanItems = jest.mocked(dynamodbClient.scanItems);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const resolvedByArb = fc.constantFrom<'ai' | 'human'>('ai', 'human');
const severityArb = fc.constantFrom<'low' | 'medium' | 'high'>('low', 'medium', 'high');

const resolutionArb: fc.Arbitrary<Resolution> = fc.record({
  ticketId: fc.uuid(),
  resolvedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-01-01') }),
  resolvedBy: resolvedByArb,
  resolutionTime: fc.integer({ min: 1, max: 86400000 }),
  firstResponseTime: fc.integer({ min: 1, max: 86400000 }),
  satisfactionScore: fc.option(fc.double({ min: 1, max: 5, noNaN: true }), { nil: undefined }),
});

const timeRangeArb: fc.Arbitrary<TimeRange> = fc
  .tuple(
    fc.date({ min: new Date('2024-01-01'), max: new Date('2024-12-01') }),
    fc.integer({ min: 1, max: 90 }),
  )
  .map(([start, days]) => ({
    start,
    end: new Date(start.getTime() + days * 86400000),
  }));

const trendArb: fc.Arbitrary<Trend> = fc.record({
  trendId: fc.uuid(),
  issueDescription: fc.string({ minLength: 1, maxLength: 50 }),
  affectedUsers: fc.integer({ min: 0, max: 1000 }),
  frequency: fc.integer({ min: 1, max: 500 }),
  growthRate: fc.double({ min: -1, max: 5, noNaN: true }),
  affectedProducts: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
  firstDetected: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-01-01') }),
  severity: severityArb,
});

const alertArb: fc.Arbitrary<Alert> = fc.record({
  alertId: fc.uuid(),
  type: fc.constantFrom<'spike' | 'critical_service' | 'emerging_issue'>('spike', 'critical_service', 'emerging_issue'),
  description: fc.string({ minLength: 1, maxLength: 200 }),
  affectedUsers: fc.integer({ min: 0, max: 1000 }),
  recommendedActions: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 5 }),
  createdAt: fc.date(),
});

const teamArb = fc.constantFrom('billing', 'support', 'engineering', 'sales');
const categoryArb = fc.constantFrom('payment', 'login', 'bug', 'feature', 'outage');

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property-Based Tests: Analytics Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPutItem.mockResolvedValue(undefined);
    mockedQueryItems.mockResolvedValue([]);
    mockedScanItems.mockResolvedValue([]);
  });

  // -----------------------------------------------------------------------
  // Property 33: Resolution Metrics Calculation (Task 20.4)
  // **Validates: Requirements 15.1, 15.2**
  // -----------------------------------------------------------------------
  describe('Property 33: Resolution Metrics Calculation', () => {
    test('trackResolution stores resolution and response metrics via putItem', async () => {
      await fc.assert(
        fc.asyncProperty(resolutionArb, async (resolution) => {
          jest.clearAllMocks();
          mockedPutItem.mockResolvedValue(undefined);

          await trackResolution(resolution);

          // Should always store at least resolution + response = 2 calls
          const hasSatisfaction = resolution.satisfactionScore !== undefined;
          const expectedCalls = hasSatisfaction ? 3 : 2;
          expect(mockedPutItem).toHaveBeenCalledTimes(expectedCalls);

          const calls = mockedPutItem.mock.calls.map((c) => c[0] as any);

          // Verify resolution metric
          const resolutionMetric = calls.find((c: any) => c.metricType === 'resolution');
          expect(resolutionMetric).toBeDefined();
          expect(resolutionMetric.value).toBe(resolution.resolutionTime);
          expect(resolutionMetric.resolvedBy).toBe(resolution.resolvedBy);
          expect(resolutionMetric.ticketId).toBe(resolution.ticketId);

          // Verify response metric
          const responseMetric = calls.find((c: any) => c.metricType === 'response');
          expect(responseMetric).toBeDefined();
          expect(responseMetric.value).toBe(resolution.firstResponseTime);

          // Verify satisfaction metric if present
          if (hasSatisfaction) {
            const satMetric = calls.find((c: any) => c.metricType === 'satisfaction');
            expect(satMetric).toBeDefined();
            expect(satMetric.value).toBe(resolution.satisfactionScore);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 34: Satisfaction Score Aggregation (Task 20.5)
  // **Validates: Requirements 15.3**
  // -----------------------------------------------------------------------
  describe('Property 34: Satisfaction Score Aggregation', () => {
    test('getSatisfactionScores groups by team and computes correct averages', async () => {
      await fc.assert(
        fc.asyncProperty(
          timeRangeArb,
          fc.array(
            fc.record({
              value: fc.double({ min: 1, max: 5, noNaN: true }),
              team: teamArb,
              category: categoryArb,
            }),
            { minLength: 1, maxLength: 20 },
          ),
          async (timeRange, metrics) => {
            jest.clearAllMocks();
            mockedQueryItems.mockResolvedValue(metrics);

            const groups = await getSatisfactionScores(timeRange, 'team');

            // Every metric's team should appear in the groups
            const teamSet = new Set(metrics.map((m) => m.team));
            expect(groups.length).toBe(teamSet.size);

            // Verify averages
            for (const group of groups) {
              const matching = metrics.filter((m) => m.team === group.groupKey);
              expect(group.count).toBe(matching.length);
              const expectedAvg = matching.reduce((s, m) => s + m.value, 0) / matching.length;
              expect(group.averageScore).toBeCloseTo(expectedAvg, 5);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('getSatisfactionScores groups by category and computes correct averages', async () => {
      await fc.assert(
        fc.asyncProperty(
          timeRangeArb,
          fc.array(
            fc.record({
              value: fc.double({ min: 1, max: 5, noNaN: true }),
              team: teamArb,
              category: categoryArb,
            }),
            { minLength: 1, maxLength: 20 },
          ),
          async (timeRange, metrics) => {
            jest.clearAllMocks();
            mockedQueryItems.mockResolvedValue(metrics);

            const groups = await getSatisfactionScores(timeRange, 'category');

            const catSet = new Set(metrics.map((m) => m.category));
            expect(groups.length).toBe(catSet.size);

            for (const group of groups) {
              const matching = metrics.filter((m) => m.category === group.groupKey);
              expect(group.count).toBe(matching.length);
              const expectedAvg = matching.reduce((s, m) => s + m.value, 0) / matching.length;
              expect(group.averageScore).toBeCloseTo(expectedAvg, 5);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 35: AI Resolution Percentage Tracking (Task 20.6)
  // **Validates: Requirements 15.5**
  // -----------------------------------------------------------------------
  describe('Property 35: AI Resolution Percentage Tracking', () => {
    test('getAIResolutionPercentage calculates correct AI percentage', async () => {
      await fc.assert(
        fc.asyncProperty(
          timeRangeArb,
          fc.array(
            fc.record({ resolvedBy: resolvedByArb, value: fc.integer({ min: 1, max: 100000 }) }),
            { minLength: 1, maxLength: 50 },
          ),
          async (timeRange, metrics) => {
            jest.clearAllMocks();
            mockedQueryItems.mockResolvedValue(metrics);

            const pct = await getAIResolutionPercentage(timeRange);

            const aiCount = metrics.filter((m) => m.resolvedBy === 'ai').length;
            const expected = (aiCount / metrics.length) * 100;
            expect(pct).toBeCloseTo(expected, 5);
            expect(pct).toBeGreaterThanOrEqual(0);
            expect(pct).toBeLessThanOrEqual(100);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('getAIResolutionPercentage returns 0 for empty metrics', async () => {
      await fc.assert(
        fc.asyncProperty(timeRangeArb, async (timeRange) => {
          jest.clearAllMocks();
          mockedQueryItems.mockResolvedValue([]);

          const pct = await getAIResolutionPercentage(timeRange);
          expect(pct).toBe(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 30: Trend Cluster Detection (Task 20.7)
  // **Validates: Requirements 14.1, 14.2**
  // -----------------------------------------------------------------------
  describe('Property 30: Trend Cluster Detection', () => {
    test('detectTrends returns trends with frequency, growthRate, and affectedUsers', async () => {
      await fc.assert(
        fc.asyncProperty(
          timeRangeArb,
          fc.array(
            fc.record({
              ticketId: fc.uuid(),
              userId: fc.uuid(),
              category: categoryArb,
              createdAt: fc.constant(''), // will be overridden
              tags: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }),
            }),
            { minLength: 1, maxLength: 15 },
          ),
          async (timeRange, ticketTemplates) => {
            jest.clearAllMocks();
            mockedPutItem.mockResolvedValue(undefined);

            // Assign createdAt within the time range
            const tickets = ticketTemplates.map((t, i) => {
              const fraction = i / Math.max(ticketTemplates.length - 1, 1);
              const ts = new Date(
                timeRange.start.getTime() +
                  fraction * (timeRange.end.getTime() - timeRange.start.getTime()),
              );
              return { ...t, createdAt: ts.toISOString() };
            });

            mockedScanItems.mockResolvedValue(tickets);

            const trends = await detectTrends(timeRange);

            // Each unique category should produce a trend
            const categories = new Set(tickets.map((t) => t.category));
            expect(trends.length).toBe(categories.size);

            for (const trend of trends) {
              expect(typeof trend.frequency).toBe('number');
              expect(trend.frequency).toBeGreaterThanOrEqual(1);
              expect(typeof trend.growthRate).toBe('number');
              expect(typeof trend.affectedUsers).toBe('number');
              expect(trend.affectedUsers).toBeGreaterThanOrEqual(0);
              expect(trend.trendId).toBeDefined();
              expect(trend.issueDescription).toBeDefined();
              expect(trend.affectedProducts.length).toBeGreaterThanOrEqual(1);
              expect(['low', 'medium', 'high']).toContain(trend.severity);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 31: Trend Alert Threshold (Task 20.8)
  // **Validates: Requirements 14.3**
  // -----------------------------------------------------------------------
  describe('Property 31: Trend Alert Threshold', () => {
    test('alerts are generated if and only if affectedUsers > 10', () => {
      fc.assert(
        fc.property(
          fc.array(trendArb, { minLength: 0, maxLength: 20 }),
          (trends) => {
            const alerts = generateTrendAlerts(trends);

            // Every alert must come from a trend with affectedUsers > 10
            for (const alert of alerts) {
              expect(alert.affectedUsers).toBeGreaterThan(10);
            }

            // Every trend with affectedUsers > 10 must produce an alert
            const alertableCount = trends.filter((t) => t.affectedUsers > 10).length;
            expect(alerts.length).toBe(alertableCount);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 32: Trend Report Completeness (Task 20.9)
  // **Validates: Requirements 14.4**
  // -----------------------------------------------------------------------
  describe('Property 32: Trend Report Completeness', () => {
    test('generateTrendAlerts output includes description and recommendedActions', () => {
      fc.assert(
        fc.property(
          fc.array(
            trendArb.filter((t) => t.affectedUsers > 10),
            { minLength: 1, maxLength: 10 },
          ),
          (trends) => {
            const alerts = generateTrendAlerts(trends);

            for (const alert of alerts) {
              expect(alert.description).toBeDefined();
              expect(alert.description.length).toBeGreaterThan(0);
              expect(Array.isArray(alert.recommendedActions)).toBe(true);
              expect(alert.recommendedActions.length).toBeGreaterThan(0);
              expect(alert.affectedUsers).toBeGreaterThan(10);
              expect(alert.alertId).toBeDefined();
              expect(alert.createdAt).toBeInstanceOf(Date);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test('each Trend from detectTrends has all required fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          timeRangeArb,
          fc.array(
            fc.record({
              ticketId: fc.uuid(),
              userId: fc.uuid(),
              category: categoryArb,
              createdAt: fc.constant(''),
              tags: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
            }),
            { minLength: 1, maxLength: 10 },
          ),
          async (timeRange, ticketTemplates) => {
            jest.clearAllMocks();
            mockedPutItem.mockResolvedValue(undefined);

            const tickets = ticketTemplates.map((t, i) => {
              const fraction = i / Math.max(ticketTemplates.length - 1, 1);
              const ts = new Date(
                timeRange.start.getTime() +
                  fraction * (timeRange.end.getTime() - timeRange.start.getTime()),
              );
              return { ...t, createdAt: ts.toISOString() };
            });
            mockedScanItems.mockResolvedValue(tickets);

            const trends = await detectTrends(timeRange);

            for (const trend of trends) {
              // Required fields per Requirement 14.4
              expect(trend.affectedProducts).toBeDefined();
              expect(trend.affectedProducts.length).toBeGreaterThanOrEqual(1);
              expect(trend.firstDetected).toBeDefined();
              expect(['low', 'medium', 'high']).toContain(trend.severity);
              expect(typeof trend.affectedUsers).toBe('number');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 36: Spike Detection Threshold (Task 20.10)
  // **Validates: Requirements 16.2**
  // -----------------------------------------------------------------------
  describe('Property 36: Spike Detection Threshold', () => {
    test('detectSpikes returns true iff currentCount >= sevenDayAverage * 1.5', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.double({ min: 0, max: 10000, noNaN: true }),
          fc.double({ min: 0.01, max: 10000, noNaN: true }),
          (category, currentCount, sevenDayAverage) => {
            const result = detectSpikes(category, currentCount, sevenDayAverage);
            const expected = currentCount >= sevenDayAverage * 1.5;
            expect(result).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('detectSpikes returns false when sevenDayAverage <= 0', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.double({ min: 0, max: 10000, noNaN: true }),
          fc.double({ min: -1000, max: 0, noNaN: true }),
          (category, currentCount, sevenDayAverage) => {
            const result = detectSpikes(category, currentCount, sevenDayAverage);
            expect(result).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 37: Alert Content Completeness (Task 20.11)
  // **Validates: Requirements 16.3**
  // -----------------------------------------------------------------------
  describe('Property 37: Alert Content Completeness', () => {
    test('generateSpikeAlert returns alert with all required fields', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }),
          fc.integer({ min: 1, max: 10000 }),
          fc.double({ min: 0.01, max: 10000, noNaN: true }),
          fc.integer({ min: 0, max: 10000 }),
          (category, currentCount, sevenDayAverage, affectedUsers) => {
            const alert = generateSpikeAlert(category, currentCount, sevenDayAverage, affectedUsers);

            expect(alert.alertId).toBeDefined();
            expect(typeof alert.alertId).toBe('string');
            expect(alert.alertId.length).toBeGreaterThan(0);

            expect(alert.type).toBe('spike');

            expect(alert.description).toBeDefined();
            expect(alert.description.length).toBeGreaterThan(0);

            expect(alert.affectedUsers).toBe(affectedUsers);

            expect(Array.isArray(alert.recommendedActions)).toBe(true);
            expect(alert.recommendedActions.length).toBeGreaterThan(0);

            expect(alert.createdAt).toBeInstanceOf(Date);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Property 38: Critical Service Alert Escalation (Task 20.12)
  // **Validates: Requirements 16.4**
  // -----------------------------------------------------------------------
  describe('Property 38: Critical Service Alert Escalation', () => {
    test('escalates when alert description contains a critical service name (case-insensitive)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 10000 }),
          fc.double({ min: 0.01, max: 10000, noNaN: true }),
          fc.integer({ min: 0, max: 10000 }),
          (service, currentCount, sevenDayAverage, affectedUsers) => {
            // Generate an alert whose description will contain the service name
            // (generateSpikeAlert puts the category in the description)
            const alert = generateSpikeAlert(service, currentCount, sevenDayAverage, affectedUsers);
            const criticalServices = [service];

            const result = escalateCriticalAlert(alert, criticalServices);

            expect(result).not.toBeNull();
            expect(result!.escalatedTo).toBe('on-call-engineers');
            expect(result!.matchedService).toBe(service);
            expect(result!.alert).toBe(alert);
          },
        ),
        { numRuns: 100 },
      );
    });

    test('returns null when no critical service matches', () => {
      fc.assert(
        fc.property(
          alertArb,
          fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
          (alert, criticalServices) => {
            // Use UUIDs as critical service names — they won't appear in the alert description
            const result = escalateCriticalAlert(alert, criticalServices);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
