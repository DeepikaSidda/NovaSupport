/**
 * Routing Agent for NovaSupport
 * Analyzes tickets and assigns them to appropriate teams/individuals
 * based on expertise matching and workload balancing
 */

import { Ticket } from '../types/ticket';
import { RoutingDecision } from '../types/agent';
import { analyzeTicket, TicketAnalysis, TeamInfoForAnalysis } from '../utils/ticket-analyzer';
import { scanItems, updateItem, getItem } from '../utils/dynamodb-client';
import { TeamWorkloadRecord, TicketRecord } from '../types/dynamodb-schemas';
import { createLogger } from '../utils/logger';

const logger = createLogger('RoutingAgent');

/**
 * Team information with workload
 */
export interface TeamInfo {
  teamId: string;
  teamName: string;
  description?: string;
  currentTicketCount: number;
  expertise: string[];
}

/**
 * Analyze ticket and make routing decision
 */
export async function analyzeAndRoute(ticket: Ticket): Promise<RoutingDecision> {
  logger.info('Starting routing analysis', { ticketId: ticket.id });

  // Step 1: Get available teams first (so we can pass them to the analyzer)
  const teams = await getAvailableTeams();

  // Step 2: Analyze ticket content with team info for better routing
  const analysis = await analyzeTicket(ticket, teams.map(t => ({
    teamId: t.teamId,
    teamName: t.teamName,
    description: t.description,
    expertise: t.expertise,
  })));

  // Step 3: Match teams to ticket requirements
  const matchingTeams = matchTeamsToTicket(analysis, teams);

  // Step 4: If no teams match, flag for manual routing
  if (matchingTeams.length === 0) {
    logger.warn('No matching teams found, flagging for manual routing', {
      ticketId: ticket.id,
      primaryExpertise: analysis.expertise.primaryExpertise,
    });

    return {
      assignedTo: 'manual-routing-queue',
      reasoning: `No teams found with required expertise: ${analysis.expertise.primaryExpertise}. Manual routing required.`,
      confidence: 0,
      requiresSpecializedExpertise: true,
    };
  }

  // Step 5: Select team with lowest workload
  const selectedTeam = selectTeamByWorkload(matchingTeams);

  // Step 6: Generate routing confidence score
  const confidence = calculateRoutingConfidence(analysis, selectedTeam);

  // Step 7: Identify alternative assignments
  const alternatives = matchingTeams
    .filter(t => t.teamId !== selectedTeam.teamId)
    .slice(0, 2)
    .map(t => ({
      assignedTo: t.teamId,
      confidence: calculateRoutingConfidence(analysis, t),
    }));

  const reasoning = buildRoutingReasoning(analysis, selectedTeam, matchingTeams);

  logger.info('Routing decision complete', {
    ticketId: ticket.id,
    assignedTo: selectedTeam.teamId,
    confidence,
    alternativeCount: alternatives.length,
  });

  return {
    assignedTo: selectedTeam.teamId,
    reasoning,
    confidence,
    alternativeAssignments: alternatives.length > 0 ? alternatives : undefined,
    requiresSpecializedExpertise: analysis.expertise.confidence < 0.7,
  };
}

/**
 * Get all available teams from DynamoDB
 */
async function getAvailableTeams(): Promise<TeamInfo[]> {
  try {
    // Scan for all team workload records
    const records = await scanItems(
      'begins_with(PK, :prefix) AND SK = :sk',
      { ':prefix': 'TEAM#', ':sk': 'WORKLOAD' }
    );

    // Map records to TeamInfo
    const teams: TeamInfo[] = records.map(record => {
      const workloadRecord = record as unknown as TeamWorkloadRecord;
      return {
        teamId: workloadRecord.teamId,
        teamName: workloadRecord.teamName,
        description: workloadRecord.description,
        currentTicketCount: workloadRecord.currentTicketCount || 0,
        expertise: workloadRecord.expertise || [],
      };
    });

    logger.info('Retrieved available teams', { teamCount: teams.length });
    return teams;
  } catch (error) {
    logger.error('Failed to retrieve teams', error instanceof Error ? error : new Error(String(error)));
    // Return empty array to trigger manual routing
    return [];
  }
}

/**
 * Match teams to ticket based on expertise requirements
 */
