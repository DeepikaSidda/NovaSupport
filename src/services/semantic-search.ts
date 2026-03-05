/**
 * Semantic Search Service for NovaSupport
 * Ties together the embedding client and knowledge base search
 * into a high-level semantic search function.
 *
 * Requirements:
 * - 8.1: Use semantic search to find relevant articles
 * - 8.2: Rank results by relevance score
 * - 8.3: Extract relevant sections rather than entire documents
 * - 8.4: Return no results when confidence below 0.6
 */

import { KnowledgeBaseResult } from '../types/agent';
import { generateQueryEmbedding, generateEmbeddingWithFallback, EmbeddingUnavailableError } from '../utils/embedding-client';
import { searchKnowledgeBase } from './knowledge-base';
import { createLogger } from '../utils/logger';

const logger = createLogger('SemanticSearch');

/** Default minimum relevance threshold (Requirement 8.4) */
const DEFAULT_MIN_RELEVANCE = 0.6;

/** Default maximum number of results */
const DEFAULT_LIMIT = 10;

/**
 * Options for semantic search
 */
export interface SemanticSearchOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Minimum relevance score threshold (default: 0.6) */
  minRelevance?: number;
  /** Embedding dimensions */
  dimensions?: number;
  /** Whether to use fallback embedding when service is unavailable */
  useFallback?: boolean;
}

/**
 * Result of a semantic search operation
 */
export interface SemanticSearchResult {
  /** Search results ranked by relevance */
  results: KnowledgeBaseResult[];
  /** Whether fallback embedding was used */
  usedFallback: boolean;
  /** The query that was searched */
  query: string;
}

/**
 * Perform semantic search over the knowledge base.
 *
 * 1. Generates a query embedding using the embedding client
 * 2. Searches the knowledge base using vector similarity
 * 3. Filters results below the relevance threshold (Requirement 8.4)
 * 4. Ranks results by relevance score descending (Requirement 8.2)
 * 5. Extracts relevant sections from articles (Requirement 8.3)
 * 6. Handles embedding service unavailability with fallback
 */
export async function semanticSearch(
  query: string,
  options: SemanticSearchOptions = {}
): Promise<SemanticSearchResult> {
  const {
    limit = DEFAULT_LIMIT,
    minRelevance = DEFAULT_MIN_RELEVANCE,
    dimensions,
    useFallback = true,
  } = options;

  if (!query || query.trim().length === 0) {
    logger.warn('Empty query provided to semantic search');
    return { results: [], usedFallback: false, query: '' };
  }

  const trimmedQuery = query.trim();
  let usedFallback = false;

  logger.info('Starting semantic search', {
    queryLength: trimmedQuery.length,
    limit,
    minRelevance,
  });

  // Step 1: Generate query embedding
  let queryVector: number[];
  try {
    if (useFallback) {
      const response = await generateEmbeddingWithFallback({
        text: trimmedQuery,
        dimensions,
      });
      queryVector = response.embedding;
      // Detect if fallback was used by checking if inputTextTokenCount is missing
      // (the real API returns it, fallback does not)
      usedFallback = response.inputTextTokenCount === undefined;
    } else {
      const response = await generateQueryEmbedding(trimmedQuery, dimensions);
      queryVector = response.embedding;
    }
  } catch (error: unknown) {
    logger.error('Failed to generate query embedding', error as Error);
    throw error;
  }

  logger.info('Query embedding generated', {
    vectorLength: queryVector.length,
    usedFallback,
  });

  // Step 2-5: Search knowledge base (handles filtering, ranking, and section extraction)
  const results = await searchKnowledgeBase(queryVector, {
    limit,
    minRelevance,
  });

  logger.info('Semantic search complete', {
    resultCount: results.length,
    topScore: results.length > 0 ? results[0].relevanceScore : null,
  });

  return {
    results,
    usedFallback,
    query: trimmedQuery,
  };
}
