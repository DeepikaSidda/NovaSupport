/**
 * Lambda handler for AI Live Chat Assistant
 * Implements Task 2: Chat assistant handler core logic
 *
 * Requirements: 1.1-1.6, 2.1, 2.2, 3.1-3.4, 5.1, 5.3, 5.4
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  ChatMessageRecord,
  ChatSessionRecord,
  IssueCategory,
  CATEGORY_TEAM_MAP,
  VALID_CATEGORIES,
} from '../types/chat';
import { TicketStatus, Priority } from '../types/ticket';
import { TicketRecord } from '../types/dynamodb-schemas';
import {
  generateTicketId,
  generateChatMessageSK,
  formatDate,
} from '../utils/helpers';
import { putItem, queryItems, updateItem } from '../utils/dynamodb-client';
import {
  invokeNova2Lite,
  invokeNova2LiteWithFallback,
} from '../utils/nova-client';
import { searchKnowledgeBase } from '../services/knowledge-base';
import { findMatchingSolutions } from '../services/solution-knowledge-base';
import { SolutionMatch } from '../types/solution';
import { sendTicketForProcessing } from '../utils/sqs-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('ChatAssistantHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const FALLBACK_RESPONSE =
  "I'm temporarily unable to process your request. Please try again or create a ticket manually.";

/**
 * Validate chat request body for required fields.
 * Returns an array of error strings (empty if valid).
 */
export function validateChatRequest(body: any): string[] {
  const errors: string[] = [];

  if (!body || typeof body !== 'object') {
    return ['Request body must be a valid object'];
  }

  if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
    errors.push('message is required and must be a non-empty string');
  }

  if (!body.sessionId || typeof body.sessionId !== 'string' || body.sessionId.trim() === '') {
    errors.push('sessionId is required and must be a non-empty string');
  }

  if (!body.userId || typeof body.userId !== 'string' || body.userId.trim() === '') {
    errors.push('userId is required and must be a non-empty string');
  }

  return errors;
}

/**
 * Get the team ID for a given issue category.
 */
export function getCategoryTeam(category: IssueCategory): string {
  return CATEGORY_TEAM_MAP[category] || 'general-support';
}

/**
 * Classify a user message into one of the valid issue categories using Nova AI.
 * Defaults to "general" if classification fails or returns an unexpected value.
 *
 * Requirements: 1.2
 */
export async function classifyIssue(
  message: string,
  history: ChatMessage[],
): Promise<IssueCategory> {
  try {
    const historyText = history
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `Classify the following customer support message into exactly one category. Categories: billing, technical, account, general. Message: ${message}. Recent conversation context: ${historyText}. Respond with ONLY the category name, nothing else.`;

    const response = await invokeNova2Lite({
      prompt,
      temperature: 0.1,
      maxTokens: 20,
    });

    const category = response.text.trim().toLowerCase() as IssueCategory;

    if (VALID_CATEGORIES.includes(category)) {
      return category;
    }

    logger.warn('Unexpected classification result, defaulting to general', {
      rawResult: response.text,
    });
    return 'general';
  } catch (error) {
    logger.error(
      'Classification failed, defaulting to general',
      error instanceof Error ? error : undefined,
    );
    return 'general';
  }
}

/**
 * Calculate confidence score from knowledge base results and similar tickets.
 *
 * kbResults: array of objects with `relevanceScore` (0-1)
 * similarTickets: array of objects with `similarityScore` (0-1) and `wasSuccessful` (boolean)
 *
 * Requirements: 1.4
 */
export function calculateChatConfidence(
  kbResults: Array<{ relevanceScore: number }>,
  similarTickets: Array<{ similarityScore: number; wasSuccessful: boolean }>,
): number {
  if (kbResults.length === 0 && similarTickets.length === 0) {
    return 0.1;
  }

  const kbScore =
    kbResults.length > 0
      ? kbResults.reduce((sum, r) => sum + r.relevanceScore, 0) / kbResults.length
      : 0;

  let ticketScore = 0;
  if (similarTickets.length > 0) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const t of similarTickets) {
      const weight = t.wasSuccessful ? 1.2 : 1;
      weightedSum += Math.min(t.similarityScore * weight, 1);
      weightTotal += 1;
    }
    ticketScore = weightedSum / weightTotal;
  }

  const confidence = 0.6 * kbScore + 0.4 * ticketScore;
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Process a user message: classify, search context, generate AI response,
 * calculate confidence, persist messages, and return a ChatResponse.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 2.1, 5.3
 */
