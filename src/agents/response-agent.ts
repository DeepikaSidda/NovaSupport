/**
 * Response Agent for NovaSupport
 * Generates contextual responses using knowledge base results,
 * similar tickets, and user history
 */

import { Ticket, TicketStatus } from '../types/ticket';
import {
  ResponseContext,
  GeneratedResponse,
  KnowledgeBaseResult,
  SimilarTicket,
} from '../types/agent';
import { invokeNova2Lite, NovaUnavailableError } from '../utils/nova-client';
import { createLogger } from '../utils/logger';

export type Sentiment = 'frustrated' | 'neutral' | 'positive';

const logger = createLogger('ResponseAgent');

/**
 * Generate contextual response for a ticket
 */
export async function generateResponse(
  ticket: Ticket,
  context: ResponseContext
): Promise<GeneratedResponse> {
  logger.info('Generating response', {
    ticketId: ticket.id,
    hasKnowledgeBase: context.knowledgeBaseResults.length > 0,
    hasSimilarTickets: context.similarTickets.length > 0,
    hasUserHistory: context.userHistory.length > 0,
    hasAttachmentAnalysis: !!context.attachmentAnalysis,
  });

  try {
    // Build prompt with all available context
    const prompt = buildResponsePrompt(ticket, context);

    // Call Nova 2 Lite to generate response
    const novaResponse = await invokeNova2Lite({
      prompt,
      temperature: 0.7,
      maxTokens: 1024,
    });

    // Parse the response
    const parsedResponse = parseNovaResponse(novaResponse.text);

    // Calculate confidence score
    const confidence = calculateConfidence(context, parsedResponse);

    // Extract referenced articles
    const referencedArticles = extractReferencedArticles(
      context.knowledgeBaseResults,
      parsedResponse.text
    );

    // Extract suggested actions
    const suggestedActions = extractSuggestedActions(parsedResponse.text);

    logger.info('Response generated successfully', {
      ticketId: ticket.id,
      confidence,
      referencedArticleCount: referencedArticles.length,
      suggestedActionCount: suggestedActions?.length || 0,
    });

    const baseResponse: GeneratedResponse = {
      text: parsedResponse.text,
      confidence,
      reasoning: parsedResponse.reasoning,
      referencedArticles,
      suggestedActions,
    };

    // Apply personalization based on sentiment and user history
    return personalizeResponse(baseResponse, ticket, context);
  } catch (error) {
    if (error instanceof NovaUnavailableError) {
      logger.warn('Nova unavailable, using fallback response', {
        ticketId: ticket.id,
      });
      return generateFallbackResponse(ticket, context);
    }
    throw error;
  }
}

/**
 * Build prompt for Nova 2 Lite with all available context
 */
