/**
 * Lambda handler for getting ticket attachments with download URLs
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createLogger } from '../utils/logger';
import { getDownloadUrl } from '../utils/s3-client';

const logger = createLogger('GetAttachmentsHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// DynamoDB query for attachment records
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TICKETS_TABLE_NAME || '';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'ticketId is required' }) };
    }

    logger.info('Fetching attachments', { ticketId });

    // Query all ATTACHMENT# records for this ticket
    const result = await ddbClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TICKET#${ticketId}`, ':sk': 'ATTACHMENT#' },
    }));

    const attachments = await Promise.all(
      (result.Items || []).map(async (item) => {
        let downloadUrl = '';
        try {
          downloadUrl = await getDownloadUrl(item.s3Key);
        } catch (_e) { /* S3 presign may fail if object doesn't exist */ }
        return {
          attachmentId: item.attachmentId,
          fileName: item.fileName,
          fileType: item.fileType,
          fileSize: item.fileSize,
          uploadedAt: item.uploadedAt,
          downloadUrl,
        };
      })
    );

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ attachments }),
    };
  } catch (error) {
    logger.error('Error fetching attachments', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to fetch attachments' }) };
  }
}
