/**
 * Escalation Agent for NovaSupport
 * Determines when tickets need human intervention based on:
 * - Confidence scores below threshold
 * - Legal/security/compliance keywords
 * - Maximum automated response attempts
 */

import { Ticket } from '../types/ticket';
import {
  WorkflowState,
  EscalationDecision,
  EscalationReason,
} from '../types/agent';
import { createLogger } from '../utils/logger';

const logger = createLogger('EscalationAgent');

/**
 * Confidence threshold for escalation
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Maximum automated response attempts before escalation
 */
const MAX_ATTEMPTS = 3;

/**
 * Keywords that trigger immediate escalation
 */
const LEGAL_KEYWORDS = [
  'lawsuit',
  'attorney',
  'lawyer',
  'legal action',
  'sue',
  'court',
  'litigation',
  'subpoena',
];

const SECURITY_KEYWORDS = [
  'breach',
  'hack',
  'hacked',
  'vulnerability',
  'exploit',
  'unauthorized access',
  'data leak',
  'security incident',
  'compromised',
];

const COMPLIANCE_KEYWORDS = [
  'gdpr',
  'hipaa',
  'pci',
  'compliance',
  'regulation',
  'privacy violation',
  'data protection',
  'sox',
  'ccpa',
];

/**
 * Evaluate whether a ticket should be escalated to human agent
 */
export async function evaluateEscalation(
  ticket: Ticket,
  workflowState: WorkflowState
): Promise<EscalationDecision> {
  logger.info('Evaluating escalation', {
    ticketId: ticket.id,
    routingConfidence: workflowState.routingConfidence,
    responseConfidence: workflowState.responseConfidence,
    attemptCount: workflowState.attemptCount,
  });

  // Check all escalation triggers
  const triggers = checkEscalationTriggers(ticket, workflowState);

  // If no triggers, no escalation needed
  if (triggers.length === 0) {
    logger.info('No escalation needed', { ticketId: ticket.id });
    return {
      shouldEscalate: false,
      reason: EscalationReason.LOW_CONFIDENCE, // Default, not used
      urgency: 'low',
      summary: 'No escalation triggers detected',
      attemptedSolutions: [],
    };
  }

  // Determine primary escalation reason (highest priority)
  const primaryReason = determinePrimaryReason(triggers);

  // Determine urgency level
  const urgency = determineUrgency(primaryReason, workflowState, ticket);

  // Build escalation summary
  const summary = buildEscalationSummary(ticket, triggers, workflowState);

  // Collect attempted solutions
  const attemptedSolutions = collectAttemptedSolutions(workflowState);

  // Determine who to assign to (if applicable)
  const assignTo = determineAssignment(primaryReason, ticket);

  logger.info('Escalation decision made', {
    ticketId: ticket.id,
    shouldEscalate: true,
    reason: primaryReason,
    urgency,
    triggerCount: triggers.length,
  });

  return {
    shouldEscalate: true,
    reason: primaryReason,
    urgency,
    assignTo,
    summary,
    attemptedSolutions,
  };
}

/**
 * Escalation trigger information
 */
interface EscalationTrigger {
  reason: EscalationReason;
  details: string;
  priority: number; // Higher = more urgent
}

/**
 * Check all possible escalation triggers
 */
