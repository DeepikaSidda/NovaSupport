/**
 * Lambda handler for AI ticket analysis
 * Triggers routing, auto-tagging, prioritization, and response generation
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { Ticket, TicketStatus, Priority } from '../types/ticket';
import { analyzeAndRoute, assignTicket } from '../agents/routing-agent';
import { tagTicket } from '../services/auto-tagger';
import { calculatePriorityScore, defaultBusinessImpact } from '../services/ticket-prioritization';
import { analyzeTicket } from '../utils/ticket-analyzer';
import { evaluateEscalation } from '../agents/escalation-agent';
import { generateResponse } from '../agents/response-agent';
import { formatDate } from '../utils/helpers';
import { analyzeImage, detectImageFormat } from '../services/image-analyzer';
import { analyzeDocument } from '../services/document-analyzer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = createLogger('AnalyzeTicketHandler');
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TICKETS_TABLE_NAME || '';

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

    logger.info('Analyzing ticket', { ticketId });

    const record = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!record) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Ticket not found' } }) };
    }

    const ticket: Ticket = {
      id: record.ticketId as string,
      userId: record.userId as string,
      subject: record.subject as string,
      description: record.description as string,
      status: (record.status as TicketStatus) || TicketStatus.NEW,
      priority: (record.priority as Priority) || Priority.MEDIUM,
      assignedTo: record.assignedTo as string | undefined,
      assignedTeam: record.assignedTeam as string | undefined,
      createdAt: new Date(record.createdAt as string),
      updatedAt: new Date(record.updatedAt as string),
      tags: (record.tags as string[]) || [],
      attachments: [],
    };

    // Update status to analyzing
    await updateItem(`TICKET#${ticketId}`, 'METADATA', 'SET #status = :s, updatedAt = :u', { ':s': 'analyzing', ':u': formatDate(new Date()) }, { '#status': 'status' });

    const results: Record<string, any> = {};

    // 1. Routing
    try {
      results.routing = await analyzeAndRoute(ticket);
    } catch (e) { results.routing = { error: (e as Error).message }; }

    // 2. Auto-tagging
    try {
      results.tagging = await tagTicket(ticket);
    } catch (e) { results.tagging = { error: (e as Error).message }; }

    // 3. Ticket analysis + prioritization
    try {
      const analysis = await analyzeTicket(ticket);
      const priority = calculatePriorityScore(analysis, defaultBusinessImpact());
      results.prioritization = priority;
      results.analysis = { sentiment: analysis.sentiment, urgency: analysis.urgency, expertise: analysis.expertise };
    } catch (e) { results.prioritization = { error: (e as Error).message }; }

    // 4. Escalation check
    try {
      const escalation = await evaluateEscalation(ticket, {
        routingConfidence: results.routing?.confidence ?? 0.5,
        responseConfidence: 0.5,
        attemptCount: 0,
        detectedIssues: [],
      });
      results.escalation = escalation;
    } catch (e) { results.escalation = { error: (e as Error).message }; }

    // 5. Response generation
    try {
      results.response = await generateResponse(ticket, {
        knowledgeBaseResults: [],
        similarTickets: [],
        userHistory: [],
      });
    } catch (e) { results.response = { error: (e as Error).message }; }

    // 6. Attachment analysis (images, documents, videos)
    try {
      const attResult = await ddbClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `TICKET#${ticketId}`, ':sk': 'ATTACHMENT#' },
      }));
      const attachmentItems = attResult.Items || [];
      if (attachmentItems.length > 0) {
        const attachmentAnalyses: any[] = [];
        for (const att of attachmentItems) {
          const fileType = (att.fileType as string) || '';
          const s3Key = att.s3Key as string;
          const fileName = att.fileName as string;
          try {
            if (fileType.startsWith('image/')) {
              const fmt = detectImageFormat(fileName);
              if (fmt) {
                const imgResult = await analyzeImage({ s3Key, format: fmt });
                attachmentAnalyses.push({ fileName, fileType, type: 'image', analysis: imgResult });
              }
            } else if (fileType === 'application/pdf' || fileType === 'text/plain' || fileType === 'text/log' || fileType === 'application/x-log') {
              const fmtMap: Record<string, string> = { 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/log': 'log', 'application/x-log': 'log' };
              const docFmt = fmtMap[fileType] || 'txt';
              const docResult = await analyzeDocument({ s3Key, format: docFmt as any });
              attachmentAnalyses.push({ fileName, fileType, type: 'document', analysis: docResult });
            }
          } catch (attErr) {
            attachmentAnalyses.push({ fileName, fileType, error: (attErr as Error).message });
          }
        }
        results.attachmentAnalysis = attachmentAnalyses;
      }
    } catch (e) { results.attachmentAnalysis = { error: (e as Error).message }; }

    // 7. Persist analysis results back to the ticket
    try {
      const now = formatDate(new Date());

      // Apply routing decision (assign to team)
      if (results.routing && !results.routing.error && results.routing.assignedTo) {
        await assignTicket(ticketId, results.routing);
      }

      // Apply tags
      if (results.tagging && !results.tagging.error && results.tagging.tags) {
        const tagNames = results.tagging.tags.map((t: any) => t.tag || t);
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET tags = :tags, updatedAt = :u',
          { ':tags': tagNames, ':u': now });
      }

      // Apply priority score
      if (results.prioritization && !results.prioritization.error && results.prioritization.priorityScore) {
        const score = results.prioritization.priorityScore;
        let newPriority = 5;
        if (score >= 9) newPriority = 10;
        else if (score >= 7) newPriority = 8;
        else if (score >= 4) newPriority = 5;
        else newPriority = 1;
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET priority = :p, updatedAt = :u',
          { ':p': newPriority, ':u': now });
      }

      // Apply escalation if needed
      if (results.escalation && !results.escalation.error && results.escalation.shouldEscalate) {
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET #status = :s, escalationReason = :r, updatedAt = :u, GSI2PK = :gsi2pk',
          { ':s': 'escalated', ':r': results.escalation.reason || 'Auto-escalated by AI', ':u': now, ':gsi2pk': 'STATUS#escalated' },
          { '#status': 'status' });
      } else if (results.routing && !results.routing.error && results.routing.assignedTo !== 'manual-routing-queue') {
        // Update status to assigned if routed successfully
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET #status = :s, updatedAt = :u, GSI2PK = :gsi2pk',
          { ':s': 'assigned', ':u': now, ':gsi2pk': 'STATUS#assigned' },
          { '#status': 'status' });
      }

      logger.info('Analysis results persisted to ticket', { ticketId });
    } catch (e) {
      logger.error('Failed to persist analysis results', e instanceof Error ? e : new Error(String(e)));
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ticketId, analysis: results }) };
  } catch (error) {
    logger.error('Error analyzing ticket', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Internal error during analysis' } }) };
  }
}
