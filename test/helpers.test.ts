/**
 * Unit tests for helper utilities
 */

import {
  generateTicketId,
  generateAttachmentId,
  generateWorkflowId,
  generateAttachmentS3Key,
  validateFileSize,
  getMaxFileSize,
  validateFileType,
  getAttachmentType,
  formatDate,
  parseDate,
} from '../src/utils/helpers';

describe('Helper Utilities', () => {
  describe('ID Generation', () => {
    test('generateTicketId creates unique IDs with TKT prefix', () => {
      const id1 = generateTicketId();
      const id2 = generateTicketId();
      
      expect(id1).toMatch(/^TKT-[0-9a-f-]+$/);
      expect(id2).toMatch(/^TKT-[0-9a-f-]+$/);
      expect(id1).not.toBe(id2);
    });

    test('generateAttachmentId creates unique IDs with ATT prefix', () => {
      const id1 = generateAttachmentId();
      const id2 = generateAttachmentId();
      
      expect(id1).toMatch(/^ATT-[0-9a-f-]+$/);
      expect(id2).toMatch(/^ATT-[0-9a-f-]+$/);
      expect(id1).not.toBe(id2);
    });

    test('generateWorkflowId creates unique IDs with WF prefix', () => {
      const id1 = generateWorkflowId();
      const id2 = generateWorkflowId();
      
      expect(id1).toMatch(/^WF-[0-9a-f-]+$/);
      expect(id2).toMatch(/^WF-[0-9a-f-]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('S3 Key Generation', () => {
    test('generateAttachmentS3Key creates valid S3 key', () => {
      const ticketId = 'TKT-123';
      const attachmentId = 'ATT-456';
      const fileName = 'screenshot.png';
      
      const key = generateAttachmentS3Key(ticketId, attachmentId, fileName);
      
      expect(key).toMatch(/^attachments\/TKT-123\/ATT-456-\d+\.png$/);
    });

    test('generateAttachmentS3Key handles files without extension', () => {
      const key = generateAttachmentS3Key('TKT-1', 'ATT-1', 'file');
      
      expect(key).toMatch(/^attachments\/TKT-1\/ATT-1-\d+\.file$/);
    });
  });

  describe('File Validation', () => {
    test('validateFileSize returns true for valid sizes', () => {
      expect(validateFileSize(1000, 5000)).toBe(true);
      expect(validateFileSize(5000, 5000)).toBe(true);
    });

    test('validateFileSize returns false for oversized files', () => {
      expect(validateFileSize(6000, 5000)).toBe(false);
    });

    test('getMaxFileSize returns correct limits for different file types', () => {
      expect(getMaxFileSize('video/mp4')).toBe(50 * 1024 * 1024); // 50MB
      expect(getMaxFileSize('image/png')).toBe(5 * 1024 * 1024); // 5MB
      expect(getMaxFileSize('application/pdf')).toBe(10 * 1024 * 1024); // 10MB
      expect(getMaxFileSize('audio/mpeg')).toBe(5 * 1024 * 1024); // 5MB
      expect(getMaxFileSize('text/plain')).toBe(10 * 1024 * 1024); // 10MB
    });

    test('validateFileType accepts allowed file types', () => {
      expect(validateFileType('image/png')).toBe(true);
      expect(validateFileType('image/jpeg')).toBe(true);
      expect(validateFileType('video/mp4')).toBe(true);
      expect(validateFileType('application/pdf')).toBe(true);
      expect(validateFileType('text/plain')).toBe(true);
      expect(validateFileType('audio/mpeg')).toBe(true);
    });

    test('validateFileType rejects disallowed file types', () => {
      expect(validateFileType('application/exe')).toBe(false);
      expect(validateFileType('text/html')).toBe(false);
      expect(validateFileType('video/avi')).toBe(false);
    });

    test('getAttachmentType returns correct type', () => {
      expect(getAttachmentType('image/png')).toBe('image');
      expect(getAttachmentType('video/mp4')).toBe('video');
      expect(getAttachmentType('application/pdf')).toBe('document');
      expect(getAttachmentType('text/plain')).toBe('document');
      expect(getAttachmentType('audio/mpeg')).toBe('audio');
    });
  });

  describe('Date Utilities', () => {
    test('formatDate converts Date to ISO 8601 string', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const formatted = formatDate(date);
      
      expect(formatted).toBe('2024-01-15T10:30:00.000Z');
    });

    test('parseDate converts ISO 8601 string to Date', () => {
      const dateString = '2024-01-15T10:30:00.000Z';
      const parsed = parseDate(dateString);
      
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.toISOString()).toBe(dateString);
    });

    test('formatDate and parseDate are inverse operations', () => {
      const original = new Date();
      const roundTrip = parseDate(formatDate(original));
      
      expect(roundTrip.getTime()).toBe(original.getTime());
    });
  });
});
