/**
 * Auto-Tagging and Categorization Service for NovaSupport
 * Uses Nova 2 Lite to classify ticket content against a predefined taxonomy,
 * assigns multiple tags with confidence scores, and supports custom tags.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { invokeNova2Lite, NovaUnavailableError } from '../utils/nova-client';
import { Ticket } from '../types/ticket';
import { updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('AutoTagger');

// ---------------------------------------------------------------------------
// Predefined Taxonomy (Requirement 10.2)
// ---------------------------------------------------------------------------

export const TAXONOMY = {
  product: [
    'authentication',
    'billing',
    'database',
    'networking',
    'ui',
    'api',
    'storage',
    'compute',
    'monitoring',
  ],
  issueType: [
    'bug',
    'feature-request',
    'question',
    'performance',
    'security',
    'configuration',
    'documentation',
  ],
  severity: ['low', 'medium', 'high', 'critical'],
} as const;

export type TaxonomyCategory = keyof typeof TAXONOMY;

/** Flat set of all taxonomy tags for fast lookup */
export const ALL_TAXONOMY_TAGS: ReadonlySet<string> = new Set([
  ...TAXONOMY.product,
  ...TAXONOMY.issueType,
  ...TAXONOMY.severity,
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single tag with its category and confidence score */
export interface TagResult {
  tag: string;
  category: TaxonomyCategory | 'custom';
  confidence: number; // [0, 1]
}

/** Complete tagging result for a ticket */
export interface TaggingResult {
  ticketId: string;
  tags: TagResult[];
  taggedAt: Date;
}

// ---------------------------------------------------------------------------
// Clamp helper
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Nova-based tagging (primary path)
// ---------------------------------------------------------------------------

/**
 * Build the classification prompt for Nova 2 Lite.
 */
function buildTaggingPrompt(ticket: Ticket): string {
  return `Classify the following support ticket and assign relevant tags.

Subject: ${ticket.subject}
Description: ${ticket.description}

Use the following predefined taxonomy. Assign ALL tags that are relevant.

Product: ${TAXONOMY.product.join(', ')}
Issue Type: ${TAXONOMY.issueType.join(', ')}
Severity: ${TAXONOMY.severity.join(', ')}

For each tag, provide a confidence score between 0 and 1.
If the ticket relates to a topic not covered by the taxonomy, add custom tags.

Respond ONLY with valid JSON in this exact format:
{
  "tags": [
    { "tag": "string", "category": "product" | "issueType" | "severity" | "custom", "confidence": number }
  ]
}`;
}

/**
 * Parse the Nova response into a TaggingResult, normalising and validating
 * every tag and confidence score.
 */
function parseTaggingResponse(responseText: string, ticketId: string): TaggingResult {
  let jsonText = responseText.trim();

  // Strip markdown code fences if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  }

  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed.tags)) {
    throw new Error('Response missing "tags" array');
  }

  const tags: TagResult[] = parsed.tags.map((t: any) => {
    const tag = String(t.tag ?? '').toLowerCase().trim();
    const rawCategory = String(t.category ?? 'custom').toLowerCase().trim();
    const confidence = clamp(Number(t.confidence ?? 0), 0, 1);

    // Determine the real category
    let category: TaxonomyCategory | 'custom';
    if (rawCategory === 'issuetype' || rawCategory === 'issue_type' || rawCategory === 'issue-type') {
      category = 'issueType';
    } else if (rawCategory === 'product' || rawCategory === 'severity') {
      category = rawCategory as TaxonomyCategory;
    } else if (rawCategory === 'custom') {
      category = 'custom';
    } else {
      // If the tag exists in the taxonomy, infer the category
      category = inferCategory(tag);
    }

    return { tag, category, confidence };
  }).filter((t: TagResult) => t.tag.length > 0);

  return { ticketId, tags, taggedAt: new Date() };
}

/**
 * Infer the taxonomy category for a tag by checking membership.
 */
function inferCategory(tag: string): TaxonomyCategory | 'custom' {
  if ((TAXONOMY.product as readonly string[]).includes(tag)) return 'product';
  if ((TAXONOMY.issueType as readonly string[]).includes(tag)) return 'issueType';
  if ((TAXONOMY.severity as readonly string[]).includes(tag)) return 'severity';
  return 'custom';
}

// ---------------------------------------------------------------------------
// Rule-based fallback tagging
// ---------------------------------------------------------------------------

/** Keyword → tag mappings for rule-based fallback */
const PRODUCT_KEYWORDS: Record<string, string[]> = {
  authentication: ['login', 'password', 'auth', 'sign in', 'sign-in', 'access denied', 'sso', 'mfa', 'token'],
  billing: ['payment', 'invoice', 'charge', 'subscription', 'billing', 'price', 'cost', 'refund'],
  database: ['database', 'query', 'sql', 'table', 'dynamo', 'rds', 'data store'],
  networking: ['network', 'connection', 'timeout', 'latency', 'dns', 'vpc', 'load balancer'],
  ui: ['button', 'page', 'display', 'layout', 'interface', 'css', 'frontend', 'render'],
  api: ['api', 'endpoint', 'rest', 'graphql', 'request', 'response', 'http', 'webhook'],
  storage: ['s3', 'bucket', 'file', 'upload', 'download', 'storage', 'object'],
  compute: ['lambda', 'ec2', 'container', 'ecs', 'fargate', 'cpu', 'memory', 'instance'],
  monitoring: ['cloudwatch', 'alarm', 'metric', 'log', 'trace', 'dashboard', 'alert'],
};

