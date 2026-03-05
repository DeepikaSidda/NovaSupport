/**
 * Property-based tests for Follow-Up Scheduling Service
 * Tests tasks 19.2, 19.3, 19.4, 19.5
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 * Property 22: Follow-Up Scheduling Timing
 * Property 23: Satisfaction Survey Scheduling
 * Property 24: Follow-Up Cancellation on Response
 * Property 25: Follow-Up Message Personalization
 */

import * as fc from 'fast-check';
import {
  scheduleFollowUp,
  scheduleSatisfactionSurvey,
  cancelPendingFollowUps,
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
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const priorityArb = fc.constantFrom(Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL);

const statusArb = fc.constantFrom(
  TicketStatus.PENDING_USER,
  TicketStatus.RESOLVED,
  TicketStatus.NEW,
  TicketStatus.ASSIGNED,
);

/** Generate a realistic ticket with non-empty id, subject, and description */
const ticketArb: fc.Arbitrary<Ticket> = fc
  .record({
    id: fc.stringMatching(/^[a-zA-Z0-9_-]{1,36}$/).filter((s) => s.length > 0),
    userId: fc.stringMatching(/^[a-zA-Z0-9_-]{1,36}$/).filter((s) => s.length > 0),
    subject: fc.string({ minLength: 1, maxLength: 100 }),
    description: fc.string({ minLength: 1, maxLength: 500 }),
    status: statusArb,
    priority: priorityArb,
  })
  .map(({ id, userId, subject, description, status, priority }): Ticket => ({
    id,
    userId,
    subject,
    description,
    status,
    priority,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
  }));

/** Generate a ticket specifically in PENDING_USER status */
const pendingTicketArb: fc.Arbitrary<Ticket> = ticketArb.map((t) => ({
  ...t,
  status: TicketStatus.PENDING_USER,
}));

/** Generate a ticket specifically in RESOLVED status */
const resolvedTicketArb: fc.Arbitrary<Ticket> = ticketArb.map((t) => ({
  ...t,
  status: TicketStatus.RESOLVED,
}));

/**
 * Generate a list of 1-5 pending follow-up records for a given ticketId.
 * Used for testing cancellation.
 */
function pendingRecordsArb(ticketId: string): fc.Arbitrary<Record<string, unknown>[]> {
  return fc
    .array(
      fc.record({
        type: fc.constantFrom(FollowUpType.FOLLOW_UP, FollowUpType.SATISFACTION_SURVEY),
        scheduledAt: fc.date({ min: new Date('2025-01-01'), max: new Date('2026-01-01') }),
      }),
      { minLength: 1, maxLength: 5 },
    )
    .map((items) =>
      items.map((item) => ({
        ticketId,
        type: item.type,
        status: FollowUpStatus.PENDING,
        scheduledAt: item.scheduledAt.toISOString(),
        message: `Follow-up for ${ticketId}`,
        createdAt: new Date().toISOString(),
      })),
    );
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property-Based Tests: Follow-Up Scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 22: Follow-Up Scheduling Timing
   * **Validates: Requirements 11.1**
   *
   * For any ticket in "pending user response" status, a follow-up message
   * should be scheduled exactly 48 hours after the status change.
   */
  test('Property 22: Follow-up is scheduled exactly 48 hours from now', async () => {
    await fc.assert(
      fc.asyncProperty(pendingTicketArb, async (ticket) => {
        jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);

        const before = Date.now();
        const result = await scheduleFollowUp(ticket);
        const after = Date.now();

        const scheduledTime = new Date(result.scheduledAt).getTime();

        // scheduledAt should be Date.now() + 48h, within the execution window
        expect(scheduledTime).toBeGreaterThanOrEqual(before + DEFAULT_FOLLOWUP_DELAY_MS);
        expect(scheduledTime).toBeLessThanOrEqual(after + DEFAULT_FOLLOWUP_DELAY_MS);

        // Verify the record metadata
        expect(result.type).toBe(FollowUpType.FOLLOW_UP);
        expect(result.status).toBe(FollowUpStatus.PENDING);
        expect(result.ticketId).toBe(ticket.id);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 23: Satisfaction Survey Scheduling
   * **Validates: Requirements 11.2**
   *
   * For any ticket that transitions to "resolved" status, a satisfaction
   * survey should be scheduled exactly 24 hours after resolution.
   */
  test('Property 23: Survey is scheduled exactly 24 hours from now', async () => {
    await fc.assert(
      fc.asyncProperty(resolvedTicketArb, async (ticket) => {
        jest.mocked(dynamodbClient.putItem).mockResolvedValue(undefined);

        const before = Date.now();
        const result = await scheduleSatisfactionSurvey(ticket);
        const after = Date.now();

        const scheduledTime = new Date(result.scheduledAt).getTime();

        // scheduledAt should be Date.now() + 24h, within the execution window
        expect(scheduledTime).toBeGreaterThanOrEqual(before + DEFAULT_SURVEY_DELAY_MS);
        expect(scheduledTime).toBeLessThanOrEqual(after + DEFAULT_SURVEY_DELAY_MS);

        // Verify the record metadata
        expect(result.type).toBe(FollowUpType.SATISFACTION_SURVEY);
        expect(result.status).toBe(FollowUpStatus.PENDING);
        expect(result.ticketId).toBe(ticket.id);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 24: Follow-Up Cancellation on Response
   * **Validates: Requirements 11.4**
   *
   * For any ticket with pending follow-up messages, when the user responds,
   * all pending follow-ups for that ticket should be cancelled.
   */
  test('Property 24: All pending follow-ups are cancelled when user responds', async () => {
    await fc.assert(
      fc.asyncProperty(
        ticketArb.chain((ticket) =>
          pendingRecordsArb(ticket.id).map((records) => ({ ticket, records })),
        ),
        async ({ ticket, records }) => {
          // Clear mocks between iterations to avoid accumulation
          jest.mocked(dynamodbClient.queryItems).mockReset();
          jest.mocked(dynamodbClient.updateItem).mockReset();

          jest.mocked(dynamodbClient.queryItems).mockResolvedValue(records);
          jest.mocked(dynamodbClient.updateItem).mockResolvedValue(undefined);

          const cancelledCount = await cancelPendingFollowUps(ticket.id);

          // All pending records should be cancelled
          expect(cancelledCount).toBe(records.length);

          // updateItem should be called once per pending record
          expect(dynamodbClient.updateItem).toHaveBeenCalledTimes(records.length);

          // Each call should set status to 'cancelled' and include cancelledAt
          for (const call of jest.mocked(dynamodbClient.updateItem).mock.calls) {
            const expressionValues = call[3] as Record<string, unknown>;
            expect(expressionValues[':status']).toBe(FollowUpStatus.CANCELLED);
            expect(expressionValues[':cancelledAt']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 25: Follow-Up Message Personalization
   * **Validates: Requirements 11.3**
   *
   * For any follow-up message, the message content should include
   * ticket-specific information (ticket ID, subject, or issue description).
   */
  test('Property 25: Follow-up messages contain ticket-specific information', () => {
    fc.assert(
      fc.property(ticketArb, (ticket) => {
        const followUpMsg = generateFollowUpMessage(ticket);
        const surveyMsg = generateSurveyMessage(ticket);

        // Follow-up message must contain ticket ID and subject
        expect(followUpMsg).toContain(ticket.id);
        expect(followUpMsg).toContain(ticket.subject);

        // Follow-up message must contain at least part of the description
        const descExcerpt = ticket.description.length > 120
          ? ticket.description.slice(0, 120)
          : ticket.description;
        expect(followUpMsg).toContain(descExcerpt);

        // Survey message must contain ticket ID and subject
        expect(surveyMsg).toContain(ticket.id);
        expect(surveyMsg).toContain(ticket.subject);
      }),
      { numRuns: 100 },
    );
  });
});
