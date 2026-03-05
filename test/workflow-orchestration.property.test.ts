/**
 * Property-based tests for Workflow Orchestration
 * Tests tasks 18.3 and 18.4
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import {
  AgentType,
  SharedWorkflowContext,
  RetryPolicy,
} from '../src/types/agent';
import {
  processTicket,
  registerAgent,
  clearAgents,
  calculateBackoff,
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

/** Generate a random routing output */
const routingOutputArb = fc.record({
  assignedTo: fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')), { minLength: 3, maxLength: 20 }),
  reasoning: fc.string({ minLength: 1, maxLength: 100 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  requiresSpecializedExpertise: fc.boolean(),
});

/** Generate random analysis output */
const analysisOutputArb = fc.record({
  knowledgeBaseResults: fc.array(
    fc.record({
      articleId: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 50 }),
      relevantSections: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 3 }),
      relevanceScore: fc.double({ min: 0.6, max: 1, noNaN: true }),
    }),
    { maxLength: 3 }
  ),
  similarTickets: fc.array(
    fc.record({
      ticketId: fc.uuid(),
      subject: fc.string({ minLength: 1, maxLength: 50 }),
      similarityScore: fc.double({ min: 0.75, max: 1, noNaN: true }),
      resolution: fc.string({ minLength: 1, maxLength: 50 }),
      wasSuccessful: fc.boolean(),
    }),
    { maxLength: 3 }
  ),
});

/** Generate random response output */
const responseOutputArb = fc.record({
  text: fc.string({ minLength: 1, maxLength: 200 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  reasoning: fc.string({ minLength: 1, maxLength: 100 }),
  referencedArticles: fc.array(fc.uuid(), { maxLength: 3 }),
});

/** Generate random escalation output */
const escalationOutputArb = fc.record({
  shouldEscalate: fc.boolean(),
  reason: fc.constantFrom('low_confidence', 'legal_issue', 'security_issue', 'compliance_issue', 'max_attempts', 'complex_issue'),
  urgency: fc.constantFrom('low', 'medium', 'high', 'critical'),
  summary: fc.string({ minLength: 1, maxLength: 100 }),
  attemptedSolutions: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 3 }),
});

// --- Helpers ---

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
  return store;
}

// --- Property Tests ---

