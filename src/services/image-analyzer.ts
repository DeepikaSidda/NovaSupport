/**
 * Image Analysis Service for NovaSupport
 * Uses Amazon Nova multimodal (Nova Lite) for OCR, error detection,
 * UI element identification, and application detection from screenshots.
 *
 * Requirements: 5.1 (OCR), 5.2 (error/code detection), 5.3 (application detection), 5.4 (append to ticket)
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ImageAnalysis } from '../types/agent';
import { getFile } from '../utils/s3-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('ImageAnalyzer');
const client = new BedrockRuntimeClient({});

/** Nova Lite supports multimodal (image + text) inputs */
const NOVA_MULTIMODAL_MODEL_ID = 'amazon.nova-lite-v1:0';

/** Supported image formats */
export type ImageFormat = 'png' | 'jpeg' | 'gif';

const SUPPORTED_FORMATS: ImageFormat[] = ['png', 'jpeg', 'gif'];

/** Retry configuration */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Input for image analysis — either an S3 key or raw base64 data.
 */
export interface ImageInput {
  /** S3 object key for the image (mutually exclusive with base64Data) */
  s3Key?: string;
  /** Base64-encoded image data (mutually exclusive with s3Key) */
  base64Data?: string;
  /** Image format */
  format: ImageFormat;
}

/**
 * Error thrown when Nova multimodal API is unavailable
 */
export class ImageAnalysisError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ImageAnalysisError';
  }
}

/**
 * Detect image format from file name or MIME type.
 */
export function detectImageFormat(fileName: string): ImageFormat | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'gif') return 'gif';
  return null;
}

/**
 * Validate that the given format is supported.
 */
export function isSupportedFormat(format: string): format is ImageFormat {
  return SUPPORTED_FORMATS.includes(format as ImageFormat);
}

/**
 * Sleep utility for exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build the analysis prompt for Nova multimodal.
 */
function buildAnalysisPrompt(): string {
  return `Analyze this screenshot image and provide the following information in JSON format:
{
  "extractedText": "All visible text in the image (OCR)",
  "detectedErrors": ["List of error messages or error codes found"],
  "detectedApplication": "Name of the application or service shown",
  "uiElements": ["List of UI elements visible (buttons, menus, dialogs, forms, etc.)"],
  "confidence": 0.0 to 1.0
}

Rules:
- Extract ALL visible text from the image.
- Identify any error messages, error codes, or warning messages.
- Detect the application, website, or service shown in the screenshot.
- List all significant UI elements visible.
- Set confidence between 0.0 and 1.0 based on image clarity and analysis certainty.
- Return ONLY valid JSON, no additional text.`;
}

/**
 * Invoke Nova multimodal model with an image and text prompt.
 */
