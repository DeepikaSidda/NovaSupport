/**
 * Property-based tests for Escalation Agent
 * Tests tasks 9.3, 9.4, and 9.5
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import {
  evaluateEscalation,
  getEscalationConfig,
} from '../src/agents/escalation-agent';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import { WorkflowState, EscalationReason } from '../src/types/agent';

jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// --- Arbitraries ---

const ticketStatusArb = fc.constantFrom(
  TicketStatus.NEW,
  TicketStatus.ANALYZING,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.PENDING_USER,
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED
);

const priorityArb = fc.constantFrom(
  Priority.LOW,
  Priority.MEDIUM,
  Priority.HIGH,
  Priority.CRITICAL
);

/** Generate a safe string that won't accidentally contain escalation keywords */
function safeStringArb(opts: { minLength?: number; maxLength?: number } = {}) {
  const chars = 'abcdfijkmnopqrtuvwxyz0123456789 ';
  return fc.stringOf(fc.constantFrom(...chars.split('')), {
    minLength: opts.minLength ?? 1,
    maxLength: opts.maxLength ?? 50,
  });
}

const safeTicketArb: fc.Arbitrary<Ticket> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  subject: safeStringArb({ minLength: 3, maxLength: 60 }),
  description: safeStringArb({ minLength: 5, maxLength: 200 }),
  status: ticketStatusArb,
  priority: priorityArb,
  createdAt: fc.date(),
  updatedAt: fc.date(),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
  attachments: fc.constant([]),
});

const ticketArb: fc.Arbitrary<Ticket> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  subject: fc.string({ minLength: 1, maxLength: 80 }),
  description: fc.string({ minLength: 1, maxLength: 300 }),
  status: ticketStatusArb,
  priority: priorityArb,
  createdAt: fc.date(),
  updatedAt: fc.date(),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
  attachments: fc.constant([]),
});

// --- Property Tests ---

