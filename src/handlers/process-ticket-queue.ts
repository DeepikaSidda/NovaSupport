/**
 * SQS consumer Lambda - automatically processes tickets from the queue
 * Runs AI analysis (routing, tagging, prioritization, escalation) on new tickets
 */

import { SQSEvent, SQSRecord } from 'aws-lambda';
import { getItem, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { Ticket, TicketStatus, Priority } from '../types/ticket';
import { analyzeAndRoute, assignTicket } from '../agents/routing-agent';
import { assignToMember } from '../agents/assignment-agent';
import { tagTicket } from '../services/auto-tagger';
import { calculatePriorityScore, defaultBusinessImpact } from '../services/ticket-prioritization';
import { analyzeTicket } from '../utils/ticket-analyzer';
import { evaluateEscalation } from '../agents/escalation-agent';
import { generateResponse } from '../agents/response-agent';
import { formatDate } from '../utils/helpers';
import { initializeSLA, detectCategory, updateTicketCategory } from '../services/sla-tracker';

const logger = createLogger('ProcessTicketQueue');

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    await processRecord(record);
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  let ticketId: string;
  try {
    const body = JSON.parse(record.body);
    ticketId = body.ticketId;
  } catch (e) {
    logger.error('Failed to parse SQS message', e instanceof Error ? e : new Error(String(e)));
    return;
  }

  logger.info('Auto-processing ticket from queue', { ticketId });

  try {
    const dbRecord = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!dbRecord) {
      logger.warn('Ticket not found, skipping', { ticketId });
      return;
    }

    const ticket: Ticket = {
      id: dbRecord.ticketId as string,
      userId: dbRecord.userId as string,
      subject: dbRecord.subject as string,
      description: dbRecord.description as string,
      status: (dbRecord.status as TicketStatus) || TicketStatus.NEW,
      priority: (dbRecord.priority as Priority) || Priority.MEDIUM,
      assignedTo: dbRecord.assignedTo as string | undefined,
      assignedTeam: dbRecord.assignedTeam as string | undefined,
      createdAt: new Date(dbRecord.createdAt as string),
      updatedAt: new Date(dbRecord.updatedAt as string),
      tags: (dbRecord.tags as string[]) || [],
      attachments: [],
    };

    // Update status to analyzing
    const now = formatDate(new Date());
    await updateItem(`TICKET#${ticketId}`, 'METADATA',
      'SET #status = :s, updatedAt = :u',
      { ':s': 'analyzing', ':u': now },
      { '#status': 'status' });

    // 1. Routing
    let routingResult: any = null;
    try {
      routingResult = await analyzeAndRoute(ticket);
      if (routingResult && !routingResult.error && routingResult.assignedTo) {
        await assignTicket(ticketId, routingResult);
        // After team assignment, run assignment agent to assign to individual member via round-robin
        if (routingResult.assignedTo !== 'manual-routing-queue') {
          try {
            const assignment = await assignToMember(ticketId, routingResult.assignedTo);
            if (assignment) {
              logger.info('Assignment agent assigned ticket to member', {
                ticketId,
                team: routingResult.assignedTo,
                member: assignment.assignedTo,
                method: assignment.method,
              });
            }
          } catch (assignErr) {
            logger.warn('Assignment agent failed, ticket stays team-assigned', {
              ticketId,
              error: assignErr instanceof Error ? assignErr.message : String(assignErr),
            });
          }
        }
      }
    } catch (e) {
      logger.error('Routing failed', e instanceof Error ? e : new Error(String(e)));
    }

    // 2. Auto-tagging (preserve existing tags like 'chat-escalation')
    try {
      const tagging = await tagTicket(ticket);
      if (tagging && tagging.tags) {
        const aiTags = tagging.tags.map((t: any) => t.tag || t);
        const existingTags = ticket.tags || [];
        const mergedTags = [...new Set([...existingTags, ...aiTags])];
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET tags = :tags, updatedAt = :u',
          { ':tags': mergedTags, ':u': formatDate(new Date()) });
      }
    } catch (e) {
      logger.error('Tagging failed', e instanceof Error ? e : new Error(String(e)));
    }

    // 2b. Category detection via Nova (skip if user already provided one)
    try {
      const currentRecord = await getItem(`TICKET#${ticketId}`, 'METADATA');
      if (!currentRecord?.category) {
        const category = await detectCategory(ticket.subject, ticket.description);
        await updateTicketCategory(ticketId, category);
        logger.info('Category detected', { ticketId, category });
      } else {
        logger.info('Category already set by user', { ticketId, category: currentRecord.category });
      }
    } catch (e) {
      logger.error('Category detection failed', e instanceof Error ? e : new Error(String(e)));
    }

    // 2c. Initialize SLA tracking
    try {
      await initializeSLA(ticketId, ticket.createdAt.toISOString(), ticket.priority);
      logger.info('SLA initialized', { ticketId });
    } catch (e) {
      logger.error('SLA initialization failed', e instanceof Error ? e : new Error(String(e)));
    }

    // 3. Prioritization
    try {
      const analysis = await analyzeTicket(ticket);
      const priority = calculatePriorityScore(analysis, defaultBusinessImpact());
      if (priority && priority.priorityScore) {
        const score = priority.priorityScore;
        let newPriority = 5;
        if (score >= 9) newPriority = 10;
        else if (score >= 7) newPriority = 8;
        else if (score >= 4) newPriority = 5;
        else newPriority = 1;
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET priority = :p, updatedAt = :u',
          { ':p': newPriority, ':u': formatDate(new Date()) });
      }
    } catch (e) {
      logger.error('Prioritization failed', e instanceof Error ? e : new Error(String(e)));
    }

    // 4. Escalation check
    try {
      const escalation = await evaluateEscalation(ticket, {
        routingConfidence: routingResult?.confidence ?? 0.5,
        responseConfidence: 0.5,
        attemptCount: 0,
        detectedIssues: [],
      });
      if (escalation && escalation.shouldEscalate) {
        await updateItem(`TICKET#${ticketId}`, 'METADATA',
          'SET #status = :s, escalationReason = :r, updatedAt = :u, GSI2PK = :gsi2pk',
          { ':s': 'escalated', ':r': escalation.reason || 'Auto-escalated by AI', ':u': formatDate(new Date()), ':gsi2pk': 'STATUS#escalated' },
          { '#status': 'status' });
        logger.info('Ticket auto-escalated', { ticketId });
        return; // Don't set to assigned if escalated
      }
    } catch (e) {
      logger.error('Escalation check failed', e instanceof Error ? e : new Error(String(e)));
    }

    // Set status to assigned if routing succeeded
    if (routingResult && !routingResult.error && routingResult.assignedTo !== 'manual-routing-queue') {
      await updateItem(`TICKET#${ticketId}`, 'METADATA',
        'SET #status = :s, updatedAt = :u, GSI2PK = :gsi2pk',
        { ':s': 'assigned', ':u': formatDate(new Date()), ':gsi2pk': 'STATUS#assigned' },
        { '#status': 'status' });
    }

    logger.info('Ticket auto-processing complete', { ticketId, assignedTo: routingResult?.assignedTo });
  } catch (e) {
    logger.error('Failed to process ticket', e instanceof Error ? e : new Error(String(e)));
    throw e; // Re-throw so SQS retries
  }
}
