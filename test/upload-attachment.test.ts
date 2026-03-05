/**
 * Unit tests for attachment upload handler
 * Tests task 2.2: Implement attachment handling
 */

import { handler } from '../src/handlers/upload-attachment';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import * as s3Client from '../src/utils/s3-client';

// Mock the dependencies
jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/s3-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Upload Attachment Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ATTACHMENTS_BUCKET_NAME = 'test-bucket';
    
    // Mock successful ticket lookup
    (dynamodbClient.getItem as jest.Mock).mockResolvedValue({
      PK: 'TICKET#TKT-123',
      SK: 'METADATA',
      ticketId: 'TKT-123',
      attachmentIds: [],
    });
    
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);
    (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);
    (s3Client.getUploadUrl as jest.Mock).mockResolvedValue('https://s3.amazonaws.com/presigned-url');
  });

  const createMockEvent = (body: any): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/attachments',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  });

  describe('Successful attachment upload', () => {
    test('should generate upload URL for valid image attachment', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'screenshot.png',
        fileType: 'image/png',
        fileSize: 2 * 1024 * 1024, // 2MB
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.attachmentId).toMatch(/^ATT-/);
      expect(body.uploadUrl).toBe('https://s3.amazonaws.com/presigned-url');
      expect(body.expiresIn).toBe(3600);
      expect(body.message).toContain('Upload URL generated successfully');
    });

    test('should generate upload URL for valid document attachment', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'error.log',
        fileType: 'text/log',
        fileSize: 5 * 1024 * 1024, // 5MB
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.attachmentId).toBeDefined();
      expect(body.uploadUrl).toBeDefined();
    });

    test('should generate upload URL for valid video attachment', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'screen-recording.mp4',
        fileType: 'video/mp4',
        fileSize: 30 * 1024 * 1024, // 30MB
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.attachmentId).toBeDefined();
    });

    test('should store attachment metadata in DynamoDB', async () => {
      const requestBody = {
        ticketId: 'TKT-456',
        fileName: 'bug-report.pdf',
        fileType: 'application/pdf',
        fileSize: 1024 * 1024, // 1MB
      };

      const event = createMockEvent(requestBody);
      await handler(event);

      expect(dynamodbClient.putItem).toHaveBeenCalledTimes(1);
      const storedRecord = (dynamodbClient.putItem as jest.Mock).mock.calls[0][0];
      
      expect(storedRecord.PK).toBe('TICKET#TKT-456');
      expect(storedRecord.SK).toMatch(/^ATTACHMENT#ATT-/);
      expect(storedRecord.ticketId).toBe('TKT-456');
      expect(storedRecord.fileName).toBe('bug-report.pdf');
      expect(storedRecord.fileType).toBe('application/pdf');
      expect(storedRecord.fileSize).toBe(1024 * 1024);
      expect(storedRecord.analyzed).toBe(false);
      expect(storedRecord.s3Key).toContain('attachments/TKT-456/');
      expect(storedRecord.s3Bucket).toBe('test-bucket');
    });

    test('should link attachment to ticket', async () => {
      const requestBody = {
        ticketId: 'TKT-789',
        fileName: 'screenshot.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(dynamodbClient.updateItem).toHaveBeenCalledTimes(1);
      const updateCall = (dynamodbClient.updateItem as jest.Mock).mock.calls[0];
      
      expect(updateCall[0]).toBe('TICKET#TKT-789');
      expect(updateCall[1]).toBe('METADATA');
      expect(updateCall[2]).toContain('SET attachmentIds');
      
      const body = JSON.parse(result.body);
      expect(updateCall[3][':attachmentIds']).toContain(body.attachmentId);
    });

    test('should generate presigned S3 URL with correct parameters', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'test.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      await handler(event);

      expect(s3Client.getUploadUrl).toHaveBeenCalledTimes(1);
      const [s3Key, contentType] = (s3Client.getUploadUrl as jest.Mock).mock.calls[0];
      
      expect(s3Key).toContain('attachments/TKT-123/');
      expect(s3Key).toContain('test.png');
      expect(contentType).toBe('image/png');
    });
  });

  describe('File type validation', () => {
    test('should reject unsupported file types', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'malware.exe',
        fileType: 'application/x-executable',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_FILE_TYPE');
      expect(body.error.message).toContain('Unsupported file type');
    });

    test('should accept all supported image types', async () => {
      const imageTypes = ['image/png', 'image/jpeg', 'image/gif'];

      for (const fileType of imageTypes) {
        const requestBody = {
          ticketId: 'TKT-123',
          fileName: `test.${fileType.split('/')[1]}`,
          fileType,
          fileSize: 1024 * 1024,
        };

        const event = createMockEvent(requestBody);
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
      }
    });

    test('should accept all supported video types', async () => {
      const videoTypes = ['video/mp4', 'video/webm'];

      for (const fileType of videoTypes) {
        const requestBody = {
          ticketId: 'TKT-123',
          fileName: `test.${fileType.split('/')[1]}`,
          fileType,
          fileSize: 10 * 1024 * 1024,
        };

        const event = createMockEvent(requestBody);
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
      }
    });
  });

  describe('File size validation', () => {
    test('should reject images over 5MB', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'large-image.png',
        fileType: 'image/png',
        fileSize: 6 * 1024 * 1024, // 6MB
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_FILE_SIZE');
      expect(body.error.message).toContain('exceeds maximum');
    });

    test('should reject documents over 10MB', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'large-doc.pdf',
        fileType: 'application/pdf',
        fileSize: 11 * 1024 * 1024, // 11MB
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_FILE_SIZE');
    });

    test('should reject videos over 50MB', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'large-video.mp4',
        fileType: 'video/mp4',
        fileSize: 51 * 1024 * 1024, // 51MB
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_FILE_SIZE');
    });

    test('should accept files at exact size limits', async () => {
      const testCases = [
        { fileType: 'image/png', fileSize: 5 * 1024 * 1024 },
        { fileType: 'application/pdf', fileSize: 10 * 1024 * 1024 },
        { fileType: 'video/mp4', fileSize: 50 * 1024 * 1024 },
      ];

      for (const testCase of testCases) {
        const requestBody = {
          ticketId: 'TKT-123',
          fileName: 'test-file',
          ...testCase,
        };

        const event = createMockEvent(requestBody);
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
      }
    });

    test('should reject zero-byte files', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'empty.png',
        fileType: 'image/png',
        fileSize: 0,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_FILE_SIZE');
      expect(body.error.message).toContain('must be greater than 0');
    });
  });

  describe('Input validation', () => {
    test('should reject request with missing body', async () => {
      const event = { ...createMockEvent({}), body: null };
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('MISSING_BODY');
    });

    test('should reject request with invalid JSON', async () => {
      const event = createMockEvent({});
      event.body = 'invalid json{';
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INVALID_JSON');
    });

    test('should reject request with missing ticketId', async () => {
      const requestBody = {
        fileName: 'test.png',
        fileType: 'image/png',
        fileSize: 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContain('ticketId is required and must be a non-empty string');
    });

    test('should reject request with missing fileName', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileType: 'image/png',
        fileSize: 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details).toContain('fileName is required and must be a non-empty string');
    });

    test('should reject request with missing fileType', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'test.png',
        fileSize: 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details).toContain('fileType is required and must be a string');
    });

    test('should reject request with missing fileSize', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'test.png',
        fileType: 'image/png',
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error.details).toContain('fileSize is required and must be a number');
    });
  });

  describe('Ticket validation', () => {
    test('should reject attachment for non-existent ticket', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      const requestBody = {
        ticketId: 'TKT-NONEXISTENT',
        fileName: 'test.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('TICKET_NOT_FOUND');
      expect(body.error.message).toContain('TKT-NONEXISTENT');
    });

    test('should verify ticket exists before generating upload URL', async () => {
      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'test.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      await handler(event);

      expect(dynamodbClient.getItem).toHaveBeenCalledWith('TICKET#TKT-123', 'METADATA');
    });
  });

  describe('Error handling', () => {
    test('should handle DynamoDB errors gracefully', async () => {
      (dynamodbClient.putItem as jest.Mock).mockRejectedValue(new Error('DynamoDB error'));

      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'test.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.retryable).toBe(true);
    });

    test('should handle S3 errors gracefully', async () => {
      (s3Client.getUploadUrl as jest.Mock).mockRejectedValue(new Error('S3 error'));

      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'test.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Multiple attachments', () => {
    test('should handle multiple attachments for same ticket', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue({
        PK: 'TICKET#TKT-123',
        SK: 'METADATA',
        ticketId: 'TKT-123',
        attachmentIds: ['ATT-001', 'ATT-002'],
      });

      const requestBody = {
        ticketId: 'TKT-123',
        fileName: 'third-attachment.png',
        fileType: 'image/png',
        fileSize: 1024 * 1024,
      };

      const event = createMockEvent(requestBody);
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      
      const updateCall = (dynamodbClient.updateItem as jest.Mock).mock.calls[0];
      const body = JSON.parse(result.body);
      expect(updateCall[3][':attachmentIds']).toEqual(['ATT-001', 'ATT-002', body.attachmentId]);
    });
  });
});
