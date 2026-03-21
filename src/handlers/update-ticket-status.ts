/**
 * Lambda handler for updating ticket status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getItem, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { formatDate } from '../utils/helpers';
import { scheduleFollowUp, scheduleSatisfactionSurvey } from '../services/follow-up-scheduler';
import { Ticket, TicketStatus, Priority } from '../types/ticket';
import { recordFirstResponse } from '../services/sla-tracker';
import { createActivityRecord } from './ticket-activity';
import { broadcastToUser } from '../services/notification-service';

const logger = createLogger('UpdateTicketStatusHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const VALID_STATUSES = ['new', 'analyzing', 'assigned', 'in_progress', 'pending_user', 'processing', 'escalated', 'resolved', 'closed'];

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'ticketId is required' } }) };
    }

    const body = JSON.parse(event.body || '{}');
    const newStatus = body.status;
    const assignedTeam = body.assignedTeam;
    const assignedTo = body.assignedTo;

    // At least one field must be provided
    if (!newStatus && !assignedTeam && assignedTo === undefined) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'At least one of status, assignedTeam, or assignedTo is required' } }) };
    }

    if (newStatus && !VALID_STATUSES.includes(newStatus)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: `status must be one of: ${VALID_STATUSES.join(', ')}` } }) };
    }

    const existing = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!existing) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Ticket not found' } }) };
    }

    const now = formatDate(new Date());
    const exprParts: string[] = ['updatedAt = :updatedAt'];
    const exprValues: Record<string, any> = { ':updatedAt': now };
    const exprNames: Record<string, string> = {};

    if (newStatus) {
      exprParts.push('#status = :status', 'GSI2PK = :gsi2pk');
      exprValues[':status'] = newStatus;
      exprValues[':gsi2pk'] = `STATUS#${newStatus}`;
      exprNames['#status'] = 'status';
      if (newStatus === 'resolved' || newStatus === 'closed') {
        exprParts.push('resolvedAt = :resolvedAt');
        exprValues[':resolvedAt'] = now;
      }
    }

    if (assignedTeam) {
      exprParts.push('assignedTeam = :assignedTeam', 'GSI3PK = :gsi3pk');
      exprValues[':assignedTeam'] = assignedTeam;
      exprValues[':gsi3pk'] = `TEAM#${assignedTeam}`;
    }

    if (assignedTo !== undefined) {
      exprParts.push('assignedTo = :assignedTo');
      exprValues[':assignedTo'] = assignedTo;
    }

    const updateExpr = 'SET ' + exprParts.join(', ');
    await updateItem(`TICKET#${ticketId}`, 'METADATA', updateExpr, exprValues, Object.keys(exprNames).length > 0 ? exprNames : undefined);

    const result: any = { ticketId, updatedAt: now };
    if (newStatus) result.status = newStatus;
    if (assignedTeam) result.assignedTeam = assignedTeam;
    if (assignedTo !== undefined) result.assignedTo = assignedTo;

    // Record activity for ticket timeline on status change (only if status actually changed)
    if (newStatus && newStatus !== existing.status) {
      try {
        await createActivityRecord(ticketId, 'status_change', body.assignedTo || 'system', {
          oldStatus: existing.status,
          newStatus,
        });
      } catch (activityError) {
        logger.error('Failed to create activity record for status change', activityError instanceof Error ? activityError : undefined);
      }
    }

    // Broadcast WebSocket notification for status change (Requirement 6.4)
    if (newStatus) {
      const broadcastMessage = {
        type: 'ticket_update',
        ticketId,
        status: newStatus,
        timestamp: now,
      };

      // Broadcast to ticket owner
      if (existing.userId) {
        try {
          await broadcastToUser(existing.userId as string, broadcastMessage);
        } catch (broadcastError) {
          logger.error('Failed to broadcast status update to ticket owner', broadcastError instanceof Error ? broadcastError : undefined);
        }
      }

      // Broadcast to assigned admin
      if (existing.assignedTo) {
        try {
          await broadcastToUser(existing.assignedTo as string, broadcastMessage);
        } catch (broadcastError) {
          logger.error('Failed to broadcast status update to assigned admin', broadcastError instanceof Error ? broadcastError : undefined);
        }
      }
    }

    // Record first response time for SLA tracking
    if (newStatus && ['assigned', 'in_progress', 'pending_user', 'resolved'].includes(newStatus)) {
      try {
        await recordFirstResponse(ticketId);
      } catch (slaError) {
        logger.error('Failed to record first response for SLA', slaError instanceof Error ? slaError : undefined);
      }
    }

    // Schedule follow-ups based on status change
    if (newStatus === 'pending_user' || newStatus === 'resolved') {
      try {
        const ticket: Ticket = {
          id: ticketId,
          userId: (existing.userId as string) || '',
          subject: (existing.subject as string) || '',
          description: (existing.description as string) || '',
          status: newStatus as TicketStatus,
          priority: (existing.priority as Priority) || Priority.MEDIUM,
          createdAt: new Date((existing.createdAt as string) || now),
          updatedAt: new Date(now),
          tags: (existing.tags as string[]) || [],
          attachments: [],
        };

        if (newStatus === 'pending_user') {
          await scheduleFollowUp(ticket);
          logger.info('Follow-up scheduled for pending_user status', { ticketId });
        } else if (newStatus === 'resolved') {
          await scheduleSatisfactionSurvey(ticket);
          logger.info('Satisfaction survey scheduled for resolved status', { ticketId });
        }
      } catch (schedulingError) {
        logger.error('Failed to schedule follow-up, status update still succeeded', schedulingError instanceof Error ? schedulingError : undefined);
      }
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(result) };
  } catch (error) {
    logger.error('Error updating ticket status', error instanceof Error ? error : undefined);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Failed to update status' } }) };
  }
}
