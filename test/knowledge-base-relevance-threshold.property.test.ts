/**
 * Property-based tests for Knowledge Base Relevance Threshold
 * Tests task 5.5: Write property test for relevance threshold
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 * Property 14: Knowledge Base Relevance Threshold
 * **Validates: Requirements 8.4**
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

describe('Property-Based Tests: Knowledge Base Relevance Threshold', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Generator for a normalized vector of a given dimension.
   * Produces unit vectors with at least one non-zero component.
   */
  const normalizedVectorArb = (dim: number) =>
    fc
      .array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
        minLength: dim,
        maxLength: dim,
      })
      .filter((v) => {
        const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
        return norm > 0.01;
      })
      .map((v) => {
        // Normalize to unit vector for predictable cosine similarity
        const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
        return v.map((x) => x / norm);
      });

  /**
   * Generator that produces a pair: a query vector and a list of article vectors
   * where ALL cosine similarities between the query and each article vector
   * are strictly below 0.6.
   *
   * Strategy: generate a query vector, then for each article vector, generate
   * a vector that is nearly orthogonal to the query by constructing it in the
   * orthogonal complement and adding small noise.
   */
  const lowSimilarityDataArb = (dim: number) =>
    fc
      .tuple(
        normalizedVectorArb(dim),
        fc.integer({ min: 1, max: 8 })
      )
      .chain(([queryVec, numArticles]) =>
        fc
          .array(normalizedVectorArb(dim), {
            minLength: numArticles,
            maxLength: numArticles,
          })
          .map((articleVecs) => ({ queryVec, articleVecs }))
      )
      .filter(({ queryVec, articleVecs }) =>
        // Only keep cases where ALL similarities are below 0.6
        articleVecs.every((av) => cosineSimilarity(queryVec, av) < 0.6)
      );

  /**
   * Property 14: Knowledge Base Relevance Threshold
   * **Validates: Requirements 8.4**
   *
   * For any knowledge base search, if all article relevance scores are below 0.6,
   * the search should return an empty result set rather than low-relevance articles.
   */
  test('Property 14: Returns empty results when all similarities are below 0.6 threshold', async () => {
    const VECTOR_DIM = 16; // Higher dimension makes random vectors more likely near-orthogonal

    await fc.assert(
      fc.asyncProperty(
        lowSimilarityDataArb(VECTOR_DIM),
        async ({ queryVec, articleVecs }) => {
          // Verify precondition: all similarities are below 0.6
          for (const av of articleVecs) {
            const sim = cosineSimilarity(queryVec, av);
            expect(sim).toBeLessThan(0.6);
          }

          // Set up mock embeddings
          const mockEmbeddings = articleVecs.map((vec, i) => ({
            PK: `EMBEDDING#EMB-art-${i}`,
            SK: 'VECTOR',
            embeddingId: `EMB-art-${i}`,
            articleId: `ART-${i}`,
            vector: vec,
            createdAt: '2024-01-01T00:00:00.000Z',
          }));

          (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(mockEmbeddings);

          // Mock getItem to return article details (should never be called
          // since all results should be filtered out)
          (dynamodbClient.getItem as jest.Mock).mockImplementation(
            (pk: string) => {
              const idx = mockEmbeddings.findIndex(
                (e) => `ARTICLE#${e.articleId}` === pk
              );
              if (idx >= 0) {
                return Promise.resolve({
                  articleId: mockEmbeddings[idx].articleId,
                  title: `Article ${idx}`,
                  content: `Content for article ${idx}.`,
                });
              }
              return Promise.resolve(undefined);
            }
          );

          // Search with default minRelevance (0.6)
          const results = await searchKnowledgeBase(queryVec);

          // Property: result set must be empty when all scores < 0.6
          expect(results).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
