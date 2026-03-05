/**
 * Unit tests for Semantic Search Service
 * Tests task 5.3: Implement semantic search
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import { semanticSearch, SemanticSearchOptions } from '../src/services/semantic-search';
import * as embeddingClient from '../src/utils/embedding-client';
import * as knowledgeBase from '../src/services/knowledge-base';

// Mock dependencies
jest.mock('../src/utils/embedding-client');
jest.mock('../src/services/knowledge-base');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockGenerateQueryEmbedding = embeddingClient.generateQueryEmbedding as jest.MockedFunction<
  typeof embeddingClient.generateQueryEmbedding
>;
const mockGenerateEmbeddingWithFallback = embeddingClient.generateEmbeddingWithFallback as jest.MockedFunction<
  typeof embeddingClient.generateEmbeddingWithFallback
>;
const mockSearchKnowledgeBase = knowledgeBase.searchKnowledgeBase as jest.MockedFunction<
  typeof knowledgeBase.searchKnowledgeBase
>;

describe('Semantic Search Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('semanticSearch', () => {
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

    test('should generate query embedding and search knowledge base', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 5,
      });
      mockSearchKnowledgeBase.mockResolvedValue([
        {
          articleId: 'ART-1',
          title: 'Password Reset Guide',
          relevantSections: ['Go to settings', 'Click reset'],
          relevanceScore: 0.85,
        },
      ]);

      const result = await semanticSearch('How do I reset my password?');

      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalledWith({
        text: 'How do I reset my password?',
        dimensions: undefined,
      });
      expect(mockSearchKnowledgeBase).toHaveBeenCalledWith(mockEmbedding, {
        limit: 10,
        minRelevance: 0.6,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].articleId).toBe('ART-1');
      expect(result.usedFallback).toBe(false);
      expect(result.query).toBe('How do I reset my password?');
    });

    test('should return empty results for empty query', async () => {
      const result = await semanticSearch('');

      expect(result.results).toEqual([]);
      expect(result.usedFallback).toBe(false);
      expect(result.query).toBe('');
      expect(mockGenerateEmbeddingWithFallback).not.toHaveBeenCalled();
      expect(mockSearchKnowledgeBase).not.toHaveBeenCalled();
    });

    test('should return empty results for whitespace-only query', async () => {
      const result = await semanticSearch('   ');

      expect(result.results).toEqual([]);
      expect(mockGenerateEmbeddingWithFallback).not.toHaveBeenCalled();
    });

    test('should trim query before processing', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      const result = await semanticSearch('  reset password  ');

      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalledWith({
        text: 'reset password',
        dimensions: undefined,
      });
      expect(result.query).toBe('reset password');
    });

    test('should pass custom limit to knowledge base search', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      await semanticSearch('query', { limit: 5 });

      expect(mockSearchKnowledgeBase).toHaveBeenCalledWith(mockEmbedding, {
        limit: 5,
        minRelevance: 0.6,
      });
    });

    test('should pass custom minRelevance to knowledge base search', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      await semanticSearch('query', { minRelevance: 0.8 });

      expect(mockSearchKnowledgeBase).toHaveBeenCalledWith(mockEmbedding, {
        limit: 10,
        minRelevance: 0.8,
      });
    });

    test('should pass custom dimensions to embedding generation', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: Array(256).fill(0.01),
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      await semanticSearch('query', { dimensions: 256 });

      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalledWith({
        text: 'query',
        dimensions: 256,
      });
    });

    test('should use default 0.6 relevance threshold (Requirement 8.4)', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      await semanticSearch('query');

      expect(mockSearchKnowledgeBase).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ minRelevance: 0.6 })
      );
    });

    test('should return results ranked by relevance descending (Requirement 8.2)', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      const rankedResults = [
        { articleId: 'ART-1', title: 'Best Match', relevantSections: ['section1'], relevanceScore: 0.95 },
        { articleId: 'ART-2', title: 'Good Match', relevantSections: ['section2'], relevanceScore: 0.80 },
        { articleId: 'ART-3', title: 'OK Match', relevantSections: ['section3'], relevanceScore: 0.65 },
      ];
      mockSearchKnowledgeBase.mockResolvedValue(rankedResults);

      const result = await semanticSearch('query');

      expect(result.results).toHaveLength(3);
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].relevanceScore).toBeGreaterThanOrEqual(result.results[i].relevanceScore);
      }
    });

    test('should return results with relevant sections (Requirement 8.3)', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([
        {
          articleId: 'ART-1',
          title: 'Guide',
          relevantSections: ['Step 1: Do this', 'Step 2: Do that'],
          relevanceScore: 0.9,
        },
      ]);

      const result = await semanticSearch('how to do something');

      expect(result.results[0].relevantSections).toEqual(['Step 1: Do this', 'Step 2: Do that']);
      expect(result.results[0].relevantSections.length).toBeGreaterThan(0);
    });

    test('should return empty results when no articles match above threshold (Requirement 8.4)', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: mockEmbedding,
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      const result = await semanticSearch('completely unrelated query');

      expect(result.results).toEqual([]);
    });
  });

  describe('fallback behavior', () => {
    test('should detect fallback usage when inputTextTokenCount is undefined', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        // No inputTextTokenCount — indicates fallback was used
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      const result = await semanticSearch('query');

      expect(result.usedFallback).toBe(true);
    });

    test('should detect real embedding when inputTextTokenCount is present', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        inputTextTokenCount: 5,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      const result = await semanticSearch('query');

      expect(result.usedFallback).toBe(false);
    });

    test('should use generateQueryEmbedding when useFallback is false', async () => {
      mockGenerateQueryEmbedding.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      const result = await semanticSearch('query', { useFallback: false });

      expect(mockGenerateQueryEmbedding).toHaveBeenCalledWith('query', undefined);
      expect(mockGenerateEmbeddingWithFallback).not.toHaveBeenCalled();
      expect(result.usedFallback).toBe(false);
    });

    test('should propagate error when useFallback is false and embedding fails', async () => {
      const error = new Error('Service down');
      mockGenerateQueryEmbedding.mockRejectedValue(error);

      await expect(semanticSearch('query', { useFallback: false })).rejects.toThrow(
        'Service down'
      );
    });

    test('should use fallback by default when embedding service is unavailable', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: Array(1024).fill(0.01),
        // No inputTextTokenCount — fallback
      });
      mockSearchKnowledgeBase.mockResolvedValue([]);

      const result = await semanticSearch('query');

      expect(result.usedFallback).toBe(true);
      expect(mockGenerateEmbeddingWithFallback).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('should propagate embedding generation errors when not using fallback', async () => {
      const error = new Error('Unexpected error');
      mockGenerateQueryEmbedding.mockRejectedValue(error);

      await expect(semanticSearch('query', { useFallback: false })).rejects.toThrow(
        'Unexpected error'
      );
    });

    test('should propagate knowledge base search errors', async () => {
      mockGenerateEmbeddingWithFallback.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        inputTextTokenCount: 3,
      });
      mockSearchKnowledgeBase.mockRejectedValue(new Error('DynamoDB error'));

      await expect(semanticSearch('query')).rejects.toThrow('DynamoDB error');
    });
  });
});