function matchTeamsToTicket(analysis: TicketAnalysis, teams: TeamInfo[]): TeamInfo[] {
  const primaryExpertise = analysis.expertise.primaryExpertise.toLowerCase();
  const secondaryExpertise = analysis.expertise.secondaryExpertise.map(e => e.toLowerCase());

  const matchingTeams = teams.filter(team => {
    const teamExpertise = team.expertise.map(e => e.toLowerCase());

    // Check if team has primary expertise
    const hasPrimaryExpertise = teamExpertise.some(exp => 
      exp === primaryExpertise || 
      primaryExpertise.includes(exp) ||
      exp.includes(primaryExpertise)
    );

    // Check if team has any secondary expertise
    const hasSecondaryExpertise = secondaryExpertise.length > 0 && secondaryExpertise.some(secExp =>
      teamExpertise.some(exp => 
        exp === secExp || 
        secExp.includes(exp) ||
        exp.includes(secExp)
      )
    );

    // Only use general expertise as fallback if primary expertise is also 'general'
    const hasGeneralExpertise = primaryExpertise === 'general' && teamExpertise.includes('general');

    return hasPrimaryExpertise || hasSecondaryExpertise || hasGeneralExpertise;
  });

  logger.debug('Matched teams to ticket', {
    primaryExpertise,
    matchingTeamCount: matchingTeams.length,
    matchingTeamIds: matchingTeams.map(t => t.teamId),
  });

  return matchingTeams;
}

/**
 * Select team with lowest workload from matching teams
 */
function selectTeamByWorkload(teams: TeamInfo[]): TeamInfo {
  if (teams.length === 0) {
    throw new Error('No teams available for selection');
  }

  // Sort by workload (ascending) and return first
  const sorted = [...teams].sort((a, b) => 
    a.currentTicketCount - b.currentTicketCount
  );

  const selected = sorted[0];

  logger.debug('Selected team by workload', {
    teamId: selected.teamId,
    currentTicketCount: selected.currentTicketCount,
  });

  return selected;
}

/**
 * Calculate routing confidence score
 */
