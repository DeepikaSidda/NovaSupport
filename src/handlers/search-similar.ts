/**
 * Lambda handler for similar ticket search
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem } from '../utils/dynamodb-client';
import { findSimilarTickets } from '../services/similar-ticket-search';
import { Ticket, TicketStatus, Priority } from '../types/ticket';
import { createLogger } from '../utils/logger';

const logger = createLogger('SearchSimilarHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'ticketId is required' } }) };
    }

    const record = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!record) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Ticket not found' } }) };
    }

    const ticket: Ticket = {
      id: record.ticketId as string,
      userId: record.userId as string,
      subject: record.subject as string,
      description: record.description as string,
      status: (record.status as TicketStatus) || TicketStatus.NEW,
      priority: (record.priority as Priority) || Priority.MEDIUM,
      createdAt: new Date(record.createdAt as string),
      updatedAt: new Date(record.updatedAt as string),
      tags: (record.tags as string[]) || [],
      attachments: [],
    };

    const similar = await findSimilarTickets(ticket, { limit: 5, minSimilarity: 0.5 });

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ticketId, similarTickets: similar }) };
  } catch (error) {
    logger.error('Error searching similar tickets', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Search failed' } }) };
  }
}
