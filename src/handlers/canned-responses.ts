/**
 * Lambda handler for Canned Responses CRUD operations
 * GET    /admin/canned-responses          - List all canned responses
 * POST   /admin/canned-responses          - Create a canned response
 * PUT    /admin/canned-responses/{responseId} - Update a canned response
 * DELETE /admin/canned-responses/{responseId} - Delete a canned response
 *
 * Requirements: 4.1, 4.2, 4.7, 4.8, 4.9
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { putItem, getItem, updateItem, scanItems, docClient, TABLE_NAME } from '../utils/dynamodb-client';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';
import { TICKET_CATEGORIES } from '../types/ticket';

const logger = createLogger('CannedResponsesHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;
    const responseId = event.pathParameters?.responseId;

    switch (method) {
      case 'GET':
        return handleList();
      case 'POST':
        return handleCreate(event);
      case 'PUT':
        return handleUpdate(event, responseId);
      case 'DELETE':
        return handleDelete(responseId);
      default:
        return {
          statusCode: 405,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: { message: `Method ${method} not allowed` } }),
        };
    }
  } catch (error) {
    logger.error('Error in canned responses handler', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Internal server error' } }),
    };
  }
}

/**
 * GET /admin/canned-responses
 * List all canned responses, sorted by category then title alphabetically.
 */
async function handleList(): Promise<APIGatewayProxyResult> {
  const items = await scanItems(
    'begins_with(PK, :prefix)',
    { ':prefix': 'CANNED_RESPONSE#' }
  );

  // Sort by category (ascending), then by title (ascending)
  items.sort((a, b) => {
    const catCompare = (a.category || '').localeCompare(b.category || '');
    if (catCompare !== 0) return catCompare;
    return (a.title || '').localeCompare(b.title || '');
  });

  logger.info('Listed canned responses', { count: items.length });

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ responses: items }),
  };
}

/**
 * POST /admin/canned-responses
 * Create a new canned response. Validates title, body, category.
 * Returns 409 if duplicate title exists within the same category.
 */
async function handleCreate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { title?: string; body?: string; category?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Invalid JSON body' } }),
    };
  }

  const { title, body: responseBody, category } = body;

  // Validate title
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'title is required and must be non-empty' } }),
    };
  }

  // Validate body
  if (!responseBody || typeof responseBody !== 'string' || responseBody.trim().length === 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'body is required and must be non-empty' } }),
    };
  }

  // Validate category
  if (!category || !TICKET_CATEGORIES.includes(category as any)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: { message: `category must be one of: ${TICKET_CATEGORIES.join(', ')}` },
      }),
    };
  }

  // Check for duplicate title within the same category
  const existing = await scanItems(
    'begins_with(PK, :prefix)',
    { ':prefix': 'CANNED_RESPONSE#' }
  );
  const duplicate = existing.find(
    (item) => item.title === title.trim() && item.category === category
  );
  if (duplicate) {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: { message: 'A canned response with this title already exists in this category' },
      }),
    };
  }

  const id = uuidv4();
  const now = formatDate(new Date());

  // Extract createdBy from request context (Cognito authorizer)
  const createdBy =
    event.requestContext?.authorizer?.claims?.email ||
    event.requestContext?.authorizer?.claims?.sub ||
    'admin';

  const item = {
    PK: `CANNED_RESPONSE#${id}`,
    SK: 'METADATA',
    responseId: id,
    title: title.trim(),
    body: responseBody.trim(),
    category,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(item);

  logger.info('Created canned response', { responseId: id, category });

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify(item),
  };
}

/**
 * PUT /admin/canned-responses/{responseId}
 * Update an existing canned response's title, body, and/or category.
 */
async function handleUpdate(
  event: APIGatewayProxyEvent,
  responseId: string | undefined
): Promise<APIGatewayProxyResult> {
  if (!responseId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'responseId is required' } }),
    };
  }

  // Verify the record exists
  const existing = await getItem(`CANNED_RESPONSE#${responseId}`, 'METADATA');
  if (!existing) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Canned response not found' } }),
    };
  }

  let body: { title?: string; body?: string; category?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Invalid JSON body' } }),
    };
  }

  const { title, body: responseBody, category } = body;

  // Validate title if provided
  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'title must be non-empty' } }),
    };
  }

  // Validate body if provided
  if (responseBody !== undefined && (typeof responseBody !== 'string' || responseBody.trim().length === 0)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'body must be non-empty' } }),
    };
  }

  // Validate category if provided
  if (category !== undefined && !TICKET_CATEGORIES.includes(category as any)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: { message: `category must be one of: ${TICKET_CATEGORIES.join(', ')}` },
      }),
    };
  }

  const now = formatDate(new Date());
  const updateParts: string[] = ['updatedAt = :updatedAt'];
  const expressionValues: Record<string, any> = { ':updatedAt': now };

  if (title !== undefined) {
    updateParts.push('title = :title');
    expressionValues[':title'] = title.trim();
  }
  if (responseBody !== undefined) {
    updateParts.push('body = :body');
    expressionValues[':body'] = responseBody.trim();
  }
  if (category !== undefined) {
    updateParts.push('category = :category');
    expressionValues[':category'] = category;
  }

  await updateItem(
    `CANNED_RESPONSE#${responseId}`,
    'METADATA',
    `SET ${updateParts.join(', ')}`,
    expressionValues
  );

  logger.info('Updated canned response', { responseId });

  const updated = {
    ...existing,
    ...(title !== undefined && { title: title.trim() }),
    ...(responseBody !== undefined && { body: responseBody.trim() }),
    ...(category !== undefined && { category }),
    updatedAt: now,
  };

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(updated),
  };
}

/**
 * DELETE /admin/canned-responses/{responseId}
 * Delete a canned response record.
 */
async function handleDelete(responseId: string | undefined): Promise<APIGatewayProxyResult> {
  if (!responseId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'responseId is required' } }),
    };
  }

  // Verify the record exists
  const existing = await getItem(`CANNED_RESPONSE#${responseId}`, 'METADATA');
  if (!existing) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Canned response not found' } }),
    };
  }

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `CANNED_RESPONSE#${responseId}`,
        SK: 'METADATA',
      },
    })
  );

  logger.info('Deleted canned response', { responseId });

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message: 'Canned response deleted', responseId }),
  };
}
