/**
 * Workflow Orchestrator for NovaSupport
 * Coordinates multi-agent workflows for ticket processing using a state machine:
 *   routing → analysis → response → escalation
 *
 * Manages context passing between agents, retry logic with exponential backoff,
 * and persists workflow state in DynamoDB.
 */

import { v4 as uuidv4 } from 'uuid';
import { Ticket } from '../types/ticket';
import {
  AgentType,
  WorkflowStep,
  WorkflowResult,
  OrchestratorWorkflowState,
  SharedWorkflowContext,
  RetryPolicy,
  WorkflowStepDefinition,
  WorkflowStatus,
  RoutingDecision,
  EscalationDecision,
  GeneratedResponse,
} from '../types/agent';
import { putItem, getItem, updateItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';
import { assignToMember } from '../agents/assignment-agent';

const logger = createLogger('WorkflowOrchestrator');

/** TTL for workflow records: 30 days */
const WORKFLOW_TTL_DAYS = 30;

/**
 * Default retry policies per agent type
 */
const DEFAULT_RETRY_POLICIES: Record<AgentType, RetryPolicy> = {
  [AgentType.ROUTING]: {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
    backoffMultiplier: 2,
  },
  [AgentType.ANALYSIS]: {
    maxRetries: 2,
    initialBackoffMs: 2000,
    maxBackoffMs: 15000,
    backoffMultiplier: 2,
  },
  [AgentType.RESPONSE]: {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
    backoffMultiplier: 2,
  },
  [AgentType.ESCALATION]: {
    maxRetries: 2,
    initialBackoffMs: 1000,
    maxBackoffMs: 8000,
    backoffMultiplier: 2,
  },
};

/**
 * The ordered workflow step definitions that form the state machine.
 * routing → analysis → response → escalation
 */
const WORKFLOW_STEP_DEFINITIONS: WorkflowStepDefinition[] = [
  {
    agentType: AgentType.ROUTING,
    retryPolicy: DEFAULT_RETRY_POLICIES[AgentType.ROUTING],
  },
  {
    agentType: AgentType.ANALYSIS,
    retryPolicy: DEFAULT_RETRY_POLICIES[AgentType.ANALYSIS],
    optional: true, // Analysis failure shouldn't block the workflow
  },
  {
    agentType: AgentType.RESPONSE,
    retryPolicy: DEFAULT_RETRY_POLICIES[AgentType.RESPONSE],
  },
  {
    agentType: AgentType.ESCALATION,
    retryPolicy: DEFAULT_RETRY_POLICIES[AgentType.ESCALATION],
  },
];

/**
 * Agent executor function type.
 * Each agent step receives the ticket and shared context, returns its output.
 */
export type AgentExecutor = (
  ticket: Ticket,
  context: SharedWorkflowContext
) => Promise<{ output: any; confidence?: number }>;

/**
 * Registry of agent executors, keyed by AgentType.
 * Populated via registerAgent() before processing tickets.
 */
const agentExecutors: Map<AgentType, AgentExecutor> = new Map();

/**
 * Register an agent executor for a given agent type.
 */
export function registerAgent(agentType: AgentType, executor: AgentExecutor): void {
  agentExecutors.set(agentType, executor);
  logger.info('Agent registered', { agentType });
}

/**
 * Clear all registered agents (useful for testing).
 */
export function clearAgents(): void {
  agentExecutors.clear();
}

/**
 * Sleep utility for backoff delays.
 * Uses an indirection so tests can replace it.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Replaceable sleep function (for testing). */
export let sleepFn: (ms: number) => Promise<void> = defaultSleep;

/** Override the sleep function (for testing). */
export function setSleepFn(fn: (ms: number) => Promise<void>): void {
  sleepFn = fn;
}

/** Reset sleep to the real implementation. */
export function resetSleepFn(): void {
  sleepFn = defaultSleep;
}

/**
 * Calculate exponential backoff delay for a given retry attempt.
 */
export function calculateBackoff(attempt: number, policy: RetryPolicy): number {
  const delay = policy.initialBackoffMs * Math.pow(policy.backoffMultiplier, attempt);
  return Math.min(delay, policy.maxBackoffMs);
}

/**
 * Create initial workflow state for a ticket.
 */
function createInitialWorkflowState(ticketId: string): OrchestratorWorkflowState {
  const workflowId = uuidv4();
  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + WORKFLOW_TTL_DAYS * 24 * 60 * 60;

  const steps: WorkflowStep[] = WORKFLOW_STEP_DEFINITIONS.map((def, index) => ({
    stepId: `step-${index}-${def.agentType}`,
    agentType: def.agentType,
    status: 'pending' as const,
    input: null,
    output: null,
    startTime: now,
    retryCount: 0,
  }));

  return {
    PK: `WORKFLOW#${workflowId}`,
    SK: 'STATE',
    workflowId,
    ticketId,
    status: 'in_progress',
    steps,
    currentStep: 0,
    sharedContext: {},
    startedAt: now.toISOString(),
    ttl,
  };
}

/**
 * Persist workflow state to DynamoDB.
 */
async function saveWorkflowState(state: OrchestratorWorkflowState): Promise<void> {
  try {
    await putItem({
      ...state,
      // Serialize Date objects in steps for DynamoDB
      steps: state.steps.map(step => ({
        ...step,
        startTime: step.startTime instanceof Date ? step.startTime.toISOString() : step.startTime,
        endTime: step.endTime instanceof Date ? step.endTime.toISOString() : step.endTime,
      })),
    });
  } catch (error) {
    logger.error('Failed to save workflow state', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Load workflow state from DynamoDB.
 */
async function loadWorkflowState(workflowId: string): Promise<OrchestratorWorkflowState | undefined> {
  try {
    const item = await getItem(`WORKFLOW#${workflowId}`, 'STATE');
    if (!item) return undefined;

    // Deserialize date strings back to Date objects in steps
    const state = item as unknown as OrchestratorWorkflowState;
    state.steps = state.steps.map(step => ({
      ...step,
      startTime: new Date(step.startTime as unknown as string),
      endTime: step.endTime ? new Date(step.endTime as unknown as string) : undefined,
    }));
    return state;
  } catch (error) {
    logger.error('Failed to load workflow state', error instanceof Error ? error : new Error(String(error)));
    return undefined;
  }
}

/**
 * Update the shared context after a step completes, based on agent type.
 */
function updateSharedContext(
  context: SharedWorkflowContext,
  agentType: AgentType,
  output: any
): SharedWorkflowContext {
  const updated = { ...context };

  switch (agentType) {
    case AgentType.ROUTING:
      updated.routingDecision = output as RoutingDecision;
      break;
    case AgentType.ANALYSIS:
      // Analysis may return multiple results
      if (output?.attachmentAnalysis) updated.attachmentAnalysis = output.attachmentAnalysis;
      if (output?.knowledgeBaseResults) updated.knowledgeBaseResults = output.knowledgeBaseResults;
      if (output?.similarTickets) updated.similarTickets = output.similarTickets;
      break;
    case AgentType.RESPONSE:
      updated.generatedResponse = output as GeneratedResponse;
      break;
    case AgentType.ESCALATION:
      updated.escalationDecision = output as EscalationDecision;
      break;
  }

  return updated;
}

/**
 * Execute a single workflow step with retry logic.
 */
async function executeStepWithRetry(
  step: WorkflowStep,
  definition: WorkflowStepDefinition,
  ticket: Ticket,
  context: SharedWorkflowContext
): Promise<{ output: any; confidence?: number }> {
  const executor = agentExecutors.get(definition.agentType);
  if (!executor) {
    throw new Error(`No executor registered for agent type: ${definition.agentType}`);
  }

  const { retryPolicy } = definition;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = calculateBackoff(attempt - 1, retryPolicy);
        logger.info('Retrying step after backoff', {
          stepId: step.stepId,
          agentType: definition.agentType,
          attempt,
          backoffMs,
        });
        await sleepFn(backoffMs);
      }

      const result = await executor(ticket, context);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      step.retryCount = attempt + 1;

      logger.warn('Step execution failed', {
        stepId: step.stepId,
        agentType: definition.agentType,
        attempt: attempt + 1,
        maxRetries: retryPolicy.maxRetries,
        error: lastError.message,
      });
    }
  }

  throw lastError || new Error(`Step ${step.stepId} failed after retries`);
}

/**
 * Process a ticket through the full agent workflow.
 * Implements the AgentOrchestrator.processTicket interface.
 */
export async function processTicket(ticket: Ticket): Promise<WorkflowResult> {
  logger.info('Starting workflow for ticket', { ticketId: ticket.id });

  const state = createInitialWorkflowState(ticket.id);
  await saveWorkflowState(state);

  for (let i = 0; i < WORKFLOW_STEP_DEFINITIONS.length; i++) {
    const definition = WORKFLOW_STEP_DEFINITIONS[i];
    const step = state.steps[i];
    state.currentStep = i;

    // Set step input from shared context
    step.input = { ...state.sharedContext };
    step.status = 'running';
    step.startTime = new Date();

    logger.info('Executing workflow step', {
      workflowId: state.workflowId,
      stepId: step.stepId,
      agentType: definition.agentType,
      stepIndex: i,
    });

    try {
      const result = await executeStepWithRetry(step, definition, ticket, state.sharedContext);

      step.status = 'completed';
      step.output = result.output;
      step.confidence = result.confidence;
      step.endTime = new Date();

      // Update shared context with step output
      state.sharedContext = updateSharedContext(state.sharedContext, definition.agentType, result.output);

      // Check if escalation agent decided to escalate — skip remaining steps
      if (definition.agentType === AgentType.ESCALATION) {
        const escalationDecision = result.output as EscalationDecision | undefined;
        if (escalationDecision?.shouldEscalate) {
          logger.info('Escalation triggered, workflow completing early', {
            workflowId: state.workflowId,
            reason: escalationDecision.reason,
          });
        }
      }

      // After routing, run the assignment agent to assign to individual member via round-robin
      if (definition.agentType === AgentType.ROUTING) {
        const routingResult = result.output as RoutingDecision | undefined;
        if (routingResult?.assignedTo && routingResult.assignedTo !== 'manual-routing-queue') {
          try {
            const assignment = await assignToMember(ticket.id, routingResult.assignedTo);
            if (assignment) {
              logger.info('Assignment agent assigned ticket to member', {
                ticketId: ticket.id,
                team: routingResult.assignedTo,
                member: assignment.assignedTo,
                method: assignment.method,
              });
            }
          } catch (assignErr) {
            logger.warn('Assignment agent failed, ticket stays team-assigned', {
              ticketId: ticket.id,
              error: assignErr instanceof Error ? assignErr.message : String(assignErr),
            });
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      step.status = 'failed';
      step.endTime = new Date();
      step.error = errorMessage;

      logger.error(
        'Workflow step failed',
        error instanceof Error ? error : new Error(errorMessage),
        { workflowId: state.workflowId, stepId: step.stepId }
      );

      // If the step is optional, continue to next step
      if (definition.optional) {
        logger.warn('Optional step failed, continuing workflow', {
          workflowId: state.workflowId,
          stepId: step.stepId,
        });
        continue;
      }

      // Non-optional step failed — mark workflow as failed
      state.status = 'failed';
      state.completedAt = new Date().toISOString();
      await saveWorkflowState(state);

      return buildWorkflowResult(state);
    }

    // Persist state after each step
    await saveWorkflowState(state);
  }

  // All steps completed
  state.status = 'completed';
  state.completedAt = new Date().toISOString();
  await saveWorkflowState(state);

  logger.info('Workflow completed', {
    workflowId: state.workflowId,
    ticketId: ticket.id,
    status: state.status,
  });

  return buildWorkflowResult(state);
}

/**
 * Get the status of a workflow by its ID.
 */
export async function getWorkflowStatus(workflowId: string): Promise<WorkflowStatus | undefined> {
  const state = await loadWorkflowState(workflowId);
  if (!state) return undefined;

  return {
    workflowId: state.workflowId,
    ticketId: state.ticketId,
    status: state.status,
    currentStep: state.currentStep,
    totalSteps: state.steps.length,
    steps: state.steps,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  };
}

/**
 * Retry a specific failed step in a workflow.
 */
export async function retryFailedStep(workflowId: string, stepId: string, ticket: Ticket): Promise<void> {
  const state = await loadWorkflowState(workflowId);
  if (!state) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const stepIndex = state.steps.findIndex(s => s.stepId === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepId}`);
  }

  const step = state.steps[stepIndex];
  if (step.status !== 'failed') {
    throw new Error(`Step ${stepId} is not in failed state (current: ${step.status})`);
  }

  const definition = WORKFLOW_STEP_DEFINITIONS[stepIndex];

  logger.info('Retrying failed step', {
    workflowId,
    stepId,
    agentType: definition.agentType,
  });

  step.status = 'running';
  step.startTime = new Date();
  step.error = undefined;

  try {
    const result = await executeStepWithRetry(step, definition, ticket, state.sharedContext);

    step.status = 'completed';
    step.output = result.output;
    step.confidence = result.confidence;
    step.endTime = new Date();

    state.sharedContext = updateSharedContext(state.sharedContext, definition.agentType, result.output);

    // If the workflow was failed, set it back to in_progress
    if (state.status === 'failed') {
      state.status = 'in_progress';
      state.completedAt = undefined;
    }

    await saveWorkflowState(state);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    step.status = 'failed';
    step.endTime = new Date();
    step.error = errorMessage;
    await saveWorkflowState(state);
    throw error;
  }
}

/**
 * Build a WorkflowResult from the current state.
 */
function buildWorkflowResult(state: OrchestratorWorkflowState): WorkflowResult {
  return {
    workflowId: state.workflowId,
    ticketId: state.ticketId,
    steps: state.steps,
    status: state.status,
    finalState: state.sharedContext,
  };
}

/**
 * Get the workflow step definitions (for testing/inspection).
 */
export function getWorkflowStepDefinitions(): WorkflowStepDefinition[] {
  return [...WORKFLOW_STEP_DEFINITIONS];
}

/**
 * Get the default retry policies (for testing/inspection).
 */
export function getDefaultRetryPolicies(): Record<AgentType, RetryPolicy> {
  return { ...DEFAULT_RETRY_POLICIES };
}
