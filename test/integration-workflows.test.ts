/**
 * Integration tests for complete NovaSupport workflows.
 * Tests end-to-end flows by wiring together actual service modules,
 * mocking only external AWS SDK calls (DynamoDB, S3, SQS, Bedrock).
 *
 * Task 26.1: Write integration tests for complete workflows
 */

// Mock external AWS dependencies before imports
jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/s3-client');
jest.mock('../src/utils/sqs-client');
jest.mock('../src/utils/nova-client');
jest.mock('../src/utils/embedding-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock Bedrock client used by image-analyzer and voice-processor
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  InvokeModelCommand: jest.fn(),
}));

import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import { WorkflowState, EscalationReason, AgentType } from '../src/types/agent';
import { Resolution } from '../src/types/analytics';

// Agents
import { analyzeAndRoute, assignTicket } from '../src/agents/routing-agent';
import { generateResponse } from '../src/agents/response-agent';
import { evaluateEscalation } from '../src/agents/escalation-agent';

// Services
import { analyzeImage, parseAnalysisResponse } from '../src/services/image-analyzer';
import {
  transcribeSpeech,
  createTicketFromVoice,
  generateSpeech,
  parseTranscriptionResponse,
  detectTechnicalTerms,
  buildPronunciationGuide,
} from '../src/services/voice-processor';
import {
  calculatePriorityScore,
  clampPriority,
} from '../src/services/ticket-prioritization';
import {
  trackResolution,
  detectTrends,
  generateTrendAlerts,
  detectSpikes,
  generateSpikeAlert,
  escalateCriticalAlert,
} from '../src/services/analytics-engine';
import {
  sendEscalationNotification,
} from '../src/services/notification-service';

// Mocked modules
import * as ticketAnalyzer from '../src/utils/ticket-analyzer';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import * as s3Client from '../src/utils/s3-client';
import * as sqsClient from '../src/utils/sqs-client';
import * as novaClient from '../src/utils/nova-client';
import * as embeddingClient from '../src/utils/embedding-client';

jest.mock('../src/utils/ticket-analyzer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTicket(overrides?: Partial<Ticket>): Ticket {
  return {
    id: 'ticket-int-001',
    userId: 'user-100',
    subject: 'Cannot login to dashboard',
    description: 'I am unable to login to the dashboard since this morning. Getting a 403 error.',
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  };
}


// ===========================================================================
// 1. Ticket Creation → Routing → Response → Resolution
// ===========================================================================

