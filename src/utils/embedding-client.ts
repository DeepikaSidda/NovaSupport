/**
 * Amazon Nova Multimodal Embedding client for NovaSupport
 * Generates embeddings for semantic search, similarity detection,
 * and knowledge base retrieval.
 *
 * Requirements: 17.4 - Nova multimodal embedding for semantic search
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from './logger';

const logger = createLogger('EmbeddingClient');
const client = new BedrockRuntimeClient({});

// Nova Embedding model ID
const NOVA_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';

// Retry configuration (mirrors nova-client.ts)
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 3000;

// Default embedding dimension
const DEFAULT_EMBEDDING_DIMENSION = 1024;

/**
 * Request parameters for embedding generation
 */
export interface EmbeddingRequest {
  text: string;
  dimensions?: number;
}

/**
 * Response from embedding generation
 */
export interface EmbeddingResponse {
  embedding: number[];
  inputTextTokenCount?: number;
}

/**
 * Error thrown when the embedding service is unavailable
 */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

/**
 * Sleep utility for exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number): number {
  const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * Generate an embedding vector for the given text using Amazon Nova embedding model.
 * Includes retry logic with exponential backoff for transient failures.
 */
export async function generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
  const { text, dimensions = DEFAULT_EMBEDDING_DIMENSION } = request;

  if (!text || text.trim().length === 0) {
    throw new Error('Text input is required for embedding generation');
  }

  logger.info('Generating embedding', {
    textLength: text.length,
    dimensions,
  });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const requestBody = {
        inputText: text,
        dimensions,
      };

      logger.debug('Sending request to Nova Embedding model', {
        attempt: attempt + 1,
        modelId: NOVA_EMBEDDING_MODEL_ID,
      });

      const command = new InvokeModelCommand({
        modelId: NOVA_EMBEDDING_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      const response = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      logger.info('Embedding response received', {
        attempt: attempt + 1,
        embeddingLength: responseBody.embedding?.length,
        inputTextTokenCount: responseBody.inputTextTokenCount,
      });

      const embedding = responseBody.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response: missing embedding array');
      }

      return {
        embedding,
        inputTextTokenCount: responseBody.inputTextTokenCount,
      };
    } catch (error: any) {
      lastError = error;

      logger.warn('Embedding generation failed', {
        attempt: attempt + 1,
        error: error.message,
        errorCode: error.name,
      });

      // Check if error is retryable
      const isRetryable =
        error.name === 'ThrottlingException' ||
        error.name === 'ServiceUnavailableException' ||
        error.name === 'InternalServerException' ||
        error.$metadata?.httpStatusCode === 429 ||
        error.$metadata?.httpStatusCode === 500 ||
        error.$metadata?.httpStatusCode === 503;

      if (!isRetryable) {
        logger.error('Non-retryable error from embedding model', error);
        throw new EmbeddingUnavailableError(
          `Embedding API error: ${error.message}`,
          error
        );
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = calculateBackoff(attempt);
        logger.info('Retrying after backoff', {
          attempt: attempt + 1,
          backoffMs,
        });
        await sleep(backoffMs);
      }
    }
  }

  logger.error('All retry attempts exhausted for embedding generation', lastError);
  throw new EmbeddingUnavailableError(
    `Embedding service unavailable after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    lastError
  );
}

/**
 * Generate an embedding for a knowledge base article.
 * Combines title and content for a richer embedding representation.
 */
export async function generateArticleEmbedding(
  title: string,
  content: string,
  dimensions?: number
): Promise<EmbeddingResponse> {
  const combinedText = `${title}\n\n${content}`;
  return generateEmbedding({ text: combinedText, dimensions });
}

/**
 * Generate an embedding for a search query.
 */
export async function generateQueryEmbedding(
  query: string,
  dimensions?: number
): Promise<EmbeddingResponse> {
  return generateEmbedding({ text: query, dimensions });
}

/**
 * Generate a simple deterministic fallback embedding from text.
 * Used when the embedding service is unavailable.
 * This produces a consistent but low-quality vector based on character codes.
 */
export function generateFallbackEmbedding(text: string, dimensions: number = DEFAULT_EMBEDDING_DIMENSION): number[] {
  const vector = new Array(dimensions).fill(0);

  for (let i = 0; i < text.length; i++) {
    const idx = i % dimensions;
    vector[idx] += text.charCodeAt(i);
  }

  // Normalize the vector to unit length
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= magnitude;
    }
  }

  return vector;
}

/**
 * Generate an embedding with fallback for when the service is unavailable.
 * Returns a real embedding when possible, or a deterministic fallback embedding.
 *
 * Requirements: 17.6 - Graceful degradation when Nova models are unavailable
 */
export async function generateEmbeddingWithFallback(
  request: EmbeddingRequest
): Promise<EmbeddingResponse> {
  try {
    return await generateEmbedding(request);
  } catch (error) {
    logger.warn('Embedding service call failed, using fallback embedding', {
      textLength: request.text.length,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    const dimensions = request.dimensions ?? DEFAULT_EMBEDDING_DIMENSION;
    return {
      embedding: generateFallbackEmbedding(request.text, dimensions),
    };
  }
}
