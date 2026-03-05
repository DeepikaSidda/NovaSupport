/**
 * Lambda handler for listing teams and their workload
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { scanItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('ListTeamsHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Listing teams');

    // Fetch both WORKLOAD and MEMBER records for all teams
    const items = await scanItems(
      'begins_with(PK, :prefix)',
      { ':prefix': 'TEAM#' }
    );

    const teamMap: Record<string, any> = {};
    const memberMap: Record<string, any[]> = {};

    for (const item of items) {
      const teamId = item.teamId;
      if (!teamId) continue;

      if (item.SK === 'WORKLOAD') {
        teamMap[teamId] = {
          teamId: item.teamId,
          teamName: item.teamName,
          description: item.description || '',
          currentTicketCount: item.currentTicketCount || 0,
          expertise: item.expertise || [],
          updatedAt: item.updatedAt,
        };
      } else if (typeof item.SK === 'string' && item.SK.startsWith('MEMBER#')) {
        if (!memberMap[teamId]) memberMap[teamId] = [];
        memberMap[teamId].push({
          name: item.memberName,
          email: item.memberEmail,
          role: item.memberRole || 'member',
          addedAt: item.addedAt,
        });
      }
    }

    const teams = Object.values(teamMap).map((team: any) => ({
      ...team,
      members: memberMap[team.teamId] || [],
    }));

    teams.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName));

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ teams }) };
  } catch (error) {
    logger.error('Error listing teams', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Failed to list teams' } }) };
  }
}