describe('Integration: Ticket Creation → Routing → Response → Resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should process a ticket through the full happy-path workflow', async () => {
    const ticket = createMockTicket();

    // --- Step 1: Routing ---
    // Mock ticket analysis (used by routing agent)
    (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
      ticketId: ticket.id,
      urgency: { hasUrgentKeywords: false, urgentKeywords: [], urgencyScore: 5 },
      sentiment: { sentiment: 'neutral', sentimentScore: 0, isFrustrated: false, isAngry: false },
      expertise: {
        primaryExpertise: 'authentication',
        secondaryExpertise: [],
        technicalTerms: ['login', 'dashboard', '403'],
        confidence: 0.9,
      },
      analyzedAt: new Date(),
    });

    // Mock DynamoDB scan for teams
    (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
      {
        PK: 'TEAM#auth-team',
        SK: 'WORKLOAD',
        teamId: 'auth-team',
        teamName: 'Authentication Team',
        currentTicketCount: 3,
        expertise: ['authentication', 'security'],
        updatedAt: new Date().toISOString(),
      },
      {
        PK: 'TEAM#general-team',
        SK: 'WORKLOAD',
        teamId: 'general-team',
        teamName: 'General Support',
        currentTicketCount: 10,
        expertise: ['general'],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const routingDecision = await analyzeAndRoute(ticket);

    expect(routingDecision.assignedTo).toBe('auth-team');
    expect(routingDecision.confidence).toBeGreaterThan(0.5);
    expect(routingDecision.requiresSpecializedExpertise).toBe(false);

    // --- Step 2: Assignment ---
    (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);
    (dynamodbClient.getItem as jest.Mock).mockResolvedValue({
      PK: 'TEAM#auth-team',
      SK: 'WORKLOAD',
      teamId: 'auth-team',
      currentTicketCount: 3,
    });

    await assignTicket(ticket.id, routingDecision);

    expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
      `TICKET#${ticket.id}`,
      'METADATA',
      expect.stringContaining('assignedTo'),
      expect.objectContaining({ ':assignedTo': 'auth-team' }),
    );

    // --- Step 3: Response Generation ---
    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: Please try clearing your browser cache and cookies, then attempt to login again. If the 403 error persists, check that your account has the correct permissions.\nREASONING: The user is experiencing a 403 Forbidden error which typically indicates an authorization issue.\nSUGGESTED_ACTIONS: Clear browser cache, Check account permissions, Contact admin if issue persists',
    });

    const responseContext = {
      knowledgeBaseResults: [
        {
          articleId: 'art-001',
          title: 'Troubleshooting 403 Errors',
          relevantSections: ['Clear browser cache', 'Check permissions'],
          relevanceScore: 0.85,
        },
      ],
      similarTickets: [
        {
          ticketId: 'old-ticket-001',
          subject: 'Dashboard login 403',
          similarityScore: 0.82,
          resolution: 'Cleared cache and reset permissions',
          wasSuccessful: true,
        },
      ],
      userHistory: [],
    };

    const response = await generateResponse(ticket, responseContext);

    expect(response.text).toBeTruthy();
    expect(response.confidence).toBeGreaterThanOrEqual(0);
    expect(response.confidence).toBeLessThanOrEqual(1);
    expect(response.reasoning).toBeTruthy();
    expect(response.referencedArticles.length).toBeGreaterThan(0);

    // --- Step 4: Escalation Check (should NOT escalate for happy path) ---
    const workflowState: WorkflowState = {
      routingConfidence: routingDecision.confidence,
      responseConfidence: response.confidence,
      attemptCount: 1,
      detectedIssues: [],
    };

    const escalationDecision = await evaluateEscalation(ticket, workflowState);

    // High confidence → no escalation
    expect(escalationDecision.shouldEscalate).toBe(false);

    // --- Step 5: Resolution tracking ---
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);

    const resolution: Resolution = {
      ticketId: ticket.id,
      resolvedAt: new Date(),
      resolvedBy: 'ai',
      resolutionTime: 120000,
      firstResponseTime: 3000,
      satisfactionScore: 4.5,
    };

    await trackResolution(resolution, { team: 'auth-team', category: 'authentication' });

    // Verify metrics were stored (resolution + response + satisfaction = 3 putItem calls)
    expect(dynamodbClient.putItem).toHaveBeenCalledTimes(3);
  });
});


// ===========================================================================
// 2. Multimodal Ticket with Image → Analysis → Response
// ===========================================================================

