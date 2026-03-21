/**
 * Helper utilities for NovaSupport
 */

import { randomUUID } from 'crypto';
const uuidv4 = randomUUID;

/**
 * Generate a unique ticket ID
 */
export function generateTicketId(): string {
  return `TKT-${uuidv4()}`;
}

/**
 * Generate a unique attachment ID
 */
export function generateAttachmentId(): string {
  return `ATT-${uuidv4()}`;
}

/**
 * Generate a unique workflow ID
 */
export function generateWorkflowId(): string {
  return `WF-${uuidv4()}`;
}

/**
 * Generate S3 key for attachment
 */
export function generateAttachmentS3Key(ticketId: string, attachmentId: string, fileName: string): string {
  const timestamp = Date.now();
  const extension = fileName.split('.').pop() || '';
  return `attachments/${ticketId}/${attachmentId}-${timestamp}.${extension}`;
}

/**
 * Validate file size
 */
export function validateFileSize(fileSize: number, maxSize: number): boolean {
  return fileSize <= maxSize;
}

/**
 * Get max file size based on file type
 */
export function getMaxFileSize(fileType: string): number {
  if (fileType.startsWith('video/')) {
    return 50 * 1024 * 1024; // 50MB for videos
  } else if (fileType.startsWith('application/') || fileType === 'text/plain') {
    return 10 * 1024 * 1024; // 10MB for documents
  } else if (fileType.startsWith('image/')) {
    return 5 * 1024 * 1024; // 5MB for images
  } else if (fileType.startsWith('audio/')) {
    return 5 * 1024 * 1024; // 5MB for audio
  }
  return 10 * 1024 * 1024; // Default 10MB
}

/**
 * Validate file type
 */
export function validateFileType(fileType: string): boolean {
  const allowedTypes = [
    // Images
    'image/png',
    'image/jpeg',
    'image/gif',
    // Videos
    'video/mp4',
    'video/webm',
    // Documents
    'application/pdf',
    'text/plain',
    'text/log',
    // Audio
    'audio/mpeg',
    'audio/wav',
    'audio/webm',
  ];
  
  return allowedTypes.includes(fileType);
}

/**
 * Get attachment type from file type
 */
export function getAttachmentType(fileType: string): 'image' | 'video' | 'document' | 'audio' {
  if (fileType.startsWith('image/')) {
    return 'image';
  } else if (fileType.startsWith('video/')) {
    return 'video';
  } else if (fileType.startsWith('audio/')) {
    return 'audio';
  } else {
    return 'document';
  }
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
  return `MSG-${uuidv4()}`;
}

/**
 * Format date to ISO 8601 string
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Parse ISO 8601 string to Date
 */
export function parseDate(dateString: string): Date {
  return new Date(dateString);
}

/**
 * Generate a unique chat session ID
 */
export function generateSessionId(): string {
  return `CHAT-${uuidv4()}`;
}

/**
 * Generate sort key for a chat message
 */
export function generateChatMessageSK(timestamp: string): string {
  return `MESSAGE#${timestamp}`;
}
