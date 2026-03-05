/**
 * Property-based tests for ticket creation handler
 * Tests task 2.3: Write property test for ticket creation
 * 
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import { handler } from '../src/handlers/create-ticket';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import * as sqsClient from '../src/utils/sqs-client';
import { Priority } from '../src/types/ticket';

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

describe('Property-Based Tests: Ticket Creation', () => {
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

  /**
   * Property 4: Priority Score Bounds
   * **Validates: Requirements 3.3**
   * 
   * For any ticket, when priority is assigned, the priority score should be 
   * an integer in the range [1, 10].
   */
  test('Property 4: Priority scores are in valid range [1, 10]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.string({ minLength: 1, maxLength: 100 }),
          subject: fc.string({ minLength: 1, maxLength: 200 }),
          description: fc.string({ minLength: 1, maxLength: 1000 }),
          priority: fc.option(
            fc.constantFrom(Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL),
            { nil: undefined }
          ),
        }),
        async (ticketData) => {
          const event = createMockEvent(ticketData);
          const result = await handler(event);

          // Only check successful ticket creation (status 201)
          if (result.statusCode === 201) {
            const body = JSON.parse(result.body);
            const priority = body.priority;

            // Priority must be an integer in the range [1, 10]
            expect(Number.isInteger(priority)).toBe(true);
            expect(priority).toBeGreaterThanOrEqual(1);
            expect(priority).toBeLessThanOrEqual(10);

            // Priority must be one of the valid enum values
            const validPriorities = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL];
            expect(validPriorities).toContain(priority);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property test: Priority assignment consistency
   * Verifies that when a priority is explicitly provided, it is preserved
   */
  test('Property: Explicit priority values are preserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.string({ minLength: 1, maxLength: 100 }),
          subject: fc.string({ minLength: 1, maxLength: 200 }),
          description: fc.string({ minLength: 1, maxLength: 1000 }),
          priority: fc.constantFrom(Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL),
        }),
        async (ticketData) => {
          const event = createMockEvent(ticketData);
          const result = await handler(event);

          if (result.statusCode === 201) {
            const body = JSON.parse(result.body);
            // The returned priority should match the input priority
            expect(body.priority).toBe(ticketData.priority);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property test: Default priority assignment
   * Verifies that when no priority is provided, a valid default is assigned
   */
  test('Property: Default priority is assigned when not provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.string({ minLength: 1, maxLength: 100 }),
          subject: fc.string({ minLength: 1, maxLength: 200 }),
          description: fc.string({ minLength: 1, maxLength: 1000 }),
        }),
        async (ticketData) => {
          const event = createMockEvent(ticketData);
          const result = await handler(event);

          if (result.statusCode === 201) {
            const body = JSON.parse(result.body);
            // A valid priority should be assigned
            expect(body.priority).toBeDefined();
            expect(body.priority).toBeGreaterThanOrEqual(1);
            expect(body.priority).toBeLessThanOrEqual(10);
            // Default should be MEDIUM (5)
            expect(body.priority).toBe(Priority.MEDIUM);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