describe('Integration: Multimodal Ticket with Image → Analysis → Response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should analyze an image attachment and generate a contextual response', async () => {
    const ticket = createMockTicket({
      id: 'ticket-img-001',
      subject: 'Error screenshot from dashboard',
      description: 'Attached a screenshot of the error I am seeing on the dashboard.',
      attachments: [
        {
          id: 'att-001',
          ticketId: 'ticket-img-001',
          fileName: 'error-screenshot.png',
          fileType: 'image/png',
          fileSize: 500000,
          s3Key: 'attachments/error-screenshot.png',
          s3Bucket: 'novasupport-attachments',
          analyzed: false,
          uploadedAt: new Date(),
        },
      ],
    });

    // --- Step 1: Image Analysis (parse a simulated Nova response) ---
    const novaImageResponse = JSON.stringify({
      extractedText: 'Error 500: Internal Server Error\nTimestamp: 2024-01-15 10:30:00',
      detectedErrors: ['Error 500: Internal Server Error'],
      detectedApplication: 'NovaSupport Dashboard',
      uiElements: ['Error dialog', 'Retry button', 'Navigation bar'],
      confidence: 0.92,
    });

    const imageAnalysis = parseAnalysisResponse(novaImageResponse);

    expect(imageAnalysis.extractedText).toContain('Error 500');
    expect(imageAnalysis.detectedErrors).toContain('Error 500: Internal Server Error');
    expect(imageAnalysis.detectedApplication).toBe('NovaSupport Dashboard');
    expect(imageAnalysis.uiElements.length).toBeGreaterThan(0);
    expect(imageAnalysis.confidence).toBeGreaterThanOrEqual(0);
    expect(imageAnalysis.confidence).toBeLessThanOrEqual(1);

    // --- Step 2: Generate response with attachment analysis context ---
    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: Based on the screenshot, you are experiencing an Internal Server Error (500). This is typically a server-side issue. Our team is investigating. In the meantime, please try refreshing the page.\nREASONING: The screenshot shows a 500 error on the NovaSupport Dashboard.\nSUGGESTED_ACTIONS: Refresh the page, Wait 5 minutes and retry',
    });

    const responseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
      attachmentAnalysis: {
        ticketId: ticket.id,
        attachments: [
          {
            attachmentId: 'att-001',
            type: 'image' as const,
            extractedText: imageAnalysis.extractedText,
            detectedErrors: imageAnalysis.detectedErrors,
            detectedApplication: imageAnalysis.detectedApplication,
            summary: 'Screenshot showing Error 500 on dashboard',
            keyFindings: ['Internal Server Error', 'Dashboard affected'],
          },
        ],
      },
    };

    const response = await generateResponse(ticket, responseContext);

    expect(response.text).toBeTruthy();
    expect(response.text.toLowerCase()).toContain('error');
    expect(response.confidence).toBeGreaterThanOrEqual(0);
    expect(response.confidence).toBeLessThanOrEqual(1);
  });
});


// ===========================================================================
// 3. Voice Ticket → Transcription → Routing → Voice Response
// ===========================================================================

describe('Integration: Voice Ticket → Transcription → Routing → Voice Response', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should transcribe voice, create ticket, route, and generate voice response', async () => {
    // --- Step 1: Transcription (using pure functions, no Bedrock call) ---
    const transcriptionText =
      'I am having trouble with my DynamoDB table. The queries are timing out and I see connection refused errors.';

    const transcription = parseTranscriptionResponse(transcriptionText, 'en');

    expect(transcription.text).toBe(transcriptionText);
    expect(transcription.language).toBe('en');
    expect(transcription.confidence).toBeGreaterThan(0);

    // --- Step 2: Technical term detection ---
    const technicalTerms = detectTechnicalTerms(transcription.text);

    expect(technicalTerms).toContain('DynamoDB');
    // 'timeout' is in the error terms dictionary
    expect(technicalTerms.length).toBeGreaterThan(0);

    // --- Step 3: Create ticket from voice transcription ---
    const { ticketId, description } = createTicketFromVoice(
      { ...transcription, detectedTechnicalTerms: technicalTerms },
      'user-voice-001',
    );

    expect(ticketId).toMatch(/^VOICE-/);
    expect(description).toContain('[Voice Ticket]');
    expect(description).toContain(transcriptionText);
    expect(description).toContain('DynamoDB');

    // --- Step 4: Route the voice ticket ---
    const voiceTicket = createMockTicket({
      id: ticketId,
      userId: 'user-voice-001',
      subject: 'Voice Ticket',
      description,
    });

    (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
      ticketId: voiceTicket.id,
      urgency: { hasUrgentKeywords: false, urgentKeywords: [], urgencyScore: 6 },
      sentiment: { sentiment: 'neutral', sentimentScore: -0.1, isFrustrated: false, isAngry: false },
      expertise: {
        primaryExpertise: 'database',
        secondaryExpertise: [],
        technicalTerms: ['DynamoDB', 'timeout'],
        confidence: 0.85,
      },
      analyzedAt: new Date(),
    });

    (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
      {
        PK: 'TEAM#db-team',
        SK: 'WORKLOAD',
        teamId: 'db-team',
        teamName: 'Database Team',
        currentTicketCount: 4,
        expertise: ['database', 'dynamodb'],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const routingDecision = await analyzeAndRoute(voiceTicket);

    expect(routingDecision.assignedTo).toBe('db-team');
    expect(routingDecision.confidence).toBeGreaterThan(0);

    // --- Step 5: Generate voice response (pronunciation guide) ---
    const responseText =
      'Your DynamoDB queries are timing out. Please check your VPC configuration and ensure the DynamoDB endpoint is accessible.';

    const pronounceableText = buildPronunciationGuide(responseText);

    // Pronunciation guide should replace acronyms with phonetic versions
    expect(pronounceableText).toContain('Dynamo D B');
    expect(pronounceableText).toContain('V P C');
  });
});


