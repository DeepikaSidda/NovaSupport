/**
 * Lambda handler for notifications
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getNotifications, markAsRead } from '../services/notification-service';
import { createLogger } from '../utils/logger';

const logger = createLogger('GetNotificationsHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;

    if (method === 'GET') {
      const userId = event.queryStringParameters?.userId || 'default-user';
      const unreadOnly = event.queryStringParameters?.unreadOnly === 'true';
      const notifications = await getNotifications(userId, { unreadOnly });
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ notifications }) };
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { notificationId, userId } = body;
      if (!notificationId || !userId) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'notificationId and userId required' } }) };
      }
      await markAsRead(notificationId, userId);
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Method not allowed' } }) };
  } catch (error) {
    logger.error('Error with notifications', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Failed' } }) };
  }
}
