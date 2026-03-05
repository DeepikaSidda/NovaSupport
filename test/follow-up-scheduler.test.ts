/**
 * Unit tests for Follow-Up Scheduling Service
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import {
  scheduleFollowUp,
  scheduleSatisfactionSurvey,
  cancelPendingFollowUps,
  getPendingFollowUps,
  generateFollowUpMessage,
  generateSurveyMessage,
  FollowUpType,
  FollowUpStatus,
  DEFAULT_FOLLOWUP_DELAY_MS,
  DEFAULT_SURVEY_DELAY_MS,
} from '../src/services/follow-up-scheduler';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as dynamodbClient from '../src/utils/dynamodb-client';

jest.mock('../src/utils/dynamodb-client');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-100',
    userId: 'user-42',
    subject: 'Cannot access dashboard',
    description: 'I am unable to log in to the admin dashboard since this morning.',
    status: TicketStatus.PENDING_USER,
    priority: Priority.HIGH,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ['authentication', 'bug'],
    attachments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Follow-Up Scheduler Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Follow-up scheduling at 48 hours (Requirement 11.1)
  // -----------------------------------------------------------------------
  describe('scheduleFollowUp', () => {
    it('should schedule a follow-up exactly 48 hours from now', async () => {
      const mockPutItem = jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket();

      const result = await scheduleFollowUp(ticket);

      const expectedScheduledAt = new Date(
        new Date('2025-01-15T12:00:00.000Z').getTime() + DEFAULT_FOLLOWUP_DELAY_MS,
      ).toISOString();

      expect(result.ticketId).toBe('ticket-100');
      expect(result.type).toBe(FollowUpType.FOLLOW_UP);
      expect(result.status).toBe(FollowUpStatus.PENDING);
      expect(result.scheduledAt).toBe(expectedScheduledAt);
      // 48 hours later = 2025-01-17T12:00:00.000Z
      expect(result.scheduledAt).toBe('2025-01-17T12:00:00.000Z');
    });

    it('should store the follow-up in DynamoDB with correct keys', async () => {
      const mockPutItem = jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket();

      await scheduleFollowUp(ticket);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      const storedItem = mockPutItem.mock.calls[0][0];
      expect(storedItem.PK).toBe('FOLLOWUP#ticket-100');
      expect(storedItem.SK).toMatch(/^FOLLOW_UP#/);
      expect(storedItem.status).toBe(FollowUpStatus.PENDING);
      expect(storedItem.type).toBe(FollowUpType.FOLLOW_UP);
    });

    it('should allow custom delay via options (Requirement 11.5)', async () => {
      jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket();
      const customDelay = 72 * 60 * 60 * 1000; // 72 hours

      const result = await scheduleFollowUp(ticket, { delayMs: customDelay });

      const expectedScheduledAt = new Date(
        new Date('2025-01-15T12:00:00.000Z').getTime() + customDelay,
      ).toISOString();
      expect(result.scheduledAt).toBe(expectedScheduledAt);
      // 72 hours later = 2025-01-18T12:00:00.000Z
      expect(result.scheduledAt).toBe('2025-01-18T12:00:00.000Z');
    });

    it('should allow custom message via options (Requirement 11.5)', async () => {
      jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket();
      const customMessage = 'Hey, just checking in on your ticket!';

      const result = await scheduleFollowUp(ticket, { customMessage });

      expect(result.message).toBe(customMessage);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Satisfaction survey scheduling at 24 hours (Requirement 11.2)
  // -----------------------------------------------------------------------
  describe('scheduleSatisfactionSurvey', () => {
    it('should schedule a survey exactly 24 hours from now', async () => {
      jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket({ status: TicketStatus.RESOLVED });

      const result = await scheduleSatisfactionSurvey(ticket);

      const expectedScheduledAt = new Date(
        new Date('2025-01-15T12:00:00.000Z').getTime() + DEFAULT_SURVEY_DELAY_MS,
      ).toISOString();

      expect(result.ticketId).toBe('ticket-100');
      expect(result.type).toBe(FollowUpType.SATISFACTION_SURVEY);
      expect(result.status).toBe(FollowUpStatus.PENDING);
      expect(result.scheduledAt).toBe(expectedScheduledAt);
      // 24 hours later = 2025-01-16T12:00:00.000Z
      expect(result.scheduledAt).toBe('2025-01-16T12:00:00.000Z');
    });

    it('should store the survey in DynamoDB with correct keys', async () => {
      const mockPutItem = jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket({ status: TicketStatus.RESOLVED });

      await scheduleSatisfactionSurvey(ticket);

      expect(mockPutItem).toHaveBeenCalledTimes(1);
      const storedItem = mockPutItem.mock.calls[0][0];
      expect(storedItem.PK).toBe('FOLLOWUP#ticket-100');
      expect(storedItem.SK).toMatch(/^SATISFACTION_SURVEY#/);
      expect(storedItem.type).toBe(FollowUpType.SATISFACTION_SURVEY);
    });

    it('should allow custom delay for survey (Requirement 11.5)', async () => {
      jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);
      const ticket = createMockTicket({ status: TicketStatus.RESOLVED });
      const customDelay = 12 * 60 * 60 * 1000; // 12 hours

      const result = await scheduleSatisfactionSurvey(ticket, { delayMs: customDelay });

      // 12 hours later = 2025-01-16T00:00:00.000Z
      expect(result.scheduledAt).toBe('2025-01-16T00:00:00.000Z');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Cancellation of pending follow-ups (Requirement 11.4)
  // -----------------------------------------------------------------------
  describe('cancelPendingFollowUps', () => {
    it('should cancel all pending follow-ups for a ticket', async () => {
      const pendingItems = [
        {
          PK: 'FOLLOWUP#ticket-100',
          SK: 'FOLLOW_UP#2025-01-17T12:00:00.000Z',
          ticketId: 'ticket-100',
          type: FollowUpType.FOLLOW_UP,
          status: FollowUpStatus.PENDING,
          scheduledAt: '2025-01-17T12:00:00.000Z',
          message: 'Follow-up message',
          createdAt: '2025-01-15T12:00:00.000Z',
        },
        {
          PK: 'FOLLOWUP#ticket-100',
          SK: 'SATISFACTION_SURVEY#2025-01-16T12:00:00.000Z',
          ticketId: 'ticket-100',
          type: FollowUpType.SATISFACTION_SURVEY,
          status: FollowUpStatus.PENDING,
          scheduledAt: '2025-01-16T12:00:00.000Z',
          message: 'Survey message',
          createdAt: '2025-01-15T12:00:00.000Z',
        },
      ];

      jest.mocked(dynamodbClient.queryItems).mockResolvedValue(pendingItems);
      const mockUpdateItem = jest.mocked(dynamodbClient.updateItem).mockResolvedValue(undefined);

      const cancelledCount = await cancelPendingFollowUps('ticket-100');

      expect(cancelledCount).toBe(2);
      expect(mockUpdateItem).toHaveBeenCalledTimes(2);

      // Verify each update sets status to cancelled
      for (const call of mockUpdateItem.mock.calls) {
        expect(call[0]).toBe('FOLLOWUP#ticket-100');
        expect(call[2]).toContain('#status = :status');
        expect(call[3][':status']).toBe(FollowUpStatus.CANCELLED);
        expect(call[3][':cancelledAt']).toBeDefined();
      }
    });

    it('should return 0 when no pending follow-ups exist', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([]);
      const mockUpdateItem = jest.mocked(dynamodbClient.updateItem);

      const cancelledCount = await cancelPendingFollowUps('ticket-999');

      expect(cancelledCount).toBe(0);
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('should only cancel pending items, not already sent or cancelled ones', async () => {
      const items = [
        {
          ticketId: 'ticket-100',
          type: FollowUpType.FOLLOW_UP,
          status: FollowUpStatus.SENT,
          scheduledAt: '2025-01-14T12:00:00.000Z',
          message: 'Already sent',
          createdAt: '2025-01-12T12:00:00.000Z',
        },
        {
          ticketId: 'ticket-100',
          type: FollowUpType.FOLLOW_UP,
          status: FollowUpStatus.PENDING,
          scheduledAt: '2025-01-17T12:00:00.000Z',
          message: 'Still pending',
          createdAt: '2025-01-15T12:00:00.000Z',
        },
        {
          ticketId: 'ticket-100',
          type: FollowUpType.SATISFACTION_SURVEY,
          status: FollowUpStatus.CANCELLED,
          scheduledAt: '2025-01-16T12:00:00.000Z',
          message: 'Already cancelled',
          createdAt: '2025-01-14T12:00:00.000Z',
        },
      ];

      jest.mocked(dynamodbClient.queryItems).mockResolvedValue(items);
      const mockUpdateItem = jest.mocked(dynamodbClient.updateItem).mockResolvedValue(undefined);

      const cancelledCount = await cancelPendingFollowUps('ticket-100');

      // Only the one pending item should be cancelled
      expect(cancelledCount).toBe(1);
      expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Message personalization (Requirement 11.3)
  // -----------------------------------------------------------------------
  describe('Message personalization', () => {
    it('should include ticket ID in follow-up message', () => {
      const ticket = createMockTicket({ id: 'ticket-abc-123' });
      const message = generateFollowUpMessage(ticket);
      expect(message).toContain('ticket-abc-123');
    });

    it('should include ticket subject in follow-up message', () => {
      const ticket = createMockTicket({ subject: 'Login page broken' });
      const message = generateFollowUpMessage(ticket);
      expect(message).toContain('Login page broken');
    });

    it('should include description excerpt in follow-up message', () => {
      const ticket = createMockTicket({
        description: 'The login page returns a 500 error when I try to sign in.',
      });
      const message = generateFollowUpMessage(ticket);
      expect(message).toContain('500 error');
    });

    it('should truncate long descriptions in follow-up message', () => {
      const longDescription = 'A'.repeat(200);
      const ticket = createMockTicket({ description: longDescription });
      const message = generateFollowUpMessage(ticket);
      expect(message).toContain('...');
      // Should not contain the full 200-char description
      expect(message).not.toContain(longDescription);
    });

    it('should include ticket ID in survey message', () => {
      const ticket = createMockTicket({ id: 'ticket-xyz-789' });
      const message = generateSurveyMessage(ticket);
      expect(message).toContain('ticket-xyz-789');
    });

    it('should include ticket subject in survey message', () => {
      const ticket = createMockTicket({ subject: 'Billing discrepancy' });
      const message = generateSurveyMessage(ticket);
      expect(message).toContain('Billing discrepancy');
    });
  });

  // -----------------------------------------------------------------------
  // 5. getPendingFollowUps
  // -----------------------------------------------------------------------
  describe('getPendingFollowUps', () => {
    it('should return only pending follow-ups from DynamoDB', async () => {
      const items = [
        {
          ticketId: 'ticket-100',
          type: FollowUpType.FOLLOW_UP,
          status: FollowUpStatus.PENDING,
          scheduledAt: '2025-01-17T12:00:00.000Z',
          message: 'Pending follow-up',
          createdAt: '2025-01-15T12:00:00.000Z',
        },
        {
          ticketId: 'ticket-100',
          type: FollowUpType.SATISFACTION_SURVEY,
          status: FollowUpStatus.SENT,
          scheduledAt: '2025-01-16T12:00:00.000Z',
          message: 'Already sent survey',
          createdAt: '2025-01-15T12:00:00.000Z',
        },
      ];

      jest.mocked(dynamodbClient.queryItems).mockResolvedValue(items);

      const result = await getPendingFollowUps('ticket-100');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(FollowUpType.FOLLOW_UP);
      expect(result[0].status).toBe(FollowUpStatus.PENDING);
    });

    it('should query DynamoDB with correct partition key', async () => {
      const mockQueryItems = jest.mocked(dynamodbClient.queryItems).mockResolvedValue([]);

      await getPendingFollowUps('ticket-200');

      expect(mockQueryItems).toHaveBeenCalledWith(
        'PK = :pk',
        { ':pk': 'FOLLOWUP#ticket-200' },
      );
    });

    it('should return empty array when no follow-ups exist', async () => {
      jest.mocked(dynamodbClient.queryItems).mockResolvedValue([]);

      const result = await getPendingFollowUps('ticket-nonexistent');

      expect(result).toEqual([]);
    });
  });
});
