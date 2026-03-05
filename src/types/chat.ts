/**
 * Chat types for AI Live Chat Assistant
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  userId: string;
  conversationHistory: ChatMessage[];
  action?: 'message' | 'escalate';
}

export type IssueCategory = 'billing' | 'technical' | 'account' | 'general';

export interface ChatResponse {
  sessionId: string;
  response: string;
  confidence: number;
  category: IssueCategory;
  suggestedActions: string[];
  referencedArticles: string[];
  escalation?: {
    ticketId: string;
    assignedTeam: string;
  };
}

export interface ChatMessageRecord {
  PK: string;
  SK: string;
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  category?: IssueCategory;
  confidence?: number;
  timestamp: string;
}

export interface ChatSessionRecord {
  PK: string;
  SK: string;
  sessionId: string;
  userId: string;
  category?: IssueCategory;
  escalatedTicketId?: string;
  createdAt: string;
  updatedAt: string;
}

export const CATEGORY_TEAM_MAP: Record<IssueCategory, string> = {
  billing: 'billing',
  technical: 'technical-support',
  account: 'account-management',
  general: 'general-support',
};

export const VALID_CATEGORIES: IssueCategory[] = ['billing', 'technical', 'account', 'general'];
