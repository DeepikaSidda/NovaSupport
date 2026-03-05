/**
 * Lambda handler for team member CRUD operations.
 * Stores members in DynamoDB with PK: TEAM#<teamId>, SK: MEMBER#<email>
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { putItem, queryItems, getItem } from '../utils/dynamodb-client';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('TeamMembersHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const teamId = event.pathParameters?.teamId;

  if (!teamId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'teamId is required' } }) };
  }

  try {
    if (method === 'GET') {
      return await listMembers(teamId);
    } else if (method === 'POST') {
      return await addMember(teamId, event.body);
    } else if (method === 'DELETE') {
      const email = event.queryStringParameters?.email;
      if (!email) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'email query parameter is required' } }) };
      }
      return await removeMember(teamId, email);
    }
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Method not allowed' } }) };
  } catch (error) {
    logger.error('Error in team-members handler', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Internal server error' } }) };
  }
}

async function listMembers(teamId: string): Promise<APIGatewayProxyResult> {
  logger.info('Listing members for team', { teamId });
  const items = await queryItems(
    'PK = :pk AND begins_with(SK, :skPrefix)',
    { ':pk': `TEAM#${teamId}`, ':skPrefix': 'MEMBER#' }
  );

  const members = items.map(item => ({
    name: item.memberName,
    email: item.memberEmail,
    role: item.memberRole || 'member',
    addedAt: item.addedAt,
  }));

  members.sort((a, b) => {
    const roleOrder: Record<string, number> = { manager: 0, lead: 1, member: 2 };
    return (roleOrder[a.role] ?? 2) - (roleOrder[b.role] ?? 2);
  });

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ members }) };
}

async function addMember(teamId: string, body: string | null): Promise<APIGatewayProxyResult> {
  if (!body) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Request body is required' } }) };
  }

  const { name, email, role } = JSON.parse(body);
  if (!name || !email) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'name and email are required' } }) };
  }

  const validRoles = ['member', 'lead', 'manager'];
  const memberRole = validRoles.includes(role) ? role : 'member';

  // Check if member already exists
  const existing = await getItem(`TEAM#${teamId}`, `MEMBER#${email}`);
  if (existing) {
    return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Member with this email already exists in this team' } }) };
  }

  const item = {
    PK: `TEAM#${teamId}`,
    SK: `MEMBER#${email}`,
    memberName: name,
    memberEmail: email,
    memberRole,
    teamId,
    addedAt: new Date().toISOString(),
  };

  await putItem(item);
  logger.info('Added member to team', { teamId, email, role: memberRole });

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message: 'Member added', member: { name, email, role: memberRole, addedAt: item.addedAt } }),
  };
}

async function removeMember(teamId: string, email: string): Promise<APIGatewayProxyResult> {
  logger.info('Removing member from team', { teamId, email });

  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: `TEAM#${teamId}`, SK: `MEMBER#${email}` },
  }));

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ message: 'Member removed' }) };
}
