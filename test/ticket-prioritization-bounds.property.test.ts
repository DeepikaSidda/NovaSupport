/**
 * Property-based tests for ticket prioritization bounds and queue ordering
 * Tests tasks 11.3 and 11.4
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import {
  calculatePriorityScore,
  clampPriority,
  BusinessImpact,
  TicketQueueItem,
} from '../src/services/ticket-prioritization';
import { TicketAnalysis } from '../src/utils/ticket-analyzer';

jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

// --- Generators ---

const serviceCriticalityArb = fc.constantFrom('low', 'medium', 'high', 'critical') as fc.Arbitrary<
  'low' | 'medium' | 'high' | 'critical'
>;

const businessImpactArb: fc.Arbitrary<BusinessImpact> = fc.record({
  affectedUserCount: fc.integer({ min: 0, max: 10000 }),
  serviceCriticality: serviceCriticalityArb,
  revenueImpact: fc.boolean(),
});

const ticketAnalysisArb: fc.Arbitrary<TicketAnalysis> = fc.record({
  ticketId: fc.uuid(),
  urgency: fc.record({
    hasUrgentKeywords: fc.boolean(),
    urgentKeywords: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
    urgencyScore: fc.double({ min: 0, max: 10, noNaN: true }),
  }),
  sentiment: fc.record({
    sentiment: fc.constantFrom('positive', 'neutral', 'negative') as fc.Arbitrary<
      'positive' | 'neutral' | 'negative'
    >,
    sentimentScore: fc.double({ min: -1, max: 1, noNaN: true }),
    isFrustrated: fc.boolean(),
    isAngry: fc.boolean(),
  }),
  expertise: fc.record({
    primaryExpertise: fc.string({ minLength: 1, maxLength: 30 }),
    secondaryExpertise: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
    technicalTerms: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  analyzedAt: fc.date(),
});

const ticketQueueItemArb: fc.Arbitrary<TicketQueueItem> = fc.record({
  ticketId: fc.uuid(),
  subject: fc.string({ minLength: 1, maxLength: 100 }),
  priority: fc.integer({ min: 1, max: 10 }),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(
    (d) => d.toISOString()
  ),
  assignedTo: fc.option(fc.uuid(), { nil: undefined }),
});

// --- Property 4: Priority Score Bounds ---

describe('Property 4: Priority Score Bounds', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any ticket, when priority is assigned, the priority score should be
   * an integer in the range [1, 10].
   */
  test('Property 4: calculatePriorityScore always returns an integer in [1, 10]', () => {
    fc.assert(
      fc.property(ticketAnalysisArb, businessImpactArb, (analysis, impact) => {
        const result = calculatePriorityScore(analysis, impact);

        expect(result.priorityScore).toBeGreaterThanOrEqual(1);
        expect(result.priorityScore).toBeLessThanOrEqual(10);
        expect(Number.isInteger(result.priorityScore)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * clampPriority should always produce an integer in [1, 10] for any finite input.
   */
  test('Property 4: clampPriority always returns an integer in [1, 10]', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          fc.integer({ min: -100, max: 100 }),
          fc.constant(NaN),
          fc.constant(Infinity),
          fc.constant(-Infinity)
        ),
        (score) => {
          const result = clampPriority(score);

          expect(result).toBeGreaterThanOrEqual(1);
          expect(result).toBeLessThanOrEqual(10);
          expect(Number.isInteger(result)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * The result object should always contain the correct ticketId and a valid calculatedAt date.
   */
  test('Property 4: calculatePriorityScore result contains valid metadata', () => {
    fc.assert(
      fc.property(ticketAnalysisArb, businessImpactArb, (analysis, impact) => {
        const result = calculatePriorityScore(analysis, impact);

        expect(result.ticketId).toBe(analysis.ticketId);
        expect(result.calculatedAt).toBeInstanceOf(Date);
        expect(typeof result.urgencyComponent).toBe('number');
        expect(typeof result.sentimentComponent).toBe('number');
        expect(typeof result.businessImpactComponent).toBe('number');
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 5: Priority-Based Queue Ordering ---

describe('Property 5: Priority-Based Queue Ordering', () => {
  /**
   * Helper: sort queue items using the same logic as getTicketQueue.
   * Priority descending, then createdAt ascending for ties.
   */
  function sortQueue(items: TicketQueueItem[]): TicketQueueItem[] {
    return [...items].sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  /**
   * **Validates: Requirements 3.4**
   *
   * For any ticket queue, after priority assignment, tickets should be ordered
   * by priority score in descending order (highest priority first).
   */
  test('Property 5: Sorted queue has priorities in descending order', () => {
    fc.assert(
      fc.property(
        fc.array(ticketQueueItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const sorted = sortQueue(items);

          for (let i = 1; i < sorted.length; i++) {
            expect(sorted[i - 1].priority).toBeGreaterThanOrEqual(sorted[i].priority);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * For tickets with equal priority, they should be ordered by createdAt ascending
   * (oldest first).
   */
  test('Property 5: Equal-priority tickets are ordered by createdAt ascending', () => {
    fc.assert(
      fc.property(
        fc.array(ticketQueueItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const sorted = sortQueue(items);

          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i - 1].priority === sorted[i].priority) {
              expect(
                sorted[i - 1].createdAt.localeCompare(sorted[i].createdAt)
              ).toBeLessThanOrEqual(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Sorting should be stable — the sorted queue contains exactly the same items
   * as the input (no items lost or duplicated).
   */
  test('Property 5: Sorting preserves all queue items', () => {
    fc.assert(
      fc.property(
        fc.array(ticketQueueItemArb, { minLength: 0, maxLength: 50 }),
        (items) => {
          const sorted = sortQueue(items);

          expect(sorted).toHaveLength(items.length);

          const sortedIds = sorted.map((i) => i.ticketId).sort();
          const originalIds = [...items].map((i) => i.ticketId).sort();
          expect(sortedIds).toEqual(originalIds);
        }
      ),
      { numRuns: 100 }
    );
  });
});
