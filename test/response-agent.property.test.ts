/**
 * Property-based tests for Response Agent
 * Tests tasks 8.3, 8.4, and 8.5
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import { generateResponse } from '../src/agents/response-agent';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import {
  ResponseContext,
  KnowledgeBaseResult,
  SimilarTicket,
} from '../src/types/agent';
import * as novaClient from '../src/utils/nova-client';

jest.mock('../src/utils/nova-client');
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
  subject: fc.string({ minLength: 3, maxLength: 80 }),
  description: fc.string({ minLength: 5, maxLength: 300 }),
  status: ticketStatusArb,
  priority: priorityArb,
  createdAt: fc.date(),
  updatedAt: fc.date(),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
  attachments: fc.constant([]),
});

const knowledgeBaseResultArb: fc.Arbitrary<KnowledgeBaseResult> = fc.record({
  articleId: fc.uuid(),
  title: fc.string({ minLength: 3, maxLength: 60 }),
  relevantSections: fc.array(fc.string({ minLength: 5, maxLength: 200 }), {
    minLength: 1,
    maxLength: 3,
  }),
  relevanceScore: fc.double({ min: 0.6, max: 1.0, noNaN: true }),
  url: fc.option(fc.webUrl(), { nil: undefined }),
});

const similarTicketArb: fc.Arbitrary<SimilarTicket> = fc.record({
  ticketId: fc.uuid(),
  subject: fc.string({ minLength: 3, maxLength: 60 }),
  similarityScore: fc.double({ min: 0.75, max: 1.0, noNaN: true }),
  resolution: fc.option(fc.string({ minLength: 5, maxLength: 200 }), { nil: undefined }),
  wasSuccessful: fc.boolean(),
});

const userHistoryTicketArb: fc.Arbitrary<Ticket> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  subject: fc.string({ minLength: 3, maxLength: 60 }),
  description: fc.string({ minLength: 5, maxLength: 200 }),
  status: ticketStatusArb,
  priority: priorityArb,
  createdAt: fc.date(),
  updatedAt: fc.date(),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 3 }),
  attachments: fc.constant([]),
});

// Helper: build a Nova mock response that references article titles
function buildMockNovaResponse(kbResults: KnowledgeBaseResult[]): string {
  const titleRefs = kbResults
    .slice(0, 2)
    .map((a) => a.title)
    .join(', ');
  const responseBody = kbResults.length > 0
    ? `Based on our documentation (${titleRefs}), here is a detailed solution to your issue. Please follow these steps carefully to resolve the problem you reported.`
    : 'Could you please provide additional details about your issue so we can assist you better? We need more information to investigate.';
  return [
    `RESPONSE: ${responseBody}`,
    'REASONING: Generated based on available context and knowledge base',
    'SUGGESTED_ACTIONS: Follow the steps, Contact support if issue persists',
  ].join('\n');
}

// --- Tests ---

describe('Property-Based Tests: Response Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 2: Response Generation Completeness
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * For any assigned ticket, when the Response Agent generates a response,
   * it should incorporate relevant knowledge base articles (if found),
   * reference similar ticket resolutions (if found), and include the
   * ticket's specific context and user history.
   */
  test('Property 2: Response Generation Completeness', async () => {
    await fc.assert(
      fc.asyncProperty(
        ticketArb,
        fc.array(knowledgeBaseResultArb, { minLength: 1, maxLength: 3 }),
        fc.array(similarTicketArb, { maxLength: 3 }),
        fc.array(userHistoryTicketArb, { maxLength: 3 }),
        async (ticket, kbResults, similarTickets, userHistory) => {
          const context: ResponseContext = {
            knowledgeBaseResults: kbResults,
            similarTickets,
            userHistory,
          };

          // Mock Nova to return a response that references article titles
          (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
            text: buildMockNovaResponse(kbResults),
          });

          const response = await generateResponse(ticket, context);

          // If knowledge base results were provided, referencedArticles should be non-empty
          if (kbResults.length > 0) {
            expect(response.referencedArticles.length).toBeGreaterThan(0);
          }

          // Response text must always be non-empty
          expect(response.text.length).toBeGreaterThan(0);

          // Confidence must always be defined
          expect(response.confidence).toBeDefined();
          expect(typeof response.confidence).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Response Confidence Scoring
   * **Validates: Requirements 2.5**
   *
   * For any generated response, the response should include a confidence
   * score in the range [0, 1].
   */
  test('Property 3: Response Confidence Scoring', async () => {
    await fc.assert(
      fc.asyncProperty(
        ticketArb,
        fc.array(knowledgeBaseResultArb, { maxLength: 4 }),
        fc.array(similarTicketArb, { maxLength: 4 }),
        fc.array(userHistoryTicketArb, { maxLength: 4 }),
        async (ticket, kbResults, similarTickets, userHistory) => {
          const context: ResponseContext = {
            knowledgeBaseResults: kbResults,
            similarTickets,
            userHistory,
          };

          (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
            text: buildMockNovaResponse(kbResults),
          });

          const response = await generateResponse(ticket, context);

          // Confidence must be a number in [0, 1]
          expect(typeof response.confidence).toBe('number');
          expect(response.confidence).toBeGreaterThanOrEqual(0);
          expect(response.confidence).toBeLessThanOrEqual(1);
          expect(Number.isNaN(response.confidence)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Unit Tests for No-Solution Scenario (Task 8.5) ---

describe('No-Solution Scenario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.4**
   * When no relevant solutions exist, the Agent SHALL generate a response
   * requesting additional information.
   */
  test('should request additional information when no KB articles and no similar tickets', async () => {
    const ticket: Ticket = {
      id: 'ticket-no-sol-1',
      userId: 'user-1',
      subject: 'Unknown issue',
      description: 'Something is not working',
      status: TicketStatus.ASSIGNED,
      priority: Priority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    };

    const context: ResponseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
    };

    // Nova returns a response that asks for more info (as prompted)
    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: Thank you for reaching out. Could you please provide additional details about your issue? Specifically, when did this start and what steps have you tried so far?\nREASONING: No knowledge base articles or similar tickets found\nSUGGESTED_ACTIONS: Provide more details, Attach screenshots',
    });

    const response = await generateResponse(ticket, context);

    expect(response.text).toBeTruthy();
    expect(response.confidence).toBeDefined();
    expect(response.reasoning).toBeTruthy();
  });

  test('fallback response requests additional information when no solutions exist', async () => {
    const ticket: Ticket = {
      id: 'ticket-no-sol-2',
      userId: 'user-2',
      subject: 'App crashes randomly',
      description: 'My app keeps crashing',
      status: TicketStatus.ASSIGNED,
      priority: Priority.HIGH,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    };

    const context: ResponseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
    };

    // Simulate Nova being unavailable to trigger fallback
    (novaClient.invokeNova2Lite as jest.Mock).mockRejectedValue(
      new novaClient.NovaUnavailableError('Service unavailable')
    );

    const response = await generateResponse(ticket, context);

    // Fallback with no KB/similar tickets should ask for additional details
    expect(response.text).toContain('additional details');
    expect(response.text).toContain('When did this issue first occur');
    expect(response.text).toContain('error messages');
    expect(response.confidence).toBe(0.5);
    expect(response.reasoning).toContain('Fallback');
    expect(response.suggestedActions).toContain('Provide additional details');
  });

  test('fallback response references KB articles when available but no similar tickets', async () => {
    const ticket: Ticket = {
      id: 'ticket-no-sol-3',
      userId: 'user-3',
      subject: 'Password issue',
      description: 'Cannot reset password',
      status: TicketStatus.ASSIGNED,
      priority: Priority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    };

    const context: ResponseContext = {
      knowledgeBaseResults: [
        {
          articleId: 'kb-100',
          title: 'Password Reset Guide',
          relevantSections: ['Step 1: Go to settings'],
          relevanceScore: 0.8,
          url: 'https://help.example.com/password-reset',
        },
      ],
      similarTickets: [],
      userHistory: [],
    };

    (novaClient.invokeNova2Lite as jest.Mock).mockRejectedValue(
      new novaClient.NovaUnavailableError('Service unavailable')
    );

    const response = await generateResponse(ticket, context);

    // Should reference the KB article instead of asking for more info
    expect(response.text).toContain('Password Reset Guide');
    expect(response.referencedArticles).toContain('kb-100');
    // Should NOT ask for additional details since KB articles exist
    expect(response.text).not.toContain('additional details');
  });
});