function checkEscalationTriggers(
  ticket: Ticket,
  workflowState: WorkflowState
): EscalationTrigger[] {
  const triggers: EscalationTrigger[] = [];

  // Trigger 1: Low confidence scores (Requirement 4.2)
  if (
    workflowState.routingConfidence < CONFIDENCE_THRESHOLD ||
    workflowState.responseConfidence < CONFIDENCE_THRESHOLD
  ) {
    const lowestConfidence = Math.min(
      workflowState.routingConfidence,
      workflowState.responseConfidence
    );
    triggers.push({
      reason: EscalationReason.LOW_CONFIDENCE,
      details: `Confidence score ${lowestConfidence.toFixed(2)} is below threshold ${CONFIDENCE_THRESHOLD}`,
      priority: 2,
    });
  }

  // Trigger 2: Legal keywords (Requirement 4.1)
  const legalKeywords = detectKeywords(ticket, LEGAL_KEYWORDS);
  if (legalKeywords.length > 0) {
    triggers.push({
      reason: EscalationReason.LEGAL_ISSUE,
      details: `Legal keywords detected: ${legalKeywords.join(', ')}`,
      priority: 5,
    });
  }

  // Trigger 3: Security keywords (Requirement 4.1)
  const securityKeywords = detectKeywords(ticket, SECURITY_KEYWORDS);
  if (securityKeywords.length > 0) {
    triggers.push({
      reason: EscalationReason.SECURITY_ISSUE,
      details: `Security keywords detected: ${securityKeywords.join(', ')}`,
      priority: 5,
    });
  }

  // Trigger 4: Compliance keywords (Requirement 4.1)
  const complianceKeywords = detectKeywords(ticket, COMPLIANCE_KEYWORDS);
  if (complianceKeywords.length > 0) {
    triggers.push({
      reason: EscalationReason.COMPLIANCE_ISSUE,
      details: `Compliance keywords detected: ${complianceKeywords.join(', ')}`,
      priority: 5,
    });
  }

  // Trigger 5: Maximum attempts exceeded (Requirement 4.3)
  if (workflowState.attemptCount >= MAX_ATTEMPTS) {
    triggers.push({
      reason: EscalationReason.MAX_ATTEMPTS,
      details: `Automated response attempts (${workflowState.attemptCount}) exceeded maximum (${MAX_ATTEMPTS})`,
      priority: 3,
    });
  }

  // Trigger 6: Complex issue detected in workflow state
  if (workflowState.detectedIssues.length > 0) {
    const hasComplexIssue = workflowState.detectedIssues.some(issue =>
      issue.toLowerCase().includes('complex') ||
      issue.toLowerCase().includes('unclear') ||
      issue.toLowerCase().includes('ambiguous')
    );
    if (hasComplexIssue) {
      triggers.push({
        reason: EscalationReason.COMPLEX_ISSUE,
        details: `Complex issues detected: ${workflowState.detectedIssues.join(', ')}`,
        priority: 2,
      });
    }
  }

  return triggers;
}

/**
 * Detect keywords in ticket content
 */
