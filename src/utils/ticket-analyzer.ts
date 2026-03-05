/**
 * Ticket analysis utilities using Amazon Nova 2 Lite
 * Analyzes ticket content for urgency, sentiment, and required expertise
 */

import { invokeNova2Lite, NovaUnavailableError } from './nova-client';
import { Ticket } from '../types/ticket';
import { createLogger } from './logger';

const logger = createLogger('TicketAnalyzer');

/**
 * Urgency indicators found in ticket content
 */
export interface UrgencyIndicators {
  hasUrgentKeywords: boolean;
  urgentKeywords: string[];
  urgencyScore: number; // 0-10 scale
}

/**
 * Sentiment analysis results
 */
export interface SentimentAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number; // -1 to 1 scale
  isFrustrated: boolean;
  isAngry: boolean;
}

/**
 * Required expertise identified from content
 */
export interface ExpertiseRequirements {
  primaryExpertise: string;
  secondaryExpertise: string[];
  technicalTerms: string[];
  confidence: number; // 0-1 scale
}

/**
 * Complete ticket analysis results
 */
export interface TicketAnalysis {
  ticketId: string;
  urgency: UrgencyIndicators;
  sentiment: SentimentAnalysis;
  expertise: ExpertiseRequirements;
  analyzedAt: Date;
}

/**
 * Team info passed to the analyzer for better routing
 */
export interface TeamInfoForAnalysis {
  teamId: string;
  teamName: string;
  description?: string;
  expertise: string[];
}

/**
 * Analyze ticket content for urgency, sentiment, and required expertise
 */
export async function analyzeTicket(ticket: Ticket, availableTeams?: TeamInfoForAnalysis[]): Promise<TicketAnalysis> {
  logger.info('Analyzing ticket', { ticketId: ticket.id });

  const prompt = buildAnalysisPrompt(ticket, availableTeams);

  try {
    const response = await invokeNova2Lite({
      prompt,
      temperature: 0.3, // Lower temperature for more consistent analysis
      maxTokens: 1024,
    });

    const analysis = parseAnalysisResponse(response.text, ticket.id);
    
    logger.info('Ticket analysis complete', {
      ticketId: ticket.id,
      urgencyScore: analysis.urgency.urgencyScore,
      sentiment: analysis.sentiment.sentiment,
      primaryExpertise: analysis.expertise.primaryExpertise,
    });

    return analysis;
  } catch (error) {
    if (error instanceof NovaUnavailableError) {
      logger.warn('Nova unavailable, using fallback analysis', {
        ticketId: ticket.id,
      });
      return fallbackAnalysis(ticket);
    }
    throw error;
  }
}

/**
 * Build analysis prompt for Nova 2 Lite
 */
function buildAnalysisPrompt(ticket: Ticket, availableTeams?: TeamInfoForAnalysis[]): string {
  let teamSection = '';
  if (availableTeams && availableTeams.length > 0) {
    teamSection = `\n\nAvailable Teams (you MUST pick primaryExpertise that matches one of these teams):\n` +
      availableTeams.map(t =>
        `- ${t.teamName} (id: ${t.teamId}): ${t.description || 'No description'}\n  Expertise: ${t.expertise.join(', ')}`
      ).join('\n');
  }

  return `Analyze the following support ticket and provide structured analysis:

Subject: ${ticket.subject}
Description: ${ticket.description}
${teamSection}

Please analyze this ticket and provide the following information in JSON format:

1. Urgency Indicators:
   - Identify urgent keywords (e.g., "urgent", "critical", "asap", "emergency", "down", "broken", "not working")
   - Assign an urgency score from 0-10 (0=not urgent, 10=extremely urgent)

2. Sentiment Analysis:
   - Determine sentiment: positive, neutral, or negative
   - Assign sentiment score from -1 (very negative) to 1 (very positive)
   - Identify if customer is frustrated or angry

3. Required Expertise:
   - Identify primary expertise area — this MUST match one of the team expertise keywords listed above
   - List secondary expertise areas if applicable
   - Extract technical terms mentioned
   - Provide confidence score (0-1) for expertise identification

Respond ONLY with valid JSON in this exact format:
{
  "urgency": {
    "hasUrgentKeywords": boolean,
    "urgentKeywords": string[],
    "urgencyScore": number
  },
  "sentiment": {
    "sentiment": "positive" | "neutral" | "negative",
    "sentimentScore": number,
    "isFrustrated": boolean,
    "isAngry": boolean
  },
  "expertise": {
    "primaryExpertise": string,
    "secondaryExpertise": string[],
    "technicalTerms": string[],
    "confidence": number
  }
}`;
}

/**
 * Parse Nova 2 Lite response into structured analysis
 */
