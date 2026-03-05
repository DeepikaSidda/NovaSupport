/**
 * Lambda handler for ticket creation
 * Implements task 2.1: Create ticket creation API endpoint
 * 
 * Requirements: 1.1, 10.1
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { generateTicketId, formatDate } from '../utils/helpers';
import { putItem, getItem, putItemIfNotExists, updateItem } from '../utils/dynamodb-client';
import { sendTicketForProcessing } from '../utils/sqs-client';
import { createLogger } from '../utils/logger';
import { TicketStatus, Priority } from '../types/ticket';
import { TicketRecord } from '../types/dynamodb-schemas';
import { detectAndTranslate } from '../services/translation-service';

const logger = createLogger('CreateTicketHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

interface CreateTicketRequestBody {
  userId: string;
  subject: string;
  description: string;
  priority?: Priority;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

/**
 * Validate ticket input data
 */
function validateTicketInput(body: CreateTicketRequestBody): string[] {
  const errors: string[] = [];
  
  if (!body.userId || typeof body.userId !== 'string' || body.userId.trim() === '') {
    errors.push('userId is required and must be a non-empty string');
  }
  
  if (!body.subject || typeof body.subject !== 'string' || body.subject.trim() === '') {
    errors.push('subject is required and must be a non-empty string');
  }
  
  if (!body.description || typeof body.description !== 'string' || body.description.trim() === '') {
    errors.push('description is required and must be a non-empty string');
  }
  
  if (body.priority !== undefined) {
    const validPriorities = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL];
    if (!validPriorities.includes(body.priority)) {
      errors.push(`priority must be one of: ${validPriorities.join(', ')}`);
    }
  }
  
  return errors;
}

/**
 * Lambda handler for creating a ticket
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received ticket creation request', { event });
    
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_BODY',
            message: 'Request body is required',
            retryable: false,
          },
        }),
      };
    }
    
    let requestBody: CreateTicketRequestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
            retryable: false,
          },
        }),
      };
    }
    
    // Validate input
    const validationErrors = validateTicketInput(requestBody);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid ticket data',
            details: validationErrors,
            retryable: false,
          },
        }),
      };
    }
    
    // Generate unique ticket ID
    const ticketId = generateTicketId();
    const now = new Date();
    const timestamp = formatDate(now);
    
    // Set default priority if not provided
    const priority = requestBody.priority ?? Priority.MEDIUM;

    // Idempotency check: if client sent an idempotencyKey, prevent duplicate creation
    if (requestBody.idempotencyKey) {
      const dedupRecord = await getItem(
        `IDEMP#${requestBody.userId.trim()}`,
        `KEY#${requestBody.idempotencyKey}`
      );
      if (dedupRecord) {
        logger.info('Duplicate request detected, returning existing ticket', {
          idempotencyKey: requestBody.idempotencyKey,
          existingTicketId: dedupRecord.ticketId,
        });
        return {
          statusCode: 201,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            ticketId: dedupRecord.ticketId,
            status: dedupRecord.status,
            priority: dedupRecord.priority,
            createdAt: dedupRecord.createdAt,
            message: 'Ticket created successfully and queued for processing',
          }),
        };
      }
    }
    
    // Create ticket record for DynamoDB
    const ticketRecord: TicketRecord = {
      // Primary Key
      PK: `TICKET#${ticketId}`,
      SK: 'METADATA',
      
      // Attributes
      ticketId,
      userId: requestBody.userId.trim(),
      subject: requestBody.subject.trim(),
      description: requestBody.description.trim(),
      status: TicketStatus.NEW,
      priority,
      
      // Category (from user selection, or will be auto-detected later)
      category: requestBody.metadata?.category || undefined,
      
      // Timestamps
      createdAt: timestamp,
      updatedAt: timestamp,
      
      // Classification (will be populated by auto-tagging agent)
      tags: [],
      
      // Attachments (empty initially)
      attachmentIds: [],
      
      // GSI Keys for queries
      GSI1PK: `USER#${requestBody.userId.trim()}`,
      GSI1SK: timestamp,
      GSI2PK: `STATUS#${TicketStatus.NEW}`,
      GSI2SK: `${priority}#${timestamp}`,
    };
    
    // Store ticket metadata in DynamoDB
    await putItem(ticketRecord);
    logger.info('Ticket stored in DynamoDB', { ticketId });

    // Detect language and translate if non-English (Requirement 5.1, 5.2)
    try {
      const subjectResult = await detectAndTranslate(requestBody.subject.trim());
      const detectedLanguage = subjectResult.detectedLanguage;

      if (detectedLanguage !== 'en' && !subjectResult.translationFailed) {
        const descriptionResult = await detectAndTranslate(requestBody.description.trim());

        await updateItem(
          `TICKET#${ticketId}`,
          'METADATA',
          'SET detectedLanguage = :lang, translatedSubject = :tSubj, translatedDescription = :tDesc',
          {
            ':lang': detectedLanguage,
            ':tSubj': subjectResult.translatedText,
            ':tDesc': descriptionResult.translatedText,
          }
        );
        logger.info('Ticket translated', { ticketId, detectedLanguage });
      } else if (subjectResult.translationFailed) {
        await updateItem(
          `TICKET#${ticketId}`,
          'METADATA',
          'SET translationFailed = :failed',
          { ':failed': true }
        );
        logger.warn('Translation failed for ticket', { ticketId });
      }
    } catch (translationError) {
      logger.error('Translation error during ticket creation', translationError instanceof Error ? translationError : undefined);
      try {
        await updateItem(
          `TICKET#${ticketId}`,
          'METADATA',
          'SET translationFailed = :failed',
          { ':failed': true }
        );
      } catch (updateError) {
        logger.error('Failed to set translationFailed flag', updateError instanceof Error ? updateError : undefined);
      }
    }

    // Store idempotency record (TTL: 24 hours) to prevent duplicate creation
    if (requestBody.idempotencyKey) {
      await putItemIfNotExists({
        PK: `IDEMP#${requestBody.userId.trim()}`,
        SK: `KEY#${requestBody.idempotencyKey}`,
        ticketId,
        status: TicketStatus.NEW,
        priority,
        createdAt: timestamp,
        ttl: Math.floor(Date.now() / 1000) + 86400, // 24h TTL
      });
    }
    
    // Publish ticket to SQS for agent processing
    const messageId = await sendTicketForProcessing(ticketId);
    logger.info('Ticket published to SQS', { ticketId, messageId });
    
    // Return success response
    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ticketId,
        status: TicketStatus.NEW,
        priority,
        createdAt: timestamp,
        message: 'Ticket created successfully and queued for processing',
      }),
    };
    
  } catch (error) {
    logger.error('Error creating ticket', error instanceof Error ? error : undefined);
    
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while creating the ticket',
          retryable: true,
        },
      }),
    };
  }
}
