/**
 * Unit tests for get ticket handler
 * Tests task 23.1: GET /tickets/{ticketId} endpoint
 */

import { handler } from '../src/handlers/get-ticket';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import { TicketStatus, Priority } from '../src/types/ticket';

jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Get Ticket Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockEvent = (ticketId: string | null): APIGatewayProxyEvent => ({
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: ticketId ? `/tickets/${ticketId}` : '/tickets/',
    pathParameters: ticketId ? { ticketId } : null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  });

  const mockTicketRecord = {
    PK: 'TICKET#TKT-123',
    SK: 'METADATA',
    ticketId: 'TKT-123',
    userId: 'user-456',
    subject: 'Login issue',
    description: 'Cannot log into my account',
    status: TicketStatus.NEW,
    priority: Priority.HIGH,
    assignedTo: undefined,
    assignedTeam: undefined,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    tags: ['login', 'auth'],
    category: 'authentication',
    attachmentIds: ['ATT-001'],
    routingConfidence: 0.85,
    responseConfidence: undefined,
    escalationReason: undefined,
    GSI1PK: 'USER#user-456',
    GSI1SK: '2024-01-01T00:00:00.000Z',
    GSI2PK: 'STATUS#new',
    GSI2SK: '8#2024-01-01T00:00:00.000Z',
  };

  describe('Successful ticket retrieval', () => {
    test('should return ticket details with 200 status', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockTicketRecord);

      const event = createMockEvent('TKT-123');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.ticketId).toBe('TKT-123');
      expect(body.userId).toBe('user-456');
      expect(body.subject).toBe('Login issue');
      expect(body.description).toBe('Cannot log into my account');
      expect(body.status).toBe(TicketStatus.NEW);
      expect(body.priority).toBe(Priority.HIGH);
      expect(body.tags).toEqual(['login', 'auth']);
      expect(body.attachmentIds).toEqual(['ATT-001']);
      expect(body.routingConfidence).toBe(0.85);
    });

    test('should query DynamoDB with correct key', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockTicketRecord);

      const event = createMockEvent('TKT-123');
      await handler(event);

      expect(dynamodbClient.getItem).toHaveBeenCalledWith('TICKET#TKT-123', 'METADATA');
    });

    test('should not expose internal DynamoDB keys in response', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockTicketRecord);

      const event = createMockEvent('TKT-123');
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(body.PK).toBeUndefined();
      expect(body.SK).toBeUndefined();
      expect(body.GSI1PK).toBeUndefined();
      expect(body.GSI1SK).toBeUndefined();
      expect(body.GSI2PK).toBeUndefined();
      expect(body.GSI2SK).toBeUndefined();
    });
  });

  describe('Ticket not found', () => {
    test('should return 404 when ticket does not exist', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      const event = createMockEvent('TKT-nonexistent');
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('TICKET_NOT_FOUND');
      expect(body.error.message).toContain('TKT-nonexistent');
      expect(body.error.retryable).toBe(false);
    });
  });

  describe('Input validation', () => {
    test('should return 400 when ticketId is missing', async () => {
      const event = createMockEvent(null);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MISSING_TICKET_ID');
    });

    test('should return 400 when ticketId is empty string', async () => {
      const event = createMockEvent('');
      // pathParameters with empty string
      event.pathParameters = { ticketId: '   ' };
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MISSING_TICKET_ID');
    });
  });

  describe('Error handling', () => {
    test('should handle DynamoDB errors gracefully', async () => {
      (dynamodbClient.getItem as jest.Mock).mockRejectedValue(new Error('DynamoDB error'));

      const event = createMockEvent('TKT-123');
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });
  });
});
