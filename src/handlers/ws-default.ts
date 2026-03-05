/**
 * Lambda handler for WebSocket $default route
 * Handles ping/pong and echo for connection keep-alive.
 *
 * Requirements: 6.1
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createLogger } from '../utils/logger';

const logger = createLogger('WebSocketDefaultHandler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const connectionId = event.requestContext.connectionId;

    let message: any = {};
    try {
      message = JSON.parse(event.body || '{}');
    } catch {
      // Non-JSON body, treat as plain text
      message = { action: 'echo', data: event.body };
    }

    const action = message.action || 'echo';

    if (action === 'ping') {
      logger.info('Ping received', { connectionId });
      return { statusCode: 200, body: JSON.stringify({ action: 'pong', timestamp: new Date().toISOString() }) };
    }

    // Default: echo the message back
    logger.info('Echo message', { connectionId, action });
    return { statusCode: 200, body: JSON.stringify({ action: 'echo', data: message.data || null }) };
  } catch (error) {
    logger.error('Error handling WebSocket default message', error instanceof Error ? error : undefined);
    return { statusCode: 500, body: 'Error' };
  }
}
