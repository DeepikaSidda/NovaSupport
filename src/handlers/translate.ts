/**
 * Lambda handler for text translation
 * POST /translate - Translate text to a target language
 *
 * Requirements: 5.7 (POST /translate endpoint), 5.8 (Amazon Translate with auto-detection)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { detectAndTranslate } from '../services/translation-service';
import { createLogger } from '../utils/logger';

const logger = createLogger('TranslateHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: `Method ${event.httpMethod} not allowed` } }),
      };
    }

    let body: { text?: string; targetLanguage?: string };
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Invalid JSON body' } }),
      };
    }

    const { text, targetLanguage } = body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'text is required and must be non-empty' } }),
      };
    }

    const target = targetLanguage || 'en';

    logger.info('Translation request received', {
      textLength: text.length,
      targetLanguage: target,
    });

    const result = await detectAndTranslate(text, target);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };
  } catch (error) {
    logger.error('Error in translate handler', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Internal server error' } }),
    };
  }
}
