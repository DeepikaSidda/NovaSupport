/**
 * Lambda handler for resolving a ticket and storing the solution
 * PUT /tickets/{id}/resolve
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';
import { storeSolution } from '../services/solution-knowledge-base';
import { ResolveTicketRequest } from '../types/solution';
import { createActivityRecord } from './ticket-activity';
import { createInAppNotification } from '../services/notification-service';

const logger = createLogger('ResolveTicketHandler');

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

    const body = JSON.parse(event.body || '{}') as ResolveTicketRequest;

    if (!body.resolution?.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'resolution is required' } }) };
    }

    if (!body.resolvedBy?.trim()) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'resolvedBy is required' } }) };
    }

    const existing = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!existing) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Ticket not found' } }) };
    }

    const now = formatDate(new Date());
    await updateItem(
      `TICKET#${ticketId}`,
      'METADATA',
      'SET #status = :status, resolvedAt = :resolvedAt, updatedAt = :updatedAt, resolution = :resolution, rootCause = :rootCause, GSI2PK = :gsi2pk',
      {
        ':status': 'resolved',
        ':resolvedAt': now,
        ':updatedAt': now,
        ':resolution': body.resolution.trim(),
        ':rootCause': body.rootCause?.trim() || null,
        ':gsi2pk': 'STATUS#resolved',
      },
      { '#status': 'status' }
    );

    try {
      await storeSolution({
        ticketId,
        subject: existing.subject as string,
        description: existing.description as string,
        resolution: body.resolution,
        rootCause: body.rootCause,
        category: existing.category as string | undefined,
        tags: existing.tags as string[] | undefined,
        resolvedBy: body.resolvedBy,
      });
    } catch (solutionError) {
      logger.error('Failed to store solution (ticket still resolved)', solutionError instanceof Error ? solutionError : undefined);
    }

    // Record activity for ticket timeline on resolution
    try {
      await createActivityRecord(ticketId, 'resolution', body.resolvedBy, {
        resolution: body.resolution.trim(),
      });
    } catch (activityError) {
      logger.error('Failed to create activity record for resolution', activityError instanceof Error ? activityError : undefined);
    }

    // Notify the ticket creator (admin) that the ticket has been resolved
    try {
      const ticketUserId = existing.userId as string;
      if (ticketUserId) {
        const subject = existing.subject as string || 'Ticket';
        await createInAppNotification(
          ticketUserId,
          'alert',
          `Ticket Resolved: ${subject}`,
          `Ticket #${ticketId.substring(0, 8)} was resolved by ${body.resolvedBy}. Resolution: ${body.resolution.trim().substring(0, 100)}`,
          ticketId,
        );
      }
    } catch (notifError) {
      logger.error('Failed to create resolution notification', notifError instanceof Error ? notifError : undefined);
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ticketId, status: 'resolved', resolvedAt: now }) };
  } catch (error) {
    logger.error('Error resolving ticket', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Failed to resolve ticket' } }) };
  }
}