function detectKeywords(ticket: Ticket, keywords: string[]): string[] {
  const content = `${ticket.subject} ${ticket.description}`.toLowerCase();
  const detected: string[] = [];

  for (const keyword of keywords) {
    // Use word boundaries to avoid false matches (e.g., "sue" in "issue")
    const regex = new RegExp(`\\b${keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (regex.test(content)) {
      detected.push(keyword);
    }
  }

  return detected;
}

/**
 * Determine primary escalation reason (highest priority)
 */
function determinePrimaryReason(triggers: EscalationTrigger[]): EscalationReason {
  // Sort by priority (descending) and return first
  const sorted = [...triggers].sort((a, b) => b.priority - a.priority);
  return sorted[0].reason;
}

/**
 * Determine urgency level based on escalation reason and context
 */
function determineUrgency(
  reason: EscalationReason,
  workflowState: WorkflowState,
  ticket: Ticket
): 'low' | 'medium' | 'high' | 'critical' {
  // Critical urgency for legal/security/compliance issues
  if (
    reason === EscalationReason.LEGAL_ISSUE ||
    reason === EscalationReason.SECURITY_ISSUE ||
    reason === EscalationReason.COMPLIANCE_ISSUE
  ) {
    return 'critical';
  }

  // High urgency for max attempts with high priority ticket
  if (reason === EscalationReason.MAX_ATTEMPTS && ticket.priority >= 8) {
    return 'high';
  }

  // High urgency for very low confidence
  if (
    reason === EscalationReason.LOW_CONFIDENCE &&
    (workflowState.routingConfidence < 0.5 || workflowState.responseConfidence < 0.5)
  ) {
    return 'high';
  }

  // Medium urgency for max attempts with medium priority
  if (reason === EscalationReason.MAX_ATTEMPTS && ticket.priority >= 5) {
    return 'medium';
  }

  // Medium urgency for low confidence
  if (reason === EscalationReason.LOW_CONFIDENCE) {
    return 'medium';
  }

  // Default to low urgency
  return 'low';
}

/**
 * Build human-readable escalation summary
 */
function buildEscalationSummary(
  ticket: Ticket,
  triggers: EscalationTrigger[],
  workflowState: WorkflowState
): string {
  const parts: string[] = [];

  // Header
  parts.push(`Ticket #${ticket.id} requires human intervention.`);
  parts.push('');

  // Escalation reasons
  parts.push('Escalation Reasons:');
  for (const trigger of triggers) {
    parts.push(`- ${trigger.reason}: ${trigger.details}`);
  }
  parts.push('');

  // Ticket context
  parts.push('Ticket Context:');
  parts.push(`- Subject: ${ticket.subject}`);
  parts.push(`- Priority: ${ticket.priority}`);
  parts.push(`- Status: ${ticket.status}`);
  if (ticket.assignedTeam) {
    parts.push(`- Assigned Team: ${ticket.assignedTeam}`);
  }
  parts.push('');

  // Workflow state
  parts.push('AI Processing Summary:');
  parts.push(`- Routing Confidence: ${(workflowState.routingConfidence * 100).toFixed(0)}%`);
  parts.push(`- Response Confidence: ${(workflowState.responseConfidence * 100).toFixed(0)}%`);
  parts.push(`- Automated Attempts: ${workflowState.attemptCount}`);
  
  if (workflowState.detectedIssues.length > 0) {
    parts.push(`- Detected Issues: ${workflowState.detectedIssues.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Collect attempted solutions from workflow state
 */
function collectAttemptedSolutions(workflowState: WorkflowState): string[] {
  const solutions: string[] = [];

  // Add generic attempt descriptions based on attempt count
  for (let i = 1; i <= workflowState.attemptCount; i++) {
    solutions.push(`Attempt ${i}: Automated response generation`);
  }

  // Add any specific detected issues as attempted analysis
  if (workflowState.detectedIssues.length > 0) {
    solutions.push(`Issue analysis: ${workflowState.detectedIssues.join(', ')}`);
  }

  // Add confidence-based attempts
  if (workflowState.routingConfidence < CONFIDENCE_THRESHOLD) {
    solutions.push('Attempted automated routing with low confidence');
  }

  if (workflowState.responseConfidence < CONFIDENCE_THRESHOLD) {
    solutions.push('Attempted response generation with low confidence');
  }

  return solutions;
}

/**
 * Determine who to assign escalated ticket to
 */
function determineAssignment(
  reason: EscalationReason,
  ticket: Ticket
): string | undefined {
  // Legal issues go to legal team
  if (reason === EscalationReason.LEGAL_ISSUE) {
    return 'legal-team';
  }

  // Security issues go to security team
  if (reason === EscalationReason.SECURITY_ISSUE) {
    return 'security-team';
  }

  // Compliance issues go to compliance team
  if (reason === EscalationReason.COMPLIANCE_ISSUE) {
    return 'compliance-team';
  }

  // For other reasons, keep current assignment or escalate to senior support
  if (ticket.assignedTeam && ticket.assignedTeam !== 'manual-routing-queue') {
    return `${ticket.assignedTeam}-senior`;
  }

  return 'senior-support';
}

/**
 * Get escalation configuration (for testing/customization)
 */
export function getEscalationConfig() {
  return {
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    maxAttempts: MAX_ATTEMPTS,
    legalKeywords: LEGAL_KEYWORDS,
    securityKeywords: SECURITY_KEYWORDS,
    complianceKeywords: COMPLIANCE_KEYWORDS,
  };
}
