/**
 * Knowledge Base Service for NovaSupport
 * Handles article CRUD operations and vector store for embeddings
 * 
 * Requirements: 8.1 - Semantic search for relevant articles
 */

import { v4 as uuidv4 } from 'uuid';
import { KnowledgeArticleRecord } from '../types/dynamodb-schemas';
import { KnowledgeBaseResult } from '../types/agent';
import { putItem, getItem, queryItems, updateItem, scanItems } from '../utils/dynamodb-client';
import { formatDate } from '../utils/helpers';

/**
 * Input for creating a new knowledge base article
 */
export interface CreateArticleInput {
  title: string;
  content: string;
  category: string;
  tags?: string[];
  author: string;
}

/**
 * Input for updating an existing article
 */
export interface UpdateArticleInput {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
}

/**
 * Embedding record stored alongside articles for vector search
 */
export interface EmbeddingRecord {
  PK: string;   // "EMBEDDING#<embeddingId>"
  SK: string;   // "VECTOR"
  embeddingId: string;
  articleId: string;
  vector: number[];
  createdAt: string;
}

/**
 * Generate a unique article ID
 */
export function generateArticleId(): string {
  return `ART-${uuidv4()}`;
}

/**
 * Generate a unique embedding ID
 */
export function generateEmbeddingId(): string {
  return `EMB-${uuidv4()}`;
}

/**
 * Create a new knowledge base article
 */
export async function createArticle(input: CreateArticleInput): Promise<KnowledgeArticleRecord> {
  const articleId = generateArticleId();
  const embeddingId = generateEmbeddingId();
  const now = formatDate(new Date());

  if (!input.title || input.title.trim().length === 0) {
    throw new Error('Article title is required');
  }
  if (!input.content || input.content.trim().length === 0) {
    throw new Error('Article content is required');
  }
  if (!input.category || input.category.trim().length === 0) {
    throw new Error('Article category is required');
  }
  if (!input.author || input.author.trim().length === 0) {
    throw new Error('Article author is required');
  }

  const record: KnowledgeArticleRecord = {
    PK: `ARTICLE#${articleId}`,
    SK: 'METADATA',
    articleId,
    title: input.title.trim(),
    content: input.content.trim(),
    category: input.category.trim(),
    tags: input.tags ?? [],
    embeddingId,
    createdAt: now,
    updatedAt: now,
    author: input.author.trim(),
    viewCount: 0,
    helpfulCount: 0,
  };

  await putItem(record);
  return record;
}

/**
 * Get a knowledge base article by ID
 */
export async function getArticle(articleId: string): Promise<KnowledgeArticleRecord | undefined> {
  const item = await getItem(`ARTICLE#${articleId}`, 'METADATA');
  return item as KnowledgeArticleRecord | undefined;
}

/**
 * Update an existing knowledge base article
 */
export async function updateArticle(articleId: string, input: UpdateArticleInput): Promise<KnowledgeArticleRecord> {
  const existing = await getArticle(articleId);
  if (!existing) {
    throw new Error(`Article not found: ${articleId}`);
  }

  const updateParts: string[] = [];
  const expressionValues: Record<string, any> = {};
  const expressionNames: Record<string, string> = {};

  if (input.title !== undefined) {
    if (input.title.trim().length === 0) {
      throw new Error('Article title cannot be empty');
    }
    updateParts.push('#title = :title');
    expressionValues[':title'] = input.title.trim();
    expressionNames['#title'] = 'title';
  }

  if (input.content !== undefined) {
    if (input.content.trim().length === 0) {
      throw new Error('Article content cannot be empty');
    }
    updateParts.push('#content = :content');
    expressionValues[':content'] = input.content.trim();
    expressionNames['#content'] = 'content';
  }

  if (input.category !== undefined) {
    if (input.category.trim().length === 0) {
      throw new Error('Article category cannot be empty');
    }
    updateParts.push('category = :category');
    expressionValues[':category'] = input.category.trim();
  }

  if (input.tags !== undefined) {
    updateParts.push('tags = :tags');
    expressionValues[':tags'] = input.tags;
  }

  const now = formatDate(new Date());
  updateParts.push('updatedAt = :updatedAt');
  expressionValues[':updatedAt'] = now;

  const updateExpression = `SET ${updateParts.join(', ')}`;

  await updateItem(
    `ARTICLE#${articleId}`,
    'METADATA',
    updateExpression,
    expressionValues,
    Object.keys(expressionNames).length > 0 ? expressionNames : undefined
  );

  // Return the updated record
  const updated = await getArticle(articleId);
  return updated!;
}

/**
 * Delete a knowledge base article
 */
