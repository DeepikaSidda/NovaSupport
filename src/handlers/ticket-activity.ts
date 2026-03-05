/**
 * Lambda handler for ticket activity log (timeline)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { putItem, docClient, TABLE_NAME } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';

const logger = createLogger('TicketActivityHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export type ActivityType = 'status_change' | 'message' | 'assignment' | 'resolution' | 'escalation' | 'merge';

export interface ActivityRecord {
  PK: string;
  SK: string;
  ticketId: string;
  type: ActivityType;
  actor: string;
  details: Record<string, any>;
  timestamp: string;
  activityId: string;
}

const DEFAULT_LIMIT = 50;

/**
 * Create an activity record for a ticket timeline event.
 * Exported so other handlers can import and call it.
 */
export async function createActivityRecord(
  ticketId: string,
  type: ActivityType,
  actor: string,
  details: Record<string, any>
): Promise<ActivityRecord> {
  const now = formatDate(new Date());
  const activityId = uuidv4();

  const record: ActivityRecord = {
    PK: `TICKET#${ticketId}`,
    SK: `ACTIVITY#${now}#${activityId}`,
    ticketId,
    type,
    actor,
    details,
    timestamp: now,
    activityId,
  };

  await putItem(record);
  logger.info('Activity record created', { ticketId, type, actor, activityId });
  return record;
}

/**
 * Lambda handler for GET /tickets/{ticketId}/activities
 * Returns activity records sorted by timestamp ascending with pagination.
 */
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

    const queryParams = event.queryStringParameters || {};
    const limit = Math.min(parseInt(queryParams.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, DEFAULT_LIMIT);
    const lastKey = queryParams.lastKey;

    const params: any = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `TICKET#${ticketId}`,
        ':skPrefix': 'ACTIVITY#',
      },
      ScanIndexForward: true, // ascending by SK (timestamp)
      Limit: limit,
    };

    if (lastKey) {
      try {
        params.ExclusiveStartKey = JSON.parse(Buffer.from(lastKey, 'base64').toString('utf-8'));
      } catch {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: { message: 'Invalid lastKey parameter' } }),
        };
      }
    }

    const result = await docClient.send(new QueryCommand(params));
    const activities = result.Items || [];

    const response: any = {
      ticketId,
      activities,
      count: activities.length,
    };

    if (result.LastEvaluatedKey) {
      response.nextKey = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    logger.info('Activities fetched', { ticketId, count: activities.length });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Error fetching activities', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to fetch activities' } }),
    };
  }
}
