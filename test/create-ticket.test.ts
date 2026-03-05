/**
 * Unit tests for ticket creation handler
 * Tests task 2.1: Create ticket creation API endpoint
 */

import { handler } from '../src/handlers/create-ticket';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import * as sqsClient from '../src/utils/sqs-client';
import { Priority, TicketStatus } from '../src/types/ticket';

// Mock the dependencies
jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/sqs-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Create Ticket Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);
    (sqsClient.sendTicketForProcessing as jest.Mock).mockResolvedValue('mock-message-id');
  });

  const createMockEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/tickets',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  });

  describe('Successful ticket creation', () => {
    test('should create a ticket with valid input', async () => {
      const requestBody = {
        userId: 'user-123',
        subject: 'Login issue',
        description: 'Cannot log into my account',
        priority: Priority.HIGH,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.ticketId).toMatch(/^TKT-/);
      expect(body.status).toBe(TicketStatus.NEW);
      expect(body.priority).toBe(Priority.HIGH);
      expect(body.createdAt).toBeDefined();
      expect(body.message).toBe('Ticket created successfully and queued for processing');
    });

    test('should create a ticket with default priority when not provided', async () => {
      const requestBody = {
        userId: 'user-456',
        subject: 'Feature request',
        description: 'Would like dark mode',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.priority).toBe(Priority.MEDIUM);
    });

    test('should store ticket in DynamoDB with correct structure', async () => {
      const requestBody = {
        userId: 'user-789',
        subject: 'Bug report',
        description: 'App crashes on startup',
        priority: Priority.CRITICAL,
      };

      const event = createMockEvent(requestBody);
      await handler(event);

      expect(dynamodbClient.putItem).toHaveBeenCalledTimes(1);
      const storedRecord = (dynamodbClient.putItem as jest.Mock).mock.calls[0][0];
      
      expect(storedRecord.PK).toMatch(/^TICKET#TKT-/);
      expect(storedRecord.SK).toBe('METADATA');
      expect(storedRecord.userId).toBe('user-789');
      expect(storedRecord.subject).toBe('Bug report');
      expect(storedRecord.description).toBe('App crashes on startup');
      expect(storedRecord.status).toBe(TicketStatus.NEW);
      expect(storedRecord.priority).toBe(Priority.CRITICAL);
      expect(storedRecord.tags).toEqual([]);
      expect(storedRecord.attachmentIds).toEqual([]);
      expect(storedRecord.GSI1PK).toBe('USER#user-789');
      expect(storedRecord.GSI2PK).toBe('STATUS#new');
    });

    test('should publish ticket to SQS queue', async () => {
      const requestBody = {
        userId: 'user-999',
        subject: 'Help needed',
        description: 'Need assistance with setup',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(sqsClient.sendTicketForProcessing).toHaveBeenCalledTimes(1);
      const ticketId = JSON.parse(result.body).ticketId;
      expect(sqsClient.sendTicketForProcessing).toHaveBeenCalledWith(ticketId);
    });

    test('should trim whitespace from input fields', async () => {
      const requestBody = {
        userId: '  user-123  ',
        subject: '  Login issue  ',
        description: '  Cannot log in  ',
      };

      const event = createMockEvent(requestBody);
      await handler(event);

      const storedRecord = (dynamodbClient.putItem as jest.Mock).mock.calls[0][0];
      expect(storedRecord.userId).toBe('user-123');
      expect(storedRecord.subject).toBe('Login issue');
      expect(storedRecord.description).toBe('Cannot log in');
    });
  });

  describe('Input validation', () => {
    test('should reject request with missing body', async () => {
      const event = { ...createMockEvent({}), body: null };
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MISSING_BODY');
      expect(body.error.retryable).toBe(false);
    });

    test('should reject request with invalid JSON', async () => {
      const event = createMockEvent({});
      event.body = 'invalid json{';
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_JSON');
    });

    test('should reject request with missing userId', async () => {
      const requestBody = {
        subject: 'Test',
        description: 'Test description',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContain('userId is required and must be a non-empty string');
    });

    test('should reject request with empty userId', async () => {
      const requestBody = {
        userId: '   ',
        subject: 'Test',
        description: 'Test description',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details).toContain('userId is required and must be a non-empty string');
    });

    test('should reject request with missing subject', async () => {
      const requestBody = {
        userId: 'user-123',
        description: 'Test description',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details).toContain('subject is required and must be a non-empty string');
    });

    test('should reject request with missing description', async () => {
      const requestBody = {
        userId: 'user-123',
        subject: 'Test',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details).toContain('description is required and must be a non-empty string');
    });

    test('should reject request with invalid priority', async () => {
      const requestBody = {
        userId: 'user-123',
        subject: 'Test',
        description: 'Test description',
        priority: 99,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details[0]).toContain('priority must be one of');
    });

    test('should accept all valid priority values', async () => {
      const priorities = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL];

      for (const priority of priorities) {
        const requestBody = {
          userId: 'user-123',
          subject: 'Test',
          description: 'Test description',
          priority,
        };

        const event = createMockEvent(requestBody);
        const result = await handler(event);

        expect(result.statusCode).toBe(201);
        const body = JSON.parse(result.body);
        expect(body.priority).toBe(priority);
      }
    });
  });

  describe('Error handling', () => {
    test('should handle DynamoDB errors gracefully', async () => {
      (dynamodbClient.putItem as jest.Mock).mockRejectedValue(new Error('DynamoDB error'));

      const requestBody = {
        userId: 'user-123',
        subject: 'Test',
        description: 'Test description',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });

    test('should handle SQS errors gracefully', async () => {
      (sqsClient.sendTicketForProcessing as jest.Mock).mockRejectedValue(new Error('SQS error'));

      const requestBody = {
        userId: 'user-123',
        subject: 'Test',
        description: 'Test description',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Unique ticket ID generation', () => {
    test('should generate unique ticket IDs for multiple requests', async () => {
      const requestBody = {
        userId: 'user-123',
        subject: 'Test',
        description: 'Test description',
      };

      const ticketIds = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const event = createMockEvent(requestBody);
        const result = await handler(event);
        const body = JSON.parse(result.body);
        ticketIds.add(body.ticketId);
      }

      expect(ticketIds.size).toBe(10);
    });
  });
});
