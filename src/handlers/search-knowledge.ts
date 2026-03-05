/**
 * Lambda handler for knowledge base search
 * Returns both manually-created articles AND auto-stored solutions from resolved tickets.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listArticles, searchKnowledgeBase } from '../services/knowledge-base';
import { generateEmbeddingWithFallback } from '../utils/embedding-client';
import { scanItems } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('SearchKnowledgeHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

/** Fetch all solution records stored when tickets are resolved */
async function listSolutions(): Promise<any[]> {
  const items = await scanItems(
    'begins_with(PK, :prefix) AND SK = :sk',
    { ':prefix': 'SOLUTION#', ':sk': 'METADATA' }
  );
  return items;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;

    if (method === 'GET') {
      const category = event.queryStringParameters?.category;
      const [articles, solutions] = await Promise.all([
        listArticles(category),
        listSolutions(),
      ]);
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ articles, solutions }) };
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const query = body.query;
      if (!query) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'query is required' } }) };
      }

      // Generate embedding for query and search
      try {
        const embedding = await generateEmbeddingWithFallback({ text: query });
        const results = await searchKnowledgeBase(embedding.embedding, {
          limit: body.limit || 10,
          minRelevance: body.minRelevance || 0.5,
        });
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ results }) };
      } catch (e) {
        // Fallback: return all articles if embedding fails
        const articles = await listArticles();
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ results: articles, fallback: true }) };
      }
    }

    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Method not allowed' } }) };
  } catch (error) {
    logger.error('Error searching knowledge base', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Search failed' } }) };
  }
}