function buildResponsePrompt(ticket: Ticket, context: ResponseContext): string {
  const sections: string[] = [];

  // System instruction
  sections.push(
    'You are a helpful customer support AI assistant. Generate a professional, ' +
    'contextual response to the customer\'s support ticket. Include relevant ' +
    'information from the knowledge base, similar past tickets, and the customer\'s ' +
    'history when available.'
  );

  sections.push('\n## TICKET INFORMATION');
  sections.push(`Subject: ${ticket.subject}`);
  sections.push(`Description: ${ticket.description}`);
  sections.push(`Priority: ${ticket.priority}`);
  sections.push(`Customer ID: ${ticket.userId}`);

  // Add attachment analysis if available
  if (context.attachmentAnalysis) {
    sections.push('\n## ATTACHMENT ANALYSIS');
    for (const attachment of context.attachmentAnalysis.attachments) {
      sections.push(`\nAttachment Type: ${attachment.type}`);
      sections.push(`Summary: ${attachment.summary}`);
      if (attachment.extractedText) {
        sections.push(`Extracted Text: ${attachment.extractedText.substring(0, 500)}`);
      }
      if (attachment.detectedErrors && attachment.detectedErrors.length > 0) {
        sections.push(`Detected Errors: ${attachment.detectedErrors.join(', ')}`);
      }
      if (attachment.keyFindings && attachment.keyFindings.length > 0) {
        sections.push(`Key Findings: ${attachment.keyFindings.join(', ')}`);
      }
    }
  }

  // Add knowledge base results
  if (context.knowledgeBaseResults.length > 0) {
    sections.push('\n## KNOWLEDGE BASE ARTICLES');
    for (const article of context.knowledgeBaseResults.slice(0, 3)) {
      sections.push(`\nArticle: ${article.title} (Relevance: ${article.relevanceScore.toFixed(2)})`);
      sections.push(`Content: ${article.relevantSections.join('\n')}`);
      if (article.url) {
        sections.push(`URL: ${article.url}`);
      }
    }
  }

  // Add similar tickets
  if (context.similarTickets.length > 0) {
    sections.push('\n## SIMILAR PAST TICKETS');
    for (const similar of context.similarTickets.slice(0, 3)) {
      sections.push(`\nTicket: ${similar.subject} (Similarity: ${similar.similarityScore.toFixed(2)})`);
      if (similar.resolution) {
        sections.push(`Resolution: ${similar.resolution}`);
        sections.push(`Outcome: ${similar.wasSuccessful ? 'Successful' : 'Unsuccessful'}`);
      }
    }
  }

  // Add user history
  if (context.userHistory.length > 0) {
    sections.push('\n## CUSTOMER HISTORY');
    sections.push(`Previous tickets: ${context.userHistory.length}`);
    const recentTickets = context.userHistory.slice(0, 2);
    for (const prevTicket of recentTickets) {
      sections.push(`\n- ${prevTicket.subject} (Status: ${prevTicket.status})`);
    }
  }

  // Instructions for response format
  sections.push('\n## RESPONSE INSTRUCTIONS');
  sections.push('CRITICAL: Generate a TECHNICAL SOLUTION ONLY. This is NOT an email to the customer.');
  sections.push('DO NOT include: greetings, sign-offs, "Dear", "Best regards", "Thank you", "[Your Name]", "Customer Support Team", or any email formatting.');
  sections.push('DO NOT ask the user to provide more information or reply.');
  sections.push('');
  sections.push('Your response MUST follow this exact format:');
  sections.push('1. ROOT CAUSE: One sentence identifying the likely issue');
  sections.push('2. SOLUTION STEPS: Numbered list of 3-5 specific technical steps to fix the issue');
  sections.push('3. REFERENCE: Link to relevant AWS documentation if applicable');
  sections.push('');
  sections.push('Example of CORRECT format:');
  sections.push('ROOT CAUSE: The IAM policy is missing the required s3:GetObject permission.');
  sections.push('SOLUTION STEPS:');
  sections.push('1. Navigate to IAM Console > Policies');
  sections.push('2. Find and edit the attached policy');
  sections.push('3. Add "s3:GetObject" to the Action array');
  sections.push('4. Save the policy and wait 60 seconds for propagation');
  sections.push('REFERENCE: https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html');
  
  if (context.knowledgeBaseResults.length === 0 && context.similarTickets.length === 0) {
    sections.push('\nNote: No KB articles or similar tickets found. Provide your best technical diagnosis based on the issue description.');
  }

  sections.push('\nFormat your response as:');
  sections.push('RESPONSE: [Your response text here]');
  sections.push('REASONING: [Brief explanation of why this response is appropriate]');
  sections.push('SUGGESTED_ACTIONS: [Comma-separated list of actions, or "none"]');

  return sections.join('\n');
}

/**
 * Parse Nova response into structured format
 */
interface ParsedResponse {
  text: string;
  reasoning: string;
  suggestedActionsText?: string;
}

function parseNovaResponse(responseText: string): ParsedResponse {
  const lines = responseText.split('\n');
  let text = '';
  let reasoning = '';
  let suggestedActionsText = '';

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('RESPONSE:')) {
      currentSection = 'response';
      text = trimmed.substring('RESPONSE:'.length).trim();
    } else if (trimmed.startsWith('REASONING:')) {
      currentSection = 'reasoning';
      reasoning = trimmed.substring('REASONING:'.length).trim();
    } else if (trimmed.startsWith('SUGGESTED_ACTIONS:')) {
      currentSection = 'actions';
      suggestedActionsText = trimmed.substring('SUGGESTED_ACTIONS:'.length).trim();
    } else if (trimmed.length > 0) {
      // Continue current section
      if (currentSection === 'response') {
        text += '\n' + trimmed;
      } else if (currentSection === 'reasoning') {
        reasoning += ' ' + trimmed;
      } else if (currentSection === 'actions') {
        suggestedActionsText += ' ' + trimmed;
      }
    }
  }

  // If parsing failed, use entire response as text
  if (!text) {
    text = responseText;
    reasoning = 'Generated response based on available context';
  }

  return {
    text: text.trim(),
    reasoning: reasoning.trim() || 'Generated response based on available context',
    suggestedActionsText: suggestedActionsText.trim(),
  };
}

