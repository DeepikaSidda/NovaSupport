/**
 * Performance tests for NovaSupport system.
 * Validates that key operations meet latency and throughput requirements.
 *
 * Task 26.2: Write performance tests
 * - Routing time < 5 seconds
 * - Knowledge base search < 2 seconds
 * - Notification latency < 30 seconds (escalation)
 * - Alert latency < 5 minutes
 * - Throughput: 100 concurrent tickets
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

import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import { WorkflowState, EscalationReason } from '../src/types/agent';
import { analyzeAndRoute } from '../src/agents/routing-agent';
import { searchKnowledgeBase } from '../src/services/knowledge-base';
import {
  sendEscalationNotification,
  sendAlertNotification,
} from '../src/services/notification-service';
import { handler as createTicketHandler } from '../src/handlers/create-ticket';
import { evaluateEscalation } from '../src/agents/escalation-agent';
import {
  detectTrends,
  generateTrendAlerts,
  runProactiveAlertCheck,
} from '../src/services/analytics-engine';

import * as dynamodb from '../src/utils/dynamodb-client';
import * as sqsClient from '../src/utils/sqs-client';
import * as novaClient from '../src/utils/nova-client';
import * as embeddingClient from '../src/utils/embedding-client';

// Type alias for the mock
const mockedNovaClient = novaClient as jest.Mocked<typeof novaClient>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: `TKT-${Date.now()}`,
    userId: 'user-perf-test',
    subject: 'Performance test ticket',
    description: 'Testing system performance under load',
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  };
}

function createMockAPIEvent(body: Record<string, any>) {
  return {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/tickets',
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  };
}

// ---------------------------------------------------------------------------
// Setup mocks with small delays to simulate realistic network latency
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // DynamoDB mocks with 10-20ms simulated latency
  (dynamodb.putItem as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(undefined), 10)),
  );
  (dynamodb.getItem as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(undefined), 10)),
  );
  (dynamodb.updateItem as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(undefined), 10)),
  );
  (dynamodb.queryItems as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve([]), 15)),
  );
  (dynamodb.scanItems as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve([]), 15)),
  );

  // SQS mock with 15ms latency
  (sqsClient.sendTicketForProcessing as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve('msg-perf'), 15)),
  );

  // Nova client mock with 30ms latency (simulates model inference)
  (novaClient.invokeNova2Lite as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              text: JSON.stringify({
                urgency: { urgencyScore: 5, indicators: [] },
                sentiment: { sentiment: 'neutral', score: 0.5, isFrustrated: false, isAngry: false },
                expertise: { primaryExpertise: 'general', secondaryExpertise: [], confidence: 0.8 },
              }),
              stopReason: 'end_turn',
            }),
          30,
        ),
      ),
  );

  // Embedding client mock with 20ms latency
  (embeddingClient.generateQueryEmbedding as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(new Array(256).fill(0.1)), 20),
      ),
  );
});

// ---------------------------------------------------------------------------
// Performance Tests
// ---------------------------------------------------------------------------

describe('Performance Tests', () => {
  jest.setTimeout(60_000); // Allow up to 60s for throughput tests

  // ── 1. Routing time < 5 seconds ──────────────────────────────────────────

  describe('Routing Performance', () => {
    it('should complete routing within 5 seconds', async () => {
      // Setup: provide team data so routing logic can match
      (dynamodb.scanItems as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve([
                  {
                    PK: 'TEAM#team-1',
                    SK: 'WORKLOAD',
                    teamId: 'team-1',
                    teamName: 'General Support',
                    currentTicketCount: 3,
                    expertise: ['general'],
                  },
                  {
                    PK: 'TEAM#team-2',
                    SK: 'WORKLOAD',
                    teamId: 'team-2',
                    teamName: 'Billing',
                    currentTicketCount: 5,
                    expertise: ['billing'],
                  },
                ]),
              15,
            ),
          ),
      );

      const ticket = createMockTicket();
      const start = Date.now();
      const decision = await analyzeAndRoute(ticket);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5_000);
      expect(decision).toBeDefined();
      expect(decision.assignedTo).toBeDefined();
    });
  });

  // ── 2. Knowledge base search < 2 seconds ─────────────────────────────────

  describe('Knowledge Base Search Performance', () => {
    it('should complete knowledge base search within 2 seconds', async () => {
      // Return some embedding records so the search has work to do
      (dynamodb.scanItems as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  Array.from({ length: 20 }, (_, i) => ({
                    PK: `EMBEDDING#emb-${i}`,
                    SK: 'VECTOR',
                    embeddingId: `emb-${i}`,
                    articleId: `art-${i}`,
                    vector: new Array(256).fill(0.1 + i * 0.01),
                    createdAt: new Date().toISOString(),
                  })),
                ),
              15,
            ),
          ),
      );

      // getItem returns article details for each matched embedding
      (dynamodb.getItem as jest.Mock).mockImplementation(
        (_pk: string) =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  articleId: _pk.replace('ARTICLE#', ''),
                  title: 'Test Article',
                  content: 'Section 1\n\nSection 2\n\nSection 3',
                  category: 'general',
                  tags: [],
                }),
              10,
            ),
          ),
      );

      const queryVector = new Array(256).fill(0.1);
      const start = Date.now();
      const results = await searchKnowledgeBase(queryVector, { limit: 10, minRelevance: 0.0 });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2_000);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ── 3. Notification latency < 30 seconds (escalation) ────────────────────

  describe('Escalation Notification Performance', () => {
    it('should send escalation notification within 30 seconds', async () => {
      const decision = {
        shouldEscalate: true,
        reason: EscalationReason.LOW_CONFIDENCE,
        urgency: 'high' as const,
        assignTo: 'senior-agent-1',
        summary: 'Low confidence on billing issue',
        attemptedSolutions: ['Suggested KB article', 'Requested more info'],
      };

      const start = Date.now();
      await sendEscalationNotification('TKT-perf-001', decision);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(30_000);
    });
  });

  // ── 4. Alert latency < 5 minutes ─────────────────────────────────────────

  describe('Alert Notification Performance', () => {
    it('should send alert notification within 5 minutes', async () => {
      const alert = {
        alertId: 'alert-perf-001',
        type: 'spike' as const,
        description: 'Spike detected in billing category',
        affectedUsers: 25,
        recommendedActions: ['Investigate root cause', 'Allocate resources'],
        createdAt: new Date(),
      };

      const recipients = ['manager-1', 'manager-2', 'manager-3'];

      const start = Date.now();
      await sendAlertNotification(alert, recipients);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5 * 60 * 1_000); // 5 minutes
    });
  });

  // ── 5. Throughput: 100 concurrent tickets ─────────────────────────────────

  describe('Throughput Performance', () => {
    it('should handle 100 concurrent ticket creations', async () => {
      const CONCURRENT_TICKETS = 100;

      // Build 100 API events
      const events = Array.from({ length: CONCURRENT_TICKETS }, (_, i) =>
        createMockAPIEvent({
          userId: `user-${i}`,
          subject: `Concurrent ticket ${i}`,
          description: `Performance throughput test ticket number ${i}`,
          priority: Priority.MEDIUM,
        }),
      );

      const start = Date.now();
      const results = await Promise.all(
        events.map((event) => createTicketHandler(event as any)),
      );
      const elapsed = Date.now() - start;

      // All requests should succeed
      const successCount = results.filter((r) => r.statusCode === 201).length;
      expect(successCount).toBe(CONCURRENT_TICKETS);

      // Log throughput info for visibility
      const ticketsPerSecond = (CONCURRENT_TICKETS / elapsed) * 1000;
      console.log(
        `Throughput: ${CONCURRENT_TICKETS} tickets in ${elapsed}ms (${ticketsPerSecond.toFixed(1)} tickets/sec)`,
      );

      // Should complete within a reasonable time (< 30 seconds for mocked env)
      expect(elapsed).toBeLessThan(30_000);
    });
  });
});
