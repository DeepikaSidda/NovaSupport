/**
 * Solution Knowledge Base Service for NovaSupport
 * Manages storing, retrieving, and searching solution records
 * using vector similarity for AI-powered solution matching.
 *
 * Requirements: 2.1-2.6, 3.1-3.7, 4.1-4.4, 5.1-5.3
 */

import { v4 as uuidv4 } from 'uuid';
import {
  SolutionRecord,
  SolutionEmbeddingRecord,
  SolutionMatch,
  StoreSolutionInput,
  FindSolutionsOptions,
} from '../types/solution';
import { putItem, getItem, updateItem, scanItems } from '../utils/dynamodb-client';
import { generateEmbeddingWithFallback } from '../utils/embedding-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';

const logger = createLogger('SolutionKnowledgeBase');

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 indicates identical direction.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Store a new solution from a resolved ticket into the knowledge base.
 * Generates a vector embedding and stores both the metadata and embedding records.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */
export async function storeSolution(input: StoreSolutionInput): Promise<SolutionRecord> {
  if (!input.ticketId?.trim()) throw new Error('ticketId is required');
  if (!input.subject?.trim()) throw new Error('subject is required');
  if (!input.description?.trim()) throw new Error('description is required');
  if (!input.resolution?.trim() || input.resolution.trim().length < 10) {
    throw new Error('resolution must be at least 10 characters');
  }
  if (!input.resolvedBy?.trim()) throw new Error('resolvedBy is required');

  // Check if a solution already exists for this ticket to prevent duplicates
  const existingSolutions = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk',
    { ':prefix': 'SOLUTION#', ':sk': 'METADATA' }
  );
  const existingForTicket = existingSolutions.find(
    (s: any) => s.ticketId === input.ticketId
  );
  if (existingForTicket) {
    logger.info('Solution already exists for ticket, updating instead of creating duplicate', {
      ticketId: input.ticketId,
      existingSolutionId: existingForTicket.solutionId,
    });
    // Update the existing solution with the new resolution
    const now = formatDate(new Date());
    const combinedText = `Problem: ${input.subject}\n${input.description}\n\nSolution: ${input.resolution}`;
    const { embedding } = await generateEmbeddingWithFallback({ text: combinedText });

    await updateItem(
      `SOLUTION#${existingForTicket.solutionId}`,
      'METADATA',
      'SET resolution = :resolution, rootCause = :rootCause, updatedAt = :now, resolvedBy = :resolvedBy',
      {
        ':resolution': input.resolution.trim(),
        ':rootCause': input.rootCause?.trim() || null,
        ':now': now,
        ':resolvedBy': input.resolvedBy,
      }
    );
    // Update the embedding too
    await putItem({
      PK: `SOLUTION_EMBEDDING#${existingForTicket.solutionId}`,
      SK: 'VECTOR',
      solutionId: existingForTicket.solutionId,
      problemText: `${input.subject}\n${input.description}`,
      resolutionText: input.resolution.trim(),
      vector: embedding,
      category: input.category,
      createdAt: now,
    });

    return existingForTicket as SolutionRecord;
  }

  const solutionId = `SOL-${uuidv4()}`;
  const now = formatDate(new Date());

  const combinedText = `Problem: ${input.subject}\n${input.description}\n\nSolution: ${input.resolution}`;

  logger.info('Storing solution', { solutionId, ticketId: input.ticketId });

  const { embedding } = await generateEmbeddingWithFallback({ text: combinedText });

  const record: SolutionRecord = {
    PK: `SOLUTION#${solutionId}`,
    SK: 'METADATA',
    solutionId,
    ticketId: input.ticketId,
    problem: `${input.subject}\n${input.description}`,
    resolution: input.resolution.trim(),
    rootCause: input.rootCause?.trim(),
    category: input.category,
    tags: input.tags || [],
    resolvedBy: input.resolvedBy,
    successCount: 0,
    failureCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await putItem(record);

  const embeddingRecord: SolutionEmbeddingRecord = {
    PK: `SOLUTION_EMBEDDING#${solutionId}`,
    SK: 'VECTOR',
    solutionId,
    problemText: `${input.subject}\n${input.description}`,
    resolutionText: input.resolution.trim(),
    vector: embedding,
    category: input.category,
    createdAt: now,
  };
  await putItem(embeddingRecord);

  logger.info('Solution stored successfully', { solutionId });
  return record;
}

/**
 * Find solutions matching a query using vector similarity search.
 * Returns results sorted by success rate then similarity score.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */
export async function findMatchingSolutions(
  query: string,
  options: FindSolutionsOptions = {}
): Promise<SolutionMatch[]> {
  const { limit = 5, minSimilarity = 0.7 } = options;

  if (!query?.trim()) return [];

  logger.info('Searching for matching solutions', { queryLength: query.length, limit, minSimilarity });

  const { embedding: queryVector } = await generateEmbeddingWithFallback({ text: query.trim() });

  const embeddings = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk',
    { ':prefix': 'SOLUTION_EMBEDDING#', ':sk': 'VECTOR' }
  ) as SolutionEmbeddingRecord[];

  const scored: Array<{ embedding: SolutionEmbeddingRecord; score: number }> = [];
  for (const emb of embeddings) {
    const score = cosineSimilarity(queryVector, emb.vector);
    if (score >= minSimilarity) {
      scored.push({ embedding: emb, score });
    }
  }

  const matches: SolutionMatch[] = [];
  for (const { embedding: emb, score } of scored) {
    const solution = await getItem(`SOLUTION#${emb.solutionId}`, 'METADATA') as SolutionRecord | undefined;
    if (!solution) continue;

    const total = solution.successCount + solution.failureCount;
    const successRate = total > 0 ? solution.successCount / total : 0.5;

    matches.push({
      solutionId: emb.solutionId,
      ticketId: solution.ticketId,
      problem: emb.problemText,
      resolution: emb.resolutionText,
      similarityScore: score,
      successRate,
      category: emb.category,
    });
  }

  matches.sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    return b.similarityScore - a.similarityScore;
  });

  logger.info('Solution search complete', { totalEmbeddings: embeddings.length, matchesFound: matches.length });
  return matches.slice(0, limit);
}

/**
 * Record feedback on whether a solution was helpful.
 * Increments the appropriate counter and updates the timestamp.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */
export async function recordSolutionFeedback(solutionId: string, wasHelpful: boolean): Promise<void> {
  const now = formatDate(new Date());
  const counterField = wasHelpful ? 'successCount' : 'failureCount';

  logger.info('Recording solution feedback', { solutionId, wasHelpful });

  await updateItem(
    `SOLUTION#${solutionId}`,
    'METADATA',
    `ADD ${counterField} :inc SET updatedAt = :now`,
    { ':inc': 1, ':now': now }
  );
}

/**
 * Get a solution record by its ID.
 * Returns undefined if the solution does not exist.
 *
 * Requirements: 5.1, 5.2, 5.3
 */
export async function getSolution(solutionId: string): Promise<SolutionRecord | undefined> {
  const item = await getItem(`SOLUTION#${solutionId}`, 'METADATA');
  return item as SolutionRecord | undefined;
}
