/**
 * Agent types for NovaSupport system
 */

import { Ticket } from './ticket';

export enum AgentType {
  ROUTING = "routing",
  ANALYSIS = "analysis",
  RESPONSE = "response",
  ESCALATION = "escalation"
}

export interface RoutingDecision {
  assignedTo: string; // team or individual ID
  reasoning: string;
  confidence: number;
  alternativeAssignments?: Array<{ assignedTo: string; confidence: number }>;
  requiresSpecializedExpertise: boolean;
}

export interface AttachmentAnalysis {
  ticketId: string;
  attachments: Array<{
    attachmentId: string;
    type: "image" | "video" | "document";
    extractedText?: string;
    detectedErrors?: string[];
    detectedApplication?: string;
    summary: string;
    keyFindings: string[];
  }>;
}

export interface KnowledgeBaseResult {
  articleId: string;
  title: string;
  relevantSections: string[];
  relevanceScore: number;
  url?: string;
}

export interface SimilarTicket {
  ticketId: string;
  subject: string;
  similarityScore: number;
  resolution?: string;
  wasSuccessful: boolean;
}

export interface ResponseContext {
  knowledgeBaseResults: KnowledgeBaseResult[];
  similarTickets: SimilarTicket[];
  userHistory: Ticket[];
  attachmentAnalysis?: AttachmentAnalysis;
}

export interface GeneratedResponse {
  text: string;
  confidence: number;
  reasoning: string;
  referencedArticles: string[];
  suggestedActions?: string[];
  audioVersion?: AudioFile;
}

export interface AudioFile {
  url: string;
  duration: number;
  format: string;
}

export interface Transcription {
  text: string;
  language: string;
  confidence: number;
  detectedTechnicalTerms: string[];
}

export enum EscalationReason {
  LOW_CONFIDENCE = "low_confidence",
  LEGAL_ISSUE = "legal_issue",
  SECURITY_ISSUE = "security_issue",
  COMPLIANCE_ISSUE = "compliance_issue",
  MAX_ATTEMPTS = "max_attempts",
  COMPLEX_ISSUE = "complex_issue"
}

export interface WorkflowState {
  routingConfidence: number;
  responseConfidence: number;
  attemptCount: number;
  detectedIssues: string[];
}

export interface EscalationDecision {
  shouldEscalate: boolean;
  reason: EscalationReason;
  urgency: "low" | "medium" | "high" | "critical";
  assignTo?: string;
  summary: string;
  attemptedSolutions: string[];
}

export interface WorkflowStep {
  stepId: string;
  agentType: AgentType;
  status: "pending" | "running" | "completed" | "failed";
  input: any;
  output: any;
  confidence?: number;
  startTime: Date;
  endTime?: Date;
  retryCount?: number;
  error?: string;
}

export interface WorkflowResult {
  workflowId: string;
  ticketId: string;
  steps: WorkflowStep[];
  status: "completed" | "failed" | "in_progress";
  finalState: any;
}

/**
 * Full workflow state persisted in DynamoDB for the orchestrator.
 * This is distinct from the simpler WorkflowState used by the escalation agent.
 */
export interface OrchestratorWorkflowState {
  PK: string; // "WORKFLOW#<workflowId>"
  SK: string; // "STATE"
  workflowId: string;
  ticketId: string;
  status: "in_progress" | "completed" | "failed";
  steps: WorkflowStep[];
  currentStep: number;
  sharedContext: SharedWorkflowContext;
  startedAt: string;
  completedAt?: string;
  ttl: number;
}

export interface SharedWorkflowContext {
  routingDecision?: RoutingDecision;
  attachmentAnalysis?: AttachmentAnalysis;
  knowledgeBaseResults?: KnowledgeBaseResult[];
  similarTickets?: SimilarTicket[];
  generatedResponse?: GeneratedResponse;
  escalationDecision?: EscalationDecision;
}

/**
 * Retry policy configuration for workflow steps
 */
export interface RetryPolicy {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
}

/**
 * Workflow step definition for the state machine
 */
export interface WorkflowStepDefinition {
  agentType: AgentType;
  retryPolicy: RetryPolicy;
  optional?: boolean; // If true, failure doesn't fail the whole workflow
}

/**
 * Status of the overall workflow for external queries
 */
export interface WorkflowStatus {
  workflowId: string;
  ticketId: string;
  status: "in_progress" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  steps: WorkflowStep[];
  startedAt: string;
  completedAt?: string;
}

export interface ImageAnalysis {
  extractedText: string;
  detectedErrors: string[];
  detectedApplication: string;
  uiElements: string[];
  confidence: number;
}

export interface VideoAnalysis {
  keyFrames: Array<{ timestamp: number; analysis: ImageAnalysis }>;
  timeline: Array<{ timestamp: number; event: string }>;
  summary: string;
  detectedActions: string[];
}

export interface DocumentAnalysis {
  extractedText: string;
  errorPatterns: string[];
  stackTraces: string[];
  timestamps: Date[];
  summary: string;
  keyTechnicalDetails: Record<string, string>;
}