/**
 * Calculate confidence score based on available context
 */
function calculateConfidence(
  context: ResponseContext,
  parsedResponse: ParsedResponse
): number {
  let confidence = 0.5; // Base confidence

  // Boost confidence if we have knowledge base articles
  if (context.knowledgeBaseResults.length > 0) {
    const avgRelevance = context.knowledgeBaseResults.reduce(
      (sum, article) => sum + article.relevanceScore,
      0
    ) / context.knowledgeBaseResults.length;
    confidence += avgRelevance * 0.3;
  }

  // Boost confidence if we have similar tickets with successful resolutions
  const successfulSimilar = context.similarTickets.filter(t => t.wasSuccessful);
  if (successfulSimilar.length > 0) {
    const avgSimilarity = successfulSimilar.reduce(
      (sum, ticket) => sum + ticket.similarityScore,
      0
    ) / successfulSimilar.length;
    confidence += avgSimilarity * 0.2;
  }

  // Boost confidence if we have user history
  if (context.userHistory.length > 0) {
    confidence += 0.1;
  }

  // Boost confidence if we have attachment analysis
  if (context.attachmentAnalysis) {
    confidence += 0.1;
  }

  // Reduce confidence if response is very short (likely insufficient)
  if (parsedResponse.text.length < 100) {
    confidence -= 0.2;
  }

  // Ensure confidence is in valid range [0, 1]
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Extract referenced articles from response text
 */
function extractReferencedArticles(
  knowledgeBaseResults: KnowledgeBaseResult[],
  responseText: string
): string[] {
  const referenced: string[] = [];

  for (const article of knowledgeBaseResults) {
    // Check if article title or ID is mentioned in response
    const titleMentioned = responseText.toLowerCase().includes(
      article.title.toLowerCase()
    );
    const idMentioned = responseText.includes(article.articleId);

    if (titleMentioned || idMentioned) {
      referenced.push(article.articleId);
    }
  }

  // If no explicit references but we used articles, include top 2
  if (referenced.length === 0 && knowledgeBaseResults.length > 0) {
    referenced.push(...knowledgeBaseResults.slice(0, 2).map(a => a.articleId));
  }

  return referenced;
}

/**
 * Extract suggested actions from response text
 */
function extractSuggestedActions(responseText: string): string[] | undefined {
  // Look for SUGGESTED_ACTIONS section
  const match = responseText.match(/SUGGESTED_ACTIONS:\s*(.+?)(?:\n|$)/i);
  
  if (match && match[1]) {
    const actionsText = match[1].trim();
    
    if (actionsText.toLowerCase() === 'none') {
      return undefined;
    }

    // Split by comma and clean up
    const actions = actionsText
      .split(',')
      .map(action => action.trim())
      .filter(action => action.length > 0);

    return actions.length > 0 ? actions : undefined;
  }

  return undefined;
}

/**
 * Generate fallback response when Nova is unavailable
 */
function generateFallbackResponse(
  ticket: Ticket,
  context: ResponseContext
): GeneratedResponse {
  logger.info('Generating fallback response', { ticketId: ticket.id });

  let text = `ROOT CAUSE: Unable to determine - requires manual investigation of "${ticket.subject}".\n\n`;

  // If we have knowledge base articles, reference them
  if (context.knowledgeBaseResults.length > 0) {
    text += 'RELEVANT DOCUMENTATION:\n';
    for (const article of context.knowledgeBaseResults.slice(0, 2)) {
      text += `- ${article.title}`;
      if (article.url) {
        text += `: ${article.url}`;
      }
      text += '\n';
    }
    text += '\n';
  }

  // If we have similar tickets, mention them
  if (context.similarTickets.length > 0) {
    const successfulSimilar = context.similarTickets.filter(t => t.wasSuccessful);
    if (successfulSimilar.length > 0 && successfulSimilar[0].resolution) {
      text += `SIMILAR ISSUE RESOLUTION: ${successfulSimilar[0].resolution}\n\n`;
    }
  }

  // Default troubleshooting steps
  if (context.knowledgeBaseResults.length === 0 && context.similarTickets.length === 0) {
    text += 'RECOMMENDED TROUBLESHOOTING STEPS:\n';
    text += '1. Check AWS CloudWatch logs for related errors\n';
    text += '2. Verify IAM permissions and resource policies\n';
    text += '3. Review recent configuration changes\n';
    text += '4. Check AWS Service Health Dashboard for outages\n\n';
  }

  text += 'STATUS: Awaiting detailed analysis by support agent.';

  const referencedArticles = context.knowledgeBaseResults
    .slice(0, 2)
    .map(a => a.articleId);

  return {
    text,
    confidence: 0.5,
    reasoning: 'Fallback response generated due to AI service unavailability',
    referencedArticles,
    suggestedActions: context.knowledgeBaseResults.length === 0
      ? ['Check CloudWatch logs', 'Verify IAM permissions']
      : ['Review documentation', 'Check similar resolutions'],
  };
}


// --- Personalization Functions ---

const FRUSTRATED_KEYWORDS = [
  'frustrated', 'angry', 'unacceptable', 'terrible', 'worst',
  'furious', 'ridiculous', 'outrageous', 'horrible', 'awful',
];

const POSITIVE_KEYWORDS = [
  'thank', 'appreciate', 'great', 'excellent', 'wonderful',
  'happy', 'pleased', 'grateful', 'awesome', 'fantastic',
];

/**
 * Detect sentiment from text using keyword matching.
 * Returns 'frustrated', 'positive', or 'neutral'.
 */
export function detectSentiment(text: string): Sentiment {
  const lower = text.toLowerCase();

  for (const keyword of FRUSTRATED_KEYWORDS) {
    if (lower.includes(keyword)) {
      return 'frustrated';
    }
  }

  for (const keyword of POSITIVE_KEYWORDS) {
    if (lower.includes(keyword)) {
      return 'positive';
    }
  }

  return 'neutral';
}

/**
 * Adapt response tone based on detected sentiment.
 */
export function adaptTone(text: string, sentiment: Sentiment): string {
  switch (sentiment) {
    case 'frustrated':
      return (
        'I understand your frustration, and I sincerely apologize for the inconvenience. ' +
        'Resolving this is our top priority.\n\n' +
        text
      );
    case 'positive':
      return (
        'Thank you for your patience and kind words! ' +
        "We're happy to help.\n\n" +
        text
      );
    case 'neutral':
    default:
      return text;
  }
}

/**
 * Add references to the user's previous tickets in the response.
 */
export function addUserHistoryContext(text: string, userHistory: Ticket[]): string {
  if (userHistory.length === 0) {
    return text;
  }

  const lines: string[] = [];

  // Warm greeting for returning customers
  lines.push('Welcome back! I see you\'ve contacted us before.');

  // Acknowledge unresolved tickets
  const unresolved = userHistory.filter(
    (t) =>
      t.status !== TicketStatus.RESOLVED &&
      t.status !== TicketStatus.CLOSED
  );

  if (unresolved.length > 0) {
    const subjects = unresolved
      .slice(0, 2)
      .map((t) => `"${t.subject}"`)
      .join(' and ');
    lines.push(
      `I also notice you have ${unresolved.length === 1 ? 'an open ticket' : 'open tickets'} about ${subjects} — we haven't forgotten about ${unresolved.length === 1 ? 'it' : 'them'}.`
    );
  }

  // Reference recent resolved tickets
  const resolved = userHistory.filter(
    (t) => t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CLOSED
  );
  if (resolved.length > 0 && unresolved.length === 0) {
    lines.push(
      `I see you've contacted us before about "${resolved[0].subject}".`
    );
  }

  return lines.join(' ') + '\n\n' + text;
}

/**
 * Post-process a generated response to add personalization:
 * sentiment-based tone, user history context, and ticket-specific details.
 */
export function personalizeResponse(
  response: GeneratedResponse,
  ticket: Ticket,
  context: ResponseContext
): GeneratedResponse {
  logger.info('Personalizing response', { ticketId: ticket.id });

  // 1. Detect sentiment from the ticket description (and subject)
  const sentiment = detectSentiment(ticket.description + ' ' + ticket.subject);

  // 2. Adapt tone based on sentiment
  let personalizedText = adaptTone(response.text, sentiment);

  // 3. Add user history context
  personalizedText = addUserHistoryContext(personalizedText, context.userHistory);

  return {
    ...response,
    text: personalizedText,
  };
}
