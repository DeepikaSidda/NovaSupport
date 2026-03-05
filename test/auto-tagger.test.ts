/**
 * Unit tests for Auto-Tagging and Categorization Service
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import {
  tagTicket,
  updateTicketTags,
  fallbackTagging,
  TAXONOMY,
  ALL_TAXONOMY_TAGS,
  TaggingResult,
} from '../src/services/auto-tagger';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as novaClient from '../src/utils/nova-client';
import * as dynamodbClient from '../src/utils/dynamodb-client';

jest.mock('../src/utils/nova-client');
jest.mock('../src/utils/dynamodb-client');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTicket(subject: string, description: string): Ticket {
  return {
    id: 'ticket-001',
    userId: 'user-123',
    subject,
    description,
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
  };
}

function novaTagResponse(tags: Array<{ tag: string; category: string; confidence: number }>) {
  return { text: JSON.stringify({ tags }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Auto-Tagger Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Tagging with mocked Nova response
  // -----------------------------------------------------------------------
  describe('Nova-based tagging', () => {
    it('should classify a ticket using Nova 2 Lite and return tags', async () => {
      const ticket = createMockTicket(
        'Cannot login to dashboard',
        'Getting 401 errors when trying to access the admin dashboard.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'authentication', category: 'product', confidence: 0.92 },
          { tag: 'bug', category: 'issueType', confidence: 0.85 },
          { tag: 'high', category: 'severity', confidence: 0.78 },
        ])
      );

      const result = await tagTicket(ticket);

      expect(result.ticketId).toBe(ticket.id);
      expect(result.tags.length).toBe(3);
      expect(result.tags.map(t => t.tag)).toContain('authentication');
      expect(result.tags.map(t => t.tag)).toContain('bug');
      expect(result.tags.map(t => t.tag)).toContain('high');
      expect(result.taggedAt).toBeInstanceOf(Date);
    });

    it('should handle Nova response wrapped in markdown code blocks', async () => {
      const ticket = createMockTicket('Slow API', 'API response times are very high.');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: '```json\n{"tags":[{"tag":"api","category":"product","confidence":0.9},{"tag":"performance","category":"issueType","confidence":0.88}]}\n```',
      });

      const result = await tagTicket(ticket);

      expect(result.tags.length).toBe(2);
      expect(result.tags[0].tag).toBe('api');
    });
  });

  // -----------------------------------------------------------------------
  // 2. All tags from predefined taxonomy (Property 19)
  // -----------------------------------------------------------------------
  describe('Taxonomy compliance', () => {
    it('should only return tags that exist in the predefined taxonomy (when no custom tags)', async () => {
      const ticket = createMockTicket('Billing error', 'Double charged for subscription.');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'billing', category: 'product', confidence: 0.95 },
          { tag: 'bug', category: 'issueType', confidence: 0.88 },
          { tag: 'high', category: 'severity', confidence: 0.7 },
        ])
      );

      const result = await tagTicket(ticket);

      for (const t of result.tags) {
        if (t.category !== 'custom') {
          expect(ALL_TAXONOMY_TAGS.has(t.tag)).toBe(true);
        }
      }
    });

    it('should contain all expected product tags in taxonomy', () => {
      expect(TAXONOMY.product).toContain('authentication');
      expect(TAXONOMY.product).toContain('billing');
      expect(TAXONOMY.product).toContain('database');
      expect(TAXONOMY.product).toContain('networking');
      expect(TAXONOMY.product).toContain('ui');
      expect(TAXONOMY.product).toContain('api');
      expect(TAXONOMY.product).toContain('storage');
      expect(TAXONOMY.product).toContain('compute');
      expect(TAXONOMY.product).toContain('monitoring');
    });

    it('should contain all expected issue type tags in taxonomy', () => {
      expect(TAXONOMY.issueType).toContain('bug');
      expect(TAXONOMY.issueType).toContain('feature-request');
      expect(TAXONOMY.issueType).toContain('question');
      expect(TAXONOMY.issueType).toContain('performance');
      expect(TAXONOMY.issueType).toContain('security');
      expect(TAXONOMY.issueType).toContain('configuration');
      expect(TAXONOMY.issueType).toContain('documentation');
    });

    it('should contain all expected severity tags in taxonomy', () => {
      expect(TAXONOMY.severity).toContain('low');
      expect(TAXONOMY.severity).toContain('medium');
      expect(TAXONOMY.severity).toContain('high');
      expect(TAXONOMY.severity).toContain('critical');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Multiple tags assigned (Property 21)
  // -----------------------------------------------------------------------
  describe('Multi-label assignment', () => {
    it('should assign multiple tags across categories', async () => {
      const ticket = createMockTicket(
        'Database performance issue',
        'Queries are extremely slow and timing out on the billing service database.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'database', category: 'product', confidence: 0.9 },
          { tag: 'billing', category: 'product', confidence: 0.6 },
          { tag: 'performance', category: 'issueType', confidence: 0.92 },
          { tag: 'bug', category: 'issueType', confidence: 0.55 },
          { tag: 'high', category: 'severity', confidence: 0.8 },
        ])
      );

      const result = await tagTicket(ticket);

      expect(result.tags.length).toBeGreaterThan(1);

      const categories = new Set(result.tags.map(t => t.category));
      expect(categories.size).toBeGreaterThan(1);
    });

    it('should assign multiple product tags when relevant', async () => {
      const ticket = createMockTicket(
        'API and storage issue',
        'Cannot upload files through the API to S3 storage.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'api', category: 'product', confidence: 0.88 },
          { tag: 'storage', category: 'product', confidence: 0.85 },
          { tag: 'bug', category: 'issueType', confidence: 0.75 },
          { tag: 'medium', category: 'severity', confidence: 0.7 },
        ])
      );

      const result = await tagTicket(ticket);

      const productTags = result.tags.filter(t => t.category === 'product');
      expect(productTags.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Confidence scores in [0, 1] (Property 20)
  // -----------------------------------------------------------------------
  describe('Confidence scoring', () => {
    it('should have confidence scores in [0, 1] for all tags', async () => {
      const ticket = createMockTicket('Test ticket', 'Some description.');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'api', category: 'product', confidence: 0.9 },
          { tag: 'bug', category: 'issueType', confidence: 0.7 },
          { tag: 'medium', category: 'severity', confidence: 0.5 },
        ])
      );

      const result = await tagTicket(ticket);

      for (const t of result.tags) {
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should clamp confidence scores that exceed [0, 1]', async () => {
      const ticket = createMockTicket('Test', 'Test');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'api', category: 'product', confidence: 1.5 },
          { tag: 'bug', category: 'issueType', confidence: -0.3 },
        ])
      );

      const result = await tagTicket(ticket);

      expect(result.tags[0].confidence).toBeLessThanOrEqual(1);
      expect(result.tags[1].confidence).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Custom tag support (Requirement 10.5)
  // -----------------------------------------------------------------------
  describe('Custom tags', () => {
    it('should support custom tags not in the taxonomy', async () => {
      const ticket = createMockTicket(
        'Kubernetes pod crashing',
        'Our k8s pods keep restarting with OOMKilled errors.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue(
        novaTagResponse([
          { tag: 'compute', category: 'product', confidence: 0.8 },
          { tag: 'bug', category: 'issueType', confidence: 0.85 },
          { tag: 'kubernetes', category: 'custom', confidence: 0.9 },
          { tag: 'high', category: 'severity', confidence: 0.75 },
        ])
      );

      const result = await tagTicket(ticket);

      const customTags = result.tags.filter(t => t.category === 'custom');
      expect(customTags.length).toBeGreaterThanOrEqual(1);
      expect(customTags[0].tag).toBe('kubernetes');
      expect(customTags[0].confidence).toBeGreaterThanOrEqual(0);
      expect(customTags[0].confidence).toBeLessThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Fallback when Nova is unavailable
  // -----------------------------------------------------------------------
  describe('Fallback tagging', () => {
    it('should fall back to rule-based tagging when Nova is unavailable', async () => {
      const ticket = createMockTicket(
        'Login broken',
        'Cannot access my account. Getting error on the login page.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service unavailable')
      );

      const result = await tagTicket(ticket);

      expect(result.ticketId).toBe(ticket.id);
      expect(result.tags.length).toBeGreaterThan(0);

      // Should detect authentication product
      const productTags = result.tags.filter(t => t.category === 'product');
      expect(productTags.map(t => t.tag)).toContain('authentication');
    });

    it('should fall back when Nova returns unparseable response', async () => {
      const ticket = createMockTicket('Test', 'Some bug in the API.');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: 'This is not valid JSON at all',
      });

      const result = await tagTicket(ticket);

      // Should still return a valid result via fallback
      expect(result.ticketId).toBe(ticket.id);
      expect(result.tags.length).toBeGreaterThan(0);
    });

    it('should detect multiple categories in fallback mode', async () => {
      const ticket = createMockTicket(
        'Critical database performance bug',
        'Database queries are extremely slow. This is a critical production issue.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Throttled')
      );

      const result = await tagTicket(ticket);

      const categories = new Set(result.tags.map(t => t.category));
      expect(categories.size).toBeGreaterThan(1);
    });

    it('should assign default tags when no keywords match in fallback', async () => {
      const ticket = createMockTicket('Hello', 'I need some assistance please.');

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Unavailable')
      );

      const result = await tagTicket(ticket);

      expect(result.tags.length).toBeGreaterThan(0);
    });

    it('should have confidence scores in [0, 1] in fallback mode', async () => {
      const ticket = createMockTicket(
        'Urgent billing error',
        'I was charged twice for my subscription payment.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Down')
      );

      const result = await tagTicket(ticket);

      for (const t of result.tags) {
        expect(t.confidence).toBeGreaterThanOrEqual(0);
        expect(t.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should only produce taxonomy tags in fallback mode (no custom)', () => {
      const ticket = createMockTicket(
        'Network timeout',
        'Connection keeps timing out when accessing the API.'
      );

      const result = fallbackTagging(ticket);

      for (const t of result.tags) {
        expect(ALL_TAXONOMY_TAGS.has(t.tag)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 7. DynamoDB update
  // -----------------------------------------------------------------------
  describe('DynamoDB update', () => {
    it('should update ticket tags in DynamoDB', async () => {
      const mockUpdateItem = jest.mocked(dynamodbClient.updateItem).mockResolvedValue(undefined);

      const taggingResult: TaggingResult = {
        ticketId: 'ticket-001',
        tags: [
          { tag: 'api', category: 'product', confidence: 0.9 },
          { tag: 'bug', category: 'issueType', confidence: 0.85 },
        ],
        taggedAt: new Date(),
      };

      await updateTicketTags('ticket-001', taggingResult);

      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        'TICKET#ticket-001',
        'METADATA',
        'SET tags = :tags, updatedAt = :updatedAt',
        expect.objectContaining({
          ':tags': ['api', 'bug'],
        })
      );
    });
  });
});