async function invokeNovaMultimodal(
  base64Data: string,
  format: ImageFormat,
  prompt: string
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const requestBody = {
        messages: [
          {
            role: 'user',
            content: [
              {
                image: {
                  format,
                  source: { bytes: base64Data },
                },
              },
              { text: prompt },
            ],
          },
        ],
        inferenceConfig: { temperature: 0.3, maxTokens: 2048 },
      };

      logger.debug('Sending request to Nova multimodal', {
        attempt: attempt + 1,
        modelId: NOVA_MULTIMODAL_MODEL_ID,
        format,
      });

      const command = new InvokeModelCommand({
        modelId: NOVA_MULTIMODAL_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      const response = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.output?.message?.content?.[0]?.text || '';

      logger.info('Nova multimodal response received', {
        attempt: attempt + 1,
        responseLength: text.length,
      });

      return text;
    } catch (error: any) {
      lastError = error;
      logger.warn('Nova multimodal invocation failed', {
        attempt: attempt + 1,
        error: error.message,
        errorCode: error.name,
      });

      const isRetryable =
        error.name === 'ThrottlingException' ||
        error.name === 'ServiceUnavailableException' ||
        error.name === 'InternalServerException' ||
        error.$metadata?.httpStatusCode === 429 ||
        error.$metadata?.httpStatusCode === 500 ||
        error.$metadata?.httpStatusCode === 503;

      if (!isRetryable) {
        throw new ImageAnalysisError(
          `Nova multimodal API error: ${error.message}`,
          error
        );
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoffMs);
      }
    }
  }

  throw new ImageAnalysisError(
    `Nova multimodal unavailable after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    lastError
  );
}

/**
 * Parse the JSON response from Nova multimodal into an ImageAnalysis object.
 * Handles malformed JSON gracefully.
 */
export function parseAnalysisResponse(responseText: string): ImageAnalysis {
  try {
    // Try to extract JSON from the response (Nova may wrap it in markdown code blocks)
    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    return {
      extractedText: typeof parsed.extractedText === 'string' ? parsed.extractedText : '',
      detectedErrors: Array.isArray(parsed.detectedErrors)
        ? parsed.detectedErrors.filter((e: unknown) => typeof e === 'string')
        : [],
      detectedApplication: typeof parsed.detectedApplication === 'string'
        ? parsed.detectedApplication
        : 'Unknown',
      uiElements: Array.isArray(parsed.uiElements)
        ? parsed.uiElements.filter((e: unknown) => typeof e === 'string')
        : [],
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    };
  } catch {
    logger.warn('Failed to parse Nova multimodal response as JSON, using raw text', {
      responseLength: responseText.length,
    });

    // Fallback: treat the entire response as extracted text
    return {
      extractedText: responseText,
      detectedErrors: [],
      detectedApplication: 'Unknown',
      uiElements: [],
      confidence: 0.3,
    };
  }
}

/**
 * Generate a fallback ImageAnalysis when Nova is unavailable.
 */
export function fallbackAnalysis(): ImageAnalysis {
  return {
    extractedText: '',
    detectedErrors: [],
    detectedApplication: 'Unknown',
    uiElements: [],
    confidence: 0,
  };
}

/**
 * Analyze an image using Nova multimodal.
 *
 * Accepts either an S3 key (fetches the image from S3) or raw base64 data.
 * Returns structured ImageAnalysis with OCR text, detected errors,
 * application identification, and UI elements.
 *
 * Falls back gracefully when Nova is unavailable.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function analyzeImage(input: ImageInput): Promise<ImageAnalysis> {
  logger.info('Starting image analysis', {
    hasS3Key: !!input.s3Key,
    hasBase64: !!input.base64Data,
    format: input.format,
  });

  if (!isSupportedFormat(input.format)) {
    throw new ImageAnalysisError(`Unsupported image format: ${input.format}`);
  }

  // Resolve base64 data
  let base64Data: string;
  if (input.base64Data) {
    base64Data = input.base64Data;
  } else if (input.s3Key) {
    try {
      const fileBuffer = await getFile(input.s3Key);
      base64Data = fileBuffer.toString('base64');
    } catch (error: any) {
      logger.error('Failed to fetch image from S3', error, { s3Key: input.s3Key });
      throw new ImageAnalysisError(`Failed to fetch image from S3: ${error.message}`, error);
    }
  } else {
    throw new ImageAnalysisError('Either s3Key or base64Data must be provided');
  }

  // Call Nova multimodal with fallback
  try {
    const prompt = buildAnalysisPrompt();
    const responseText = await invokeNovaMultimodal(base64Data, input.format, prompt);
    const analysis = parseAnalysisResponse(responseText);

    logger.info('Image analysis complete', {
      extractedTextLength: analysis.extractedText.length,
      errorCount: analysis.detectedErrors.length,
      detectedApplication: analysis.detectedApplication,
      uiElementCount: analysis.uiElements.length,
      confidence: analysis.confidence,
    });

    return analysis;
  } catch (error) {
    if (error instanceof ImageAnalysisError) {
      logger.warn('Nova multimodal unavailable, returning fallback analysis', {
        error: error.message,
      });
      return fallbackAnalysis();
    }
    throw error;
  }
}

/**
 * Build a text summary from an ImageAnalysis to append to a ticket description.
 *
 * Requirement: 5.4 — append extracted information to the ticket description.
 */
export function buildAnalysisSummary(analysis: ImageAnalysis): string {
  const parts: string[] = [];

  parts.push('--- Image Analysis ---');

  if (analysis.extractedText) {
    parts.push(`Extracted Text: ${analysis.extractedText}`);
  }

  if (analysis.detectedErrors.length > 0) {
    parts.push(`Detected Errors: ${analysis.detectedErrors.join('; ')}`);
  }

  if (analysis.detectedApplication && analysis.detectedApplication !== 'Unknown') {
    parts.push(`Application: ${analysis.detectedApplication}`);
  }

  if (analysis.uiElements.length > 0) {
    parts.push(`UI Elements: ${analysis.uiElements.join(', ')}`);
  }

  parts.push(`Analysis Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);

  return parts.join('\n');
}
