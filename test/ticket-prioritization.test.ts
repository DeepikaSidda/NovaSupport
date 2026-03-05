/**
 * Unit tests for ticket prioritization service
 * Tests priority calculation with various urgency/sentiment combinations,
 * negative sentiment increasing priority, priority bounds [1, 10],
 * and DynamoDB update calls.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5
 */

import {
  calculatePriorityScore,
  calculateSentimentComponent,
  calculateBusinessImpactComponent,
  clampPriority,
  updateTicketPriority,
  prioritizeTicket,
  defaultBusinessImpact,
  getTicketQueue,
  reorderQueue,
  BusinessImpact,
  PriorityResult,
  TicketQueueItem,
} from '../src/services/ticket-prioritization';
import { TicketAnalysis, UrgencyIndicators, SentimentAnalysis, ExpertiseRequirements } from '../src/utils/ticket-analyzer';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as dynamodbClient from '../src/utils/dynamodb-client';

jest.mock('../src/utils/dynamodb-client');

describe('Ticket Prioritization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to build a TicketAnalysis
  function makeAnalysis(overrides: {
    urgencyScore?: number;
    sentiment?: 'positive' | 'neutral' | 'negative';
    sentimentScore?: number;
    isFrustrated?: boolean;
    isAngry?: boolean;
  } = {}): TicketAnalysis {
    return {
      ticketId: 'TKT-test-123',
      urgency: {
        hasUrgentKeywords: (overrides.urgencyScore ?? 5) > 5,
        urgentKeywords: [],
        urgencyScore: overrides.urgencyScore ?? 5,
      },
      sentiment: {
        sentiment: overrides.sentiment ?? 'neutral',
        sentimentScore: overrides.sentimentScore ?? 0,
        isFrustrated: overrides.isFrustrated ?? false,
        isAngry: overrides.isAngry ?? false,
      },
      expertise: {
        primaryExpertise: 'general',
        secondaryExpertise: [],
        technicalTerms: [],
        confidence: 0.8,
      },
      analyzedAt: new Date(),
    };
  }

  function makeImpact(overrides: Partial<BusinessImpact> = {}): BusinessImpact {
    return {
      affectedUserCount: overrides.affectedUserCount ?? 1,
      serviceCriticality: overrides.serviceCriticality ?? 'medium',
      revenueImpact: overrides.revenueImpact ?? false,
    };
  }

  function makeMockTicket(): Ticket {
    return {
      id: 'TKT-test-123',
      userId: 'user-456',
      subject: 'Test ticket',
      description: 'Test description',
      status: TicketStatus.NEW,
      priority: Priority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    };
  }

  describe('calculatePriorityScore', () => {
    it('should return priority score in range [1, 10]', () => {
      const analysis = makeAnalysis({ urgencyScore: 5, sentimentScore: 0 });
      const impact = makeImpact();
      const result = calculatePriorityScore(analysis, impact);

      expect(result.priorityScore).toBeGreaterThanOrEqual(1);
      expect(result.priorityScore).toBeLessThanOrEqual(10);
      expect(Number.isInteger(result.priorityScore)).toBe(true);
    });

    it('should return high priority for high urgency + negative sentiment + critical impact', () => {
      const analysis = makeAnalysis({
        urgencyScore: 10,
        sentiment: 'negative',
        sentimentScore: -1,
        isFrustrated: true,
        isAngry: true,
      });
      const impact = makeImpact({
        affectedUserCount: 100,
        serviceCriticality: 'critical',
        revenueImpact: true,
      });
      const result = calculatePriorityScore(analysis, impact);

      expect(result.priorityScore).toBeGreaterThanOrEqual(8);
    });

    it('should return low priority for low urgency + positive sentiment + low impact', () => {
      const analysis = makeAnalysis({
        urgencyScore: 0,
        sentiment: 'positive',
        sentimentScore: 1,
      });
      const impact = makeImpact({
        affectedUserCount: 1,
        serviceCriticality: 'low',
        revenueImpact: false,
      });
      const result = calculatePriorityScore(analysis, impact);

      expect(result.priorityScore).toBeLessThanOrEqual(3);
    });

    it('should return medium priority for neutral inputs', () => {
      const analysis = makeAnalysis({ urgencyScore: 5, sentimentScore: 0 });
      const impact = makeImpact({ serviceCriticality: 'medium', affectedUserCount: 5 });
      const result = calculatePriorityScore(analysis, impact);

      expect(result.priorityScore).toBeGreaterThanOrEqual(3);
      expect(result.priorityScore).toBeLessThanOrEqual(7);
    });

    it('should include all components in the result', () => {
      const analysis = makeAnalysis();
      const impact = makeImpact();
      const result = calculatePriorityScore(analysis, impact);

      expect(result).toHaveProperty('ticketId', 'TKT-test-123');
      expect(result).toHaveProperty('priorityScore');
      expect(result).toHaveProperty('urgencyComponent');
      expect(result).toHaveProperty('sentimentComponent');
      expect(result).toHaveProperty('businessImpactComponent');
      expect(result).toHaveProperty('calculatedAt');
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('should always produce an integer priority score', () => {
      const analysis = makeAnalysis({ urgencyScore: 3, sentimentScore: -0.3 });
      const impact = makeImpact({ affectedUserCount: 7, serviceCriticality: 'high' });
      const result = calculatePriorityScore(analysis, impact);

      expect(Number.isInteger(result.priorityScore)).toBe(true);
    });
  });

  describe('Negative sentiment increases priority (Requirement 3.2)', () => {
    it('should assign higher priority to negative sentiment than positive sentiment', () => {
      const impact = makeImpact();

      const negativeAnalysis = makeAnalysis({
        urgencyScore: 5,
        sentiment: 'negative',
        sentimentScore: -0.8,
      });
      const positiveAnalysis = makeAnalysis({
        urgencyScore: 5,
        sentiment: 'positive',
        sentimentScore: 0.8,
      });

      const negativeResult = calculatePriorityScore(negativeAnalysis, impact);
      const positiveResult = calculatePriorityScore(positiveAnalysis, impact);

      expect(negativeResult.priorityScore).toBeGreaterThanOrEqual(positiveResult.priorityScore);
    });

    it('should assign higher priority to frustrated customers', () => {
      const impact = makeImpact();

      const frustratedAnalysis = makeAnalysis({
        urgencyScore: 5,
        sentiment: 'negative',
        sentimentScore: -0.5,
        isFrustrated: true,
      });
      const calmAnalysis = makeAnalysis({
        urgencyScore: 5,
        sentiment: 'negative',
        sentimentScore: -0.5,
        isFrustrated: false,
      });

      const frustratedResult = calculatePriorityScore(frustratedAnalysis, impact);
      const calmResult = calculatePriorityScore(calmAnalysis, impact);

      expect(frustratedResult.sentimentComponent).toBeGreaterThan(calmResult.sentimentComponent);
    });

    it('should assign higher priority to angry customers', () => {
      const impact = makeImpact();

      const angryAnalysis = makeAnalysis({
        urgencyScore: 5,
        sentiment: 'negative',
        sentimentScore: -0.5,
        isAngry: true,
      });
      const calmAnalysis = makeAnalysis({
        urgencyScore: 5,
        sentiment: 'negative',
        sentimentScore: -0.5,
        isAngry: false,
      });

      const angryResult = calculatePriorityScore(angryAnalysis, impact);
      const calmResult = calculatePriorityScore(calmAnalysis, impact);

      expect(angryResult.sentimentComponent).toBeGreaterThan(calmResult.sentimentComponent);
    });
  });

  describe('calculateSentimentComponent', () => {
    it('should return higher value for negative sentiment', () => {
      const negative = makeAnalysis({ sentimentScore: -1 });
      const positive = makeAnalysis({ sentimentScore: 1 });

      expect(calculateSentimentComponent(negative)).toBeGreaterThan(
        calculateSentimentComponent(positive)
      );
    });

    it('should return ~0.5 for neutral sentiment', () => {
      const neutral = makeAnalysis({ sentimentScore: 0 });
      const component = calculateSentimentComponent(neutral);

      expect(component).toBeCloseTo(0.5, 1);
    });

    it('should return value in [0, 1]', () => {
      const analysis = makeAnalysis({ sentimentScore: -1, isFrustrated: true, isAngry: true });
      const component = calculateSentimentComponent(analysis);

      expect(component).toBeGreaterThanOrEqual(0);
      expect(component).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateBusinessImpactComponent', () => {
    it('should return higher value for critical services', () => {
      const critical = makeImpact({ serviceCriticality: 'critical' });
      const low = makeImpact({ serviceCriticality: 'low' });

      expect(calculateBusinessImpactComponent(critical)).toBeGreaterThan(
        calculateBusinessImpactComponent(low)
      );
    });

    it('should return higher value for more affected users', () => {
      const many = makeImpact({ affectedUserCount: 100 });
      const few = makeImpact({ affectedUserCount: 1 });

      expect(calculateBusinessImpactComponent(many)).toBeGreaterThan(
        calculateBusinessImpactComponent(few)
      );
    });

    it('should return higher value when revenue is impacted', () => {
      const withRevenue = makeImpact({ revenueImpact: true });
      const withoutRevenue = makeImpact({ revenueImpact: false });

      expect(calculateBusinessImpactComponent(withRevenue)).toBeGreaterThan(
        calculateBusinessImpactComponent(withoutRevenue)
      );
    });

    it('should return 0 for zero affected users', () => {
      const impact = makeImpact({ affectedUserCount: 0, serviceCriticality: 'low', revenueImpact: false });
      const component = calculateBusinessImpactComponent(impact);

      expect(component).toBeGreaterThanOrEqual(0);
      expect(component).toBeLessThanOrEqual(1);
    });

    it('should return value in [0, 1]', () => {
      const impact = makeImpact({
        affectedUserCount: 10000,
        serviceCriticality: 'critical',
        revenueImpact: true,
      });
      const component = calculateBusinessImpactComponent(impact);

      expect(component).toBeGreaterThanOrEqual(0);
      expect(component).toBeLessThanOrEqual(1);
    });
  });

  describe('clampPriority', () => {
    it('should clamp values below 1 to 1', () => {
      expect(clampPriority(0)).toBe(1);
      expect(clampPriority(-5)).toBe(1);
    });

    it('should clamp values above 10 to 10', () => {
      expect(clampPriority(11)).toBe(10);
      expect(clampPriority(100)).toBe(10);
    });

    it('should round to nearest integer', () => {
      expect(clampPriority(5.4)).toBe(5);
      expect(clampPriority(5.6)).toBe(6);
    });

    it('should return 5 for NaN', () => {
      expect(clampPriority(NaN)).toBe(5);
    });

    it('should return 5 for Infinity', () => {
      expect(clampPriority(Infinity)).toBe(5);
      expect(clampPriority(-Infinity)).toBe(5);
    });

    it('should pass through valid integers unchanged', () => {
      expect(clampPriority(1)).toBe(1);
      expect(clampPriority(5)).toBe(5);
      expect(clampPriority(10)).toBe(10);
    });
  });

  describe('updateTicketPriority', () => {
    it('should call updateItem with correct parameters', async () => {
      const mockUpdateItem = jest.mocked(dynamodbClient.updateItem).mockResolvedValue(undefined);

      const result: PriorityResult = {
        ticketId: 'TKT-test-123',
        priorityScore: 8,
        urgencyComponent: 0.9,
        sentimentComponent: 0.7,
        businessImpactComponent: 0.6,
        calculatedAt: new Date(),
      };

      await updateTicketPriority('TKT-test-123', result);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'TICKET#TKT-test-123',
        'METADATA',
        expect.stringContaining('SET priority = :priority'),
        expect.objectContaining({
          ':priority': 8,
        })
      );
    });

    it('should propagate DynamoDB errors', async () => {
      jest.mocked(dynamodbClient.updateItem).mockRejectedValue(new Error('DynamoDB error'));

      const result: PriorityResult = {
        ticketId: 'TKT-test-123',
        priorityScore: 5,
        urgencyComponent: 0.5,
        sentimentComponent: 0.5,
        businessImpactComponent: 0.5,
        calculatedAt: new Date(),
      };

      await expect(updateTicketPriority('TKT-test-123', result)).rejects.toThrow('DynamoDB error');
    });
  });

  describe('prioritizeTicket (full flow)', () => {
    it('should calculate priority and update DynamoDB', async () => {
      jest.mocked(dynamodbClient.updateItem).mockResolvedValue(undefined);

      const ticket = makeMockTicket();
      const analysis = makeAnalysis({ urgencyScore: 7, sentimentScore: -0.5 });
      const impact = makeImpact({ serviceCriticality: 'high', affectedUserCount: 10 });

      const result = await prioritizeTicket(ticket, analysis, impact);

      expect(result.priorityScore).toBeGreaterThanOrEqual(1);
      expect(result.priorityScore).toBeLessThanOrEqual(10);
      expect(dynamodbClient.updateItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('defaultBusinessImpact', () => {
    it('should return sensible defaults', () => {
      const impact = defaultBusinessImpact();

      expect(impact.affectedUserCount).toBe(1);
      expect(impact.serviceCriticality).toBe('medium');
      expect(impact.revenueImpact).toBe(false);
    });
  });

  describe('getTicketQueue (Requirement 3.4)', () => {
    it('should return tickets sorted by priority descending', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([
        { ticketId: 'TKT-1', subject: 'Low', priority: 2, createdAt: '2024-01-01T00:00:00Z' },
        { ticketId: 'TKT-2', subject: 'High', priority: 9, createdAt: '2024-01-01T01:00:00Z' },
        { ticketId: 'TKT-3', subject: 'Medium', priority: 5, createdAt: '2024-01-01T02:00:00Z' },
      ]);

      const queue = await getTicketQueue(TicketStatus.NEW);

      expect(queue).toHaveLength(3);
      expect(queue[0].priority).toBe(9);
      expect(queue[1].priority).toBe(5);
      expect(queue[2].priority).toBe(2);
    });

    it('should sort by createdAt ascending for equal priority', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([
        { ticketId: 'TKT-B', subject: 'Later', priority: 5, createdAt: '2024-01-02T00:00:00Z' },
        { ticketId: 'TKT-A', subject: 'Earlier', priority: 5, createdAt: '2024-01-01T00:00:00Z' },
      ]);

      const queue = await getTicketQueue(TicketStatus.NEW);

      expect(queue).toHaveLength(2);
      expect(queue[0].ticketId).toBe('TKT-A');
      expect(queue[1].ticketId).toBe('TKT-B');
    });

    it('should query GSI2 with correct status key', async () => {
      const mockQuery = jest.mocked(dynamodbClient.queryItems).mockResolvedValue([]);

      await getTicketQueue(TicketStatus.IN_PROGRESS);

      expect(mockQuery).toHaveBeenCalledWith(
        'GSI2PK = :statusKey',
        { ':statusKey': 'STATUS#in_progress' },
        'GSI2'
      );
    });

    it('should return empty array when no tickets match the status', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([]);

      const queue = await getTicketQueue(TicketStatus.RESOLVED);

      expect(queue).toEqual([]);
    });

    it('should include assignedTo when present', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([
        { ticketId: 'TKT-1', subject: 'Test', priority: 5, createdAt: '2024-01-01T00:00:00Z', assignedTo: 'agent-1' },
      ]);

      const queue = await getTicketQueue(TicketStatus.ASSIGNED);

      expect(queue[0].assignedTo).toBe('agent-1');
    });

    it('should map all TicketQueueItem fields correctly', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([
        { ticketId: 'TKT-42', subject: 'Login broken', priority: 8, createdAt: '2024-03-15T10:30:00Z', assignedTo: 'team-auth' },
      ]);

      const queue = await getTicketQueue(TicketStatus.NEW);

      expect(queue).toHaveLength(1);
      expect(queue[0]).toEqual({
        ticketId: 'TKT-42',
        subject: 'Login broken',
        priority: 8,
        createdAt: '2024-03-15T10:30:00Z',
        assignedTo: 'team-auth',
      });
    });
  });

  describe('reorderQueue (Requirement 3.4)', () => {
    it('should return the same result as getTicketQueue', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([
        { ticketId: 'TKT-1', subject: 'A', priority: 10, createdAt: '2024-01-01T00:00:00Z' },
        { ticketId: 'TKT-2', subject: 'B', priority: 3, createdAt: '2024-01-01T01:00:00Z' },
      ]);

      const queue = await reorderQueue(TicketStatus.NEW);

      expect(queue).toHaveLength(2);
      expect(queue[0].priority).toBe(10);
      expect(queue[1].priority).toBe(3);
    });

    it('should handle empty queue', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([]);

      const queue = await reorderQueue(TicketStatus.CLOSED);

      expect(queue).toEqual([]);
    });
  });
});
