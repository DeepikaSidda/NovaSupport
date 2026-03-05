/**
 * Lambda handler for ticket messages
 * Implements task 3.1: POST (create message) and GET (list messages)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 6.3, 6.4
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, putItem, queryItems, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { generateMessageId, formatDate } from '../utils/helpers';
import { MessageRecord } from '../types/dynamodb-schemas';
import { cancelPendingFollowUps } from '../services/follow-up-scheduler';
import { createActivityRecord } from './ticket-activity';
import { detectAndTranslate } from '../services/translation-service';
import { broadcastToUser } from '../services/notification-service';

const logger = createLogger('TicketMessagesHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

interface CreateMessageRequestBody {
  content: string;
  userId: string;
}

/**
 * Validate create message input
 */
function validateMessageInput(body: CreateMessageRequestBody): string[] {
  const errors: string[] = [];

  if (!body.content || typeof body.content !== 'string' || body.content.trim() === '') {
    errors.push('Message content is required');
  }

  if (!body.userId || typeof body.userId !== 'string' || body.userId.trim() === '') {
    errors.push('userId is required and must be a non-empty string');
  }

  return errors;
}

/**
 * Handle POST - create a new message on a ticket
 */
async function handlePost(event: APIGatewayProxyEvent, ticketId: string): Promise<APIGatewayProxyResult> {
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

  let requestBody: CreateMessageRequestBody;
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
  const validationErrors = validateMessageInput(requestBody);
  if (validationErrors.length > 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid message data',
          details: validationErrors,
          retryable: false,
        },
      }),
    };
  }

  // Verify ticket exists
  const ticket = await getItem(`TICKET#${ticketId}`, 'METADATA');
  if (!ticket) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: `Ticket ${ticketId} not found`,
          retryable: false,
        },
      }),
    };
  }

  // Create message record
  const messageId = generateMessageId();
  const now = formatDate(new Date());

  const messageRecord: MessageRecord = {
    PK: `TICKET#${ticketId}`,
    SK: `MESSAGE#${messageId}`,
    messageId,
    ticketId,
    userId: requestBody.userId.trim(),
    content: requestBody.content.trim(),
    createdAt: now,
  };

  await putItem(messageRecord);
  logger.info('Message created', { ticketId, messageId });

  // Translate admin message if ticket is non-English (Requirement 5.4)
  try {
    const detectedLanguage = (ticket as any).detectedLanguage;
    if (detectedLanguage && detectedLanguage !== 'en') {
      const translationResult = await detectAndTranslate(requestBody.content.trim(), detectedLanguage);
      if (!translationResult.translationFailed) {
        await updateItem(
          `TICKET#${ticketId}`,
          `MESSAGE#${messageId}`,
          'SET translatedContent = :tc',
          { ':tc': translationResult.translatedText }
        );
        logger.info('Admin message translated', { ticketId, messageId, targetLang: detectedLanguage });
      } else {
        await updateItem(
          `TICKET#${ticketId}`,
          `MESSAGE#${messageId}`,
          'SET translationFailed = :failed',
          { ':failed': true }
        );
        logger.warn('Admin message translation failed', { ticketId, messageId });
      }
    }
  } catch (translationError) {
    logger.error('Translation error for admin message', translationError instanceof Error ? translationError : undefined);
    try {
      await updateItem(
        `TICKET#${ticketId}`,
        `MESSAGE#${messageId}`,
        'SET translationFailed = :failed',
        { ':failed': true }
      );
    } catch (updateError) {
      logger.error('Failed to set translationFailed flag on message', updateError instanceof Error ? updateError : undefined);
    }
  }

  // Record activity for ticket timeline
  try {
    const contentPreview = requestBody.content.trim().substring(0, 100);
    await createActivityRecord(ticketId, 'message', requestBody.userId.trim(), {
      messageId,
      contentPreview,
    });
  } catch (activityError) {
    logger.error('Failed to create activity record for message', activityError instanceof Error ? activityError : undefined);
  }

  // Cancel any pending follow-ups since the user has responded (Requirement 3.1)
  try {
    const cancelledCount = await cancelPendingFollowUps(ticketId);
    if (cancelledCount > 0) {
      logger.info('Cancelled pending follow-ups after user message', { ticketId, cancelledCount });
    }
  } catch (error) {
    logger.error('Failed to cancel pending follow-ups', error instanceof Error ? error : undefined);
  }

  // Broadcast WebSocket notification for new message (Requirement 6.5)
  try {
    const contentPreview = requestBody.content.trim().substring(0, 100);
    const broadcastMessage = {
      type: 'new_message',
      ticketId,
      sender: requestBody.userId.trim(),
      contentPreview,
    };

    const ticketOwner = (ticket as any).userId;
    const assignedAdmin = (ticket as any).assignedTo;
    const senderId = requestBody.userId.trim();

    // If sender is the user, broadcast to assigned admin
    if (assignedAdmin && senderId !== assignedAdmin) {
      try {
        await broadcastToUser(assignedAdmin, broadcastMessage);
      } catch (broadcastError) {
        logger.error('Failed to broadcast new message to assigned admin', broadcastError instanceof Error ? broadcastError : undefined);
      }
    }

    // If sender is the admin, broadcast to ticket owner
    if (ticketOwner && senderId !== ticketOwner) {
      try {
        await broadcastToUser(ticketOwner, broadcastMessage);
      } catch (broadcastError) {
        logger.error('Failed to broadcast new message to ticket owner', broadcastError instanceof Error ? broadcastError : undefined);
      }
    }
  } catch (broadcastError) {
    logger.error('Failed to prepare broadcast for new message', broadcastError instanceof Error ? broadcastError : undefined);
  }

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      messageId,
      ticketId,
      userId: messageRecord.userId,
      content: messageRecord.content,
      createdAt: now,
    }),
  };
}

/**
 * Handle GET - list messages for a ticket
 */
async function handleGet(ticketId: string): Promise<APIGatewayProxyResult> {
  const items = await queryItems(
    'PK = :pk AND begins_with(SK, :skPrefix)',
    {
      ':pk': `TICKET#${ticketId}`,
      ':skPrefix': 'MESSAGE#',
    }
  );

  // Sort by createdAt ascending
  const messages = items
    .map((item) => ({
      messageId: item.messageId,
      ticketId: item.ticketId,
      userId: item.userId,
      content: item.content,
      createdAt: item.createdAt,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ messages }),
  };
}

/**
 * Lambda handler for ticket messages
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received ticket messages request', { httpMethod: event.httpMethod });

    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ticketId is required',
            retryable: false,
          },
        }),
      };
    }

    if (event.httpMethod === 'POST') {
      return await handlePost(event, ticketId);
    }

    if (event.httpMethod === 'GET') {
      return await handleGet(ticketId);
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `Method ${event.httpMethod} not allowed`,
          retryable: false,
        },
      }),
    };
  } catch (error) {
    logger.error('Error handling ticket messages', error instanceof Error ? error : undefined);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while processing the request',
          retryable: true,
        },
      }),
    };
  }
}