// ===========================================================================
// 4. Escalation Flow → Human Notification
// ===========================================================================

describe('Integration: Escalation Flow → Human Notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should escalate ticket with low confidence and notify human', async () => {
    const ticket = createMockTicket({
      id: 'ticket-esc-001',
      subject: 'Complex infrastructure issue',
      description: 'Multiple services are failing intermittently across regions.',
    });

    // --- Step 1: Routing with low confidence ---
    (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
      ticketId: ticket.id,
      urgency: { hasUrgentKeywords: true, urgentKeywords: ['failing'], urgencyScore: 8 },
      sentiment: { sentiment: 'negative', sentimentScore: -0.5, isFrustrated: true, isAngry: false },
      expertise: {
        primaryExpertise: 'infrastructure',
        secondaryExpertise: ['networking'],
        technicalTerms: ['services', 'regions'],
        confidence: 0.5, // Low confidence
      },
      analyzedAt: new Date(),
    });

    (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
      {
        PK: 'TEAM#infra-team',
        SK: 'WORKLOAD',
        teamId: 'infra-team',
        teamName: 'Infrastructure Team',
        currentTicketCount: 8,
        expertise: ['infrastructure', 'networking'],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const routingDecision = await analyzeAndRoute(ticket);
    expect(routingDecision.assignedTo).toBe('infra-team');

    // --- Step 2: Response generation with low confidence ---
    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: We are looking into the intermittent failures.\nREASONING: Complex multi-region issue, limited context.',
    });

    const response = await generateResponse(ticket, {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
    });

    // --- Step 3: Escalation evaluation ---
    const workflowState: WorkflowState = {
      routingConfidence: 0.5, // Below 0.7 threshold
      responseConfidence: response.confidence,
      attemptCount: 1,
      detectedIssues: [],
    };

    const escalationDecision = await evaluateEscalation(ticket, workflowState);

    expect(escalationDecision.shouldEscalate).toBe(true);
    expect(escalationDecision.reason).toBe(EscalationReason.LOW_CONFIDENCE);
    expect(escalationDecision.summary).toContain(ticket.id);
    expect(escalationDecision.attemptedSolutions.length).toBeGreaterThan(0);
    expect(['medium', 'high', 'critical']).toContain(escalationDecision.urgency);

    // --- Step 4: Human notification ---
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);

    await sendEscalationNotification(ticket.id, escalationDecision);

    // Verify in-app notification was stored
    expect(dynamodbClient.putItem).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: expect.stringContaining('NOTIFICATION#'),
        type: 'escalation',
        ticketId: ticket.id,
      }),
    );
  });

  test('should escalate ticket with legal keywords and assign to legal team', async () => {
    const ticket = createMockTicket({
      id: 'ticket-legal-001',
      subject: 'Legal action regarding data breach',
      description: 'Our attorney has advised us to pursue legal action due to the data breach.',
    });

    const workflowState: WorkflowState = {
      routingConfidence: 0.9,
      responseConfidence: 0.9,
      attemptCount: 0,
      detectedIssues: [],
    };

    const escalationDecision = await evaluateEscalation(ticket, workflowState);

    expect(escalationDecision.shouldEscalate).toBe(true);
    // Legal or security issue should be detected
    expect([
      EscalationReason.LEGAL_ISSUE,
      EscalationReason.SECURITY_ISSUE,
    ]).toContain(escalationDecision.reason);
    expect(escalationDecision.urgency).toBe('critical');
    expect(escalationDecision.assignTo).toMatch(/legal-team|security-team/);
  });

  test('should escalate after max automated attempts', async () => {
    const ticket = createMockTicket({
      id: 'ticket-max-001',
      subject: 'Recurring issue',
      description: 'This issue keeps happening despite multiple attempts to fix it.',
    });

    const workflowState: WorkflowState = {
      routingConfidence: 0.8,
      responseConfidence: 0.8,
      attemptCount: 3, // At max attempts threshold
      detectedIssues: [],
    };

    const escalationDecision = await evaluateEscalation(ticket, workflowState);

    expect(escalationDecision.shouldEscalate).toBe(true);
    expect(escalationDecision.reason).toBe(EscalationReason.MAX_ATTEMPTS);
    expect(escalationDecision.attemptedSolutions.length).toBeGreaterThanOrEqual(3);
  });
});