describe('Property-Based Tests: Workflow Orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAgents();
    setSleepFn(async () => {});
    setupDynamoDBMock();
  });

  afterEach(() => {
    resetSleepFn();
  });

  /**
   * Property 39: Workflow Context Propagation
   * **Validates: Requirements 18.3**
   *
   * For any multi-step ticket workflow orchestrated by Nova Act, when an agent
   * completes a task, the output context should be available as input to the
   * next agent in the workflow.
   */
  describe('Property 39: Workflow Context Propagation', () => {
    test('Each agent receives accumulated context from all previous agents', async () => {
      await fc.assert(
        fc.asyncProperty(
          ticketArb,
          routingOutputArb,
          analysisOutputArb,
          responseOutputArb,
          escalationOutputArb,
          async (ticket, routingOutput, analysisOutput, responseOutput, escalationOutput) => {
            clearAgents();
            setupDynamoDBMock();

            // Track the context each agent receives
            const receivedContexts: SharedWorkflowContext[] = [];

            registerAgent(AgentType.ROUTING, async (_t, ctx) => {
              receivedContexts.push({ ...ctx });
              return { output: routingOutput, confidence: routingOutput.confidence };
            });

            registerAgent(AgentType.ANALYSIS, async (_t, ctx) => {
              receivedContexts.push({ ...ctx });
              return { output: analysisOutput, confidence: 0.8 };
            });

            registerAgent(AgentType.RESPONSE, async (_t, ctx) => {
              receivedContexts.push({ ...ctx });
              return { output: responseOutput, confidence: responseOutput.confidence };
            });

            registerAgent(AgentType.ESCALATION, async (_t, ctx) => {
              receivedContexts.push({ ...ctx });
              return { output: escalationOutput, confidence: 1.0 };
            });

            const result = await processTicket(ticket);
            expect(result.status).toBe('completed');

            // Routing agent (step 0) receives empty context
            expect(receivedContexts[0].routingDecision).toBeUndefined();

            // Analysis agent (step 1) receives routing decision
            expect(receivedContexts[1].routingDecision).toBeDefined();
            expect(receivedContexts[1].routingDecision!.assignedTo).toBe(routingOutput.assignedTo);

            // Response agent (step 2) receives routing + analysis context
            expect(receivedContexts[2].routingDecision).toBeDefined();
            expect(receivedContexts[2].routingDecision!.assignedTo).toBe(routingOutput.assignedTo);
            expect(receivedContexts[2].knowledgeBaseResults).toBeDefined();

            // Escalation agent (step 3) receives routing + analysis + response context
            expect(receivedContexts[3].routingDecision).toBeDefined();
            expect(receivedContexts[3].generatedResponse).toBeDefined();
            expect(receivedContexts[3].generatedResponse!.text).toBe(responseOutput.text);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('Context accumulates and never loses data from earlier steps', async () => {
      await fc.assert(
        fc.asyncProperty(
          ticketArb,
          routingOutputArb,
          analysisOutputArb,
          responseOutputArb,
          escalationOutputArb,
          async (ticket, routingOutput, analysisOutput, responseOutput, escalationOutput) => {
            clearAgents();
            setupDynamoDBMock();

            const contextSnapshots: SharedWorkflowContext[] = [];

            registerAgent(AgentType.ROUTING, async (_t, ctx) => {
              contextSnapshots.push({ ...ctx });
              return { output: routingOutput, confidence: routingOutput.confidence };
            });

            registerAgent(AgentType.ANALYSIS, async (_t, ctx) => {
              contextSnapshots.push({ ...ctx });
              return { output: analysisOutput, confidence: 0.8 };
            });

            registerAgent(AgentType.RESPONSE, async (_t, ctx) => {
              contextSnapshots.push({ ...ctx });
              return { output: responseOutput, confidence: responseOutput.confidence };
            });

            registerAgent(AgentType.ESCALATION, async (_t, ctx) => {
              contextSnapshots.push({ ...ctx });
              return { output: escalationOutput, confidence: 1.0 };
            });

            await processTicket(ticket);

            // The number of defined context keys should monotonically increase
            const keyCounts = contextSnapshots.map(ctx =>
              Object.values(ctx).filter(v => v !== undefined).length
            );

            for (let i = 1; i < keyCounts.length; i++) {
              expect(keyCounts[i]).toBeGreaterThanOrEqual(keyCounts[i - 1]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 40: Workflow Retry on Failure
   * **Validates: Requirements 18.4**
   *
   * For any workflow step that fails, the system should automatically retry
   * the step using Nova Act's retry mechanism.
   */
  describe('Property 40: Workflow Retry on Failure', () => {
    test('Failed steps are retried up to maxRetries before final failure', async () => {
      const policies = getDefaultRetryPolicies();

      await fc.assert(
        fc.asyncProperty(
          ticketArb,
          fc.constantFrom(AgentType.ROUTING, AgentType.RESPONSE, AgentType.ESCALATION),
          async (ticket, failingAgentType) => {
            clearAgents();
            setupDynamoDBMock();

            const callCounts: Record<string, number> = {};

            // Create executors: the target agent always fails, others succeed
            for (const agentType of [AgentType.ROUTING, AgentType.ANALYSIS, AgentType.RESPONSE, AgentType.ESCALATION]) {
              callCounts[agentType] = 0;

              if (agentType === failingAgentType) {
                registerAgent(agentType, async () => {
                  callCounts[agentType]++;
                  throw new Error(`${agentType} permanent failure`);
                });
              } else {
                registerAgent(agentType, async () => {
                  callCounts[agentType]++;
                  return { output: { mock: true }, confidence: 0.9 };
                });
              }
            }

            const result = await processTicket(ticket);

            const expectedMaxCalls = policies[failingAgentType].maxRetries + 1;

            // The failing agent should have been called exactly maxRetries + 1 times
            // (1 initial attempt + maxRetries retries)
            expect(callCounts[failingAgentType]).toBe(expectedMaxCalls);

            // Workflow should be failed (since these are non-optional steps)
            expect(result.status).toBe('failed');

            // The failed step should have error info
            const failedStep = result.steps.find(
              s => s.agentType === failingAgentType
            );
            expect(failedStep).toBeDefined();
            expect(failedStep!.status).toBe('failed');
            expect(failedStep!.error).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    test('Transient failures are recovered via retry', async () => {
      await fc.assert(
        fc.asyncProperty(
          ticketArb,
          fc.constantFrom(AgentType.ROUTING, AgentType.RESPONSE, AgentType.ESCALATION),
          fc.integer({ min: 1, max: 2 }),
          async (ticket, transientAgentType, failuresBeforeSuccess) => {
            clearAgents();
            setupDynamoDBMock();

            const callCounts: Record<string, number> = {};

            for (const agentType of [AgentType.ROUTING, AgentType.ANALYSIS, AgentType.RESPONSE, AgentType.ESCALATION]) {
              callCounts[agentType] = 0;

              if (agentType === transientAgentType) {
                registerAgent(agentType, async () => {
                  callCounts[agentType]++;
                  if (callCounts[agentType] <= failuresBeforeSuccess) {
                    throw new Error(`${agentType} transient failure`);
                  }
                  return { output: { recovered: true }, confidence: 0.8 };
                });
              } else {
                registerAgent(agentType, async () => {
                  callCounts[agentType]++;
                  return { output: { mock: true }, confidence: 0.9 };
                });
              }
            }

            const result = await processTicket(ticket);

            // Should succeed because failures < maxRetries for all agent types
            expect(result.status).toBe('completed');

            // The transient agent should have been called more than once
            expect(callCounts[transientAgentType]).toBe(failuresBeforeSuccess + 1);

            // The recovered step should be completed
            const recoveredStep = result.steps.find(
              s => s.agentType === transientAgentType
            );
            expect(recoveredStep).toBeDefined();
            expect(recoveredStep!.status).toBe('completed');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('Backoff delay increases with each retry attempt', () => {
      fc.assert(
        fc.property(
          fc.record({
            maxRetries: fc.integer({ min: 1, max: 10 }),
            initialBackoffMs: fc.integer({ min: 100, max: 5000 }),
            maxBackoffMs: fc.integer({ min: 5000, max: 60000 }),
            backoffMultiplier: fc.double({ min: 1.1, max: 5, noNaN: true }),
          }),
          (policy: RetryPolicy) => {
            const delays: number[] = [];
            for (let attempt = 0; attempt < policy.maxRetries; attempt++) {
              delays.push(calculateBackoff(attempt, policy));
            }

            // Delays should be non-decreasing
            for (let i = 1; i < delays.length; i++) {
              expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
            }

            // All delays should be capped at maxBackoffMs
            for (const delay of delays) {
              expect(delay).toBeLessThanOrEqual(policy.maxBackoffMs);
            }

            // First delay should equal initialBackoffMs
            if (delays.length > 0) {
              expect(delays[0]).toBe(policy.initialBackoffMs);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
