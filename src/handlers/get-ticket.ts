/**
 * Lambda handler for getting ticket details
 * Implements task 23.1: GET /tickets/{ticketId} endpoint
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('GetTicketHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/**
 * Lambda handler for retrieving a ticket by ID
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;

    if (!ticketId || ticketId.trim() === '') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_TICKET_ID',
            message: 'ticketId path parameter is required',
            retryable: false,
          },
        }),
      };
    }

    logger.info('Fetching ticket', { ticketId });

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

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ticketId: ticket.ticketId,
        userId: ticket.userId,
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        assignedTo: ticket.assignedTo,
        assignedMemberEmail: ticket.assignedMemberEmail,
        assignedTeam: ticket.assignedTeam,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        resolvedAt: ticket.resolvedAt,
        resolution: ticket.resolution,
        rootCause: ticket.rootCause,
        tags: ticket.tags,
        category: ticket.category,
        attachmentIds: ticket.attachmentIds,
        routingConfidence: ticket.routingConfidence,
        responseConfidence: ticket.responseConfidence,
        escalationReason: ticket.escalationReason,
        detectedLanguage: ticket.detectedLanguage,
        translatedSubject: ticket.translatedSubject,
        translatedDescription: ticket.translatedDescription,
        translationFailed: ticket.translationFailed,
      }),
    };
  } catch (error) {
    logger.error('Error fetching ticket', error instanceof Error ? error : undefined);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while fetching the ticket',
          retryable: true,
        },
      }),
    };
  }
}