const ISSUE_TYPE_KEYWORDS: Record<string, string[]> = {
  bug: ['bug', 'error', 'broken', 'crash', 'fail', 'not working', 'defect', 'issue'],
  'feature-request': ['feature', 'request', 'enhancement', 'wish', 'would be nice', 'suggestion'],
  question: ['how to', 'how do', 'question', 'help', 'what is', 'explain', 'guide'],
  performance: ['slow', 'performance', 'latency', 'speed', 'throughput', 'bottleneck'],
  security: ['security', 'vulnerability', 'breach', 'hack', 'exploit', 'cve'],
  configuration: ['config', 'configuration', 'setting', 'setup', 'parameter', 'environment'],
  documentation: ['documentation', 'docs', 'readme', 'guide', 'tutorial', 'example'],
};

const SEVERITY_KEYWORDS: Record<string, string[]> = {
  critical: ['critical', 'emergency', 'outage', 'down', 'production down', 'p0'],
  high: ['urgent', 'asap', 'important', 'high priority', 'p1', 'major'],
  medium: ['moderate', 'medium', 'p2', 'normal'],
  low: ['low', 'minor', 'cosmetic', 'nice to have', 'p3'],
};

/**
 * Rule-based fallback when Nova is unavailable.
 * Scans ticket content for keyword matches and assigns tags with moderate confidence.
 */
export function fallbackTagging(ticket: Ticket): TaggingResult {
  logger.info('Using rule-based fallback tagging', { ticketId: ticket.id });

  const content = `${ticket.subject} ${ticket.description}`.toLowerCase();
  const tags: TagResult[] = [];

  // Match product tags
  for (const [tag, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
    const matchCount = keywords.filter(k => content.includes(k)).length;
    if (matchCount > 0) {
      tags.push({
        tag,
        category: 'product',
        confidence: clamp(0.3 + matchCount * 0.15, 0, 0.8),
      });
    }
  }

  // Match issue type tags
  for (const [tag, keywords] of Object.entries(ISSUE_TYPE_KEYWORDS)) {
    const matchCount = keywords.filter(k => content.includes(k)).length;
    if (matchCount > 0) {
      tags.push({
        tag,
        category: 'issueType',
        confidence: clamp(0.3 + matchCount * 0.15, 0, 0.8),
      });
    }
  }

  // Match severity tags — pick the highest matching severity
  let bestSeverity: { tag: string; confidence: number } | null = null;
  const severityOrder = ['critical', 'high', 'medium', 'low'];
  for (const sev of severityOrder) {
    const keywords = SEVERITY_KEYWORDS[sev];
    const matchCount = keywords.filter(k => content.includes(k)).length;
    if (matchCount > 0 && !bestSeverity) {
      bestSeverity = { tag: sev, confidence: clamp(0.3 + matchCount * 0.15, 0, 0.8) };
    }
  }
  if (bestSeverity) {
    tags.push({ tag: bestSeverity.tag, category: 'severity', confidence: bestSeverity.confidence });
  }

  // If no tags matched at all, assign a default
  if (tags.length === 0) {
    tags.push({ tag: 'bug', category: 'issueType', confidence: 0.3 });
    tags.push({ tag: 'medium', category: 'severity', confidence: 0.3 });
  }

  return { ticketId: ticket.id, tags, taggedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Tag a ticket using Nova 2 Lite, falling back to rule-based tagging on failure.
 *
 * Requirements: 10.1 (content analysis), 10.2 (taxonomy), 10.3 (multiple tags),
 *               10.4 (confidence scores), 10.5 (custom tags)
 */
export async function tagTicket(ticket: Ticket): Promise<TaggingResult> {
  logger.info('Tagging ticket', { ticketId: ticket.id });

  const prompt = buildTaggingPrompt(ticket);

  try {
    const response = await invokeNova2Lite({
      prompt,
      temperature: 0.3,
      maxTokens: 1024,
    });

    const result = parseTaggingResponse(response.text, ticket.id);

    logger.info('Ticket tagged via Nova', {
      ticketId: ticket.id,
      tagCount: result.tags.length,
    });

    return result;
  } catch (error) {
    if (error instanceof NovaUnavailableError) {
      logger.warn('Nova unavailable, using fallback tagging', { ticketId: ticket.id });
      return fallbackTagging(ticket);
    }
    // Parse errors also fall back
    if (error instanceof SyntaxError || (error instanceof Error && error.message.includes('missing'))) {
      logger.warn('Failed to parse Nova response, using fallback', { ticketId: ticket.id });
      return fallbackTagging(ticket);
    }
    throw error;
  }
}

/**
 * Update ticket tags in DynamoDB.
 */
export async function updateTicketTags(
  ticketId: string,
  taggingResult: TaggingResult
): Promise<void> {
  logger.info('Updating ticket tags in DynamoDB', {
    ticketId,
    tagCount: taggingResult.tags.length,
  });

  const pk = `TICKET#${ticketId}`;
  const sk = 'METADATA';
  const now = new Date().toISOString();

  const tagStrings = taggingResult.tags.map(t => t.tag);

  await updateItem(
    pk,
    sk,
    'SET tags = :tags, updatedAt = :updatedAt',
    {
      ':tags': tagStrings,
      ':updatedAt': now,
    }
  );

  logger.info('Ticket tags updated', { ticketId, tags: tagStrings });
}

/**
 * Full tagging flow: classify and persist.
 */
export async function tagAndUpdateTicket(ticket: Ticket): Promise<TaggingResult> {
  const result = await tagTicket(ticket);
  await updateTicketTags(ticket.id, result);
  return result;
}
