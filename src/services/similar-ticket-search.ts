/**
 * Similar Ticket Search Service for NovaSupport
 * Generates embeddings for tickets and finds similar historical tickets
 * using vector similarity search.
 *
 * Requirements:
 * - 9.1: Search for similar tickets using semantic similarity
 * - 9.2: Link tickets with similarity scores above 0.75
 * - 9.3: Prioritize resolved tickets with successful outcomes
 * - 9.5: Search across all historical tickets regardless of age
 */

import { Ticket, TicketStatus } from '../types/ticket';
import { SimilarTicket } from '../types/agent';
import { generateEmbeddingWithFallback } from '../utils/embedding-client';
import { putItem, getItem, scanItems } from '../utils/dynamodb-client';
import { cosineSimilarity } from './knowledge-base';
import { formatDate } from '../utils/helpers';
import { createLogger } from '../utils/logger';

const logger = createLogger('SimilarTicketSearch');

/** Default similarity threshold (Requirement 9.2) */
const DEFAULT_MIN_SIMILARITY = 0.75;

/** Default maximum number of similar tickets to return */
const DEFAULT_LIMIT = 5;

/**
 * Embedding record stored for ticket similarity search
 */
export interface TicketEmbeddingRecord {
  PK: string;       // "TICKET_EMBEDDING#<ticketId>"
  SK: string;       // "VECTOR"
  ticketId: string;
  subject: string;
  description: string;
  vector: number[];
  status?: string;
  resolution?: string;
  wasSuccessful?: boolean;
  createdAt: string;
}

/**
 * Options for finding similar tickets
 */
export interface FindSimilarTicketsOptions {
  /** Maximum number of results to return (default: 5) */
  limit?: number;
  /** Minimum similarity score threshold (default: 0.75) */
  minSimilarity?: number;
}

/**
 * Store an embedding for a ticket's description.
 * Combines subject and description for a richer embedding representation.
 *
 * @param ticketId - The ticket ID
 * @param subject - The ticket subject
 * @param description - The ticket description
 * @param metadata - Optional metadata (status, resolution, wasSuccessful)
 */
export async function storeTicketEmbedding(
  ticketId: string,
  subject: string,
  description: string,
  metadata?: { status?: string; resolution?: string; wasSuccessful?: boolean }
): Promise<TicketEmbeddingRecord> {
  if (!ticketId || ticketId.trim().length === 0) {
    throw new Error('Ticket ID is required');
  }
  if (!subject || subject.trim().length === 0) {
    throw new Error('Ticket subject is required');
  }
  if (!description || description.trim().length === 0) {
    throw new Error('Ticket description is required');
  }

  const combinedText = `${subject.trim()}\n\n${description.trim()}`;

  logger.info('Generating embedding for ticket', { ticketId, textLength: combinedText.length });

  const response = await generateEmbeddingWithFallback({ text: combinedText });

  const record: TicketEmbeddingRecord = {
    PK: `TICKET_EMBEDDING#${ticketId}`,
    SK: 'VECTOR',
    ticketId,
    subject: subject.trim(),
    description: description.trim(),
    vector: response.embedding,
    status: metadata?.status,
    resolution: metadata?.resolution,
    wasSuccessful: metadata?.wasSuccessful,
    createdAt: formatDate(new Date()),
  };

  await putItem(record);

  logger.info('Ticket embedding stored', {
    ticketId,
    vectorLength: response.embedding.length,
  });

  return record;
}

/**
 * Get a stored ticket embedding by ticket ID.
 */
export async function getTicketEmbedding(ticketId: string): Promise<TicketEmbeddingRecord | undefined> {
  const item = await getItem(`TICKET_EMBEDDING#${ticketId}`, 'VECTOR');
  return item as TicketEmbeddingRecord | undefined;
}

/**
 * Find similar historical tickets using vector similarity search.
 *
 * 1. Generates an embedding for the input ticket
 * 2. Scans all stored ticket embeddings (Requirement 9.5)
 * 3. Computes cosine similarity between the query and each stored embedding
 * 4. Filters results below the similarity threshold (Requirement 9.2)
 * 5. Sorts results: resolved+successful first, then by similarity descending (Requirement 9.3)
 *
 * @param ticket - The ticket to find similar tickets for
 * @param options - Search options (limit, minSimilarity)
 * @returns Array of similar tickets sorted by priority and similarity
 */
export async function findSimilarTickets(
  ticket: Ticket,
  options: FindSimilarTicketsOptions = {}
): Promise<SimilarTicket[]> {
  const { limit = DEFAULT_LIMIT, minSimilarity = DEFAULT_MIN_SIMILARITY } = options;

  logger.info('Finding similar tickets', {
    ticketId: ticket.id,
    limit,
    minSimilarity,
  });

  // Generate embedding for the query ticket
  const combinedText = `${ticket.subject}\n\n${ticket.description}`;
  const response = await generateEmbeddingWithFallback({ text: combinedText });
  const queryVector = response.embedding;

  // Scan all ticket embeddings (Requirement 9.5: search across all historical tickets)
  const embeddings = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk',
    { ':prefix': 'TICKET_EMBEDDING#', ':sk': 'VECTOR' }
  ) as TicketEmbeddingRecord[];

  logger.info('Scanned ticket embeddings', { count: embeddings.length });

  // Compute similarity and filter
  const scored: Array<{ record: TicketEmbeddingRecord; score: number }> = [];

  for (const emb of embeddings) {
    // Skip the ticket itself
    if (emb.ticketId === ticket.id) {
      continue;
    }

    const score = cosineSimilarity(queryVector, emb.vector);

    // Filter by minimum similarity threshold (Requirement 9.2)
    if (score >= minSimilarity) {
      scored.push({ record: emb, score });
    }
  }

  // Sort: resolved+successful first, then by similarity descending (Requirement 9.3)
  scored.sort((a, b) => {
    const aResolved = isResolvedSuccessful(a.record);
    const bResolved = isResolvedSuccessful(b.record);

    // Resolved+successful tickets come first
    if (aResolved && !bResolved) return -1;
    if (!aResolved && bResolved) return 1;

    // Within the same group, sort by similarity descending
    return b.score - a.score;
  });

  // Take top results up to limit
  const topResults = scored.slice(0, limit);

  const results: SimilarTicket[] = topResults.map(({ record, score }) => ({
    ticketId: record.ticketId,
    subject: record.subject,
    similarityScore: score,
    resolution: record.resolution,
    wasSuccessful: record.wasSuccessful ?? false,
  }));

  logger.info('Similar tickets found', {
    ticketId: ticket.id,
    resultCount: results.length,
    topScore: results.length > 0 ? results[0].similarityScore : null,
  });

  return results;
}

/**
 * Check if a ticket embedding record represents a resolved ticket with a successful outcome.
 */
function isResolvedSuccessful(record: TicketEmbeddingRecord): boolean {
  return (
    (record.status === TicketStatus.RESOLVED || record.status === TicketStatus.CLOSED) &&
    record.wasSuccessful === true
  );
}
