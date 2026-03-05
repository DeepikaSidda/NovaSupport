/**
 * Property-based tests for Similar Ticket Detection
 * Tests tasks 6.2, 6.3, 6.4
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 * Property 16: Similar Ticket Similarity Threshold
 * Property 17: Similar Ticket Resolution Prioritization
 * Property 18: Similar Ticket Display Completeness
 */

import * as fc from 'fast-check';
import { findSimilarTickets } from '../src/services/similar-ticket-search';
import { cosineSimilarity } from '../src/services/knowledge-base';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import * as embeddingClient from '../src/utils/embedding-client';

// Mock dependencies
jest.mock('../src/utils/dynamodb-client', () => ({
  putItem: jest.fn(),
  getItem: jest.fn(),
  queryItems: jest.fn(),
  updateItem: jest.fn(),
  scanItems: jest.fn(),
  docClient: { send: jest.fn() },
  TABLE_NAME: 'novasupport-tickets',
}));

jest.mock('../src/utils/embedding-client', () => ({
  generateEmbeddingWithFallback: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockScanItems = dynamodbClient.scanItems as jest.MockedFunction<typeof dynamodbClient.scanItems>;
const mockGenerateEmbedding = embeddingClient.generateEmbeddingWithFallback as jest.MockedFunction<
  typeof embeddingClient.generateEmbeddingWithFallback
>;


const VECTOR_DIM = 8;

/** Generator for a normalized vector of a given dimension with non-zero norm */
const normalizedVectorArb = (dim: number) =>
  fc
    .array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
      minLength: dim,
      maxLength: dim,
    })
    .filter((v) => {
      const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
      return norm > 0.1;
    });

/** Create a mock Ticket object */
function createTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'TKT-query',
    userId: 'user-1',
    subject: 'Test subject',
    description: 'Test description',
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  };
}

/**
 * Scale a vector so that its cosine similarity with a reference vector
 * is approximately the target value. We achieve this by mixing the reference
 * direction with a perpendicular noise component.
 */
function makeVectorWithSimilarity(
  reference: number[],
  targetSimilarity: number,
  noise: number[]
): number[] {
  // Normalize reference
  const refNorm = Math.sqrt(reference.reduce((s, x) => s + x * x, 0));
  const refUnit = reference.map((x) => x / refNorm);

  // Make noise perpendicular to reference via Gram-Schmidt
  const dot = noise.reduce((s, x, i) => s + x * refUnit[i], 0);
  const perp = noise.map((x, i) => x - dot * refUnit[i]);
  const perpNorm = Math.sqrt(perp.reduce((s, x) => s + x * x, 0));

  if (perpNorm < 1e-9) {
    // Noise is parallel to reference; just return scaled reference
    return refUnit.map((x) => x * targetSimilarity);
  }

  const perpUnit = perp.map((x) => x / perpNorm);

  // cos(theta) = targetSimilarity => sin(theta) = sqrt(1 - target^2)
  const clamped = Math.max(-1, Math.min(1, targetSimilarity));
  const cosTheta = clamped;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);

  return refUnit.map((x, i) => cosTheta * x + sinTheta * perpUnit[i]);
}

