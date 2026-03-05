/**
 * Property-based tests for Knowledge Base Search Ranking
 * Tests task 5.4: Write property test for search ranking
 * 
 * Feature: novasupport-agentic-ai-support-ticket-system
 * Property 13: Knowledge Base Search Ranking
 * **Validates: Requirements 8.2**
 */

import * as fc from 'fast-check';
import { searchKnowledgeBase, cosineSimilarity } from '../src/services/knowledge-base';
import * as dynamodbClient from '../src/utils/dynamodb-client';

// Mock DynamoDB client
jest.mock('../src/utils/dynamodb-client', () => {
  const mockDocClient = {
    send: jest.fn(),
  };
  return {
    putItem: jest.fn(),
    getItem: jest.fn(),
    queryItems: jest.fn(),
    updateItem: jest.fn(),
    scanItems: jest.fn(),
    docClient: mockDocClient,
    TABLE_NAME: 'novasupport-tickets',
  };
});

jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Property-Based Tests: Knowledge Base Search Ranking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Generator for a normalized vector of a given dimension.
   * Produces vectors with at least one non-zero component to ensure
   * meaningful cosine similarity scores.
   */
  const normalizedVectorArb = (dim: number) =>
    fc
      .array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
        minLength: dim,
        maxLength: dim,
      })
      .filter((v) => {
        const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
        return norm > 0.01; // ensure non-zero vector
      });

  /**
   * Property 13: Knowledge Base Search Ranking
   * **Validates: Requirements 8.2**
   *
   * For any knowledge base search with multiple results, the results
   * should be ordered by relevance score in descending order
   * (highest relevance first).
   */
  test('Property 13: Search results are ordered by relevance score descending', async () => {
    const VECTOR_DIM = 8;

    await fc.assert(
      fc.asyncProperty(
        // Generate a query vector
        normalizedVectorArb(VECTOR_DIM),
        // Generate between 2 and 10 embedding records with random vectors
        fc.array(
          fc.record({
            id: fc.uuid(),
            articleId: fc.uuid(),
            vector: normalizedVectorArb(VECTOR_DIM),
            title: fc.string({ minLength: 1, maxLength: 50 }),
            content: fc.stringMatching(/^[a-zA-Z0-9 .]+$/),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        async (queryVector, articles) => {
          // Set up mock embeddings from generated data
          const mockEmbeddings = articles.map((a) => ({
            PK: `EMBEDDING#EMB-${a.id}`,
            SK: 'VECTOR',
            embeddingId: `EMB-${a.id}`,
            articleId: `ART-${a.articleId}`,
            vector: a.vector,
            createdAt: '2024-01-01T00:00:00.000Z',
          }));

          (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(mockEmbeddings);

          // Mock getItem to return article details for each article
          (dynamodbClient.getItem as jest.Mock).mockImplementation(
            (pk: string) => {
              const embMatch = mockEmbeddings.find(
                (e) => `ARTICLE#${e.articleId}` === pk
              );
              if (embMatch) {
                const artData = articles.find(
                  (a) => `ART-${a.articleId}` === embMatch.articleId
                );
                return Promise.resolve({
                  articleId: embMatch.articleId,
                  title: artData?.title ?? 'Article',
                  content: artData?.content || 'Default content paragraph.',
                });
              }
              return Promise.resolve(undefined);
            }
          );

          // Use a low minRelevance to get more results for ranking verification
          const results = await searchKnowledgeBase(queryVector, {
            minRelevance: 0.0,
            limit: 50,
          });

          // If we have multiple results, verify descending order by relevanceScore
          if (results.length > 1) {
            for (let i = 1; i < results.length; i++) {
              expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(
                results[i].relevanceScore
              );
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
