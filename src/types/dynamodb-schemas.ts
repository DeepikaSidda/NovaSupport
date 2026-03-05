/**
 * DynamoDB table schemas for NovaSupport system
 */

import { TicketStatus, Priority } from './ticket';
import { AgentType } from './agent';

/**
 * Ticket table schema with GSI indexes
 */
export interface TicketRecord {
  // Primary Key
  PK: string; // "TICKET#<ticketId>"
  SK: string; // "METADATA"
  
  // Attributes
  ticketId: string;
  userId: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: Priority;
  
  // Assignment
  assignedTo?: string;
  assignedTeam?: string;
  
  // Timestamps
  createdAt: string; // ISO 8601
  updatedAt: string;
  resolvedAt?: string;
  
  // Classification
  tags: string[];
  category?: string;
  
  // AI Metadata
  routingConfidence?: number;
  responseConfidence?: number;
  escalationReason?: string;
  
  // SLA Tracking
  slaResponseDeadline?: string;
  slaResolutionDeadline?: string;
  slaBreached?: boolean;
  firstResponseAt?: string;
  
  // Attachments
  attachmentIds: string[];
  
  // GSI Keys for queries
  GSI1PK: string; // "USER#<userId>"
  GSI1SK: string; // "<createdAt>"
  GSI2PK: string; // "STATUS#<status>"
  GSI2SK: string; // "<priority>#<createdAt>"
  GSI3PK?: string; // "TEAM#<assignedTeam>"
  GSI3SK?: string; // "<createdAt>"
}

/**
 * Attachment table schema
 */
export interface AttachmentRecord {
  // Primary Key
  PK: string; // "TICKET#<ticketId>"
  SK: string; // "ATTACHMENT#<attachmentId>"
  
  // Attributes
  attachmentId: string;
  ticketId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  s3Bucket: string;
  
  // Analysis Results
  analyzed: boolean;
  analysisResults?: {
    extractedText?: string;
    detectedErrors?: string[];
    summary?: string;
    keyFindings?: string[];
  };
  
  uploadedAt: string;
}

/**
 * Knowledge Base article schema
 */
export interface KnowledgeArticleRecord {
  // Primary Key
  PK: string; // "ARTICLE#<articleId>"
  SK: string; // "METADATA"
  
  // Attributes
  articleId: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  
  // Vector embedding (stored separately in vector DB)
  embeddingId: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  author: string;
  viewCount: number;
  helpfulCount: number;
}

/**
 * Workflow state schema
 */
export interface WorkflowStateRecord {
  // Primary Key
  PK: string; // "WORKFLOW#<workflowId>"
  SK: string; // "STATE"
  
  // Attributes
  workflowId: string;
  ticketId: string;
  status: "in_progress" | "completed" | "failed";
  
  // Steps
  steps: Array<{
    stepId: string;
    agentType: AgentType;
    status: "pending" | "running" | "completed" | "failed";
    input: any;
    output: any;
    confidence?: number;
    startTime: string;
    endTime?: string;
  }>;
  currentStep: number;
  
  // Context shared between agents
  sharedContext: {
    routingDecision?: any;
    attachmentAnalysis?: any;
    knowledgeBaseResults?: any[];
    similarTickets?: any[];
    generatedResponse?: any;
    escalationDecision?: any;
  };
  
  // Timestamps
  startedAt: string;
  completedAt?: string;
  
  // TTL for cleanup
  ttl: number;
}

/**
 * Metrics record schema
 */
export interface MetricRecord {
  // Primary Key
  PK: string; // "METRIC#<date>"
  SK: string; // "<metricType>#<ticketId>"
  
  // Attributes
  date: string; // YYYY-MM-DD
  metricType: "resolution" | "response" | "satisfaction";
  ticketId: string;
  value: number;
  
  // Dimensions
  team?: string;
  category?: string;
  resolvedBy: "ai" | "human";
  
  // GSI for time-series queries
  GSI1PK: string; // "TIMESERIES#<metricType>"
  GSI1SK: string; // "<date>#<ticketId>"
}

/**
 * Trend record schema
 */
export interface TrendRecord {
  // Primary Key
  PK: string; // "TREND#<date>"
  SK: string; // "<trendId>"
  
  // Attributes
  trendId: string;
  issueDescription: string;
  affectedUsers: number;
  frequency: number;
  growthRate: number;
  affectedProducts: string[];
  severity: string;
  
  firstDetected: string;
  lastUpdated: string;
}

/**
 * Message record schema for ticket comments/change requests
 */
export interface MessageRecord {
  // Primary Key
  PK: string; // "TICKET#<ticketId>"
  SK: string; // "MESSAGE#<messageId>"

  // Attributes
  messageId: string; // "MSG-<uuid>"
  ticketId: string;
  userId: string; // email of the user who sent the message
  content: string;
  createdAt: string; // ISO 8601
}

/**
 * Team workload schema
 */
export interface TeamWorkloadRecord {
  // Primary Key
  PK: string; // "TEAM#<teamId>"
  SK: string; // "WORKLOAD"
  
  // Attributes
  teamId: string;
  teamName: string;
  description?: string;
  currentTicketCount: number;
  expertise: string[];
  
  updatedAt: string;
}
