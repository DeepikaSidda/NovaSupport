/**
 * Lambda handler for ticket satisfaction rating
 * PUT /tickets/{ticketId}/rate
 *
 * Requirements: 2.3, 2.4, 2.5, 2.6, 2.7
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, updateItem, putItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';

const logger = createLogger('RateTicketHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'ticketId is required' } }),
      };
    }

    let body: { rating?: number; feedback?: string };
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Invalid JSON body' } }),
      };
    }

    // Validate rating: must be an integer 1–5
    const { rating, feedback } = body;
    if (rating === undefined || rating === null) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'rating is required' } }),
      };
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'rating must be an integer between 1 and 5' } }),
      };
    }

    // Validate feedback: optional, max 500 characters
    if (feedback !== undefined && feedback !== null) {
      if (typeof feedback !== 'string') {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: { message: 'feedback must be a string' } }),
        };
      }
      if (feedback.length > 500) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: { message: 'feedback must be at most 500 characters' } }),
        };
      }
    }

    // Fetch the ticket to validate status
    const ticket = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!ticket) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Ticket not found' } }),
      };
    }

    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Rating is only allowed on resolved or closed tickets.' } }),
      };
    }

    const now = formatDate(new Date());

    // Update Ticket_Record with satisfaction rating (upsert behavior)
    await updateItem(
      `TICKET#${ticketId}`,
      'METADATA',
      'SET satisfactionRating = :rating, satisfactionFeedback = :feedback, updatedAt = :updatedAt',
      {
        ':rating': rating,
        ':feedback': feedback || null,
        ':updatedAt': now,
      }
    );

    // Write a MetricRecord with type "satisfaction"
    const today = now.slice(0, 10); // YYYY-MM-DD
    await putItem({
      PK: `METRIC#${today}`,
      SK: `satisfaction#${ticketId}`,
      date: today,
      metricType: 'satisfaction',
      ticketId,
      value: rating,
      team: ticket.assignedTeam || undefined,
      category: ticket.category || undefined,
      resolvedBy: ticket.resolvedBy || 'human',
      GSI1PK: `TIMESERIES#satisfaction`,
      GSI1SK: `${today}#${ticketId}`,
    });

    logger.info('Ticket rated successfully', { ticketId, rating, hasFeedback: !!feedback });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ticketId,
        satisfactionRating: rating,
        satisfactionFeedback: feedback || null,
        updatedAt: now,
      }),
    };
  } catch (error) {
    logger.error('Error rating ticket', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to rate ticket' } }),
    };
  }
}
