/**
 * Lambda handler for permanently deleting a ticket from DynamoDB
 * DELETE /tickets/{ticketId}
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, queryItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('DeleteTicketHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;

    if (!ticketId || ticketId.trim() === '') {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'ticketId is required' } }),
      };
    }

    logger.info('Permanently deleting ticket', { ticketId });

    // Delete the main ticket METADATA record
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `TICKET#${ticketId}`, SK: 'METADATA' },
    }));

    // Also delete related records (messages, activities, etc.)
    const relatedItems = await queryItems(
      'PK = :pk',
      { ':pk': `TICKET#${ticketId}` }
    );

    for (const item of relatedItems) {
      await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: item.PK, SK: item.SK },
      }));
    }

    logger.info('Ticket permanently deleted', { ticketId, relatedRecords: relatedItems.length });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Ticket permanently deleted', ticketId }),
    };
  } catch (error) {
    logger.error('Error deleting ticket', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to delete ticket' } }),
    };
  }
}