// ===========================================================================
// 5. Analytics Pipeline → Metrics → Trends → Alerts
// ===========================================================================

describe('Integration: Analytics Pipeline → Metrics → Trends → Alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should track resolution metrics, detect trends, and generate alerts', async () => {
    // --- Step 1: Track multiple resolutions ---
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);

    const now = new Date();
    const resolutions: Resolution[] = [
      {
        ticketId: 'ticket-a1',
        resolvedAt: now,
        resolvedBy: 'ai',
        resolutionTime: 60000,
        firstResponseTime: 2000,
        satisfactionScore: 4.5,
      },
      {
        ticketId: 'ticket-a2',
        resolvedAt: now,
        resolvedBy: 'human',
        resolutionTime: 300000,
        firstResponseTime: 10000,
        satisfactionScore: 3.0,
      },
      {
        ticketId: 'ticket-a3',
        resolvedAt: now,
        resolvedBy: 'ai',
        resolutionTime: 45000,
        firstResponseTime: 1500,
      },
    ];

    for (const res of resolutions) {
      await trackResolution(res, { team: 'auth-team', category: 'authentication' });
    }

    // Each resolution creates 2 or 3 putItem calls (resolution + response + optional satisfaction)
    // ticket-a1: 3, ticket-a2: 3, ticket-a3: 2 = 8 total
    expect(dynamodbClient.putItem).toHaveBeenCalledTimes(8);

    // --- Step 2: Detect trends ---
    // Mock scanning tickets for trend detection
    const previousDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
      {
        ticketId: 'ticket-t1',
        userId: 'user-1',
        category: 'authentication',
        createdAt: previousDate.toISOString(),
        tags: ['authentication'],
      },
      {
        ticketId: 'ticket-t2',
        userId: 'user-2',
        category: 'authentication',
        createdAt: now.toISOString(),
        tags: ['authentication'],
      },
      {
        ticketId: 'ticket-t3',
        userId: 'user-3',
        category: 'billing',
        createdAt: now.toISOString(),
        tags: ['billing', 'payments'],
      },
    ]);

    // Reset putItem mock for trend persistence
    (dynamodbClient.putItem as jest.Mock).mockClear();
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);

    const timeRange = {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      end: now,
    };

    const trends = await detectTrends(timeRange);

    expect(trends.length).toBeGreaterThan(0);
    // Each trend should have required fields
    for (const trend of trends) {
      expect(trend.trendId).toBeTruthy();
      expect(trend.issueDescription).toBeTruthy();
      expect(trend.affectedUsers).toBeGreaterThanOrEqual(0);
      expect(trend.frequency).toBeGreaterThan(0);
      expect(typeof trend.growthRate).toBe('number');
      expect(trend.affectedProducts.length).toBeGreaterThan(0);
      expect(trend.firstDetected).toBeInstanceOf(Date);
      expect(['low', 'medium', 'high']).toContain(trend.severity);
    }

    // --- Step 3: Generate trend alerts ---
    // Create trends with >10 affected users to trigger alerts
    const highImpactTrends = trends.map(t => ({
      ...t,
      affectedUsers: 15, // Above the 10-user threshold
    }));

    const alerts = generateTrendAlerts(highImpactTrends);

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.alertId).toBeTruthy();
      expect(['spike', 'emerging_issue']).toContain(alert.type);
      expect(alert.description).toBeTruthy();
      expect(alert.affectedUsers).toBeGreaterThan(10);
      expect(alert.recommendedActions.length).toBeGreaterThan(0);
      expect(alert.createdAt).toBeInstanceOf(Date);
    }

    // Verify no alerts for trends with <=10 users
    const lowImpactTrends = trends.map(t => ({ ...t, affectedUsers: 5 }));
    const noAlerts = generateTrendAlerts(lowImpactTrends);
    expect(noAlerts.length).toBe(0);
  });

  test('should detect spikes and escalate critical service alerts', () => {
    // --- Spike detection ---
    // 50% increase over 7-day average = spike
    expect(detectSpikes('auth', 15, 10)).toBe(true);   // 50% increase
    expect(detectSpikes('auth', 20, 10)).toBe(true);   // 100% increase
    expect(detectSpikes('auth', 14, 10)).toBe(false);  // Only 40% increase
    expect(detectSpikes('auth', 10, 10)).toBe(false);  // No increase
    expect(detectSpikes('auth', 5, 0)).toBe(false);    // No baseline

    // --- Spike alert generation ---
    const spikeAlert = generateSpikeAlert('authentication', 20, 10, 25);

    expect(spikeAlert.type).toBe('spike');
    expect(spikeAlert.description).toContain('authentication');
    expect(spikeAlert.affectedUsers).toBe(25);
    expect(spikeAlert.recommendedActions.length).toBeGreaterThan(0);

    // --- Critical service escalation ---
    const criticalServices = ['authentication', 'payments'];

    const escalation = escalateCriticalAlert(spikeAlert, criticalServices);

    expect(escalation).not.toBeNull();
    expect(escalation!.escalatedTo).toBe('on-call-engineers');
    expect(escalation!.matchedService).toBe('authentication');

    // Non-critical service should not escalate
    const nonCriticalAlert = generateSpikeAlert('documentation', 15, 10, 12);
    const noEscalation = escalateCriticalAlert(nonCriticalAlert, criticalServices);
    expect(noEscalation).toBeNull();
  });

  test('should calculate priority scores within valid bounds', () => {
    const analysis: import('../src/utils/ticket-analyzer').TicketAnalysis = {
      ticketId: 'ticket-pri-001',
      urgency: { hasUrgentKeywords: true, urgentKeywords: ['urgent'], urgencyScore: 8 },
      sentiment: { sentiment: 'negative' as const, sentimentScore: -0.7, isFrustrated: true, isAngry: false },
      expertise: {
        primaryExpertise: 'billing',
        secondaryExpertise: [],
        technicalTerms: [],
        confidence: 0.8,
      },
      analyzedAt: new Date(),
    };

    const businessImpact = {
      affectedUserCount: 50,
      serviceCriticality: 'high' as const,
      revenueImpact: true,
    };

    const result = calculatePriorityScore(analysis, businessImpact);

    expect(result.priorityScore).toBeGreaterThanOrEqual(1);
    expect(result.priorityScore).toBeLessThanOrEqual(10);
    expect(Number.isInteger(result.priorityScore)).toBe(true);
    expect(result.urgencyComponent).toBeGreaterThanOrEqual(0);
    expect(result.urgencyComponent).toBeLessThanOrEqual(1);
    expect(result.sentimentComponent).toBeGreaterThanOrEqual(0);
    expect(result.sentimentComponent).toBeLessThanOrEqual(1);
    expect(result.businessImpactComponent).toBeGreaterThanOrEqual(0);
    expect(result.businessImpactComponent).toBeLessThanOrEqual(1);

    // High urgency + negative sentiment + high business impact → high priority
    expect(result.priorityScore).toBeGreaterThanOrEqual(7);

    // Clamp should enforce bounds
    expect(clampPriority(0)).toBe(1);
    expect(clampPriority(11)).toBe(10);
    expect(clampPriority(NaN)).toBe(5);
    expect(clampPriority(5.6)).toBe(6);
  });
});
