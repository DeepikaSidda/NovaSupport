/**
 * AgentCore Memory integration for NovaSupport.
 *
 * Gives the support agents persistent, semantic long-term memory across
 * tickets. After a ticket is processed, the resolution is written as an
 * event; before the response agent runs, semantically similar past
 * resolutions are recalled and injected into the workflow context.
 *
 * This module is intentionally defensive: if the AGENTCORE_MEMORY_ID
 * environment variable is not set (i.e. the Memory resource has not been
 * provisioned yet), every operation becomes a safe no-op so the existing
 * workflow keeps running unchanged.
 *
 * Data-plane SDK: @aws-sdk/client-bedrock-agentcore
 * Required IAM: bedrock-agentcore:CreateEvent, bedrock-agentcore:RetrieveMemoryRecords
 */

import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  RetrieveMemoryRecordsCommand,
  Role,
} from '@aws-sdk/client-bedrock-agentcore';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentCoreMemory');

/** Minimal ticket shape needed for memory operations. `Ticket` satisfies this. */
export interface TicketLike {
  id: string;
  subject?: string;
  description?: string;
}

/** The memory resource id, set once the AgentCore Memory resource is provisioned. */
const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID;

/**
 * Namespace prefix used when retrieving long-term memory records. Must align
 * with the namespace(s) configured on the Memory resource's semantic strategy.
 */
const MEMORY_NAMESPACE = process.env.AGENTCORE_MEMORY_NAMESPACE || 'support/resolutions';

const REGION = process.env.AWS_REGION || 'us-east-1';

/** A past resolution recalled from long-term memory, for use as response context. */
export interface PastResolution {
  /** The semantic memory record text (e.g. a prior ticket + how it was resolved). */
  content: string;
  /** Relevance score in [0, 1]; higher means more similar to the current ticket. */
  score: number;
  /** Memory record id, for traceability. */
  recordId?: string;
  /** Namespaces the record belongs to, e.g. ["support/resolutions/<team>"]. */
  namespaces?: string[];
}

/**
 * Extract the team (actorId) encoded in a memory namespace of the form
 * `support/resolutions/<team>`. Returns undefined if no team segment exists.
 */
export function extractTeamFromNamespace(namespaces?: string[]): string | undefined {
  if (!namespaces) return undefined;
  for (const ns of namespaces) {
    const m = ns.match(/support\/resolutions\/(.+)$/);
    if (m && m[1] && m[1] !== '{actorId}' && m[1] !== 'novasupport') {
      return m[1];
    }
  }
  return undefined;
}

let client: BedrockAgentCoreClient | undefined;

function getClient(): BedrockAgentCoreClient {
  if (!client) {
    client = new BedrockAgentCoreClient({ region: REGION });
  }
  return client;
}

/** Whether AgentCore Memory is configured for this environment. */
export function isMemoryEnabled(): boolean {
  return !!MEMORY_ID;
}

/**
 * Sanitize a value into a valid AgentCore actorId.
 * actorId pattern: [a-zA-Z0-9][a-zA-Z0-9-_/]*
 */
function toActorId(value: string | undefined): string {
  const cleaned = (value || 'novasupport').replace(/[^a-zA-Z0-9\-_/]/g, '-');
  return /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : `team-${cleaned}`;
}

/**
 * Sanitize a value into a valid AgentCore sessionId.
 * sessionId pattern: [a-zA-Z0-9][a-zA-Z0-9-_]*
 */
function toSessionId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9\-_]/g, '-');
  return /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : `tkt-${cleaned}`;
}

/**
 * Build a concise text summary of a ticket for use as a memory search query
 * or as the "user" turn of a stored conversational event.
 */
function ticketSummary(ticket: TicketLike): string {
  const subject = (ticket.subject || '').trim();
  const description = (ticket.description || '').trim();
  return `${subject}\n\n${description}`.trim().slice(0, 4000);
}

/**
 * Record a resolved ticket and its resolution into long-term memory.
 *
 * Stored as a two-turn conversational event:
 *   user      -> the ticket subject + description
 *   assistant -> the resolution / routing reasoning
 *
 * AgentCore's semantic strategy extracts long-term records from these events
 * in the background. Failures are logged and swallowed — recording memory must
 * never break ticket processing.
 */
export async function recordResolution(params: {
  ticket: TicketLike;
  resolution: string;
  team?: string;
  confidence?: number;
}): Promise<void> {
  if (!isMemoryEnabled()) {
    return;
  }

  const { ticket, resolution, team, confidence } = params;

  try {
    const actorId = toActorId(team);
    const sessionId = toSessionId(ticket.id);

    const resolutionText = [
      resolution,
      team ? `Handled by team: ${team}.` : undefined,
      typeof confidence === 'number' ? `Confidence: ${confidence.toFixed(2)}.` : undefined,
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 4000);

    await getClient().send(
      new CreateEventCommand({
        memoryId: MEMORY_ID,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        payload: [
          { conversational: { role: Role.USER, content: { text: ticketSummary(ticket) } } },
          { conversational: { role: Role.ASSISTANT, content: { text: resolutionText } } },
        ],
      })
    );

    logger.info('Recorded resolution to AgentCore Memory', {
      ticketId: ticket.id,
      actorId,
      sessionId,
    });
  } catch (error) {
    logger.warn('Failed to record resolution to AgentCore Memory (non-fatal)', {
      ticketId: ticket.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Recall semantically similar past resolutions for a ticket.
 *
 * Returns an empty array when memory is disabled or on any error, so callers
 * can treat the result as "best effort" context.
 */
export async function recallSimilarResolutions(
  ticket: TicketLike,
  topK = 3
): Promise<PastResolution[]> {
  if (!isMemoryEnabled()) {
    return [];
  }

  try {
    const result = await getClient().send(
      new RetrieveMemoryRecordsCommand({
        memoryId: MEMORY_ID,
        namespace: MEMORY_NAMESPACE,
        searchCriteria: {
          searchQuery: ticketSummary(ticket),
          topK,
        },
        maxResults: topK,
      })
    );

    const summaries = result.memoryRecordSummaries || [];
    const resolutions: PastResolution[] = summaries
      .map(s => ({
        content: s.content?.text || '',
        score: s.score ?? 0,
        recordId: s.memoryRecordId,
        namespaces: s.namespaces,
      }))
      .filter(r => r.content.length > 0);

    logger.info('Recalled past resolutions from AgentCore Memory', {
      ticketId: ticket.id,
      count: resolutions.length,
    });

    return resolutions;
  } catch (error) {
    logger.warn('Failed to recall resolutions from AgentCore Memory (non-fatal)', {
      ticketId: ticket.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
