/**
 * Lambda handler for WebSocket $connect route
 * Stores a WebSocket_Connection record in DynamoDB on client connect.
 *
 * Requirements: 6.1, 6.2
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { putItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';

const logger = createLogger('WebSocketConnectHandler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
      logger.error('No connectionId in request context');
      return { statusCode: 400, body: 'Missing connectionId' };
    }

    // Extract userId from query string parameter
    const userId = event.queryStringParameters?.userId;
    if (!userId) {
      logger.warn('No userId provided in query string', { connectionId });
      return { statusCode: 400, body: 'Missing userId query parameter' };
    }

    const now = formatDate(new Date());

    await putItem({
      PK: `WSCONN#${connectionId}`,
      SK: 'METADATA',
      connectionId,
      userId,
      connectedAt: now,
      GSI1PK: `USER#${userId}`,
      GSI1SK: `WSCONN#${connectionId}`,
    });

    logger.info('WebSocket connection stored', { connectionId, userId });

    return { statusCode: 200, body: '' };
  } catch (error) {
    logger.error('Error handling WebSocket connect', error instanceof Error ? error : undefined);
    return { statusCode: 500, body: 'Error' };
  }
}
