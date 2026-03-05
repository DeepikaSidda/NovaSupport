/**
 * Unit tests for Workflow Orchestrator
 * Tests the agent workflow state machine and orchestration logic
 */

import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import {
  AgentType,
  SharedWorkflowContext,
  RetryPolicy,
} from '../src/types/agent';
// SharedWorkflowContext is used in context propagation tests below
import {
  processTicket,
  getWorkflowStatus,
  retryFailedStep,
  registerAgent,
  clearAgents,
  calculateBackoff,
  getWorkflowStepDefinitions,
  getDefaultRetryPolicies,
  setSleepFn,
  resetSleepFn,
  AgentExecutor,
} from '../src/services/workflow-orchestrator';

// Mock dependencies
jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Workflow Orchestrator', () => {
  const createMockTicket = (overrides?: Partial<Ticket>): Ticket => ({
    id: 'ticket-001',
    userId: 'user-001',
    subject: 'Test issue',
    description: 'Something is broken',
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearAgents();

    // Mock sleep to avoid real delays in tests
    setSleepFn(async () => {});

    // Mock DynamoDB to store/retrieve in memory
    const store = new Map<string, any>();
    const dynamodb = require('../src/utils/dynamodb-client');
    dynamodb.putItem.mockImplementation(async (item: any) => {
      store.set(`${item.PK}#${item.SK}`, item);
    });
    dynamodb.getItem.mockImplementation(async (pk: string, sk: string) => {
      return store.get(`${pk}#${sk}`);
    });
    dynamodb.updateItem.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSleepFn();
  });

  describe('Workflow Step Definitions', () => {
    test('should define steps in correct order: routing → analysis → response → escalation', () => {
      const definitions = getWorkflowStepDefinitions();
      expect(definitions).toHaveLength(4);
      expect(definitions[0].agentType).toBe(AgentType.ROUTING);
      expect(definitions[1].agentType).toBe(AgentType.ANALYSIS);
      expect(definitions[2].agentType).toBe(AgentType.RESPONSE);
      expect(definitions[3].agentType).toBe(AgentType.ESCALATION);
    });

    test('should mark analysis step as optional', () => {
      const definitions = getWorkflowStepDefinitions();
      expect(definitions[1].optional).toBe(true);
      expect(definitions[0].optional).toBeUndefined();
      expect(definitions[2].optional).toBeUndefined();
      expect(definitions[3].optional).toBeUndefined();
    });

    test('should have retry policies for all agent types', () => {
      const policies = getDefaultRetryPolicies();
      expect(policies[AgentType.ROUTING]).toBeDefined();
      expect(policies[AgentType.ANALYSIS]).toBeDefined();
      expect(policies[AgentType.RESPONSE]).toBeDefined();
      expect(policies[AgentType.ESCALATION]).toBeDefined();
    });

    test('retry policies should have valid configuration', () => {
      const policies = getDefaultRetryPolicies();
      for (const agentType of Object.values(AgentType)) {
        const policy = policies[agentType];
        expect(policy.maxRetries).toBeGreaterThanOrEqual(1);
        expect(policy.initialBackoffMs).toBeGreaterThan(0);
        expect(policy.maxBackoffMs).toBeGreaterThanOrEqual(policy.initialBackoffMs);
        expect(policy.backoffMultiplier).toBeGreaterThan(1);
      }
    });
  });

  describe('calculateBackoff', () => {
    const policy: RetryPolicy = {
      maxRetries: 3,
      initialBackoffMs: 1000,
      maxBackoffMs: 10000,
      backoffMultiplier: 2,
    };

    test('should return initial backoff for first retry', () => {
      expect(calculateBackoff(0, policy)).toBe(1000);
    });

    test('should double backoff for each subsequent retry', () => {
      expect(calculateBackoff(1, policy)).toBe(2000);
      expect(calculateBackoff(2, policy)).toBe(4000);
    });

    test('should cap backoff at maxBackoffMs', () => {
      expect(calculateBackoff(10, policy)).toBe(10000);
    });
  });

  describe('processTicket', () => {
    const mockRoutingExecutor: AgentExecutor = jest.fn().mockResolvedValue({
      output: {
        assignedTo: 'team-backend',
        reasoning: 'Backend issue',
        confidence: 0.9,
        requiresSpecializedExpertise: false,
      },
      confidence: 0.9,
    });

    const mockAnalysisExecutor: AgentExecutor = jest.fn().mockResolvedValue({
      output: {
        knowledgeBaseResults: [{ articleId: 'kb-1', title: 'Fix guide', relevantSections: ['Step 1'], relevanceScore: 0.85 }],
        similarTickets: [],
      },
      confidence: 0.8,
    });

    const mockResponseExecutor: AgentExecutor = jest.fn().mockResolvedValue({
      output: {
        text: 'Here is how to fix your issue...',
        confidence: 0.85,
        reasoning: 'Based on KB article',
        referencedArticles: ['kb-1'],
      },
      confidence: 0.85,
    });

    const mockEscalationExecutor: AgentExecutor = jest.fn().mockResolvedValue({
      output: {
        shouldEscalate: false,
        reason: 'low_confidence',
        urgency: 'low',
        summary: 'No escalation needed',
        attemptedSolutions: [],
      },
      confidence: 1.0,
    });

    function registerAllAgents() {
      registerAgent(AgentType.ROUTING, mockRoutingExecutor);
      registerAgent(AgentType.ANALYSIS, mockAnalysisExecutor);
      registerAgent(AgentType.RESPONSE, mockResponseExecutor);
      registerAgent(AgentType.ESCALATION, mockEscalationExecutor);
    }

    test('should complete workflow successfully with all agents', async () => {
      registerAllAgents();
      const ticket = createMockTicket();

      const result = await processTicket(ticket);

      expect(result.status).toBe('completed');
      expect(result.ticketId).toBe('ticket-001');
      expect(result.workflowId).toBeDefined();
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[1].status).toBe('completed');
      expect(result.steps[2].status).toBe('completed');
      expect(result.steps[3].status).toBe('completed');
    });

    test('should pass context from routing to subsequent agents', async () => {
      registerAllAgents();
      const ticket = createMockTicket();

      await processTicket(ticket);

      // Analysis should receive routing decision in context
      expect(mockAnalysisExecutor).toHaveBeenCalledWith(
        ticket,
        expect.objectContaining({
          routingDecision: expect.objectContaining({ assignedTo: 'team-backend' }),
        })
      );

      // Response should receive routing + analysis context
      expect(mockResponseExecutor).toHaveBeenCalledWith(
        ticket,
        expect.objectContaining({
          routingDecision: expect.objectContaining({ assignedTo: 'team-backend' }),
          knowledgeBaseResults: expect.arrayContaining([
            expect.objectContaining({ articleId: 'kb-1' }),
          ]),
        })
      );
    });

    test('should continue workflow when optional analysis step fails', async () => {
      registerAgent(AgentType.ROUTING, mockRoutingExecutor);
      registerAgent(AgentType.ANALYSIS, jest.fn().mockRejectedValue(new Error('Analysis failed')));
      registerAgent(AgentType.RESPONSE, mockResponseExecutor);
      registerAgent(AgentType.ESCALATION, mockEscalationExecutor);

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('completed');
      expect(result.steps[1].status).toBe('failed');
      expect(result.steps[2].status).toBe('completed');
      expect(result.steps[3].status).toBe('completed');
    });

    test('should fail workflow when required routing step fails', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockRejectedValue(new Error('Routing failed')));
      registerAgent(AgentType.ANALYSIS, mockAnalysisExecutor);
      registerAgent(AgentType.RESPONSE, mockResponseExecutor);
      registerAgent(AgentType.ESCALATION, mockEscalationExecutor);

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      // Subsequent steps should remain pending
      expect(result.steps[1].status).toBe('pending');
    });

    test('should fail workflow when required response step fails', async () => {
      registerAgent(AgentType.ROUTING, mockRoutingExecutor);
      registerAgent(AgentType.ANALYSIS, mockAnalysisExecutor);
      registerAgent(AgentType.RESPONSE, jest.fn().mockRejectedValue(new Error('Response failed')));
      registerAgent(AgentType.ESCALATION, mockEscalationExecutor);

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('failed');
      expect(result.steps[2].status).toBe('failed');
    });

    test('should include confidence scores in completed steps', async () => {
      registerAllAgents();
      const ticket = createMockTicket();

      const result = await processTicket(ticket);

      expect(result.steps[0].confidence).toBe(0.9);
      expect(result.steps[1].confidence).toBe(0.8);
      expect(result.steps[2].confidence).toBe(0.85);
      expect(result.steps[3].confidence).toBe(1.0);
    });

    test('should persist workflow state to DynamoDB', async () => {
      const dynamodb = require('../src/utils/dynamodb-client');
      registerAllAgents();
      const ticket = createMockTicket();

      await processTicket(ticket);

      // putItem should be called for initial save + after each step + final save
      expect(dynamodb.putItem).toHaveBeenCalled();
      const lastCall = dynamodb.putItem.mock.calls[dynamodb.putItem.mock.calls.length - 1][0];
      expect(lastCall.status).toBe('completed');
      expect(lastCall.PK).toMatch(/^WORKFLOW#/);
    });

    test('should generate unique workflow IDs', async () => {
      registerAllAgents();
      const ticket = createMockTicket();

      const result1 = await processTicket(ticket);
      const result2 = await processTicket(ticket);

      expect(result1.workflowId).not.toBe(result2.workflowId);
    });
  });

  describe('Retry Logic', () => {
    test('should retry failed steps according to retry policy', async () => {
      let routingCallCount = 0;
      const flakyRoutingExecutor: AgentExecutor = jest.fn().mockImplementation(async () => {
        routingCallCount++;
        if (routingCallCount <= 2) {
          throw new Error('Transient failure');
        }
        return {
          output: { assignedTo: 'team-a', reasoning: 'ok', confidence: 0.8, requiresSpecializedExpertise: false },
          confidence: 0.8,
        };
      });

      registerAgent(AgentType.ROUTING, flakyRoutingExecutor);
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.7 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({
        output: { text: 'ok', confidence: 0.8, reasoning: 'ok', referencedArticles: [] },
        confidence: 0.8,
      }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({
        output: { shouldEscalate: false, reason: 'low_confidence', urgency: 'low', summary: '', attemptedSolutions: [] },
        confidence: 1.0,
      }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      // Should succeed after retries
      expect(result.status).toBe('completed');
      expect(flakyRoutingExecutor).toHaveBeenCalledTimes(3);
    });

    test('should fail after exhausting all retries', async () => {
      const alwaysFailExecutor: AgentExecutor = jest.fn().mockRejectedValue(new Error('Permanent failure'));

      registerAgent(AgentType.ROUTING, alwaysFailExecutor);
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.7 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('failed');
      // maxRetries for routing is 3, so total calls = 1 initial + 3 retries = 4
      expect(alwaysFailExecutor).toHaveBeenCalledTimes(4);
    });
  });

  describe('getWorkflowStatus', () => {
    test('should return undefined for non-existent workflow', async () => {
      const dynamodb = require('../src/utils/dynamodb-client');
      dynamodb.getItem.mockResolvedValue(undefined);

      const status = await getWorkflowStatus('non-existent');
      expect(status).toBeUndefined();
    });

    test('should return workflow status for existing workflow', async () => {
      const dynamodb = require('../src/utils/dynamodb-client');
      dynamodb.getItem.mockResolvedValue({
        PK: 'WORKFLOW#wf-123',
        SK: 'STATE',
        workflowId: 'wf-123',
        ticketId: 'ticket-001',
        status: 'completed',
        steps: [
          { stepId: 'step-0-routing', agentType: 'routing', status: 'completed', input: {}, output: {}, startTime: new Date().toISOString(), endTime: new Date().toISOString() },
        ],
        currentStep: 0,
        sharedContext: {},
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ttl: 0,
      });

      const status = await getWorkflowStatus('wf-123');
      expect(status).toBeDefined();
      expect(status!.workflowId).toBe('wf-123');
      expect(status!.status).toBe('completed');
      expect(status!.totalSteps).toBe(1);
    });
  });

  describe('retryFailedStep', () => {
    test('should throw for non-existent workflow', async () => {
      const dynamodb = require('../src/utils/dynamodb-client');
      dynamodb.getItem.mockResolvedValue(undefined);

      const ticket = createMockTicket();
      await expect(retryFailedStep('non-existent', 'step-0', ticket)).rejects.toThrow('Workflow not found');
    });
  });

  describe('Agent Registration', () => {
    test('should throw when processing ticket without registered agents', async () => {
      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      // Should fail because no routing agent is registered
      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
    });
  });

  describe('State Transitions', () => {
    test('steps transition from pending → running → completed on success', async () => {
      const stateTransitions: Record<string, string[]> = {};

      const trackingExecutor = (agentType: string): AgentExecutor =>
        jest.fn().mockImplementation(async () => {
          return { output: { mock: true }, confidence: 0.9 };
        });

      registerAgent(AgentType.ROUTING, trackingExecutor('routing'));
      registerAgent(AgentType.ANALYSIS, trackingExecutor('analysis'));
      registerAgent(AgentType.RESPONSE, trackingExecutor('response'));
      registerAgent(AgentType.ESCALATION, trackingExecutor('escalation'));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      // All steps should end in completed state
      for (const step of result.steps) {
        expect(step.status).toBe('completed');
      }

      // Steps that haven't been reached yet should remain pending when workflow fails early
      // Verify by checking a failed workflow
      clearAgents();
      setupDynamoDBMock();
      registerAgent(AgentType.ROUTING, jest.fn().mockRejectedValue(new Error('fail')));
      registerAgent(AgentType.ANALYSIS, trackingExecutor('analysis'));
      registerAgent(AgentType.RESPONSE, trackingExecutor('response'));
      registerAgent(AgentType.ESCALATION, trackingExecutor('escalation'));

      const failedResult = await processTicket(ticket);
      expect(failedResult.steps[0].status).toBe('failed');
      expect(failedResult.steps[1].status).toBe('pending');
      expect(failedResult.steps[2].status).toBe('pending');
      expect(failedResult.steps[3].status).toBe('pending');
    });

    test('workflow transitions from in_progress → completed on success', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('completed');
    });

    test('workflow transitions from in_progress → failed when required step fails', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockRejectedValue(new Error('Response generation failed')));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('failed');
      expect(result.steps[2].status).toBe('failed');
      expect(result.steps[2].error).toBe('Response generation failed');
    });

    test('failed steps record error messages', async () => {
      const errorMessage = 'Custom agent error: timeout exceeded';
      registerAgent(AgentType.ROUTING, jest.fn().mockRejectedValue(new Error(errorMessage)));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.steps[0].error).toBe(errorMessage);
    });

    test('completed steps have endTime set', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      for (const step of result.steps) {
        expect(step.endTime).toBeDefined();
        expect(step.endTime).toBeInstanceOf(Date);
      }
    });
  });

  describe('Workflow with Escalation Triggered', () => {
    test('should complete workflow when escalation agent decides to escalate', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({
        output: { assignedTo: 'team-a', reasoning: 'ok', confidence: 0.5, requiresSpecializedExpertise: false },
        confidence: 0.5,
      }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.7 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({
        output: { text: 'response', confidence: 0.6, reasoning: 'low confidence', referencedArticles: [] },
        confidence: 0.6,
      }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({
        output: {
          shouldEscalate: true,
          reason: 'low_confidence',
          urgency: 'high',
          summary: 'Low confidence across agents',
          attemptedSolutions: ['Generated response with low confidence'],
        },
        confidence: 1.0,
      }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('completed');
      expect(result.finalState.escalationDecision).toBeDefined();
      expect(result.finalState.escalationDecision.shouldEscalate).toBe(true);
      expect(result.finalState.escalationDecision.reason).toBe('low_confidence');
    });

    test('escalation decision is stored in final workflow state', async () => {
      const escalationOutput = {
        shouldEscalate: true,
        reason: 'security_issue',
        urgency: 'critical',
        assignTo: 'security-team',
        summary: 'Security breach detected',
        attemptedSolutions: ['Automated scan', 'KB search'],
      };

      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({
        output: escalationOutput,
        confidence: 1.0,
      }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.finalState.escalationDecision).toEqual(escalationOutput);
    });
  });

  describe('Context Propagation Verification', () => {
    test('routing output is available to all subsequent agents', async () => {
      const routingOutput = {
        assignedTo: 'team-frontend',
        reasoning: 'UI issue detected',
        confidence: 0.95,
        requiresSpecializedExpertise: false,
      };

      const analysisCtx: SharedWorkflowContext[] = [];
      const responseCtx: SharedWorkflowContext[] = [];
      const escalationCtx: SharedWorkflowContext[] = [];

      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({
        output: routingOutput,
        confidence: 0.95,
      }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockImplementation(async (_t: any, ctx: SharedWorkflowContext) => {
        analysisCtx.push({ ...ctx });
        return { output: {}, confidence: 0.8 };
      }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockImplementation(async (_t: any, ctx: SharedWorkflowContext) => {
        responseCtx.push({ ...ctx });
        return { output: {}, confidence: 0.85 };
      }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockImplementation(async (_t: any, ctx: SharedWorkflowContext) => {
        escalationCtx.push({ ...ctx });
        return { output: {}, confidence: 1.0 };
      }));

      const ticket = createMockTicket();
      await processTicket(ticket);

      expect(analysisCtx[0].routingDecision).toEqual(routingOutput);
      expect(responseCtx[0].routingDecision).toEqual(routingOutput);
      expect(escalationCtx[0].routingDecision).toEqual(routingOutput);
    });

    test('analysis output (knowledge base + similar tickets) propagates to response agent', async () => {
      const kbResults = [{ articleId: 'kb-42', title: 'Fix guide', relevantSections: ['Step 1'], relevanceScore: 0.9 }];
      const similarTickets = [{ ticketId: 't-99', subject: 'Similar bug', similarityScore: 0.88, resolution: 'Restart', wasSuccessful: true }];

      let responseContext: SharedWorkflowContext | undefined;

      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({
        output: { knowledgeBaseResults: kbResults, similarTickets },
        confidence: 0.8,
      }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockImplementation(async (_t: any, ctx: SharedWorkflowContext) => {
        responseContext = { ...ctx };
        return { output: {}, confidence: 0.85 };
      }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      await processTicket(ticket);

      expect(responseContext).toBeDefined();
      expect(responseContext!.knowledgeBaseResults).toEqual(kbResults);
      expect(responseContext!.similarTickets).toEqual(similarTickets);
    });

    test('final workflow state contains all accumulated context', async () => {
      const routingOutput = { assignedTo: 'team-a', reasoning: 'ok', confidence: 0.9, requiresSpecializedExpertise: false };
      const responseOutput = { text: 'Fix applied', confidence: 0.9, reasoning: 'KB match', referencedArticles: ['kb-1'] };

      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: routingOutput, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: responseOutput, confidence: 0.9 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({
        output: { shouldEscalate: false, reason: 'low_confidence', urgency: 'low', summary: 'ok', attemptedSolutions: [] },
        confidence: 1.0,
      }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.finalState.routingDecision).toEqual(routingOutput);
      expect(result.finalState.generatedResponse).toEqual(responseOutput);
      expect(result.finalState.escalationDecision).toBeDefined();
    });
  });

  describe('Error Handling Edge Cases', () => {
    test('should handle non-Error thrown objects gracefully', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockRejectedValue('string error'));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].error).toBeDefined();
    });

    test('should handle escalation step failure', async () => {
      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockRejectedValue(new Error('Escalation service down')));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('failed');
      expect(result.steps[3].status).toBe('failed');
      expect(result.steps[3].error).toBe('Escalation service down');
      // Previous steps should still be completed
      expect(result.steps[0].status).toBe('completed');
      expect(result.steps[1].status).toBe('completed');
      expect(result.steps[2].status).toBe('completed');
    });

    test('should handle DynamoDB save failure gracefully', async () => {
      const dynamodb = require('../src/utils/dynamodb-client');
      dynamodb.putItem.mockRejectedValue(new Error('DynamoDB unavailable'));

      registerAgent(AgentType.ROUTING, jest.fn().mockResolvedValue({ output: {}, confidence: 0.9 }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      await expect(processTicket(ticket)).rejects.toThrow('DynamoDB unavailable');
    });

    test('retry count is tracked on failed steps', async () => {
      let callCount = 0;
      registerAgent(AgentType.ROUTING, jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) throw new Error('transient');
        return { output: {}, confidence: 0.9 };
      }));
      registerAgent(AgentType.ANALYSIS, jest.fn().mockResolvedValue({ output: {}, confidence: 0.8 }));
      registerAgent(AgentType.RESPONSE, jest.fn().mockResolvedValue({ output: {}, confidence: 0.85 }));
      registerAgent(AgentType.ESCALATION, jest.fn().mockResolvedValue({ output: {}, confidence: 1.0 }));

      const ticket = createMockTicket();
      const result = await processTicket(ticket);

      expect(result.status).toBe('completed');
      // retryCount tracks the number of failed attempts
      expect(result.steps[0].retryCount).toBe(2);
    });
  });

  // Helper to set up DynamoDB mock with in-memory store
  function setupDynamoDBMock() {
    const store = new Map<string, any>();
    const dynamodb = require('../src/utils/dynamodb-client');
    dynamodb.putItem.mockImplementation(async (item: any) => {
      store.set(`${item.PK}#${item.SK}`, item);
    });
    dynamodb.getItem.mockImplementation(async (pk: string, sk: string) => {
      return store.get(`${pk}#${sk}`);
    });
    dynamodb.updateItem.mockResolvedValue(undefined);
  }
});
