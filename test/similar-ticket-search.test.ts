/**
 * Unit tests for Similar Ticket Search Service
 * Tests task 6.1: Create ticket embedding and similarity search
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5
 */

import {
  storeTicketEmbedding,
  getTicketEmbedding,
  findSimilarTickets,
  TicketEmbeddingRecord,
} from '../src/services/similar-ticket-search';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as embeddingClient from '../src/utils/embedding-client';
import * as dynamodbClient from '../src/utils/dynamodb-client';

// Mock dependencies
jest.mock('../src/utils/embedding-client');
jest.mock('../src/utils/dynamodb-client', () => ({
  putItem: jest.fn(),
  getItem: jest.fn(),
  queryItems: jest.fn(),
  updateItem: jest.fn(),
  scanItems: jest.fn(),
  docClient: { send: jest.fn() },
  TABLE_NAME: 'novasupport-tickets',
}));
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockGenerateEmbeddingWithFallback = embeddingClient.generateEmbeddingWithFallback as jest.MockedFunction<
  typeof embeddingClient.generateEmbeddingWithFallback
>;
const mockPutItem = dynamodbClient.putItem as jest.MockedFunction<typeof dynamodbClient.putItem>;
const mockGetItem = dynamodbClient.getItem as jest.MockedFunction<typeof dynamodbClient.getItem>;
const mockScanItems = dynamodbClient.scanItems as jest.MockedFunction<typeof dynamodbClient.scanItems>;

/** Helper to create a mock ticket */
function createMockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'TKT-query',
    userId: 'user-1',
    subject: 'Cannot login to dashboard',
    description: 'I am unable to login to the dashboard after resetting my password.',
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  };
}

