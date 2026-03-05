/**
 * Lambda handler for listing tickets
 * Supports filtering by status and userId
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { scanItems, queryItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('ListTicketsHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const status = event.queryStringParameters?.status;
    const userId = event.queryStringParameters?.userId;

    logger.info('Listing tickets', { status, userId });

    let items: Record<string, any>[];

    if (status) {
      items = await queryItems(
        'GSI2PK = :pk',
        { ':pk': `STATUS#${status}` },
        'GSI2'
      );
    } else if (userId) {
      items = await queryItems(
        'GSI1PK = :pk',
        { ':pk': `USER#${userId}` },
        'GSI1'
      );
    } else {
      items = await scanItems(
        'begins_with(PK, :prefix) AND SK = :sk',
        { ':prefix': 'TICKET#', ':sk': 'METADATA' }
      );
    }

    const tickets = items.map(item => ({
      ticketId: item.ticketId,
      userId: item.userId,
      subject: item.subject,
      description: item.description,
      status: item.status,
      priority: item.priority,
      assignedTo: item.assignedTo,
      assignedMemberEmail: item.assignedMemberEmail,
      assignedTeam: item.assignedTeam,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      resolvedAt: item.resolvedAt,
      resolution: item.resolution,
      rootCause: item.rootCause,
      tags: item.tags || [],
      routingConfidence: item.routingConfidence,
      escalationReason: item.escalationReason,
    }));

    // Sort by createdAt descending
    tickets.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ tickets }) };
  } catch (error) {
    logger.error('Error listing tickets', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Failed to list tickets' } }) };
  }
}
