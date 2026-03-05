/**
 * Core ticket types for NovaSupport system
 */

export enum TicketStatus {
  NEW = "new",
  ANALYZING = "analyzing",
  ASSIGNED = "assigned",
  IN_PROGRESS = "in_progress",
  PENDING_USER = "pending_user",
  ESCALATED = "escalated",
  RESOLVED = "resolved",
  CLOSED = "closed"
}

export enum Priority {
  LOW = 1,
  MEDIUM = 5,
  HIGH = 8,
  CRITICAL = 10
}

export interface Ticket {
  id: string;
  userId: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: Priority;
  assignedTo?: string;
  assignedTeam?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  firstResponseAt?: Date;
  tags: string[];
  category?: string;
  attachments: Attachment[];
  routingConfidence?: number;
  responseConfidence?: number;
  escalationReason?: string;
  slaResponseDeadline?: string;
  slaResolutionDeadline?: string;
  slaBreached?: boolean;
}

/**
 * SLA definitions per priority level (in minutes)
 */
export interface SLADefinition {
  priority: Priority;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
}

/**
 * SLA status for a ticket
 */
export interface SLAStatus {
  responseDeadline: string;
  resolutionDeadline: string;
  responseBreached: boolean;
  resolutionBreached: boolean;
  responseTimeRemaining: number; // minutes, negative = breached
  resolutionTimeRemaining: number;
  firstResponseAt?: string;
}

/**
 * Predefined issue categories for ticket classification
 */
export const TICKET_CATEGORIES = [
  'Hardware',
  'Software',
  'Network',
  'Account & Access',
  'Email',
  'Security',
  'Database',
  'Cloud Infrastructure',
  'Performance',
  'Other',
] as const;

export type TicketCategory = typeof TICKET_CATEGORIES[number];

export interface CreateTicketRequest {
  userId: string;
  subject: string;
  description: string;
  attachments?: File[];
  priority?: Priority;
  metadata?: Record<string, any>;
}

export interface Attachment {
  id: string;
  ticketId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  s3Bucket: string;
  analyzed: boolean;
  analysisResults?: AttachmentAnalysisResult;
  uploadedAt: Date;
}

export interface AttachmentAnalysisResult {
  extractedText?: string;
  detectedErrors?: string[];
  summary?: string;
  keyFindings?: string[];
}

export interface File {
  name: string;
  type: string;
  size: number;
  content: Buffer;
}