/** Helper to create a mock embedding record */
function createMockEmbeddingRecord(overrides: Partial<TicketEmbeddingRecord> = {}): TicketEmbeddingRecord {
  return {
    PK: `TICKET_EMBEDDING#TKT-1`,
    SK: 'VECTOR',
    ticketId: 'TKT-1',
    subject: 'Login issue',
    description: 'Cannot login',
    vector: [1.0, 0.0, 0.0],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Similar Ticket Search Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPutItem.mockResolvedValue(undefined);
  });

  describe('storeTicketEmbedding', () => {
    test('should generate and store embedding for a ticket', async () => {
      const mockVector = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockVector,
        inputTextTokenCount: 10,
      });

      const result = await storeTicketEmbedding('TKT-123', 'Login issue', 'Cannot login to dashboard');

      expect(result.PK).toBe('TICKET_EMBEDDING#TKT-123');
      expect(result.SK).toBe('VECTOR');
      expect(result.ticketId).toBe('TKT-123');
      expect(result.subject).toBe('Login issue');
      expect(result.description).toBe('Cannot login to dashboard');
      expect(result.vector).toEqual(mockVector);
      expect(result.createdAt).toBeDefined();
      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalledWith({
        text: 'Login issue\n\nCannot login to dashboard',
      });
      expect(mockPutItem).toHaveBeenCalledTimes(1);
    });

    test('should store embedding with metadata', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: [0.1, 0.2],
      });

      const result = await storeTicketEmbedding('TKT-123', 'Issue', 'Description', {
        status: TicketStatus.RESOLVED,
        resolution: 'Reset the password',
        wasSuccessful: true,
      });

      expect(result.status).toBe(TicketStatus.RESOLVED);
      expect(result.resolution).toBe('Reset the password');
      expect(result.wasSuccessful).toBe(true);
    });

    test('should trim subject and description', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: [0.1],
      });

      const result = await storeTicketEmbedding('TKT-1', '  Login issue  ', '  Cannot login  ');

      expect(result.subject).toBe('Login issue');
      expect(result.description).toBe('Cannot login');
      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalledWith({
        text: 'Login issue\n\nCannot login',
      });
    });

    test('should throw for empty ticket ID', async () => {
      await expect(storeTicketEmbedding('', 'Subject', 'Desc'))
        .rejects.toThrow('Ticket ID is required');
    });

    test('should throw for empty subject', async () => {
      await expect(storeTicketEmbedding('TKT-1', '', 'Desc'))
        .rejects.toThrow('Ticket subject is required');
    });

    test('should throw for empty description', async () => {
      await expect(storeTicketEmbedding('TKT-1', 'Subject', '   '))
        .rejects.toThrow('Ticket description is required');
    });

    test('should propagate embedding service errors', async () => {
      mockGenerateEmbeddingWithFallback.mockRejectedValue(new Error('Service error'));

      await expect(storeTicketEmbedding('TKT-1', 'Subject', 'Desc'))
        .rejects.toThrow('Service error');
    });
  });

  describe('getTicketEmbedding', () => {
    test('should return embedding when found', async () => {
      const mockRecord = createMockEmbeddingRecord();
      mockGetItem.mockResolvedValue(mockRecord);

      const result = await getTicketEmbedding('TKT-1');

      expect(result).toEqual(mockRecord);
      expect(mockGetItem).toHaveBeenCalledWith('TICKET_EMBEDDING#TKT-1', 'VECTOR');
    });

    test('should return undefined when not found', async () => {
      mockGetItem.mockResolvedValue(undefined);

      const result = await getTicketEmbedding('TKT-nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('findSimilarTickets', () => {
    const queryTicket = createMockTicket();
    const queryVector = [1.0, 0.0, 0.0];

    beforeEach(() => {
      // Mock embedding generation for the query ticket
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: queryVector,
        inputTextTokenCount: 10,
      });
    });

    test('should find similar tickets above 0.75 threshold (Requirement 9.2)', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-similar',
          subject: 'Login problem',
          vector: [0.95, 0.1, 0.0], // high similarity
        }),
        createMockEmbeddingRecord({
          ticketId: 'TKT-different',
          subject: 'Billing question',
          vector: [0.0, 0.0, 1.0], // low similarity (orthogonal)
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      // Only the similar ticket should be returned
      expect(results.length).toBe(1);
      expect(results[0].ticketId).toBe('TKT-similar');
      expect(results[0].similarityScore).toBeGreaterThanOrEqual(0.75);
    });

    test('should filter out tickets below 0.75 threshold (Requirement 9.2)', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-low',
          subject: 'Unrelated issue',
          vector: [0.3, 0.3, 0.9], // low similarity to [1,0,0]
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results).toEqual([]);
    });

    test('should prioritize resolved tickets with successful outcomes (Requirement 9.3)', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-unresolved',
          subject: 'Open issue',
          vector: [0.99, 0.05, 0.0], // very high similarity
          status: TicketStatus.IN_PROGRESS,
          wasSuccessful: false,
        }),
        createMockEmbeddingRecord({
          ticketId: 'TKT-resolved',
          subject: 'Fixed issue',
          vector: [0.95, 0.1, 0.0], // slightly lower similarity
          status: TicketStatus.RESOLVED,
          resolution: 'Reset credentials',
          wasSuccessful: true,
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results.length).toBe(2);
      // Resolved+successful should come first despite lower similarity
      expect(results[0].ticketId).toBe('TKT-resolved');
      expect(results[0].wasSuccessful).toBe(true);
      expect(results[0].resolution).toBe('Reset credentials');
      expect(results[1].ticketId).toBe('TKT-unresolved');
    });

    test('should sort by similarity within same resolution group', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-resolved-low',
          subject: 'Resolved low sim',
          vector: [0.8, 0.5, 0.0],
          status: TicketStatus.RESOLVED,
          wasSuccessful: true,
        }),
        createMockEmbeddingRecord({
          ticketId: 'TKT-resolved-high',
          subject: 'Resolved high sim',
          vector: [0.99, 0.05, 0.0],
          status: TicketStatus.RESOLVED,
          wasSuccessful: true,
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results.length).toBe(2);
      // Higher similarity should come first within resolved group
      expect(results[0].ticketId).toBe('TKT-resolved-high');
      expect(results[1].ticketId).toBe('TKT-resolved-low');
    });

    test('should return empty results when no embeddings exist', async () => {
      mockScanItems.mockResolvedValue([]);

      const results = await findSimilarTickets(queryTicket);

      expect(results).toEqual([]);
    });

    test('should exclude the query ticket itself from results', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          PK: 'TICKET_EMBEDDING#TKT-query',
          ticketId: 'TKT-query', // same as query ticket
          vector: [1.0, 0.0, 0.0], // identical vector
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results).toEqual([]);
    });

    test('should respect custom limit option', async () => {
      const embeddings: TicketEmbeddingRecord[] = Array.from({ length: 10 }, (_, i) =>
        createMockEmbeddingRecord({
          PK: `TICKET_EMBEDDING#TKT-${i}`,
          ticketId: `TKT-${i}`,
          subject: `Issue ${i}`,
          vector: [0.95 - i * 0.01, 0.1, 0.0], // all above threshold
        })
      );
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket, { limit: 3 });

      expect(results.length).toBe(3);
    });

    test('should respect custom minSimilarity option', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-high',
          vector: [0.99, 0.05, 0.0], // very high similarity
        }),
        createMockEmbeddingRecord({
          ticketId: 'TKT-medium',
          PK: 'TICKET_EMBEDDING#TKT-medium',
          vector: [0.85, 0.4, 0.0], // moderate similarity
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket, { minSimilarity: 0.95 });

      // Only the very high similarity ticket should pass 0.95 threshold
      expect(results.length).toBe(1);
      expect(results[0].ticketId).toBe('TKT-high');
    });

    test('should use default limit of 5', async () => {
      const embeddings: TicketEmbeddingRecord[] = Array.from({ length: 10 }, (_, i) =>
        createMockEmbeddingRecord({
          PK: `TICKET_EMBEDDING#TKT-${i}`,
          ticketId: `TKT-${i}`,
          vector: [0.99 - i * 0.01, 0.05, 0.0],
        })
      );
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('should include resolution and wasSuccessful in results (Requirement 9.4)', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-resolved',
          subject: 'Resolved ticket',
          vector: [0.98, 0.05, 0.0],
          status: TicketStatus.RESOLVED,
          resolution: 'Cleared browser cache and cookies',
          wasSuccessful: true,
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results.length).toBe(1);
      expect(results[0].resolution).toBe('Cleared browser cache and cookies');
      expect(results[0].wasSuccessful).toBe(true);
      expect(results[0].subject).toBe('Resolved ticket');
    });

    test('should handle embedding service failure gracefully via fallback', async () => {
      // generateEmbeddingWithFallback already handles fallback internally
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: [0.5, 0.5, 0.0], // fallback embedding (no inputTextTokenCount)
      });
      mockScanItems.mockResolvedValue([]);

      const results = await findSimilarTickets(queryTicket);

      expect(results).toEqual([]);
      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalled();
    });

    test('should treat closed+successful tickets as resolved for prioritization', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-open',
          subject: 'Open ticket',
          vector: [0.99, 0.05, 0.0],
          status: TicketStatus.NEW,
        }),
        createMockEmbeddingRecord({
          ticketId: 'TKT-closed',
          PK: 'TICKET_EMBEDDING#TKT-closed',
          subject: 'Closed ticket',
          vector: [0.95, 0.1, 0.0],
          status: TicketStatus.CLOSED,
          wasSuccessful: true,
          resolution: 'Fixed via update',
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results.length).toBe(2);
      expect(results[0].ticketId).toBe('TKT-closed');
      expect(results[1].ticketId).toBe('TKT-open');
    });

    test('should default wasSuccessful to false when not set', async () => {
      const embeddings: TicketEmbeddingRecord[] = [
        createMockEmbeddingRecord({
          ticketId: 'TKT-no-meta',
          vector: [0.98, 0.05, 0.0],
          // no wasSuccessful set
        }),
      ];
      mockScanItems.mockResolvedValue(embeddings);

      const results = await findSimilarTickets(queryTicket);

      expect(results.length).toBe(1);
      expect(results[0].wasSuccessful).toBe(false);
    });
  });
});