export async function deleteArticle(articleId: string): Promise<void> {
  const existing = await getArticle(articleId);
  if (!existing) {
    throw new Error(`Article not found: ${articleId}`);
  }

  // Delete the article by overwriting with a tombstone (DynamoDB delete)
  const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
  const { docClient, TABLE_NAME } = await import('../utils/dynamodb-client');

  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: `ARTICLE#${articleId}`, SK: 'METADATA' },
  }));

  // Also delete the associated embedding if it exists
  if (existing.embeddingId) {
    try {
      await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: `EMBEDDING#${existing.embeddingId}`, SK: 'VECTOR' },
      }));
    } catch {
      // Embedding may not exist yet, ignore
    }
  }
}

/**
 * List all knowledge base articles, optionally filtered by category
 */
export async function listArticles(category?: string): Promise<KnowledgeArticleRecord[]> {
  if (category) {
    const items = await scanItems(
      'category = :category AND begins_with(PK, :prefix)',
      { ':category': category, ':prefix': 'ARTICLE#' }
    );
    return items as KnowledgeArticleRecord[];
  }

  const items = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk',
    { ':prefix': 'ARTICLE#', ':sk': 'METADATA' }
  );
  return items as KnowledgeArticleRecord[];
}

/**
 * Increment the view count for an article
 */
export async function incrementViewCount(articleId: string): Promise<void> {
  await updateItem(
    `ARTICLE#${articleId}`,
    'METADATA',
    'SET viewCount = viewCount + :inc',
    { ':inc': 1 }
  );
}

/**
 * Increment the helpful count for an article
 */
export async function incrementHelpfulCount(articleId: string): Promise<void> {
  await updateItem(
    `ARTICLE#${articleId}`,
    'METADATA',
    'SET helpfulCount = helpfulCount + :inc',
    { ':inc': 1 }
  );
}

/**
 * Store an embedding vector for an article
 */
export async function storeEmbedding(embeddingId: string, articleId: string, vector: number[]): Promise<EmbeddingRecord> {
  const record: EmbeddingRecord = {
    PK: `EMBEDDING#${embeddingId}`,
    SK: 'VECTOR',
    embeddingId,
    articleId,
    vector,
    createdAt: formatDate(new Date()),
  };

  await putItem(record);
  return record;
}

/**
 * Get an embedding by ID
 */
export async function getEmbedding(embeddingId: string): Promise<EmbeddingRecord | undefined> {
  const item = await getItem(`EMBEDDING#${embeddingId}`, 'VECTOR');
  return item as EmbeddingRecord | undefined;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Search the knowledge base using vector similarity.
 * This performs a brute-force cosine similarity search over stored embeddings.
 * For production, this would be replaced with OpenSearch or a dedicated vector DB.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */
export async function searchKnowledgeBase(
  queryVector: number[],
  options: { limit?: number; minRelevance?: number } = {}
): Promise<KnowledgeBaseResult[]> {
  const { limit = 10, minRelevance = 0.6 } = options;

  // Fetch all embeddings (in production, use a vector index)
  const embeddings = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk',
    { ':prefix': 'EMBEDDING#', ':sk': 'VECTOR' }
  ) as EmbeddingRecord[];

  // Compute similarity scores
  const scored = embeddings.map(emb => ({
    embedding: emb,
    score: cosineSimilarity(queryVector, emb.vector),
  }));

  // Filter by minimum relevance threshold (Requirement 8.4)
  const filtered = scored.filter(s => s.score >= minRelevance);

  // Sort by relevance descending (Requirement 8.2)
  filtered.sort((a, b) => b.score - a.score);

  // Take top results
  const topResults = filtered.slice(0, limit);

  // Fetch article details for each result
  const results: KnowledgeBaseResult[] = [];
  for (const result of topResults) {
    const article = await getArticle(result.embedding.articleId);
    if (article) {
      // Extract relevant sections rather than entire document (Requirement 8.3)
      const relevantSections = extractRelevantSections(article.content);

      results.push({
        articleId: article.articleId,
        title: article.title,
        relevantSections,
        relevanceScore: result.score,
      });
    }
  }

  return results;
}

/**
 * Extract relevant sections from article content.
 * Splits content into paragraphs and returns them as sections.
 * In production, this would use more sophisticated section extraction.
 * 
 * Requirement 8.3: Extract most relevant sections rather than entire documents
 */
export function extractRelevantSections(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // Split by double newlines (paragraphs) or markdown headers
  const sections = content
    .split(/\n\n+|\n(?=#{1,6}\s)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Return sections (not the entire document)
  return sections;
}
