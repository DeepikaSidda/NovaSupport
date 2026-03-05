/**
 * Analytics types for NovaSupport system
 */

export interface Resolution {
  ticketId: string;
  resolvedAt: Date;
  resolvedBy: "ai" | "human";
  resolutionTime: number; // milliseconds
  firstResponseTime: number;
  satisfactionScore?: number;
}

export interface Trend {
  trendId: string;
  issueDescription: string;
  affectedUsers: number;
  frequency: number;
  growthRate: number;
  affectedProducts: string[];
  firstDetected: Date;
  severity: "low" | "medium" | "high";
}

export interface Alert {
  alertId: string;
  type: "spike" | "critical_service" | "emerging_issue";
  description: string;
  affectedUsers: number;
  recommendedActions: string[];
  createdAt: Date;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface TeamMetrics {
  totalTickets: number;
  averageResolutionTime: number;
  averageFirstResponseTime: number;
  satisfactionScore: number;
  aiResolvedPercentage: number;
}

export interface PerformanceReport {
  timeRange: TimeRange;
  totalTickets: number;
  aiResolvedPercentage: number;
  averageResolutionTime: number;
  averageFirstResponseTime: number;
  satisfactionScore: number;
  topIssues: Array<{ issue: string; count: number }>;
  teamPerformance: Array<{ team: string; metrics: TeamMetrics }>;
}
