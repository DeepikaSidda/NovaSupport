/**
 * Lambda handler for editing unassigned tickets
 * Implements task 2.1: Edit ticket handler
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';
import { Priority } from '../types/ticket';

const logger = createLogger('EditTicketHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const EDITABLE_STATUSES = ['new', 'analyzing'];
const VALID_PRIORITIES = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL];

interface EditTicketRequestBody {
  subject: string;
  description: string;
  priority: Priority;
}

/**
 * Validate edit ticket input data
 */
function validateEditInput(body: EditTicketRequestBody): string[] {
  const errors: string[] = [];

  if (!body.subject || typeof body.subject !== 'string' || body.subject.trim() === '') {
    errors.push('subject is required and must be a non-empty string');
  }

  if (!body.description || typeof body.description !== 'string' || body.description.trim() === '') {
    errors.push('description is required and must be a non-empty string');
  }

  if (body.priority === undefined || body.priority === null) {
    errors.push(`priority is required and must be one of: ${VALID_PRIORITIES.join(', ')}`);
  } else if (!VALID_PRIORITIES.includes(body.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  return errors;
}

/**
 * Lambda handler for editing a ticket
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received edit ticket request', { event });

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

    let requestBody: EditTicketRequestBody;
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
    const validationErrors = validateEditInput(requestBody);
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

    // Fetch existing ticket
    const existing = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!existing) {
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

    // Check ticket is editable
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      return {
        statusCode: 409,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'TICKET_NOT_EDITABLE',
            message: 'Ticket has been assigned and can no longer be edited directly. Send a message instead.',
            retryable: false,
          },
        }),
      };
    }

    // Build update
    const now = formatDate(new Date());
    const newGSI2SK = `${requestBody.priority}#${existing.createdAt}`;

    const updateExpression =
      'SET subject = :subject, description = :description, priority = :priority, updatedAt = :updatedAt, GSI2SK = :gsi2sk';
    const expressionAttributeValues: Record<string, any> = {
      ':subject': requestBody.subject.trim(),
      ':description': requestBody.description.trim(),
      ':priority': requestBody.priority,
      ':updatedAt': now,
      ':gsi2sk': newGSI2SK,
    };

    await updateItem(`TICKET#${ticketId}`, 'METADATA', updateExpression, expressionAttributeValues);

    logger.info('Ticket updated successfully', { ticketId });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ticketId,
        subject: requestBody.subject.trim(),
        description: requestBody.description.trim(),
        priority: requestBody.priority,
        updatedAt: now,
        status: existing.status,
      }),
    };
  } catch (error) {
    logger.error('Error editing ticket', error instanceof Error ? error : undefined);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while editing the ticket',
          retryable: true,
        },
      }),
    };
  }
}