describe('Property-Based Tests: Similar Ticket Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 16: Similar Ticket Similarity Threshold
   * **Validates: Requirements 9.2**
   *
   * For any similar ticket search, only tickets with similarity scores
   * above 0.75 should be included in the linked results.
   */
  test('Property 16: All returned similar tickets have similarity >= 0.75', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Query vector
        normalizedVectorArb(VECTOR_DIM),
        // Generate 2-8 embedding records with random similarity targets
        fc.array(
          fc.record({
            ticketId: fc.uuid(),
            subject: fc.string({ minLength: 1, maxLength: 30 }),
            // Target similarity: mix of above and below threshold
            targetSimilarity: fc.double({ min: 0.3, max: 0.99, noNaN: true, noDefaultInfinity: true }),
            noise: normalizedVectorArb(VECTOR_DIM),
            status: fc.constantFrom(
              TicketStatus.NEW,
              TicketStatus.RESOLVED,
              TicketStatus.CLOSED,
              TicketStatus.IN_PROGRESS
            ),
            wasSuccessful: fc.boolean(),
            resolution: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
          }),
          { minLength: 2, maxLength: 8 }
        ),
        async (queryVector, tickets) => {
          // Mock embedding generation to return the query vector directly
          mockGenerateEmbedding.mockResolvedValue({
            embedding: queryVector,
            inputTextTokenCount: 10,
          });

          // Build embedding records with controlled similarity
          const embeddings = tickets.map((t) => {
            const vector = makeVectorWithSimilarity(queryVector, t.targetSimilarity, t.noise);
            return {
              PK: `TICKET_EMBEDDING#${t.ticketId}`,
              SK: 'VECTOR',
              ticketId: t.ticketId,
              subject: t.subject,
              description: 'test description',
              vector,
              status: t.status,
              resolution: t.resolution,
              wasSuccessful: t.wasSuccessful,
              createdAt: '2024-01-01T00:00:00.000Z',
            };
          });

          mockScanItems.mockResolvedValue(embeddings);

          const queryTicket = createTicket();
          const results = await findSimilarTickets(queryTicket, { limit: 50 });

          // Property: every returned result must have similarityScore >= 0.75
          for (const result of results) {
            expect(result.similarityScore).toBeGreaterThanOrEqual(0.75);
          }

          // Also verify that no ticket below threshold sneaked in
          // by checking against the actual cosine similarity
          for (const result of results) {
            const emb = embeddings.find((e) => e.ticketId === result.ticketId);
            if (emb) {
              const actualSim = cosineSimilarity(queryVector, emb.vector);
              expect(actualSim).toBeGreaterThanOrEqual(0.75);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 17: Similar Ticket Resolution Prioritization
   * **Validates: Requirements 9.3**
   *
   * For any similar ticket search results, resolved tickets with successful
   * outcomes should appear before unresolved tickets or tickets with
   * unsuccessful outcomes.
   */
  test('Property 17: Resolved+successful tickets appear before others in results', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Query vector
        normalizedVectorArb(VECTOR_DIM),
        // Generate a mix of resolved/successful and other tickets, all above threshold
        fc.array(
          fc.record({
            ticketId: fc.uuid(),
            subject: fc.string({ minLength: 1, maxLength: 30 }),
            // Keep similarity high (above 0.75) so all pass the threshold
            similarity: fc.double({ min: 0.78, max: 0.99, noNaN: true, noDefaultInfinity: true }),
            noise: normalizedVectorArb(VECTOR_DIM),
            // Mix of resolved/successful and other statuses
            isResolvedSuccessful: fc.boolean(),
            resolution: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        async (queryVector, tickets) => {
          mockGenerateEmbedding.mockResolvedValue({
            embedding: queryVector,
            inputTextTokenCount: 10,
          });

          const embeddings = tickets.map((t) => {
            const vector = makeVectorWithSimilarity(queryVector, t.similarity, t.noise);
            return {
              PK: `TICKET_EMBEDDING#${t.ticketId}`,
              SK: 'VECTOR',
              ticketId: t.ticketId,
              subject: t.subject,
              description: 'test description',
              vector,
              status: t.isResolvedSuccessful ? TicketStatus.RESOLVED : TicketStatus.IN_PROGRESS,
              resolution: t.isResolvedSuccessful ? (t.resolution ?? 'Fixed') : undefined,
              wasSuccessful: t.isResolvedSuccessful ? true : false,
              createdAt: '2024-01-01T00:00:00.000Z',
            };
          });

          mockScanItems.mockResolvedValue(embeddings);

          const queryTicket = createTicket();
          const results = await findSimilarTickets(queryTicket, { limit: 50 });

          // Property: all resolved+successful tickets must appear before
          // any non-resolved or unsuccessful tickets
          let seenNonResolved = false;
          for (const result of results) {
            const emb = embeddings.find((e) => e.ticketId === result.ticketId);
            const isResolvedSuccessful =
              emb &&
              (emb.status === TicketStatus.RESOLVED || emb.status === TicketStatus.CLOSED) &&
              emb.wasSuccessful === true;

            if (!isResolvedSuccessful) {
              seenNonResolved = true;
            }

            if (isResolvedSuccessful && seenNonResolved) {
              // A resolved+successful ticket appeared after a non-resolved one
              fail(
                `Resolved+successful ticket ${result.ticketId} appeared after a non-resolved ticket`
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 18: Similar Ticket Display Completeness
   * **Validates: Requirements 9.4**
   *
   * For any similar ticket in search results, the displayed information
   * should include the ticket's resolution approach and outcome.
   */
  test('Property 18: Each result includes ticketId, subject, similarityScore, and wasSuccessful', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Query vector
        normalizedVectorArb(VECTOR_DIM),
        // Generate tickets above threshold with resolution data
        fc.array(
          fc.record({
            ticketId: fc.uuid(),
            subject: fc.string({ minLength: 1, maxLength: 30 }),
            similarity: fc.double({ min: 0.78, max: 0.99, noNaN: true, noDefaultInfinity: true }),
            noise: normalizedVectorArb(VECTOR_DIM),
            status: fc.constantFrom(
              TicketStatus.RESOLVED,
              TicketStatus.CLOSED,
              TicketStatus.NEW,
              TicketStatus.IN_PROGRESS
            ),
            wasSuccessful: fc.boolean(),
            resolution: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        async (queryVector, tickets) => {
          mockGenerateEmbedding.mockResolvedValue({
            embedding: queryVector,
            inputTextTokenCount: 10,
          });

          const embeddings = tickets.map((t) => {
            const vector = makeVectorWithSimilarity(queryVector, t.similarity, t.noise);
            return {
              PK: `TICKET_EMBEDDING#${t.ticketId}`,
              SK: 'VECTOR',
              ticketId: t.ticketId,
              subject: t.subject,
              description: 'test description',
              vector,
              status: t.status,
              resolution: t.resolution,
              wasSuccessful: t.wasSuccessful,
              createdAt: '2024-01-01T00:00:00.000Z',
            };
          });

          mockScanItems.mockResolvedValue(embeddings);

          const queryTicket = createTicket();
          const results = await findSimilarTickets(queryTicket, { limit: 50 });

          // Property: every result must have the required display fields defined
          for (const result of results) {
            // ticketId must be defined and non-empty
            expect(result.ticketId).toBeDefined();
            expect(typeof result.ticketId).toBe('string');
            expect(result.ticketId.length).toBeGreaterThan(0);

            // subject must be defined and non-empty
            expect(result.subject).toBeDefined();
            expect(typeof result.subject).toBe('string');
            expect(result.subject.length).toBeGreaterThan(0);

            // similarityScore must be a number
            expect(result.similarityScore).toBeDefined();
            expect(typeof result.similarityScore).toBe('number');

            // wasSuccessful must be defined (boolean) - shows outcome
            expect(result.wasSuccessful).toBeDefined();
            expect(typeof result.wasSuccessful).toBe('boolean');

            // resolution field should exist on the result type (may be undefined for unresolved)
            // but the key must be present in the object
            expect('resolution' in result).toBe(true);
            expect('wasSuccessful' in result).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
