/**
 * Assignment Agent for NovaSupport
 * Takes team-routed tickets and assigns them to individual team members
 * using round-robin distribution (excludes leads and managers).
 * 
 * Flow: Routing Agent → Team → Assignment Agent → Individual Member
 */

import { queryItems, updateItem, getItem, atomicIncrement } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('AssignmentAgent');

export interface TeamMember {
  memberId: string;
  name: string;
  email: string;
  role: 'member' | 'lead' | 'manager';
  teamId: string;
  currentTicketCount: number;
}

export interface AssignmentDecision {
  ticketId: string;
  teamId: string;
  assignedTo: string;       // member name
  assignedMemberId: string;  // member ID/email
  method: 'round-robin';
  reasoning: string;
}

/**
 * Get eligible team members (role === 'member' only, excludes lead/manager)
 */
export async function getEligibleMembers(teamId: string): Promise<TeamMember[]> {
  logger.info('Fetching eligible members for team', { teamId });

  try {
    // Use queryItems instead of scanItems for consistent ordering by SK
    const records = await queryItems(
      'PK = :pk AND begins_with(SK, :sk)',
      { ':pk': `TEAM#${teamId}`, ':sk': 'MEMBER#' }
    );

    const members: TeamMember[] = records
      .filter((r: any) => (r.role || r.memberRole) === 'member')
      .map((r: any) => ({
        memberId: r.memberId || r.memberEmail || r.email,
        name: r.memberName || r.name,
        email: r.memberEmail || r.email,
        role: r.role || r.memberRole,
        teamId,
        currentTicketCount: r.currentTicketCount || 0,
      }));

    // Sort by memberId for deterministic round-robin ordering
    members.sort((a, b) => a.memberId.localeCompare(b.memberId));

    logger.info('Found eligible members', { teamId, count: members.length });
    return members;
  } catch (error) {
    logger.warn('Failed to fetch team members from DB, returning empty', { teamId });
    return [];
  }
}

/**
 * Atomically get the next round-robin index for a team.
 * Uses DynamoDB atomic ADD to prevent race conditions when
 * multiple tickets are processed concurrently.
 * Returns the counter value AFTER increment (1-based).
 */
async function getNextRoundRobinCounter(teamId: string): Promise<number> {
  const pk = `TEAM#${teamId}`;
  const sk = 'ROUND_ROBIN';

  try {
    const newCounter = await atomicIncrement(pk, sk, 'counter', {
      expression: 'SET updatedAt = :ts',
      values: { ':ts': new Date().toISOString() },
    });
    return newCounter;
  } catch (error) {
    logger.error('Failed to atomically increment round-robin counter', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Assign a ticket to the next team member via round-robin.
 * This is the main entry point — called after the routing agent assigns a ticket to a team.
 */
export async function assignToMember(
  ticketId: string,
  teamId: string
): Promise<AssignmentDecision | null> {
  logger.info('Assignment agent processing ticket', { ticketId, teamId });

  // Step 1: Get eligible members
  const members = await getEligibleMembers(teamId);
  if (members.length === 0) {
    logger.warn('No eligible members for round-robin, ticket stays team-assigned', { ticketId, teamId });
    return null;
  }

  // Step 2: Atomically get next round-robin counter (prevents race conditions)
  const counter = await getNextRoundRobinCounter(teamId);

  // Step 3: Pick member using modulo — counter is 1-based from ADD
  const nextIndex = (counter - 1) % members.length;
  const selectedMember = members[nextIndex];

  logger.info('Round-robin selected member', {
    ticketId,
    teamId,
    memberName: selectedMember.name,
    memberIndex: nextIndex,
    counter,
    totalMembers: members.length,
  });

  // Step 4: Update ticket in DynamoDB
  try {
    await updateItem(
      `TICKET#${ticketId}`, 'METADATA',
      'SET assignedTo = :member, assignedMemberEmail = :email, assignedTeam = :team, updatedAt = :ts',
      {
        ':member': selectedMember.name,
        ':email': selectedMember.email,
        ':team': teamId,
        ':ts': new Date().toISOString(),
      }
    );
  } catch (error) {
    logger.error('Failed to update ticket assignment', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }

  // Step 5: Increment member workload
  try {
    await updateItem(
      `TEAM#${teamId}`, `MEMBER#${selectedMember.memberId}`,
      'SET currentTicketCount = if_not_exists(currentTicketCount, :zero) + :one, updatedAt = :ts',
      { ':zero': 0, ':one': 1, ':ts': new Date().toISOString() }
    );
  } catch (error) {
    logger.warn('Failed to update member workload counter', { memberId: selectedMember.memberId });
  }

  const decision: AssignmentDecision = {
    ticketId,
    teamId,
    assignedTo: selectedMember.name,
    assignedMemberId: selectedMember.memberId,
    method: 'round-robin',
    reasoning: `Round-robin assignment: member ${nextIndex + 1} of ${members.length} eligible members in ${teamId}. Selected ${selectedMember.name} (${selectedMember.email}).`,
  };

  logger.info('Assignment complete', decision);
  return decision;
}

/**
 * Batch assign multiple tickets to team members.
 * Useful for redistributing all team tickets evenly.
 */
export async function batchAssignTickets(
  tickets: Array<{ ticketId: string; teamId: string }>
): Promise<AssignmentDecision[]> {
  logger.info('Batch assigning tickets', { count: tickets.length });

  const results: AssignmentDecision[] = [];

  for (const ticket of tickets) {
    const decision = await assignToMember(ticket.ticketId, ticket.teamId);
    if (decision) results.push(decision);
  }

  logger.info('Batch assignment complete', {
    total: tickets.length,
    assigned: results.length,
    skipped: tickets.length - results.length,
  });

  return results;
}
