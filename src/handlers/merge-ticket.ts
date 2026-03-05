/**
 * Lambda handler for merging duplicate tickets into a primary ticket
 * POST /tickets/{ticketId}/merge
 *
 * Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.11, 8.12
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, putItem, updateItem, queryItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';
import { createActivityRecord } from './ticket-activity';

const logger = createLogger('MergeTicketHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

interface MergeRequestBody {
  primaryTicketId: string;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const duplicateTicketId = event.pathParameters?.ticketId;
    if (!duplicateTicketId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'ticketId is required' } }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Request body is required' } }),
      };
    }

    let body: MergeRequestBody;
    try {
      body = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Invalid JSON in request body' } }),
      };
    }

    const { primaryTicketId } = body;

    if (!primaryTicketId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'primaryTicketId is required' } }),
      };
    }

    // Validate: cannot merge a ticket into itself
    if (duplicateTicketId === primaryTicketId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'A ticket cannot be merged into itself' } }),
      };
    }

    // Fetch both tickets
    const [duplicateTicket, primaryTicket] = await Promise.all([
      getItem(`TICKET#${duplicateTicketId}`, 'METADATA'),
      getItem(`TICKET#${primaryTicketId}`, 'METADATA'),
    ]);

    if (!duplicateTicket) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Duplicate ticket not found' } }),
      };
    }

    if (!primaryTicket) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'Primary ticket not found' } }),
      };
    }

    // Validate: duplicate ticket has not already been merged
    if (duplicateTicket.mergedInto) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { message: 'This ticket has already been merged' } }),
      };
    }

    // Determine the actor performing the merge
    const mergedBy =
      event.requestContext?.authorizer?.claims?.sub ||
      event.requestContext?.authorizer?.claims?.email ||
      'system';

    const now = formatDate(new Date());

    // 1. Append duplicate's description to primary ticket's description
    const separator = `\n\n--- Merged from ticket #${duplicateTicketId} ---\n\n`;
    const mergedDescription = (primaryTicket.description || '') + separator + (duplicateTicket.description || '');

    // 2. Copy attachment references from duplicate to primary
    const duplicateAttachments: string[] = duplicateTicket.attachmentIds || [];
    const primaryAttachments: string[] = primaryTicket.attachmentIds || [];
    const mergedAttachments = [...primaryAttachments, ...duplicateAttachments];

    // Update primary ticket with merged description and attachments
    if (mergedAttachments.length > 0) {
      await updateItem(
        `TICKET#${primaryTicketId}`,
        'METADATA',
        'SET description = :desc, attachmentIds = :attachments, updatedAt = :now',
        {
          ':desc': mergedDescription,
          ':attachments': mergedAttachments,
          ':now': now,
        }
      );
    } else {
      await updateItem(
        `TICKET#${primaryTicketId}`,
        'METADATA',
        'SET description = :desc, updatedAt = :now',
        {
          ':desc': mergedDescription,
          ':now': now,
        }
      );
    }

    // 3. Copy all Message_Records from duplicate to primary ticket
    const duplicateMessages = await queryItems(
      'PK = :pk AND begins_with(SK, :skPrefix)',
      {
        ':pk': `TICKET#${duplicateTicketId}`,
        ':skPrefix': 'MESSAGE#',
      }
    );

    for (const msg of duplicateMessages) {
      const copiedMessage = {
        ...msg,
        PK: `TICKET#${primaryTicketId}`,
        // SK stays the same (MESSAGE#<messageId>) to preserve ordering
      };
      await putItem(copiedMessage);
    }

    logger.info('Copied messages from duplicate to primary', {
      duplicateTicketId,
      primaryTicketId,
      messageCount: duplicateMessages.length,
    });

    // 4. Close duplicate ticket and set mergedInto
    await updateItem(
      `TICKET#${duplicateTicketId}`,
      'METADATA',
      'SET #status = :status, mergedInto = :mergedInto, updatedAt = :now',
      {
        ':status': 'closed',
        ':mergedInto': primaryTicketId,
        ':now': now,
      },
      { '#status': 'status' }
    );

    // 5. Create Merge_Record
    await putItem({
      PK: `TICKET#${duplicateTicketId}`,
      SK: 'MERGE_INFO',
      primaryTicketId,
      mergedAt: now,
      mergedBy,
    });

    // 6. Create Activity_Records on both tickets
    try {
      await Promise.all([
        createActivityRecord(duplicateTicketId, 'merge', mergedBy, {
          action: 'merged_into',
          primaryTicketId,
        }),
        createActivityRecord(primaryTicketId, 'merge', mergedBy, {
          action: 'received_merge',
          duplicateTicketId,
        }),
      ]);
    } catch (activityError) {
      logger.error('Failed to create merge activity records', activityError instanceof Error ? activityError : undefined);
    }

    logger.info('Ticket merge completed', { duplicateTicketId, primaryTicketId, mergedBy });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Tickets merged successfully',
        duplicateTicketId,
        primaryTicketId,
        mergedAt: now,
        mergedBy,
        messagesCopied: duplicateMessages.length,
        attachmentsCopied: duplicateAttachments.length,
      }),
    };
  } catch (error) {
    logger.error('Error merging tickets', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to merge tickets' } }),
    };
  }
}
