/**
 * Lambda handler for attachment upload
 * Implements task 2.2: Implement attachment handling
 * 
 * Requirements: 5.5, 6.5, 7.5
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { generateAttachmentId, formatDate } from '../utils/helpers';
import { putItem, getItem, updateItem } from '../utils/dynamodb-client';
import { getUploadUrl } from '../utils/s3-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('UploadAttachmentHandler');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

interface UploadAttachmentRequestBody {
  ticketId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

// File type validation
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'text/plain', 'text/log', 'application/x-log'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'];

const ALL_ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_AUDIO_TYPES,
];

// File size limits (in bytes)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_AUDIO_SIZE = 5 * 1024 * 1024; // 5MB (for voice tickets)

/**
 * Validate file type
 */
function validateFileType(fileType: string): { valid: boolean; error?: string } {
  if (!ALL_ALLOWED_TYPES.includes(fileType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${fileType}. Allowed types: ${ALL_ALLOWED_TYPES.join(', ')}`,
    };
  }
  return { valid: true };
}

/**
 * Validate file size based on type
 */
function validateFileSize(fileType: string, fileSize: number): { valid: boolean; error?: string } {
  let maxSize: number;
  let category: string;

  if (ALLOWED_IMAGE_TYPES.includes(fileType)) {
    maxSize = MAX_IMAGE_SIZE;
    category = 'image';
  } else if (ALLOWED_DOCUMENT_TYPES.includes(fileType)) {
    maxSize = MAX_DOCUMENT_SIZE;
    category = 'document';
  } else if (ALLOWED_VIDEO_TYPES.includes(fileType)) {
    maxSize = MAX_VIDEO_SIZE;
    category = 'video';
  } else if (ALLOWED_AUDIO_TYPES.includes(fileType)) {
    maxSize = MAX_AUDIO_SIZE;
    category = 'audio';
  } else {
    return { valid: false, error: 'Unknown file type category' };
  }

  if (fileSize > maxSize) {
    return {
      valid: false,
      error: `File size ${fileSize} bytes exceeds maximum ${maxSize} bytes for ${category} files`,
    };
  }

  if (fileSize <= 0) {
    return {
      valid: false,
      error: 'File size must be greater than 0',
    };
  }

  return { valid: true };
}

/**
 * Validate request input
 */
function validateInput(body: UploadAttachmentRequestBody): string[] {
  const errors: string[] = [];

  if (!body.ticketId || typeof body.ticketId !== 'string' || body.ticketId.trim() === '') {
    errors.push('ticketId is required and must be a non-empty string');
  }

  if (!body.fileName || typeof body.fileName !== 'string' || body.fileName.trim() === '') {
    errors.push('fileName is required and must be a non-empty string');
  }

  if (!body.fileType || typeof body.fileType !== 'string') {
    errors.push('fileType is required and must be a string');
  }

  if (typeof body.fileSize !== 'number') {
    errors.push('fileSize is required and must be a number');
  }

  return errors;
}

/**
 * Lambda handler for generating signed upload URL
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    logger.info('Received attachment upload request', { event });

    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'MISSING_BODY',
            message: 'Request body is required',
            retryable: false,
          },
        }),
      };
    }

    let requestBody: UploadAttachmentRequestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (error) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON',
            retryable: false,
          },
        }),
      };
    }

    // Validate input
    const validationErrors = validateInput(requestBody);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid attachment data',
            details: validationErrors,
            retryable: false,
          },
        }),
      };
    }

    // Validate file type
    const typeValidation = validateFileType(requestBody.fileType);
    if (!typeValidation.valid) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_FILE_TYPE',
            message: typeValidation.error,
            retryable: false,
          },
        }),
      };
    }

    // Validate file size
    const sizeValidation = validateFileSize(requestBody.fileType, requestBody.fileSize);
    if (!sizeValidation.valid) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'INVALID_FILE_SIZE',
            message: sizeValidation.error,
            retryable: false,
          },
        }),
      };
    }

    // Verify ticket exists
    const ticketId = requestBody.ticketId.trim();
    const ticket = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!ticket) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: {
            code: 'TICKET_NOT_FOUND',
            message: `Ticket ${ticketId} not found`,
            retryable: false,
          },
        }),
      };
    }

    // Generate unique attachment ID
    const attachmentId = generateAttachmentId();
    const now = new Date();
    const timestamp = formatDate(now);

    // Generate S3 key
    const s3Key = `attachments/${ticketId}/${attachmentId}/${requestBody.fileName}`;
    const bucketName = process.env.ATTACHMENTS_BUCKET_NAME || 'novasupport-attachments';

    // Generate presigned upload URL
    const uploadUrl = await getUploadUrl(s3Key, requestBody.fileType);
    logger.info('Generated presigned upload URL', { attachmentId, s3Key });

    // Store attachment metadata in DynamoDB
    const attachmentRecord = {
      PK: `TICKET#${ticketId}`,
      SK: `ATTACHMENT#${attachmentId}`,
      attachmentId,
      ticketId,
      fileName: requestBody.fileName.trim(),
      fileType: requestBody.fileType,
      fileSize: requestBody.fileSize,
      s3Key,
      s3Bucket: bucketName,
      analyzed: false,
      uploadedAt: timestamp,
    };

    await putItem(attachmentRecord);
    logger.info('Attachment metadata stored in DynamoDB', { attachmentId });

    // Update ticket to link attachment
    const existingAttachmentIds = ticket.attachmentIds || [];
    await updateItem(
      `TICKET#${ticketId}`,
      'METADATA',
      'SET attachmentIds = :attachmentIds, updatedAt = :updatedAt',
      {
        ':attachmentIds': [...existingAttachmentIds, attachmentId],
        ':updatedAt': timestamp,
      }
    );
    logger.info('Ticket updated with attachment link', { ticketId, attachmentId });

    // Return success response with upload URL
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        attachmentId,
        uploadUrl,
        s3Key,
        expiresIn: 3600, // 1 hour
        message: 'Upload URL generated successfully. Use PUT request to upload file.',
      }),
    };

  } catch (error) {
    logger.error('Error generating upload URL', error instanceof Error ? error : undefined);

    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while generating upload URL',
          retryable: true,
        },
      }),
    };
  }
}
