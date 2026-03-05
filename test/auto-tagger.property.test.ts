/**
 * Property-based tests for Auto-Tagging and Categorization Service
 * Tests tasks 10.2, 10.3, 10.4
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 * Property 19: Tag Taxonomy Compliance
 * Property 20: Tag Confidence Scoring
 * Property 21: Multi-Label Tag Assignment
 */

import * as fc from 'fast-check';
import {
  fallbackTagging,
  ALL_TAXONOMY_TAGS,
  TAXONOMY,
  TaggingResult,
} from '../src/services/auto-tagger';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';

// Mock logger to avoid noise in test output
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Keywords from each taxonomy category for building realistic ticket descriptions */
const PRODUCT_WORDS = [
  'login', 'password', 'auth', 'payment', 'invoice', 'billing',
  'database', 'query', 'sql', 'network', 'timeout', 'dns',
  'button', 'page', 'display', 'api', 'endpoint', 'rest',
  's3', 'bucket', 'upload', 'lambda', 'ec2', 'container',
  'cloudwatch', 'alarm', 'metric',
];

const ISSUE_TYPE_WORDS = [
  'bug', 'error', 'broken', 'crash', 'fail',
  'feature', 'request', 'enhancement',
  'how to', 'question', 'help',
  'slow', 'performance', 'latency',
  'security', 'vulnerability', 'breach',
  'config', 'configuration', 'setting',
  'documentation', 'docs', 'readme',
];

const SEVERITY_WORDS = [
  'critical', 'emergency', 'outage', 'down',
  'urgent', 'asap', 'important',
  'moderate', 'medium',
  'low', 'minor', 'cosmetic',
];

const ALL_KEYWORDS = [...PRODUCT_WORDS, ...ISSUE_TYPE_WORDS, ...SEVERITY_WORDS];

/** Generate a ticket description that contains 1-6 random keywords from the taxonomy */
const keywordDescriptionArb = fc
  .shuffledSubarray(ALL_KEYWORDS, { minLength: 1, maxLength: 6 })
  .map((words) => words.join(' '));

/** Generate a ticket with a keyword-rich description */
const ticketWithKeywordsArb = fc
  .record({
    id: fc.uuid(),
    subject: keywordDescriptionArb,
    description: keywordDescriptionArb,
  })
  .map(
    ({ id, subject, description }): Ticket => ({
      id,
      userId: 'user-test',
      subject,
      description,
      status: TicketStatus.NEW,
      priority: Priority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    })
  );

/** Generate a ticket with a completely random (non-keyword) description */
const randomTicketArb = fc
  .record({
    id: fc.uuid(),
    subject: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ minLength: 1, maxLength: 200 }),
  })
  .map(
    ({ id, subject, description }): Ticket => ({
      id,
      userId: 'user-test',
      subject,
      description,
      status: TicketStatus.NEW,
      priority: Priority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    })
  );

/**
 * Generate a ticket whose description contains keywords from at least 2
 * different taxonomy categories (product + issueType at minimum).
 */
const multiCategoryTicketArb = fc
  .record({
    id: fc.uuid(),
    productWord: fc.constantFrom(...PRODUCT_WORDS),
    issueWord: fc.constantFrom(...ISSUE_TYPE_WORDS),
    extraWords: fc.shuffledSubarray(ALL_KEYWORDS, { minLength: 0, maxLength: 3 }),
  })
  .map(
    ({ id, productWord, issueWord, extraWords }): Ticket => {
      const description = [productWord, issueWord, ...extraWords].join(' ');
      return {
        id,
        userId: 'user-test',
        subject: description,
        description,
        status: TicketStatus.NEW,
        priority: Priority.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        attachments: [],
      };
    }
  );

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property-Based Tests: Auto-Tagging', () => {
  /**
   * Property 19: Tag Taxonomy Compliance
   * **Validates: Requirements 10.2**
   *
   * For any ticket, when auto-tagging is applied, all assigned tags should
   * exist in the predefined taxonomy (product, issue type, severity categories).
   * Custom tags (category = 'custom') are allowed and excluded from this check.
   */
  test('Property 19: All non-custom tags exist in the predefined taxonomy', () => {
    fc.assert(
      fc.property(
        fc.oneof(ticketWithKeywordsArb, randomTicketArb),
        (ticket) => {
          const result: TaggingResult = fallbackTagging(ticket);

          for (const tagResult of result.tags) {
            if (tagResult.category !== 'custom') {
              expect(ALL_TAXONOMY_TAGS.has(tagResult.tag)).toBe(true);
            }
          }

          // Additionally verify that the category assignment is correct:
          // a tag in category 'product' must be in TAXONOMY.product, etc.
          for (const tagResult of result.tags) {
            if (tagResult.category === 'product') {
              expect((TAXONOMY.product as readonly string[]).includes(tagResult.tag)).toBe(true);
            } else if (tagResult.category === 'issueType') {
              expect((TAXONOMY.issueType as readonly string[]).includes(tagResult.tag)).toBe(true);
            } else if (tagResult.category === 'severity') {
              expect((TAXONOMY.severity as readonly string[]).includes(tagResult.tag)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 20: Tag Confidence Scoring
   * **Validates: Requirements 10.4**
   *
   * For any assigned tag on a ticket, the tag should have an associated
   * confidence score in the range [0, 1].
   */
  test('Property 20: All tag confidence scores are in [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.oneof(ticketWithKeywordsArb, randomTicketArb),
        (ticket) => {
          const result: TaggingResult = fallbackTagging(ticket);

          // Must have at least one tag (fallback always assigns defaults)
          expect(result.tags.length).toBeGreaterThan(0);

          for (const tagResult of result.tags) {
            expect(typeof tagResult.confidence).toBe('number');
            expect(tagResult.confidence).toBeGreaterThanOrEqual(0);
            expect(tagResult.confidence).toBeLessThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 21: Multi-Label Tag Assignment
   * **Validates: Requirements 10.3**
   *
   * For any ticket where multiple categories are relevant, the system should
   * assign all relevant tags (not limited to a single tag).
   */
  test('Property 21: Tickets with multi-category keywords get tags from multiple categories', () => {
    fc.assert(
      fc.property(
        multiCategoryTicketArb,
        (ticket) => {
          const result: TaggingResult = fallbackTagging(ticket);

          // Should have more than one tag
          expect(result.tags.length).toBeGreaterThan(1);

          // Should span at least 2 distinct categories
          const categories = new Set(result.tags.map((t) => t.category));
          expect(categories.size).toBeGreaterThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
