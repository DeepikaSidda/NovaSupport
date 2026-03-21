/**
 * Unit tests for Nova Multimodal Embedding client
 * Tests embedding generation, retry logic, fallback, and article/query helpers
 *
 * Validates: Requirements 17.4
 */

import {
  generateEmbedding,
  generateArticleEmbedding,
  generateQueryEmbedding,
  generateFallbackEmbedding,
  generateEmbeddingWithFallback,
  EmbeddingUnavailableError,
} from '../src/utils/embedding-client';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-bedrock-runtime');

const mockSend = jest.fn();
const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;
const MockInvokeModelCommand = InvokeModelCommand as jest.MockedClass<typeof InvokeModelCommand>;

/**
 * Helper to create a mock embedding response
 */
function createMockEmbeddingResponse(embedding: number[], inputTextTokenCount?: number) {
  return {
    body: new TextEncoder().encode(JSON.stringify({
      embedding,
      inputTextTokenCount,
    })),
  };
}

describe('Nova Embedding Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockBedrockRuntimeClient.prototype.send = mockSend;
  });

  describe('generateEmbedding', () => {
    it('should successfully generate an embedding', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding, 10));

      const result = await generateEmbedding({ text: 'Hello world' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.inputTextTokenCount).toBe(10);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));
    });

    it('should use default dimensions when not specified', async () => {
      const mockEmbedding = Array(1024).fill(0.01);
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test text' });

      expect(result.embedding).toHaveLength(1024);
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Verify the request body includes default dimensions via constructor args
      const constructorArgs = MockInvokeModelCommand.mock.calls[0][0];
      const body = JSON.parse(constructorArgs.body as string);
      expect(body.dimensions).toBe(1024);
    });

    it('should use custom dimensions when specified', async () => {
      const mockEmbedding = Array(256).fill(0.01);
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test text', dimensions: 256 });

      expect(result.embedding).toHaveLength(256);

      const constructorArgs = MockInvokeModelCommand.mock.calls[0][0];
      const body = JSON.parse(constructorArgs.body as string);
      expect(body.dimensions).toBe(256);
    });

    it('should throw an error for empty text input', async () => {
      await expect(generateEmbedding({ text: '' })).rejects.toThrow(
        'Text input is required for embedding generation'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw an error for whitespace-only text input', async () => {
      await expect(generateEmbedding({ text: '   ' })).rejects.toThrow(
        'Text input is required for embedding generation'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw EmbeddingUnavailableError for invalid response without embedding', async () => {
      const badResponse = {
        body: new TextEncoder().encode(JSON.stringify({ noEmbedding: true })),
      };
      mockSend.mockResolvedValueOnce(badResponse);

      await expect(generateEmbedding({ text: 'Test' })).rejects.toThrow(
        EmbeddingUnavailableError
      );
    });

    it('should handle response without inputTextTokenCount', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.inputTextTokenCount).toBeUndefined();
    });
  });

  describe('Retry logic', () => {
    it('should retry on ThrottlingException', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      const mockEmbedding = [0.1, 0.2, 0.3];
      mockSend
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on ServiceUnavailableException', async () => {
      const serviceError = new Error('Service unavailable');
      serviceError.name = 'ServiceUnavailableException';

      const mockEmbedding = [0.4, 0.5, 0.6];
      mockSend
        .mockRejectedValueOnce(serviceError)
        .mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on InternalServerException', async () => {
      const internalError = new Error('Internal error');
      internalError.name = 'InternalServerException';

      const mockEmbedding = [0.7, 0.8, 0.9];
      mockSend
        .mockRejectedValueOnce(internalError)
        .mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 status code', async () => {
      const rateLimitError: any = new Error('Too many requests');
      rateLimitError.$metadata = { httpStatusCode: 429 };

      const mockEmbedding = [0.1, 0.2];
      mockSend
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 status code', async () => {
      const serverError: any = new Error('Server error');
      serverError.$metadata = { httpStatusCode: 500 };

      const mockEmbedding = [0.3, 0.4];
      mockSend
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on 503 status code', async () => {
      const unavailableError: any = new Error('Service unavailable');
      unavailableError.$metadata = { httpStatusCode: 503 };

      const mockEmbedding = [0.5, 0.6];
      mockSend
        .mockRejectedValueOnce(unavailableError)
        .mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      const result = await generateEmbedding({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw EmbeddingUnavailableError on non-retryable error', async () => {
      const validationError = new Error('Invalid request');
      validationError.name = 'ValidationException';

      mockSend.mockRejectedValueOnce(validationError);

      await expect(generateEmbedding({ text: 'Test' })).rejects.toThrow(EmbeddingUnavailableError);
      await expect(generateEmbedding({ text: 'Test' })).rejects.toThrow('Embedding API error');
      expect(mockSend).toHaveBeenCalledTimes(2); // One attempt per call
    });

    it('should throw EmbeddingUnavailableError after max retries exhausted', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      mockSend.mockRejectedValue(throttlingError);

      await expect(generateEmbedding({ text: 'Test' })).rejects.toThrow(EmbeddingUnavailableError);
      await expect(generateEmbedding({ text: 'Test' })).rejects.toThrow(
        'Embedding service unavailable after 2 attempts'
      );
      expect(mockSend).toHaveBeenCalledTimes(4); // 2 attempts per call
    }, 15000);

    it('should apply exponential backoff between retries', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      mockSend.mockRejectedValue(throttlingError);

      const startTime = Date.now();
      try {
        await generateEmbedding({ text: 'Test' });
      } catch {
        // Expected
      }
      const duration = Date.now() - startTime;

      // First retry: 500ms = 500ms minimum
      expect(duration).toBeGreaterThanOrEqual(500);
      expect(mockSend).toHaveBeenCalledTimes(2);
    }, 15000);
  });

  describe('generateArticleEmbedding', () => {
    it('should combine title and content for embedding', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding, 15));

      const result = await generateArticleEmbedding('My Article', 'Article content here');

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.inputTextTokenCount).toBe(15);

      // Verify the combined text was sent
      const constructorArgs = MockInvokeModelCommand.mock.calls[0][0];
      const body = JSON.parse(constructorArgs.body as string);
      expect(body.inputText).toBe('My Article\n\nArticle content here');
    });

    it('should pass custom dimensions', async () => {
      const mockEmbedding = Array(512).fill(0.01);
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      await generateArticleEmbedding('Title', 'Content', 512);

      const constructorArgs = MockInvokeModelCommand.mock.calls[0][0];
      const body = JSON.parse(constructorArgs.body as string);
      expect(body.dimensions).toBe(512);
    });
  });

  describe('generateQueryEmbedding', () => {
    it('should generate embedding for a search query', async () => {
      const mockEmbedding = [0.5, 0.6, 0.7];
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding, 5));

      const result = await generateQueryEmbedding('How do I reset my password?');

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.inputTextTokenCount).toBe(5);

      const constructorArgs = MockInvokeModelCommand.mock.calls[0][0];
      const body = JSON.parse(constructorArgs.body as string);
      expect(body.inputText).toBe('How do I reset my password?');
    });

    it('should pass custom dimensions', async () => {
      const mockEmbedding = Array(256).fill(0.02);
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding));

      await generateQueryEmbedding('query text', 256);

      const constructorArgs = MockInvokeModelCommand.mock.calls[0][0];
      const body = JSON.parse(constructorArgs.body as string);
      expect(body.dimensions).toBe(256);
    });
  });

  describe('generateFallbackEmbedding', () => {
    it('should generate a deterministic embedding from text', () => {
      const embedding1 = generateFallbackEmbedding('Hello world');
      const embedding2 = generateFallbackEmbedding('Hello world');

      expect(embedding1).toEqual(embedding2);
    });

    it('should generate embeddings of the requested dimension', () => {
      const embedding = generateFallbackEmbedding('Test', 512);
      expect(embedding).toHaveLength(512);
    });

    it('should use default dimension of 1024', () => {
      const embedding = generateFallbackEmbedding('Test');
      expect(embedding).toHaveLength(1024);
    });

    it('should produce a normalized unit vector', () => {
      const embedding = generateFallbackEmbedding('Some text for embedding');
      const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));

      // Magnitude should be approximately 1 (unit vector)
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should produce different embeddings for different texts', () => {
      const embedding1 = generateFallbackEmbedding('Hello');
      const embedding2 = generateFallbackEmbedding('Goodbye');

      expect(embedding1).not.toEqual(embedding2);
    });
  });

  describe('generateEmbeddingWithFallback', () => {
    it('should return real embedding when service is available', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockSend.mockResolvedValueOnce(createMockEmbeddingResponse(mockEmbedding, 5));

      const result = await generateEmbeddingWithFallback({ text: 'Test' });

      expect(result.embedding).toEqual(mockEmbedding);
      expect(result.inputTextTokenCount).toBe(5);
    });

    it('should return fallback embedding when service is unavailable', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';
      mockSend.mockRejectedValue(throttlingError);

      const result = await generateEmbeddingWithFallback({ text: 'Test' });

      // Should return a fallback embedding of default dimension
      expect(result.embedding).toHaveLength(1024);
      expect(result.inputTextTokenCount).toBeUndefined();

      // Verify it's a normalized vector
      const magnitude = Math.sqrt(result.embedding.reduce((sum, v) => sum + v * v, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    }, 15000);

    it('should return fallback embedding with custom dimensions', async () => {
      const serviceError = new Error('Service unavailable');
      serviceError.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValue(serviceError);

      const result = await generateEmbeddingWithFallback({ text: 'Test', dimensions: 256 });

      expect(result.embedding).toHaveLength(256);
    }, 15000);

    it('should return fallback for non-retryable errors', async () => {
      const validationError = new Error('Invalid model');
      validationError.name = 'ValidationException';
      mockSend.mockRejectedValueOnce(validationError);

      const result = await generateEmbeddingWithFallback({ text: 'Test' });

      expect(result.embedding).toHaveLength(1024);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return fallback for empty text input since all errors are caught', async () => {
      const result = await generateEmbeddingWithFallback({ text: '' });

      // With the updated fallback that catches all errors, empty text returns a fallback embedding
      expect(result.embedding).toHaveLength(1024);
    });
  });
});
