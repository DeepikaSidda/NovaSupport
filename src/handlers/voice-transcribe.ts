/**
 * Lambda handler for voice transcription
 * Implements Task 4.1: Voice transcribe API endpoint
 *
 * Requirements: 7.1, 7.3, 5.4, 5.5
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  transcribeSpeech,
  isSupportedAudioFormat,
  isSupportedLanguage,
  MAX_AUDIO_DURATION_SECONDS,
  VoiceProcessingError,
} from '../services/voice-processor';
import { createLogger } from '../utils/logger';

const logger = createLogger('VoiceTranscribeHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/**
 * Validate transcription request body.
 * Returns an array of error strings (empty if valid).
 */
export function validateTranscribeRequest(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return ['Request body must be a valid object'];
  }

  if (!body.s3Key && !body.audioData) {
    errors.push('Either s3Key or audioData must be provided');
  }

  if (!body.format || typeof body.format !== 'string') {
    errors.push('format is required and must be a string');
  } else if (!isSupportedAudioFormat(body.format)) {
    errors.push(`Unsupported audio format: ${body.format}. Supported formats: wav, mp3, ogg, webm, pcm`);
  }

  if (body.duration === undefined || body.duration === null || typeof body.duration !== 'number') {
    errors.push('duration is required and must be a number');
  } else {
    if (body.duration <= 0) {
      errors.push('duration must be greater than 0');
    }
    if (body.duration > MAX_AUDIO_DURATION_SECONDS) {
      errors.push(`duration must not exceed ${MAX_AUDIO_DURATION_SECONDS} seconds`);
    }
  }

  if (body.language !== undefined && body.language !== null) {
    if (typeof body.language !== 'string') {
      errors.push('language must be a string');
    } else if (!isSupportedLanguage(body.language)) {
      errors.push(`Unsupported language: ${body.language}. Supported languages: en, es, fr, de, ja, zh, ko, pt, it, nl`);
    }
  }

  return errors;
}

/**
 * Lambda handler for POST /voice/transcribe
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received voice transcription request');

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

    const validationErrors = validateTranscribeRequest(requestBody);
    if (validationErrors.length > 0) {
      logger.warn('Transcription validation failed', { errors: validationErrors });
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid transcription request',
            details: validationErrors,
          },
        }),
      };
    }

    const transcription = await transcribeSpeech({
      s3Key: requestBody.s3Key,
      audioData: requestBody.audioData,
      format: requestBody.format,
      language: requestBody.language,
      duration: requestBody.duration,
    });

    logger.info('Transcription completed', {
      textLength: transcription.text.length,
      language: transcription.language,
      confidence: transcription.confidence,
      technicalTermCount: transcription.detectedTechnicalTerms.length,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        text: transcription.text,
        language: transcription.language,
        confidence: transcription.confidence,
        detectedTechnicalTerms: transcription.detectedTechnicalTerms,
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
      'Error processing transcription request',
      error instanceof Error ? error : undefined,
    );

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while processing the transcription request',
        },
      }),
    };
  }
}
