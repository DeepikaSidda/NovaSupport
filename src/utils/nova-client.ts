/**
 * Amazon Nova 2 Lite client wrapper for NovaSupport
 * Provides fast, cost-effective reasoning capabilities for ticket analysis,
 * categorization, and response generation.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { createLogger } from './logger';

const logger = createLogger('NovaClient');
const client = new BedrockRuntimeClient({});

// Nova 2 Lite model ID
const NOVA_2_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

/**
 * Request parameters for Nova 2 Lite
 */
export interface NovaRequest {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

/**
 * Response from Nova 2 Lite
 */
export interface NovaResponse {
  text: string;
  stopReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Error thrown when Nova API is unavailable
 */
export class NovaUnavailableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'NovaUnavailableError';
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
 * Invoke Nova 2 Lite model with retry logic and exponential backoff
 */
export async function invokeNova2Lite(request: NovaRequest): Promise<NovaResponse> {
  const { prompt, temperature = 0.7, maxTokens = 2048, topP = 0.9 } = request;

  logger.info('Invoking Nova 2 Lite', {
    promptLength: prompt.length,
    temperature,
    maxTokens,
  });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Prepare request body
      const requestBody = {
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          temperature,
          maxTokens,
          topP,
        },
      };

      logger.debug('Sending request to Nova 2 Lite', {
        attempt: attempt + 1,
        modelId: NOVA_2_LITE_MODEL_ID,
      });

      // Invoke the model
      const command = new InvokeModelCommand({
        modelId: NOVA_2_LITE_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      const response = await client.send(command);

      // Parse response
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      logger.info('Nova 2 Lite response received', {
        attempt: attempt + 1,
        stopReason: responseBody.stopReason,
        inputTokens: responseBody.usage?.inputTokens,
        outputTokens: responseBody.usage?.outputTokens,
      });

      // Extract text from response
      const text = responseBody.output?.message?.content?.[0]?.text || '';

      return {
        text,
        stopReason: responseBody.stopReason,
        usage: responseBody.usage
          ? {
              inputTokens: responseBody.usage.inputTokens,
              outputTokens: responseBody.usage.outputTokens,
            }
          : undefined,
      };
    } catch (error: any) {
      lastError = error;

      logger.warn('Nova 2 Lite invocation failed', {
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
        logger.error('Non-retryable error from Nova 2 Lite', error);
        throw new NovaUnavailableError(
          `Nova 2 Lite API error: ${error.message}`,
          error
        );
      }

      // If this is not the last attempt, wait before retrying
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

  // All retries exhausted
  logger.error('All retry attempts exhausted for Nova 2 Lite', lastError);
  throw new NovaUnavailableError(
    `Nova 2 Lite unavailable after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    lastError
  );
}

/**
 * Gracefully handle Nova unavailability by returning a fallback response
 */
export async function invokeNova2LiteWithFallback(
  request: NovaRequest,
  fallbackResponse: string
): Promise<NovaResponse> {
  try {
    return await invokeNova2Lite(request);
  } catch (error) {
    if (error instanceof NovaUnavailableError) {
      logger.warn('Nova 2 Lite unavailable, using fallback response', {
        fallbackResponse,
      });
      return {
        text: fallbackResponse,
        stopReason: 'fallback',
      };
    }
    throw error;
  }
}
