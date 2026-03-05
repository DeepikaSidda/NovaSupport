/**
 * Unit tests for AI Live Chat Assistant handler
 * Tests Task 4.1: chat-assistant.ts functions
 *
 * Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.4, 5.3, 5.4
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  validateChatRequest,
  classifyIssue,
  calculateChatConfidence,
  getCategoryTeam,
  processMessage,
  handleEscalation,
  handler,
} from '../src/handlers/chat-assistant';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import * as novaClient from '../src/utils/nova-client';
import * as knowledgeBase from '../src/services/knowledge-base';
import * as sqsClient from '../src/utils/sqs-client';

// Mock all external dependencies
jest.mock('../src/utils/dynamodb-client', () => ({
  putItem: jest.fn().mockResolvedValue(undefined),
  queryItems: jest.fn().mockResolvedValue([]),
  updateItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/nova-client', () => ({
  invokeNova2Lite: jest.fn().mockResolvedValue({ text: 'general' }),
  invokeNova2LiteWithFallback: jest.fn().mockResolvedValue({ text: 'Here is a helpful response.' }),
}));

jest.mock('../src/services/knowledge-base', () => ({
  searchKnowledgeBase: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/utils/sqs-client', () => ({
  sendTicketForProcessing: jest.fn().mockResolvedValue('msg-123'),
}));

jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

// Helper to create a mock API Gateway event
const createMockEvent = (body: any): APIGatewayProxyEvent => ({
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: {},
  multiValueHeaders: {},
  httpMethod: 'POST',
  isBase64Encoded: false,
  path: '/chat',
  pathParameters: null,
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  stageVariables: null,
  requestContext: {} as any,
  resource: '',
});

describe('Chat Assistant Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);
    (dynamodbClient.queryItems as jest.Mock).mockResolvedValue([]);
    (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);
    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'general' });
    (novaClient.invokeNova2LiteWithFallback as jest.Mock).mockResolvedValue({ text: 'Here is a helpful response.' });
    (knowledgeBase.searchKnowledgeBase as jest.Mock).mockResolvedValue([]);
    (sqsClient.sendTicketForProcessing as jest.Mock).mockResolvedValue('msg-123');
  });

  // ─── validateChatRequest ───────────────────────────────────────────

  describe('validateChatRequest', () => {
    test('returns empty array for valid request', () => {
      const errors = validateChatRequest({
        message: 'Hello',
        sessionId: 'sess-1',
        userId: 'user-1',
      });
      expect(errors).toEqual([]);
    });

    test('returns error when message is missing', () => {
      const errors = validateChatRequest({ sessionId: 'sess-1', userId: 'user-1' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('message');
    });

    test('returns error when sessionId is missing', () => {
      const errors = validateChatRequest({ message: 'Hello', userId: 'user-1' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('sessionId');
    });

    test('returns error when userId is missing', () => {
      const errors = validateChatRequest({ message: 'Hello', sessionId: 'sess-1' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('userId');
    });

    test('returns 3 errors when all fields are missing', () => {
      const errors = validateChatRequest({});
      expect(errors).toHaveLength(3);
    });

    test('returns error for null body', () => {
      const errors = validateChatRequest(null);
      expect(errors.length).toBeGreaterThan(0);
    });

    test('returns errors for empty string fields', () => {
      const errors = validateChatRequest({
        message: '   ',
        sessionId: '',
        userId: '  ',
      });
      expect(errors).toHaveLength(3);
    });
  });

  // ─── classifyIssue ────────────────────────────────────────────────

  describe('classifyIssue', () => {
    test('returns billing when Nova returns billing', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'billing' });
      const result = await classifyIssue('I have a billing question', []);
      expect(result).toBe('billing');
    });

    test('returns technical when Nova returns technical', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'technical' });
      const result = await classifyIssue('My app is crashing', []);
      expect(result).toBe('technical');
    });

    test('returns account when Nova returns account', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'account' });
      const result = await classifyIssue('I need to change my email', []);
      expect(result).toBe('account');
    });

    test('returns general when Nova returns general', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'general' });
      const result = await classifyIssue('Hello there', []);
      expect(result).toBe('general');
    });

    test('defaults to general on unexpected Nova output', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'unknown' });
      const result = await classifyIssue('Something weird', []);
      expect(result).toBe('general');
    });

    test('defaults to general when Nova throws error', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockRejectedValue(new Error('Nova down'));
      const result = await classifyIssue('Help me', []);
      expect(result).toBe('general');
    });
  });

  // ─── calculateChatConfidence ──────────────────────────────────────

  describe('calculateChatConfidence', () => {
    test('returns 0.1 when both arrays are empty', () => {
      const result = calculateChatConfidence([], []);
      expect(result).toBe(0.1);
    });

    test('returns value in [0, 1] for various inputs', () => {
      const kbResults = [{ relevanceScore: 0.8 }, { relevanceScore: 0.6 }];
      const similarTickets = [
        { similarityScore: 0.7, wasSuccessful: true },
        { similarityScore: 0.5, wasSuccessful: false },
      ];
      const result = calculateChatConfidence(kbResults, similarTickets);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    test('high KB relevance scores produce higher confidence', () => {
      const lowKb = calculateChatConfidence([{ relevanceScore: 0.2 }], []);
      const highKb = calculateChatConfidence([{ relevanceScore: 0.9 }], []);
      expect(highKb).toBeGreaterThan(lowKb);
    });

    test('successful similar tickets get weighted higher', () => {
      const unsuccessful = calculateChatConfidence(
        [],
        [{ similarityScore: 0.8, wasSuccessful: false }],
      );
      const successful = calculateChatConfidence(
        [],
        [{ similarityScore: 0.8, wasSuccessful: true }],
      );
      expect(successful).toBeGreaterThan(unsuccessful);
    });

    test('result is clamped to [0, 1]', () => {
      // Even with extreme inputs, result should stay in bounds
      const highResult = calculateChatConfidence(
        [{ relevanceScore: 1 }, { relevanceScore: 1 }],
        [{ similarityScore: 1, wasSuccessful: true }, { similarityScore: 1, wasSuccessful: true }],
      );
      expect(highResult).toBeLessThanOrEqual(1);
      expect(highResult).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── getCategoryTeam ──────────────────────────────────────────────

  describe('getCategoryTeam', () => {
    test('billing maps to billing', () => {
      expect(getCategoryTeam('billing')).toBe('billing');
    });

    test('technical maps to technical-support', () => {
      expect(getCategoryTeam('technical')).toBe('technical-support');
    });

    test('account maps to account-management', () => {
      expect(getCategoryTeam('account')).toBe('account-management');
    });

    test('general maps to general-support', () => {
      expect(getCategoryTeam('general')).toBe('general-support');
    });
  });

  // ─── processMessage ───────────────────────────────────────────────

  describe('processMessage', () => {
    const validRequest = {
      message: 'I need help with my bill',
      sessionId: 'sess-abc',
      userId: 'user-42',
      conversationHistory: [],
      action: 'message' as const,
    };

    test('returns ChatResponse with correct sessionId', async () => {
      const response = await processMessage(validRequest);
      expect(response.sessionId).toBe('sess-abc');
      expect(response.response).toBeDefined();
      expect(response.confidence).toBeDefined();
      expect(response.category).toBeDefined();
    });

    test('returns fallback when Nova is unavailable', async () => {
      (novaClient.invokeNova2LiteWithFallback as jest.Mock).mockResolvedValue({
        text: "I'm temporarily unable to process your request. Please try again or create a ticket manually.",
      });
      const response = await processMessage(validRequest);
      expect(response.response).toContain('temporarily unable');
    });

    test('stores user and assistant messages in DynamoDB', async () => {
      await processMessage(validRequest);
      // putItem should be called at least twice: once for user message, once for assistant message
      expect(dynamodbClient.putItem).toHaveBeenCalledTimes(2);

      const userRecord = (dynamodbClient.putItem as jest.Mock).mock.calls[0][0];
      expect(userRecord.PK).toBe('CHAT#sess-abc');
      expect(userRecord.SK).toMatch(/^MESSAGE#/);
      expect(userRecord.role).toBe('user');
      expect(userRecord.content).toBe('I need help with my bill');

      const assistantRecord = (dynamodbClient.putItem as jest.Mock).mock.calls[1][0];
      expect(assistantRecord.PK).toBe('CHAT#sess-abc');
      expect(assistantRecord.role).toBe('assistant');
    });
  });

  // ─── handleEscalation ─────────────────────────────────────────────

  describe('handleEscalation', () => {
    const escalationRequest = {
      message: 'I want to talk to a human',
      sessionId: 'sess-esc',
      userId: 'user-99',
      conversationHistory: [],
      action: 'escalate' as const,
    };

    beforeEach(() => {
      // Simulate existing chat messages in DynamoDB
      (dynamodbClient.queryItems as jest.Mock).mockResolvedValue([
        { role: 'user', content: 'My bill is wrong', timestamp: '2024-01-01T00:00:00.000Z' },
        { role: 'assistant', content: 'Let me help with that.', timestamp: '2024-01-01T00:00:01.000Z' },
        { role: 'user', content: 'I want to talk to a human', timestamp: '2024-01-01T00:00:02.000Z' },
      ]);
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'billing' });
    });

    test('creates ticket with full transcript in description', async () => {
      const response = await handleEscalation(escalationRequest);

      // putItem is called for the ticket record (and possibly session metadata)
      const putCalls = (dynamodbClient.putItem as jest.Mock).mock.calls;
      const ticketRecord = putCalls.find((call: any[]) => call[0].PK?.startsWith('TICKET#'));
      expect(ticketRecord).toBeDefined();
      expect(ticketRecord![0].description).toContain('My bill is wrong');
      expect(ticketRecord![0].description).toContain('Let me help with that.');
      expect(ticketRecord![0].description).toContain('I want to talk to a human');
    });

    test('includes category in ticket subject', async () => {
      const response = await handleEscalation(escalationRequest);

      const putCalls = (dynamodbClient.putItem as jest.Mock).mock.calls;
      const ticketRecord = putCalls.find((call: any[]) => call[0].PK?.startsWith('TICKET#'));
      expect(ticketRecord![0].subject).toContain('billing');
    });

    test('returns escalation info with ticketId and assignedTeam', async () => {
      const response = await handleEscalation(escalationRequest);
      expect(response.escalation).toBeDefined();
      expect(response.escalation!.ticketId).toMatch(/^TKT-/);
      expect(response.escalation!.assignedTeam).toBeDefined();
    });

    test('maps category to correct team', async () => {
      (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({ text: 'technical' });
      const response = await handleEscalation(escalationRequest);
      expect(response.escalation!.assignedTeam).toBe('technical-support');
    });
  });

  // ─── handler (Lambda entry point) ─────────────────────────────────

  describe('handler', () => {
    test('returns 400 for missing body', async () => {
      const event = { ...createMockEvent({}), body: null };
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MISSING_BODY');
    });

    test('returns 400 for invalid JSON', async () => {
      const event = createMockEvent('not valid json{');
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_JSON');
    });

    test('returns 400 for missing required fields', async () => {
      const event = createMockEvent({ message: 'hi' });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.length).toBeGreaterThan(0);
    });

    test('returns 200 for valid message request', async () => {
      const event = createMockEvent({
        message: 'Help me',
        sessionId: 'sess-1',
        userId: 'user-1',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.sessionId).toBe('sess-1');
      expect(body.response).toBeDefined();
    });

    test('returns 200 for valid escalate request', async () => {
      const event = createMockEvent({
        message: 'Escalate please',
        sessionId: 'sess-2',
        userId: 'user-2',
        action: 'escalate',
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.escalation).toBeDefined();
    });
  });
});
