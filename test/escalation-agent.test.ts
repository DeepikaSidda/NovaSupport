/**
 * Unit tests for Escalation Agent
 */

import {
  evaluateEscalation,
  getEscalationConfig,
} from '../src/agents/escalation-agent';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import { WorkflowState, EscalationReason } from '../src/types/agent';

// Mock logger
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

/**
 * Helper to create test ticket
 */
function createTestTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'test-ticket-123',
    userId: 'user-456',
    subject: 'Test ticket subject',
    description: 'Test ticket description',
    status: TicketStatus.IN_PROGRESS,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  };
}

/**
 * Helper to create test workflow state
 */
function createTestWorkflowState(
  overrides: Partial<WorkflowState> = {}
): WorkflowState {
  return {
    routingConfidence: 0.8,
    responseConfidence: 0.8,
    attemptCount: 1,
    detectedIssues: [],
    ...overrides,
  };
}

describe('Escalation Agent', () => {
  describe('evaluateEscalation', () => {
    it('should not escalate when all confidence scores are above threshold', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.9,
        responseConfidence: 0.85,
        attemptCount: 1,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(false);
      expect(decision.summary).toContain('No escalation triggers');
    });

    it('should escalate when routing confidence is below threshold', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.6,
        responseConfidence: 0.8,
        attemptCount: 1,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LOW_CONFIDENCE);
      expect(decision.summary).toContain('0.60');
      expect(decision.summary).toContain('below threshold');
    });

    it('should escalate when response confidence is below threshold', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.8,
        responseConfidence: 0.65,
        attemptCount: 1,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LOW_CONFIDENCE);
      expect(decision.urgency).toBe('medium');
    });

    it('should escalate when both confidence scores are below threshold', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
        responseConfidence: 0.4,
        attemptCount: 1,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LOW_CONFIDENCE);
      expect(decision.urgency).toBe('high'); // Very low confidence
    });

    it('should escalate when attempt count reaches maximum', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.8,
        responseConfidence: 0.8,
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.MAX_ATTEMPTS);
      expect(decision.summary).toContain('exceeded maximum');
      expect(decision.attemptedSolutions.length).toBeGreaterThan(0);
    });

    it('should escalate when attempt count exceeds maximum', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.8,
        responseConfidence: 0.8,
        attemptCount: 5,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.MAX_ATTEMPTS);
    });

    it('should not escalate when attempt count is below maximum', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.8,
        responseConfidence: 0.8,
        attemptCount: 2,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(false);
    });
  });

  describe('Legal keyword detection', () => {
    it('should escalate when legal keywords are detected in subject', async () => {
      const ticket = createTestTicket({
        subject: 'I will file a lawsuit if this is not resolved',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LEGAL_ISSUE);
      expect(decision.urgency).toBe('critical');
      expect(decision.assignTo).toBe('legal-team');
      expect(decision.summary).toContain('lawsuit');
    });

    it('should escalate when legal keywords are detected in description', async () => {
      const ticket = createTestTicket({
        description: 'I have contacted my attorney about this matter',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LEGAL_ISSUE);
      expect(decision.urgency).toBe('critical');
      expect(decision.summary).toContain('attorney');
    });

    it('should detect multiple legal keywords', async () => {
      const ticket = createTestTicket({
        subject: 'Legal action required',
        description: 'I will sue and take you to court',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LEGAL_ISSUE);
      expect(decision.summary).toContain('legal action');
    });

    it('should be case-insensitive for legal keywords', async () => {
      const ticket = createTestTicket({
        description: 'I will contact my LAWYER about this LAWSUIT',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.LEGAL_ISSUE);
    });
  });

  describe('Security keyword detection', () => {
    it('should escalate when security keywords are detected', async () => {
      const ticket = createTestTicket({
        subject: 'Security breach - unauthorized access detected',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.SECURITY_ISSUE);
      expect(decision.urgency).toBe('critical');
      expect(decision.assignTo).toBe('security-team');
      expect(decision.summary).toContain('breach');
    });

    it('should detect hack-related keywords', async () => {
      const ticket = createTestTicket({
        description: 'My account was hacked and data was compromised',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.SECURITY_ISSUE);
      expect(decision.summary).toContain('hacked');
    });

    it('should detect vulnerability keywords', async () => {
      const ticket = createTestTicket({
        description: 'Found a security vulnerability in your system',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.SECURITY_ISSUE);
    });
  });

  describe('Compliance keyword detection', () => {
    it('should escalate when GDPR keywords are detected', async () => {
      const ticket = createTestTicket({
        subject: 'GDPR data deletion request',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.COMPLIANCE_ISSUE);
      expect(decision.urgency).toBe('critical');
      expect(decision.assignTo).toBe('compliance-team');
      expect(decision.summary).toContain('gdpr');
    });

    it('should escalate when HIPAA keywords are detected', async () => {
      const ticket = createTestTicket({
        description: 'This is a HIPAA compliance violation',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.COMPLIANCE_ISSUE);
      expect(decision.urgency).toBe('critical');
    });

    it('should detect PCI compliance keywords', async () => {
      const ticket = createTestTicket({
        description: 'PCI compliance issue with payment processing',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.COMPLIANCE_ISSUE);
    });

    it('should detect privacy violation keywords', async () => {
      const ticket = createTestTicket({
        subject: 'Privacy violation - data protection concern',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.reason).toBe(EscalationReason.COMPLIANCE_ISSUE);
    });
  });

  describe('Urgency determination', () => {
    it('should assign critical urgency for legal issues', async () => {
      const ticket = createTestTicket({
        subject: 'Legal action pending',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('critical');
    });

    it('should assign critical urgency for security issues', async () => {
      const ticket = createTestTicket({
        subject: 'Security breach detected',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('critical');
    });

    it('should assign critical urgency for compliance issues', async () => {
      const ticket = createTestTicket({
        subject: 'GDPR compliance violation',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('critical');
    });

    it('should assign high urgency for max attempts with high priority ticket', async () => {
      const ticket = createTestTicket({
        priority: Priority.HIGH,
      });
      const workflowState = createTestWorkflowState({
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('high');
    });

    it('should assign high urgency for very low confidence', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.4,
        responseConfidence: 0.3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('high');
    });

    it('should assign medium urgency for max attempts with medium priority', async () => {
      const ticket = createTestTicket({
        priority: Priority.MEDIUM,
      });
      const workflowState = createTestWorkflowState({
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('medium');
    });

    it('should assign medium urgency for low confidence', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.65,
        responseConfidence: 0.68,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.urgency).toBe('medium');
    });
  });

  describe('Escalation summary', () => {
    it('should include ticket ID in summary', async () => {
      const ticket = createTestTicket({ id: 'ticket-999' });
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.summary).toContain('ticket-999');
    });

    it('should include escalation reasons in summary', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.6,
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.summary).toContain('Escalation Reasons');
      expect(decision.summary).toContain('low_confidence');
    });

    it('should include ticket context in summary', async () => {
      const ticket = createTestTicket({
        subject: 'Important issue',
        priority: Priority.HIGH,
        assignedTeam: 'support-team',
      });
      const workflowState = createTestWorkflowState({
        responseConfidence: 0.5,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.summary).toContain('Important issue');
      expect(decision.summary).toContain('Priority: 8');
      expect(decision.summary).toContain('support-team');
    });

    it('should include confidence scores in summary', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.65,
        responseConfidence: 0.55,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.summary).toContain('Routing Confidence: 65%');
      expect(decision.summary).toContain('Response Confidence: 55%');
    });

    it('should include attempt count in summary', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.6,
        attemptCount: 2,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.summary).toContain('Automated Attempts: 2');
    });
  });

  describe('Attempted solutions', () => {
    it('should include attempted solutions based on attempt count', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.6,
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.attemptedSolutions.length).toBeGreaterThan(0);
      expect(decision.attemptedSolutions.some(s => s.includes('Attempt 1'))).toBe(true);
      expect(decision.attemptedSolutions.some(s => s.includes('Attempt 2'))).toBe(true);
      expect(decision.attemptedSolutions.some(s => s.includes('Attempt 3'))).toBe(true);
    });

    it('should include low confidence routing in attempted solutions', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
        responseConfidence: 0.8,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(
        decision.attemptedSolutions.some(s => s.includes('routing with low confidence'))
      ).toBe(true);
    });

    it('should include low confidence response in attempted solutions', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.8,
        responseConfidence: 0.6,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(
        decision.attemptedSolutions.some(s => s.includes('response generation with low confidence'))
      ).toBe(true);
    });

    it('should include detected issues in attempted solutions', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.6,
        detectedIssues: ['unclear requirements', 'missing information'],
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(
        decision.attemptedSolutions.some(s => s.includes('unclear requirements'))
      ).toBe(true);
    });
  });

  describe('Assignment determination', () => {
    it('should assign to legal team for legal issues', async () => {
      const ticket = createTestTicket({
        subject: 'Legal action required',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.assignTo).toBe('legal-team');
    });

    it('should assign to security team for security issues', async () => {
      const ticket = createTestTicket({
        subject: 'Security breach',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.assignTo).toBe('security-team');
    });

    it('should assign to compliance team for compliance issues', async () => {
      const ticket = createTestTicket({
        subject: 'GDPR violation',
      });
      const workflowState = createTestWorkflowState();

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.assignTo).toBe('compliance-team');
    });

    it('should assign to senior support for low confidence', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.assignTo).toBe('senior-support');
    });

    it('should assign to team senior for max attempts with existing team', async () => {
      const ticket = createTestTicket({
        assignedTeam: 'support-team',
      });
      const workflowState = createTestWorkflowState({
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.assignTo).toBe('support-team-senior');
    });
  });

  describe('Multiple triggers', () => {
    it('should prioritize legal/security/compliance over low confidence', async () => {
      const ticket = createTestTicket({
        subject: 'Security breach with low confidence',
      });
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
        responseConfidence: 0.5,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      // Security should take priority
      expect(decision.reason).toBe(EscalationReason.SECURITY_ISSUE);
      expect(decision.urgency).toBe('critical');
    });

    it('should include all triggers in summary', async () => {
      const ticket = createTestTicket({
        subject: 'Legal action for security breach',
      });
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      // Should mention multiple reasons in summary
      expect(decision.summary).toContain('legal');
      expect(decision.summary).toContain('security');
    });
  });

  describe('Edge cases', () => {
    it('should handle confidence score exactly at threshold', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.7,
        responseConfidence: 0.7,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      // At threshold should not escalate
      expect(decision.shouldEscalate).toBe(false);
    });

    it('should handle confidence score just below threshold', async () => {
      const ticket = createTestTicket();
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.69,
        responseConfidence: 0.8,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      // Just below threshold should escalate
      expect(decision.shouldEscalate).toBe(true);
    });

    it('should handle empty ticket description', async () => {
      const ticket = createTestTicket({
        description: '',
      });
      const workflowState = createTestWorkflowState({
        routingConfidence: 0.5,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.summary).toBeDefined();
    });

    it('should handle ticket with no assigned team', async () => {
      const ticket = createTestTicket({
        assignedTeam: undefined,
      });
      const workflowState = createTestWorkflowState({
        attemptCount: 3,
      });

      const decision = await evaluateEscalation(ticket, workflowState);

      expect(decision.shouldEscalate).toBe(true);
      expect(decision.assignTo).toBe('senior-support');
    });
  });

  describe('Configuration', () => {
    it('should expose escalation configuration', () => {
      const config = getEscalationConfig();

      expect(config.confidenceThreshold).toBe(0.7);
      expect(config.maxAttempts).toBe(3);
      expect(config.legalKeywords).toContain('lawsuit');
      expect(config.securityKeywords).toContain('breach');
      expect(config.complianceKeywords).toContain('gdpr');
    });
  });
});
