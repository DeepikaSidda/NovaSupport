/**
 * Solution knowledge base types for NovaSupport system
 */

/**
 * DynamoDB item representing a stored solution from a resolved ticket.
 * PK: SOLUTION#<solutionId>, SK: METADATA
 */
export interface SolutionRecord {
  PK: string;
  SK: string;
  solutionId: string;
  ticketId: string;
  problem: string;
  resolution: string;
  rootCause?: string;
  category?: string;
  tags: string[];
  resolvedBy: string;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * DynamoDB item storing the vector embedding for a solution.
 * PK: SOLUTION_EMBEDDING#<solutionId>, SK: VECTOR
 */
export interface SolutionEmbeddingRecord {
  PK: string;
  SK: string;
  solutionId: string;
  problemText: string;
  resolutionText: string;
  vector: number[];
  category?: string;
  createdAt: string;
}

/**
 * Search result returned from similarity search against the solution knowledge base.
 */
export interface SolutionMatch {
  solutionId: string;
  ticketId: string;
  problem: string;
  resolution: string;
  similarityScore: number;
  successRate: number;
  category?: string;
}

/**
 * Input for storing a new solution from a resolved ticket.
 */
export interface StoreSolutionInput {
  ticketId: string;
  subject: string;
  description: string;
  resolution: string;
  rootCause?: string;
  category?: string;
  tags?: string[];
  resolvedBy: string;
}

/**
 * Options for finding matching solutions via similarity search.
 */
export interface FindSolutionsOptions {
  /** Maximum number of results to return (default: 5) */
  limit?: number;
  /** Minimum cosine similarity threshold (default: 0.7) */
  minSimilarity?: number;
}

/**
 * Request body for the PUT /tickets/{id}/resolve endpoint.
 */
export interface ResolveTicketRequest {
  resolution: string;
  rootCause?: string;
  resolvedBy: string;
}