export async function processMessage(request: ChatRequest): Promise<ChatResponse> {
  const { message, sessionId, userId, conversationHistory } = request;
  const now = new Date();
  const timestamp = formatDate(now);

  // Store user message in DynamoDB
  const userRecord: ChatMessageRecord = {
    PK: `CHAT#${sessionId}`,
    SK: generateChatMessageSK(timestamp),
    sessionId,
    userId,
    role: 'user',
    content: message,
    timestamp,
  };
  await putItem(userRecord);

  // Classify the issue
  const category = await classifyIssue(message, conversationHistory || []);

  // Search knowledge base (pass empty vector — real embeddings in production)
  let kbResults: any[] = [];
  try {
    kbResults = await searchKnowledgeBase([], { limit: 5, minRelevance: 0.3 });
  } catch (error) {
    logger.warn('Knowledge base search failed, continuing without KB results', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Search similar tickets — gracefully skip (needs a real Ticket object)
  let similarTickets: any[] = [];
  try {
    // In production, would call findSimilarTickets with a real Ticket object.
    // For now, we skip gracefully and return an empty array.
  } catch (error) {
    logger.warn('Similar ticket search failed, continuing without similar tickets', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Search solution knowledge base for proven solutions
  let solutionMatches: SolutionMatch[] = [];
  try {
    solutionMatches = await findMatchingSolutions(message, {
      limit: 3,
      minSimilarity: 0.7,
    });
  } catch (error) {
    logger.warn('Solution KB search failed, continuing without solutions', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Build prompt for Nova AI response generation
  const historyText = (conversationHistory || [])
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const kbContext = kbResults
    .map((r: any) => `Article: ${r.title || 'Untitled'} (relevance: ${r.relevanceScore})`)
    .join('\n');

  const solutionContext = solutionMatches
    .map((s, i) => `Solution ${i + 1} (${Math.round(s.similarityScore * 100)}% match, ${Math.round(s.successRate * 100)}% success rate):\nProblem: ${s.problem}\nResolution: ${s.resolution}`)
    .join('\n\n');

  const prompt = `You are NovaSupport AI, a live chat assistant. You are having a real-time conversation with a customer. 

IMPORTANT RULES:
- Respond in a casual, friendly, conversational tone — like a real chat, NOT an email
- NEVER include greetings like "Dear customer" or sign-offs like "Best regards" or "[Your Name]"
- NEVER use email formatting or letter formatting
- Keep responses short and direct (2-4 sentences max)
- If you don't know the answer, say so honestly and offer to connect them with a human agent
- Use the customer's context to give specific, actionable help

Category: ${category}
User message: ${message}

Conversation history:
${historyText || 'No prior history.'}

Knowledge base context:
${kbContext || 'No relevant articles found.'}
${solutionContext ? `\nProven solutions from resolved tickets:\n${solutionContext}\n\nIMPORTANT: If any proven solution closely matches the user's issue, present that solution first. Mention it has been verified by the support team.` : ''}

Respond naturally as a chat assistant:`;

  const novaResponse = await invokeNova2LiteWithFallback(
    { prompt, temperature: 0.7, maxTokens: 1024 },
    FALLBACK_RESPONSE,
  );

  // Calculate confidence
  const confidence = calculateChatConfidence(
    kbResults.map((r: any) => ({ relevanceScore: r.relevanceScore ?? 0 })),
    similarTickets.map((t: any) => ({
      similarityScore: t.similarityScore ?? 0,
      wasSuccessful: t.wasSuccessful ?? false,
    })),
  );

  // Boost confidence when high-quality solutions are found
  let adjustedConfidence = confidence;
  if (solutionMatches.length > 0 && solutionMatches[0].similarityScore > 0.85) {
    adjustedConfidence = Math.min(1.0, confidence + 0.15);
  }

  // Store assistant message in DynamoDB
  const assistantTimestamp = formatDate(new Date());
  const assistantRecord: ChatMessageRecord = {
    PK: `CHAT#${sessionId}`,
    SK: generateChatMessageSK(assistantTimestamp),
    sessionId,
    userId,
    role: 'assistant',
    content: novaResponse.text,
    category,
    confidence: adjustedConfidence,
    timestamp: assistantTimestamp,
  };
  await putItem(assistantRecord);

  // Build response based on confidence threshold
  const suggestedActions: string[] = [];
  const referencedArticles: string[] = [];

  if (adjustedConfidence > 0.7) {
    // High confidence — include referenced articles
    for (const r of kbResults) {
      if (r.title) {
        referencedArticles.push(r.title);
      }
    }
  } else {
    // Low confidence — suggest escalation
    suggestedActions.push('escalate');
  }

  return {
    sessionId,
    response: novaResponse.text,
    confidence: adjustedConfidence,
    category,
    suggestedActions,
    referencedArticles,
  };
}

/**
 * Handle escalation: retrieve chat history, create a support ticket with
 * the full transcript, route to the appropriate team, and return escalation info.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function handleEscalation(request: ChatRequest): Promise<ChatResponse> {
  const { sessionId, userId, conversationHistory, message } = request;
  const now = new Date();
  const timestamp = formatDate(now);

  // Use conversationHistory from request as primary source (always available from client),
  // fall back to DynamoDB query if conversationHistory is empty
  let chatMessages: Array<{ role: string; content: string }> = [];

  if (conversationHistory && conversationHistory.length > 0) {
    chatMessages = conversationHistory;
    logger.info('Using conversationHistory from request', { count: chatMessages.length });
  } else {
    // Fallback: Query DynamoDB for all messages in this session
    const dbMessages = await queryItems(
      'PK = :pk AND begins_with(SK, :skPrefix)',
      { ':pk': `CHAT#${sessionId}`, ':skPrefix': 'MESSAGE#' },
    );
    dbMessages.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    chatMessages = dbMessages.map((m) => ({ role: String(m.role || 'user'), content: String(m.content || '') }));
    logger.info('Using DynamoDB messages as fallback', { count: chatMessages.length });
  }

  // Build ticket description from chat transcript
  const transcript = chatMessages
    .map((m) => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${m.content}`;
    })
    .join('\n\n');

  const description = `Chat Escalation Transcript:\n\n${transcript}`;

  // Classify the issue for team routing
  const category = await classifyIssue(message, conversationHistory || []);
  const assignedTeam = getCategoryTeam(category);

  // Build ticket subject using Nova to summarize the conversation
  let subject: string;
  try {
    const userMessages = chatMessages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' | ');
    logger.info('Generating summary subject from user messages', { userMessages: userMessages.substring(0, 200) });
    const summaryPrompt = `Summarize this customer support conversation into a short ticket subject line (max 80 characters). Focus on the actual technical issue, not greetings. If the conversation is just greetings with no real issue, write "General Support Request".

Customer messages: ${userMessages || message}

Respond with ONLY the subject line, nothing else.`;
    const summaryResult = await invokeNova2Lite({ prompt: summaryPrompt, temperature: 0.3, maxTokens: 100 });
    logger.info('Nova summary result', { text: summaryResult.text });
    const generatedSubject = (summaryResult.text || '').trim().replace(/^["']|["']$/g, '').substring(0, 80);
    subject = `[Chat Escalation - ${category}] ${generatedSubject || 'Support Request'}`;
  } catch (err) {
    logger.warn('Failed to generate summary subject, using fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
    const firstUserMessage = chatMessages.find((m) => m.role === 'user');
    const briefSummary = firstUserMessage
      ? firstUserMessage.content.substring(0, 80)
      : message.substring(0, 80);
    subject = `[Chat Escalation - ${category}] ${briefSummary}`;
  }

  // Create ticket (same pattern as create-ticket.ts)
  const ticketId = generateTicketId();

  const ticketRecord: TicketRecord = {
    PK: `TICKET#${ticketId}`,
    SK: 'METADATA',
    ticketId,
    userId: userId.trim(),
    subject,
    description,
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    assignedTeam,
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: ['chat-escalation'],
    category,
    attachmentIds: [],
    GSI1PK: `USER#${userId.trim()}`,
    GSI1SK: timestamp,
    GSI2PK: `STATUS#${TicketStatus.NEW}`,
    GSI2SK: `${Priority.MEDIUM}#${timestamp}`,
    GSI3PK: `TEAM#${assignedTeam}`,
    GSI3SK: timestamp,
  };

  await putItem(ticketRecord);
  logger.info('Escalation ticket created', { ticketId, assignedTeam });

  // Send ticket for processing via SQS
  await sendTicketForProcessing(ticketId);

  // Update chat session metadata with escalated ticket ID
  const sessionRecord: ChatSessionRecord = {
    PK: `CHAT#${sessionId}`,
    SK: 'METADATA',
    sessionId,
    userId,
    category,
    escalatedTicketId: ticketId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    await updateItem(
      `CHAT#${sessionId}`,
      'METADATA',
      'SET escalatedTicketId = :ticketId, updatedAt = :updatedAt, category = :category',
      {
        ':ticketId': ticketId,
        ':updatedAt': timestamp,
        ':category': category,
      },
    );
  } catch {
    // If session metadata doesn't exist yet, create it
    await putItem(sessionRecord);
  }

  return {
    sessionId,
    response: `Your issue has been escalated to the ${assignedTeam} team. A support ticket has been created.`,
    confidence: 0,
    category,
    suggestedActions: [],
    referencedArticles: [],
    escalation: {
      ticketId,
      assignedTeam,
    },
  };
}

/**
 * Lambda entry point for the chat assistant.
 * Routes to processMessage or handleEscalation based on the action field.
 *
 * Requirements: 5.1, 5.4
 */
export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received chat request');

    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_BODY',
            message: 'Request body is required',
          },
        }),
      };
    }

    let requestBody: any;
    try {
      requestBody = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
          },
        }),
      };
    }

    // Extract userId from Cognito authorizer claims if not in body
    let userId = requestBody.userId;
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      try {
        userId = event.requestContext?.authorizer?.claims?.email
          || event.requestContext?.authorizer?.claims?.['cognito:username']
          || '';
      } catch {
        userId = '';
      }
    }
    requestBody.userId = userId;

    // Generate sessionId server-side if not provided
    if (!requestBody.sessionId || typeof requestBody.sessionId !== 'string' || requestBody.sessionId.trim() === '') {
      requestBody.sessionId = `CHAT-${generateTicketId()}`;
    }

    // Validate required fields
    const validationErrors = validateChatRequest(requestBody);
    if (validationErrors.length > 0) {
      logger.warn('Chat validation failed', { errors: validationErrors, hasBody: !!requestBody, userId: requestBody.userId });
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid chat request',
            details: validationErrors,
          },
        }),
      };
    }

    const chatRequest: ChatRequest = {
      message: requestBody.message,
      sessionId: requestBody.sessionId,
      userId: requestBody.userId,
      conversationHistory: requestBody.conversationHistory || [],
      action: requestBody.action || 'message',
    };

    logger.info('Processing chat request', {
      action: chatRequest.action,
      sessionId: chatRequest.sessionId,
      messageLength: chatRequest.message.length,
    });

    let response: ChatResponse;

    if (chatRequest.action === 'escalate') {
      response = await handleEscalation(chatRequest);
    } else {
      response = await processMessage(chatRequest);
    }

    logger.info('Chat response generated', {
      sessionId: response.sessionId,
      category: response.category,
      confidence: response.confidence,
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error(
      'Error processing chat request',
      error instanceof Error ? error : undefined,
    );

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while processing the chat request',
        },
      }),
    };
  }
}
