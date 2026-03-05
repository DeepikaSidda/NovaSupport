/**
 * Lambda handler for WebSocket $disconnect route
 * Deletes the WebSocket_Connection record from DynamoDB on client disconnect.
 *
 * Requirements: 6.1, 6.3
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('WebSocketDisconnectHandler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const connectionId = event.requestContext.connectionId;
    if (!connectionId) {
      logger.error('No connectionId in request context');
      return { statusCode: 400, body: 'Missing connectionId' };
    }

    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `WSCONN#${connectionId}`,
        SK: 'METADATA',
      },
    }));

    logger.info('WebSocket connection removed', { connectionId });

    return { statusCode: 200, body: '' };
  } catch (error) {
    logger.error('Error handling WebSocket disconnect', error instanceof Error ? error : undefined);
    return { statusCode: 500, body: 'Error' };
  }
}