function calculateRoutingConfidence(
  analysis: TicketAnalysis,
  team: TeamInfo
): number {
  // Base confidence from expertise analysis
  let confidence = analysis.expertise.confidence;

  // Boost confidence if team has exact expertise match
  const primaryExpertise = analysis.expertise.primaryExpertise.toLowerCase();
  const teamExpertise = team.expertise.map(e => e.toLowerCase());
  
  const hasExactMatch = teamExpertise.includes(primaryExpertise);
  if (hasExactMatch) {
    confidence = Math.min(1.0, confidence + 0.2);
  }

  // Reduce confidence if team has high workload
  if (team.currentTicketCount > 20) {
    confidence = Math.max(0, confidence - 0.1);
  }

  // Ensure confidence is in valid range [0, 1]
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Build human-readable routing reasoning
 */
function buildRoutingReasoning(
  analysis: TicketAnalysis,
  selectedTeam: TeamInfo,
  allMatchingTeams: TeamInfo[]
): string {
  const parts: string[] = [];

  // Expertise match
  parts.push(
    `Ticket requires ${analysis.expertise.primaryExpertise} expertise.`
  );

  // Team selection
  if (allMatchingTeams.length === 1) {
    parts.push(
      `Assigned to ${selectedTeam.teamName} (only team with matching expertise).`
    );
  } else {
    parts.push(
      `Assigned to ${selectedTeam.teamName} (lowest workload: ${selectedTeam.currentTicketCount} tickets among ${allMatchingTeams.length} qualified teams).`
    );
  }

  // Urgency note
  if (analysis.urgency.urgencyScore >= 8) {
    parts.push(
      `High urgency detected (score: ${analysis.urgency.urgencyScore}/10).`
    );
  }

  // Sentiment note
  if (analysis.sentiment.isFrustrated || analysis.sentiment.isAngry) {
    parts.push(
      `Customer sentiment is ${analysis.sentiment.sentiment}. Handle with care.`
    );
  }

  return parts.join(' ');
}

/**
 * Fallback routing when Nova is unavailable (rule-based)
 */
export async function fallbackRouting(ticket: Ticket): Promise<RoutingDecision> {
  logger.warn('Using fallback routing logic', { ticketId: ticket.id });

  const teams = await getAvailableTeams();

  if (teams.length === 0) {
    return {
      assignedTo: 'manual-routing-queue',
      reasoning: 'No teams available. Manual routing required.',
      confidence: 0,
      requiresSpecializedExpertise: true,
    };
  }

  // Simple rule-based routing: assign to team with lowest workload
  const selectedTeam = selectTeamByWorkload(teams);

  return {
    assignedTo: selectedTeam.teamId,
    reasoning: `Fallback routing to ${selectedTeam.teamName} (lowest workload). Nova unavailable for expertise analysis.`,
    confidence: 0.5,
    requiresSpecializedExpertise: false,
  };
}

/**
 * Assign ticket to team/individual based on routing decision
 * Updates ticket record and team workload counters
 */
export async function assignTicket(
  ticketId: string,
  routingDecision: RoutingDecision
): Promise<void> {
  logger.info('Assigning ticket', {
    ticketId,
    assignedTo: routingDecision.assignedTo,
  });

  const now = new Date().toISOString();

  try {
    // Step 1: Update ticket record with assignment
    await updateTicketAssignment(ticketId, routingDecision, now);

    // Step 2: Update team workload counter (if not manual routing)
    if (routingDecision.assignedTo !== 'manual-routing-queue') {
      await incrementTeamWorkload(routingDecision.assignedTo);
    }

    logger.info('Ticket assignment complete', {
      ticketId,
      assignedTo: routingDecision.assignedTo,
    });
  } catch (error) {
    logger.error('Failed to assign ticket', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Update ticket record with assignment information
 */
async function updateTicketAssignment(
  ticketId: string,
  routingDecision: RoutingDecision,
  timestamp: string
): Promise<void> {
  const pk = `TICKET#${ticketId}`;
  const sk = 'METADATA';

  // Build update expression
  const updateExpression = 
    'SET assignedTo = :assignedTo, ' +
    'assignedTeam = :assignedTeam, ' +
    'routingConfidence = :confidence, ' +
    'updatedAt = :updatedAt, ' +
    'GSI3PK = :gsi3pk, ' +
    'GSI3SK = :gsi3sk';

  const expressionAttributeValues = {
    ':assignedTo': routingDecision.assignedTo,
    ':assignedTeam': routingDecision.assignedTo,
    ':confidence': routingDecision.confidence,
    ':updatedAt': timestamp,
    ':gsi3pk': `TEAM#${routingDecision.assignedTo}`,
    ':gsi3sk': timestamp,
  };

  await updateItem(pk, sk, updateExpression, expressionAttributeValues);

  logger.debug('Updated ticket assignment', { ticketId, assignedTo: routingDecision.assignedTo });
}

/**
 * Increment team workload counter
 */
async function incrementTeamWorkload(teamId: string): Promise<void> {
  const pk = `TEAM#${teamId}`;
  const sk = 'WORKLOAD';

  // Get current team record to check if it exists
  const existingRecord = await getItem(pk, sk);

  if (!existingRecord) {
    logger.warn('Team workload record not found, skipping increment', { teamId });
    return;
  }

  // Increment the counter
  const updateExpression = 
    'SET currentTicketCount = currentTicketCount + :increment, ' +
    'updatedAt = :updatedAt';

  const expressionAttributeValues = {
    ':increment': 1,
    ':updatedAt': new Date().toISOString(),
  };

  await updateItem(pk, sk, updateExpression, expressionAttributeValues);

  logger.debug('Incremented team workload', { teamId });
}

/**
 * Decrement team workload counter (for ticket resolution/reassignment)
 */
export async function decrementTeamWorkload(teamId: string): Promise<void> {
  const pk = `TEAM#${teamId}`;
  const sk = 'WORKLOAD';

  // Get current team record
  const existingRecord = await getItem(pk, sk);

  if (!existingRecord) {
    logger.warn('Team workload record not found, skipping decrement', { teamId });
    return;
  }

  // Decrement the counter (but don't go below 0)
  const updateExpression = 
    'SET currentTicketCount = if_not_exists(currentTicketCount, :zero) - :decrement, ' +
    'updatedAt = :updatedAt';

  const expressionAttributeValues = {
    ':zero': 0,
    ':decrement': 1,
    ':updatedAt': new Date().toISOString(),
  };

  await updateItem(pk, sk, updateExpression, expressionAttributeValues);

  logger.debug('Decremented team workload', { teamId });
}
