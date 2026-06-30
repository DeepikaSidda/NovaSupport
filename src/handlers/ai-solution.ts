/**
 * Lambda handler for AI-Generated Solution
 * POST /tickets/{ticketId}/ai-solution
 *
 * Uses Amazon Nova to generate a suggested solution based on ticket details.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem } from '../utils/dynamodb-client';
import { invokeNova2LiteWithFallback } from '../utils/nova-client';
import { createLogger } from '../utils/logger';
import { recallSimilarResolutions } from '../services/agentcore-memory';

const logger = createLogger('AISolutionHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'ticketId is required' } }) };
    }

    const record = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!record) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Ticket not found' } }) };
    }

    const subject = record.subject as string || '';
    const description = record.description as string || '';
    const category = record.category as string || '';
    const tags = (record.tags as string[]) || [];
    const priority = record.priority as number || 5;

    // Recall how similar tickets were resolved in the past (AgentCore Memory).
    // This grounds the AI suggestion in real prior resolutions. Best-effort.
    let memoryContext = '';
    let recalledMemories: Array<{ content: string; score: number }> = [];
    try {
      const pastResolutions = await recallSimilarResolutions({
        id: ticketId,
        subject,
        description,
      });
      if (pastResolutions.length > 0) {
        recalledMemories = pastResolutions.map(r => ({
          content: r.content,
          score: Number(r.score.toFixed(2)),
        }));
        memoryContext =
          '\n\nPRIOR RESOLUTIONS for similar tickets (use as reference if relevant):\n' +
          pastResolutions
            .map((r, i) => `${i + 1}. (relevance ${r.score.toFixed(2)}) ${r.content}`)
            .join('\n');
        logger.info('Grounded AI solution with past resolutions', {
          ticketId,
          count: pastResolutions.length,
        });
      }
    } catch (memErr) {
      logger.warn('Memory recall failed, continuing without it', {
        ticketId,
        error: memErr instanceof Error ? memErr.message : String(memErr),
      });
    }

    const prompt = `You are an IT support engineer writing internal notes. Given this support ticket, provide a concise technical diagnosis and actionable fix steps. Do NOT write an email. Do NOT address the user. Do NOT include greetings, sign-offs, or ask follow-up questions. Just give direct technical suggestions as bullet points.

Subject: ${subject}
Description: ${description}
${category ? `Category: ${category}` : ''}
${tags.length ? `Tags: ${tags.join(', ')}` : ''}
Priority: ${priority >= 10 ? 'Critical' : priority >= 8 ? 'High' : priority >= 5 ? 'Medium' : 'Low'}${memoryContext}

Respond in this exact format (no email, no greeting, no sign-off):
DIAGNOSIS: [1-2 sentence root cause analysis]
SOLUTION: [Numbered list of concrete fix steps, max 5 steps]
PREVENTION: [1-2 sentence prevention tip]`;

    logger.info('Generating AI solution', { ticketId });

    const response = await invokeNova2LiteWithFallback(
      { prompt, temperature: 0.3, maxTokens: 1024 },
      'DIAGNOSIS: Unable to generate AI diagnosis at this time.\nSOLUTION: Please review the ticket manually.\nPREVENTION: N/A'
    );

    // Parse the structured response
    const text = response.text.trim();
    const diagnosisMatch = text.match(/DIAGNOSIS:\s*([\s\S]*?)(?=SOLUTION:|$)/i);
    const solutionMatch = text.match(/SOLUTION:\s*([\s\S]*?)(?=PREVENTION:|$)/i);
    const preventionMatch = text.match(/PREVENTION:\s*([\s\S]*?)$/i);

    const aiSolution = {
      diagnosis: diagnosisMatch?.[1]?.trim() || 'Unable to determine root cause.',
      solution: solutionMatch?.[1]?.trim() || text,
      prevention: preventionMatch?.[1]?.trim() || '',
      model: 'Amazon Nova Lite',
      generatedAt: new Date().toISOString(),
      // AgentCore Memory: prior resolutions that grounded this suggestion
      recalledMemories,
      memoryUsed: recalledMemories.length > 0,
    };

    logger.info('AI solution generated', { ticketId, stopReason: response.stopReason });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(aiSolution),
    };
  } catch (error) {
    logger.error('Error generating AI solution', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to generate AI solution' } }),
    };
  }
}