function parseAnalysisResponse(responseText: string, ticketId: string): TicketAnalysis {
  try {
    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = responseText.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    
    const parsed = JSON.parse(jsonText);

    // Validate and normalize the response
    return {
      ticketId,
      urgency: {
        hasUrgentKeywords: Boolean(parsed.urgency?.hasUrgentKeywords),
        urgentKeywords: Array.isArray(parsed.urgency?.urgentKeywords) 
          ? parsed.urgency.urgentKeywords 
          : [],
        urgencyScore: clamp(parsed.urgency?.urgencyScore ?? 5, 0, 10),
      },
      sentiment: {
        sentiment: validateSentiment(parsed.sentiment?.sentiment),
        sentimentScore: clamp(parsed.sentiment?.sentimentScore ?? 0, -1, 1),
        isFrustrated: Boolean(parsed.sentiment?.isFrustrated),
        isAngry: Boolean(parsed.sentiment?.isAngry),
      },
      expertise: {
        primaryExpertise: String(parsed.expertise?.primaryExpertise || 'general'),
        secondaryExpertise: Array.isArray(parsed.expertise?.secondaryExpertise)
          ? parsed.expertise.secondaryExpertise
          : [],
        technicalTerms: Array.isArray(parsed.expertise?.technicalTerms)
          ? parsed.expertise.technicalTerms
          : [],
        confidence: clamp(parsed.expertise?.confidence ?? 0.5, 0, 1),
      },
      analyzedAt: new Date(),
    };
  } catch (error: any) {
    logger.error('Failed to parse Nova response', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to parse analysis response: ${error}`);
  }
}

/**
 * Validate sentiment value
 */
function validateSentiment(value: any): 'positive' | 'neutral' | 'negative' {
  if (value === 'positive' || value === 'neutral' || value === 'negative') {
    return value;
  }
  return 'neutral';
}

/**
 * Clamp a number between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Fallback analysis when Nova is unavailable (rule-based)
 */
function fallbackAnalysis(ticket: Ticket): TicketAnalysis {
  logger.info('Using rule-based fallback analysis', { ticketId: ticket.id });

  const content = `${ticket.subject} ${ticket.description}`.toLowerCase();

  // Rule-based urgency detection
  const urgentKeywords = [
    'urgent', 'critical', 'asap', 'emergency', 'immediately',
    'down', 'broken', 'not working', 'crashed', 'error'
  ];
  const foundUrgentKeywords = urgentKeywords.filter(keyword => 
    content.includes(keyword)
  );
  const urgencyScore = Math.min(10, foundUrgentKeywords.length * 2 + 3);

  // Rule-based sentiment detection
  const negativeKeywords = [
    'frustrated', 'angry', 'terrible', 'awful', 'horrible',
    'disappointed', 'unacceptable', 'worst'
  ];
  const positiveKeywords = ['thanks', 'appreciate', 'great', 'excellent'];
  
  const negativeCount = negativeKeywords.filter(k => content.includes(k)).length;
  const positiveCount = positiveKeywords.filter(k => content.includes(k)).length;
  
  let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
  let sentimentScore = 0;
  
  if (negativeCount > positiveCount) {
    sentiment = 'negative';
    sentimentScore = -0.5;
  } else if (positiveCount > negativeCount) {
    sentiment = 'positive';
    sentimentScore = 0.5;
  }

  const isFrustrated = content.includes('frustrated') || negativeCount >= 2;
  const isAngry = content.includes('angry') || content.includes('unacceptable');

  // Rule-based expertise detection
  const expertiseKeywords: Record<string, string[]> = {
    authentication: ['login', 'password', 'auth', 'sign in', 'access denied'],
    billing: ['payment', 'invoice', 'charge', 'subscription', 'billing'],
    database: ['database', 'query', 'sql', 'data', 'table'],
    infrastructure: ['deploy', 'deployment', 'server', '502', '503', '500', 'gateway', 'downtime', 'outage', 'cloud', 'aws', 'hosting', 'devops', 'ci/cd', 'pipeline'],
    networking: ['network', 'connection', 'timeout', 'latency', 'dns'],
    'ui/ux': ['button', 'page', 'display', 'layout', 'interface'],
    security: ['security', 'vulnerability', 'breach', 'hack', 'compliance', 'privacy'],
  };

  let primaryExpertise = 'general';
  let maxMatches = 0;

  for (const [expertise, keywords] of Object.entries(expertiseKeywords)) {
    const matches = keywords.filter(k => content.includes(k)).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      primaryExpertise = expertise;
    }
  }

  return {
    ticketId: ticket.id,
    urgency: {
      hasUrgentKeywords: foundUrgentKeywords.length > 0,
      urgentKeywords: foundUrgentKeywords,
      urgencyScore,
    },
    sentiment: {
      sentiment,
      sentimentScore,
      isFrustrated,
      isAngry,
    },
    expertise: {
      primaryExpertise,
      secondaryExpertise: [],
      technicalTerms: [],
      confidence: 0.5, // Lower confidence for rule-based analysis
    },
    analyzedAt: new Date(),
  };
}