describe('Property-Based Tests: Escalation Agent', () => {
  /**
   * Property 7: Escalation Trigger Detection
   * **Validates: Requirements 4.1, 4.2, 4.3**
   *
   * For any ticket, escalation should be triggered if:
   * (1) any agent's confidence score is below 0.7, OR
   * (2) the ticket contains legal/security/compliance keywords, OR
   * (3) automated response attempts exceed 3.
   */
  describe('Property 7: Escalation Trigger Detection', () => {
    test('Low confidence triggers escalation (routingConfidence < 0.7)', async () => {
      await fc.assert(
        fc.asyncProperty(
          safeTicketArb,
          fc.double({ min: 0, max: 0.6999, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          async (ticket, lowRouting, anyResponse) => {
            const workflowState: WorkflowState = {
              routingConfidence: lowRouting,
              responseConfidence: anyResponse,
              attemptCount: 0,
              detectedIssues: [],
            };

            const decision = await evaluateEscalation(ticket, workflowState);
            expect(decision.shouldEscalate).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('Low confidence triggers escalation (responseConfidence < 0.7)', async () => {
      await fc.assert(
        fc.asyncProperty(
          safeTicketArb,
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 0.6999, noNaN: true }),
          async (ticket, anyRouting, lowResponse) => {
            const workflowState: WorkflowState = {
              routingConfidence: anyRouting,
              responseConfidence: lowResponse,
              attemptCount: 0,
              detectedIssues: [],
            };

            const decision = await evaluateEscalation(ticket, workflowState);
            expect(decision.shouldEscalate).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('Legal/security/compliance keywords trigger escalation', async () => {
      const config = getEscalationConfig();
      const allKeywords = [
        ...config.legalKeywords,
        ...config.securityKeywords,
        ...config.complianceKeywords,
      ];

      await fc.assert(
        fc.asyncProperty(
          safeTicketArb,
          fc.constantFrom(...allKeywords),
          fc.boolean(),
          async (baseTicket, keyword, inSubject) => {
            const ticket: Ticket = {
              ...baseTicket,
              subject: inSubject ? `issue about ${keyword} problem` : baseTicket.subject,
              description: inSubject ? baseTicket.description : `we have a ${keyword} situation`,
            };

            const workflowState: WorkflowState = {
              routingConfidence: 0.9,
              responseConfidence: 0.9,
              attemptCount: 0,
              detectedIssues: [],
            };

            const decision = await evaluateEscalation(ticket, workflowState);
            expect(decision.shouldEscalate).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('Attempt count >= 3 triggers escalation', async () => {
      await fc.assert(
        fc.asyncProperty(
          safeTicketArb,
          fc.integer({ min: 3, max: 100 }),
          async (ticket, attemptCount) => {
            const workflowState: WorkflowState = {
              routingConfidence: 0.9,
              responseConfidence: 0.9,
              attemptCount,
              detectedIssues: [],
            };

            const decision = await evaluateEscalation(ticket, workflowState);
            expect(decision.shouldEscalate).toBe(true);
            expect(decision.reason).toBe(EscalationReason.MAX_ATTEMPTS);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('No triggers means no escalation', async () => {
      await fc.assert(
        fc.asyncProperty(
          safeTicketArb,
          fc.double({ min: 0.7, max: 1, noNaN: true }),
          fc.double({ min: 0.7, max: 1, noNaN: true }),
          fc.integer({ min: 0, max: 2 }),
          async (ticket, routingConf, responseConf, attemptCount) => {
            const workflowState: WorkflowState = {
              routingConfidence: routingConf,
              responseConfidence: responseConf,
              attemptCount,
              detectedIssues: [],
            };

            const decision = await evaluateEscalation(ticket, workflowState);
            expect(decision.shouldEscalate).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 8: Escalation Summary Completeness
   * **Validates: Requirements 4.4**
   *
   * For any escalation decision where shouldEscalate is true, the escalation
   * should include a summary, the escalation reason, and a list of attempted solutions.
   */
  describe('Property 8: Escalation Summary Completeness', () => {
    test('Escalation decisions include summary, reason, and attemptedSolutions', async () => {
      await fc.assert(
        fc.asyncProperty(
          ticketArb,
          fc.double({ min: 0, max: 0.6999, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.integer({ min: 0, max: 10 }),
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 3 }),
          async (ticket, lowConf, otherConf, attempts, issues) => {
            const workflowState: WorkflowState = {
              routingConfidence: lowConf,
              responseConfidence: otherConf,
              attemptCount: attempts,
              detectedIssues: issues,
            };

            const decision = await evaluateEscalation(ticket, workflowState);

            // This should always escalate due to low routingConfidence
            expect(decision.shouldEscalate).toBe(true);

            // Summary must be a non-empty string
            expect(typeof decision.summary).toBe('string');
            expect(decision.summary.length).toBeGreaterThan(0);

            // Reason must be a valid EscalationReason
            expect(Object.values(EscalationReason)).toContain(decision.reason);

            // attemptedSolutions must be an array
            expect(Array.isArray(decision.attemptedSolutions)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// --- Unit Tests for Keyword Detection (Task 9.5) ---

describe('Keyword Detection Unit Tests', () => {
  /**
   * **Validates: Requirements 4.1**
   * WHEN a ticket contains indicators of legal, security, or compliance issues,
   * THE Escalation_Manager SHALL flag it for immediate human review.
   */

  describe('Legal keywords', () => {
    it.each(['lawsuit', 'attorney', 'legal action'])(
      'should escalate for legal keyword: %s',
      async (keyword) => {
        const ticket: Ticket = {
          id: 'kw-legal-1',
          userId: 'user-1',
          subject: 'Normal subject',
          description: `I need help with a ${keyword} matter`,
          status: TicketStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          attachments: [],
        };

        const workflowState: WorkflowState = {
          routingConfidence: 0.9,
          responseConfidence: 0.9,
          attemptCount: 0,
          detectedIssues: [],
        };

        const decision = await evaluateEscalation(ticket, workflowState);

        expect(decision.shouldEscalate).toBe(true);
        expect(decision.reason).toBe(EscalationReason.LEGAL_ISSUE);
        expect(decision.urgency).toBe('critical');
        expect(decision.assignTo).toBe('legal-team');
      }
    );
  });

  describe('Security keywords', () => {
    it.each(['breach', 'hack', 'vulnerability'])(
      'should escalate for security keyword: %s',
      async (keyword) => {
        const ticket: Ticket = {
          id: 'kw-sec-1',
          userId: 'user-1',
          subject: `Reporting a ${keyword}`,
          description: 'Please investigate this issue',
          status: TicketStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          attachments: [],
        };

        const workflowState: WorkflowState = {
          routingConfidence: 0.9,
          responseConfidence: 0.9,
          attemptCount: 0,
          detectedIssues: [],
        };

        const decision = await evaluateEscalation(ticket, workflowState);

        expect(decision.shouldEscalate).toBe(true);
        expect(decision.reason).toBe(EscalationReason.SECURITY_ISSUE);
        expect(decision.urgency).toBe('critical');
        expect(decision.assignTo).toBe('security-team');
      }
    );
  });

  describe('Compliance keywords', () => {
    it.each(['gdpr', 'hipaa', 'pci'])(
      'should escalate for compliance keyword: %s',
      async (keyword) => {
        const ticket: Ticket = {
          id: 'kw-comp-1',
          userId: 'user-1',
          subject: 'Normal subject',
          description: `This involves ${keyword} requirements`,
          status: TicketStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: [],
          attachments: [],
        };

        const workflowState: WorkflowState = {
          routingConfidence: 0.9,
          responseConfidence: 0.9,
          attemptCount: 0,
          detectedIssues: [],
        };

        const decision = await evaluateEscalation(ticket, workflowState);

        expect(decision.shouldEscalate).toBe(true);
        expect(decision.reason).toBe(EscalationReason.COMPLIANCE_ISSUE);
        expect(decision.urgency).toBe('critical');
        expect(decision.assignTo).toBe('compliance-team');
      }
    );
  });
});
