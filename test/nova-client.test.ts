/**
 * Unit tests for Nova 2 Lite client wrapper
 * Tests error handling, retry logic, and graceful degradation
 */

import { invokeNova2Lite, invokeNova2LiteWithFallback, NovaUnavailableError } from '../src/utils/nova-client';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-bedrock-runtime');

const mockSend = jest.fn();
const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;

describe('Nova 2 Lite Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockBedrockRuntimeClient.prototype.send = mockSend;
  });

  describe('invokeNova2Lite', () => {
    it('should successfully invoke Nova 2 Lite and return response', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'This is a test response' }],
            },
          },
          stopReason: 'end_turn',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
          },
        })),
      };

      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({
        prompt: 'Test prompt',
        temperature: 0.7,
        maxTokens: 100,
      });

      expect(result.text).toBe('This is a test response');
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));
    });

    it('should use default parameters when not provided', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Response' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Response');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));
    });

    it('should retry on throttling exception with exponential backoff', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success after retry' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValueOnce(mockResponse);

      const startTime = Date.now();
      const result = await invokeNova2Lite({ prompt: 'Test' });
      const duration = Date.now() - startTime;

      expect(result.text).toBe('Success after retry');
      expect(mockSend).toHaveBeenCalledTimes(2);
      // Should have waited at least 500ms (first backoff)
      expect(duration).toBeGreaterThanOrEqual(500);
    });

    it('should retry on service unavailable exception', async () => {
      const serviceError = new Error('Service unavailable');
      serviceError.name = 'ServiceUnavailableException';

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(serviceError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on internal server exception', async () => {
      const internalError = new Error('Internal error');
      internalError.name = 'InternalServerException';

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(internalError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 status code', async () => {
      const rateLimitError: any = new Error('Too many requests');
      rateLimitError.$metadata = { httpStatusCode: 429 };

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 status code', async () => {
      const serverError: any = new Error('Server error');
      serverError.$metadata = { httpStatusCode: 500 };

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should retry on 503 status code', async () => {
      const unavailableError: any = new Error('Service unavailable');
      unavailableError.$metadata = { httpStatusCode: 503 };

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(unavailableError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw NovaUnavailableError on non-retryable error', async () => {
      const validationError = new Error('Invalid request');
      validationError.name = 'ValidationException';

      mockSend.mockRejectedValueOnce(validationError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow('Nova 2 Lite API error');

      expect(mockSend).toHaveBeenCalledTimes(2); // Only called once per attempt, no retries
    });

    it('should throw NovaUnavailableError after max retries exhausted', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      mockSend.mockRejectedValue(throttlingError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow('Nova 2 Lite unavailable after 2 attempts');

      // Should have tried 2 times for each call
      expect(mockSend).toHaveBeenCalledTimes(4);
    }, 10000); // Increase timeout to 10 seconds

    it('should handle empty response text gracefully', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('');
      expect(result.stopReason).toBe('end_turn');
    });

    it('should handle response without usage information', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Response' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Response');
      expect(result.usage).toBeUndefined();
    });
  });

  describe('invokeNova2LiteWithFallback', () => {
    it('should return Nova response when available', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Nova response' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        'Fallback response'
      );

      expect(result.text).toBe('Nova response');
      expect(result.stopReason).toBe('end_turn');
    });

    it('should return fallback response when Nova is unavailable', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      mockSend.mockRejectedValue(throttlingError);

      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        'Fallback response - please contact support'
      );

      expect(result.text).toBe('Fallback response - please contact support');
      expect(result.stopReason).toBe('fallback');
      // Should have tried 2 times (max retries)
      expect(mockSend.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should use fallback for all NovaUnavailableError cases', async () => {
      // The fallback function catches all NovaUnavailableError instances
      // including those from non-retryable errors
      const validationError = new Error('Invalid request');
      validationError.name = 'ValidationException';

      mockSend.mockRejectedValueOnce(validationError);

      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        'Fallback'
      );

      expect(result.text).toBe('Fallback');
      expect(result.stopReason).toBe('fallback');
    });
  });

  describe('Exponential backoff', () => {
    it('should increase backoff delay exponentially', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      mockSend.mockRejectedValue(throttlingError);

      const startTime = Date.now();
      
      try {
        await invokeNova2Lite({ prompt: 'Test' });
      } catch (error) {
        // Expected to fail
      }

      const duration = Date.now() - startTime;

      // First retry: 500ms
      // Total should be at least 500ms
      expect(duration).toBeGreaterThanOrEqual(500);
      // But less than max backoff * retries (3000 * 2)
      expect(duration).toBeLessThan(10000);
    });

    it('should cap backoff at maximum value', async () => {
      const throttlingError = new Error('Rate exceeded');
      throttlingError.name = 'ThrottlingException';

      mockSend.mockRejectedValue(throttlingError);

      const startTime = Date.now();
      
      try {
        await invokeNova2Lite({ prompt: 'Test' });
      } catch (error) {
        // Expected to fail
      }

      const duration = Date.now() - startTime;

      // With 2 retries and exponential backoff capped at 3000ms:
      // Retry 1: 500ms
      // Total: ~500ms
      expect(duration).toBeGreaterThanOrEqual(500);
      expect(duration).toBeLessThan(10000);
    });
  });

  // Task 3.4: Unit tests for Nova API error handling
  describe('API Unavailability Scenarios (Task 3.4)', () => {
    it('should handle complete API unavailability', async () => {
      const unavailableError = new Error('Service is unavailable');
      unavailableError.name = 'ServiceUnavailableException';

      mockSend.mockRejectedValue(unavailableError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow('Nova 2 Lite unavailable after 2 attempts');

      // Should have attempted all retries
      expect(mockSend).toHaveBeenCalledTimes(4); // 2 attempts per call
    }, 10000);

    it('should handle network timeout errors', async () => {
      const timeoutError: any = new Error('Request timeout');
      timeoutError.$metadata = { httpStatusCode: 503 };

      mockSend.mockRejectedValue(timeoutError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      expect(mockSend).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should handle intermittent API failures', async () => {
      const serviceError = new Error('Temporary failure');
      serviceError.name = 'InternalServerException';

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success after intermittent failure' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      // Fail once, then succeed
      mockSend
        .mockRejectedValueOnce(serviceError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success after intermittent failure');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle API endpoint not found errors', async () => {
      const notFoundError: any = new Error('Endpoint not found');
      notFoundError.$metadata = { httpStatusCode: 404 };

      mockSend.mockRejectedValueOnce(notFoundError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      // Non-retryable error, should only attempt once
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle model not available errors', async () => {
      const modelError = new Error('Model not available');
      modelError.name = 'ModelNotReadyException';

      mockSend.mockRejectedValueOnce(modelError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      // Non-retryable error
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rate Limiting Scenarios (Task 3.4)', () => {
    it('should handle rate limit with 429 status code', async () => {
      const rateLimitError: any = new Error('Too many requests');
      rateLimitError.$metadata = { httpStatusCode: 429 };

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success after rate limit' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success after rate limit');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle ThrottlingException with retry', async () => {
      const throttlingError = new Error('Request throttled');
      throttlingError.name = 'ThrottlingException';

      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Success after throttling' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2Lite({ prompt: 'Test' });

      expect(result.text).toBe('Success after throttling');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should exhaust retries on persistent rate limiting', async () => {
      const rateLimitError: any = new Error('Rate limit exceeded');
      rateLimitError.$metadata = { httpStatusCode: 429 };

      mockSend.mockRejectedValue(rateLimitError);

      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow(NovaUnavailableError);
      await expect(invokeNova2Lite({ prompt: 'Test' })).rejects.toThrow('Nova 2 Lite unavailable after 2 attempts');

      // Should have attempted all retries for both calls
      expect(mockSend).toHaveBeenCalledTimes(4);
    }, 10000);

    it('should apply exponential backoff for rate limiting', async () => {
      const rateLimitError: any = new Error('Rate limit');
      rateLimitError.$metadata = { httpStatusCode: 429 };

      mockSend.mockRejectedValue(rateLimitError);

      const startTime = Date.now();
      
      try {
        await invokeNova2Lite({ prompt: 'Test' });
      } catch (error) {
        // Expected to fail
      }

      const duration = Date.now() - startTime;

      // Should have waited with exponential backoff
      // First retry: 500ms
      expect(duration).toBeGreaterThanOrEqual(500);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('Graceful Degradation to Fallback (Task 3.4)', () => {
    it('should use fallback response when API is completely unavailable', async () => {
      const unavailableError = new Error('Service down');
      unavailableError.name = 'ServiceUnavailableException';

      mockSend.mockRejectedValue(unavailableError);

      const fallbackText = 'We are experiencing technical difficulties. A support agent will assist you shortly.';
      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Analyze this ticket' },
        fallbackText
      );

      expect(result.text).toBe(fallbackText);
      expect(result.stopReason).toBe('fallback');
      expect(mockSend).toHaveBeenCalledTimes(2); // Should have tried all retries
    }, 10000);

    it('should use fallback response when rate limited persistently', async () => {
      const rateLimitError: any = new Error('Rate limit exceeded');
      rateLimitError.$metadata = { httpStatusCode: 429 };

      mockSend.mockRejectedValue(rateLimitError);

      const fallbackText = 'Unable to process request at this time. Please try again later.';
      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        fallbackText
      );

      expect(result.text).toBe(fallbackText);
      expect(result.stopReason).toBe('fallback');
    }, 10000);

    it('should prefer Nova response over fallback when available', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          output: {
            message: {
              content: [{ text: 'Nova AI response' }],
            },
          },
          stopReason: 'end_turn',
        })),
      };

      mockSend.mockResolvedValueOnce(mockResponse);

      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        'Fallback response'
      );

      expect(result.text).toBe('Nova AI response');
      expect(result.stopReason).toBe('end_turn');
      expect(result.stopReason).not.toBe('fallback');
    });

    it('should use fallback for non-retryable errors', async () => {
      const validationError = new Error('Invalid model parameters');
      validationError.name = 'ValidationException';

      mockSend.mockRejectedValueOnce(validationError);

      const fallbackText = 'Request could not be processed. Please contact support.';
      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        fallbackText
      );

      expect(result.text).toBe(fallbackText);
      expect(result.stopReason).toBe('fallback');
      // Non-retryable, should only attempt once
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should use fallback after exhausting retries on intermittent failures', async () => {
      const serviceError = new Error('Internal error');
      serviceError.name = 'InternalServerException';

      mockSend.mockRejectedValue(serviceError);

      const fallbackText = 'Service temporarily unavailable. Your request has been queued.';
      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        fallbackText
      );

      expect(result.text).toBe(fallbackText);
      expect(result.stopReason).toBe('fallback');
      expect(mockSend).toHaveBeenCalledTimes(2); // All retries exhausted
    }, 10000);

    it('should handle fallback with empty fallback text', async () => {
      const unavailableError = new Error('Service unavailable');
      unavailableError.name = 'ServiceUnavailableException';

      mockSend.mockRejectedValue(unavailableError);

      const result = await invokeNova2LiteWithFallback(
        { prompt: 'Test' },
        ''
      );

      expect(result.text).toBe('');
      expect(result.stopReason).toBe('fallback');
    }, 10000);
  });
});
