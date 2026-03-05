/**
 * Lambda handler for text-to-speech generation
 * Implements Task 4.2: Voice TTS API endpoint
 *
 * Requirements: 7.2, 7.4
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  generateSpeech,
  isSupportedOutputLanguage,
  VoiceProcessingError,
} from '../services/voice-processor';
import { createLogger } from '../utils/logger';

const logger = createLogger('VoiceTTSHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/**
 * Validate TTS request body.
 * Returns an array of error strings (empty if valid).
 */
export function validateTTSRequest(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return ['Request body must be a valid object'];
  }

  if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
    errors.push('text is required and must be a non-empty string');
  }

  if (body.language !== undefined && body.language !== null) {
    if (typeof body.language !== 'string') {
      errors.push('language must be a string');
    } else if (!isSupportedOutputLanguage(body.language)) {
      errors.push(`Unsupported language: ${body.language}. Supported languages: en, es, fr, de, ja, zh, ko, pt, it, nl`);
    }
  }

  if (body.speed !== undefined && body.speed !== null) {
    if (typeof body.speed !== 'number') {
      errors.push('speed must be a number');
    } else if (body.speed < 0.5 || body.speed > 2.0) {
      errors.push('speed must be between 0.5 and 2.0');
    }
  }

  return errors;
}

/**
 * Lambda handler for POST /voice/tts
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received TTS request');

    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_BODY',
            message: 'Request body is required',
          },
        }),
      };
    }

    let requestBody: any;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
          },
        }),
      };
    }

    const validationErrors = validateTTSRequest(requestBody);
    if (validationErrors.length > 0) {
      logger.warn('TTS validation failed', { errors: validationErrors });
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid TTS request',
            details: validationErrors,
          },
        }),
      };
    }

    const audioFile = await generateSpeech({
      text: requestBody.text,
      language: requestBody.language,
      voice: requestBody.voice,
      speed: requestBody.speed,
    });

    logger.info('TTS generation completed', {
      url: audioFile.url,
      duration: audioFile.duration,
      format: audioFile.format,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        url: audioFile.url,
        duration: audioFile.duration,
        format: audioFile.format,
      }),
    };
  } catch (error) {
    if (error instanceof VoiceProcessingError) {
      logger.warn('Voice processing error', { message: error.message });
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VOICE_PROCESSING_ERROR',
            message: error.message,
          },
        }),
      };
    }

    logger.error(
      'Error processing TTS request',
      error instanceof Error ? error : undefined,
    );

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while processing the TTS request',
        },
      }),
    };
  }
}
