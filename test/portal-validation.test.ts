import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for user-portal/portal-validation.js
 *
 * Since portal-validation.js is a browser IIFE module, we evaluate the script
 * using the Function constructor to get the PortalValidation object.
 */

const scriptPath = path.join(__dirname, '..', 'user-portal', 'portal-validation.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
const loadScript = new Function(scriptContent + '\nreturn PortalValidation;');
const PortalValidation = loadScript();

describe('PortalValidation', () => {
  describe('validateSubject', () => {
    it('rejects empty string', () => {
      const result = PortalValidation.validateSubject('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Subject is required');
    });

    it('rejects whitespace-only string (spaces)', () => {
      const result = PortalValidation.validateSubject('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Subject is required');
    });

    it('rejects whitespace-only string (tabs and newlines)', () => {
      const result = PortalValidation.validateSubject('\t\n\r');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Subject is required');
    });

    it('accepts valid non-empty string', () => {
      const result = PortalValidation.validateSubject('Login issue');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts string with leading/trailing whitespace and content', () => {
      const result = PortalValidation.validateSubject('  Help me  ');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateDescription', () => {
    it('rejects empty string', () => {
      const result = PortalValidation.validateDescription('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Description is required');
    });

    it('rejects whitespace-only string (spaces)', () => {
      const result = PortalValidation.validateDescription('     ');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Description is required');
    });

    it('rejects whitespace-only string (tabs and newlines)', () => {
      const result = PortalValidation.validateDescription('\t\n');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Description is required');
    });

    it('accepts valid non-empty string', () => {
      const result = PortalValidation.validateDescription('I cannot log in to my account');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('validateForm', () => {
    it('returns errors for both fields when both are empty', () => {
      const result = PortalValidation.validateForm('', '');
      expect(result.valid).toBe(false);
      expect(result.errors.subject).toBe('Subject is required');
      expect(result.errors.description).toBe('Description is required');
    });

    it('returns error only for subject when description is valid', () => {
      const result = PortalValidation.validateForm('', 'Valid description');
      expect(result.valid).toBe(false);
      expect(result.errors.subject).toBe('Subject is required');
      expect(result.errors.description).toBeUndefined();
    });

    it('returns error only for description when subject is valid', () => {
      const result = PortalValidation.validateForm('Valid subject', '   ');
      expect(result.valid).toBe(false);
      expect(result.errors.subject).toBeUndefined();
      expect(result.errors.description).toBe('Description is required');
    });

    it('returns valid when both fields are non-empty', () => {
      const result = PortalValidation.validateForm('Bug report', 'App crashes on login');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it('rejects whitespace-only inputs for both fields', () => {
      const result = PortalValidation.validateForm('  \t  ', '\n\r');
      expect(result.valid).toBe(false);
      expect(result.errors.subject).toBe('Subject is required');
      expect(result.errors.description).toBe('Description is required');
    });
  });
});

describe('PortalValidation - File Validation', () => {
  describe('ALLOWED_TYPES', () => {
    it('exposes the ALLOWED_TYPES constant', () => {
      expect(PortalValidation.ALLOWED_TYPES).toBeDefined();
      expect(PortalValidation.ALLOWED_TYPES.image).toBeDefined();
      expect(PortalValidation.ALLOWED_TYPES.document).toBeDefined();
      expect(PortalValidation.ALLOWED_TYPES.video).toBeDefined();
      expect(PortalValidation.ALLOWED_TYPES.audio).toBeDefined();
    });
  });

  describe('validateFileType', () => {
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/gif',
      'application/pdf', 'text/plain', 'text/log', 'application/x-log',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
    ];

    it.each(allowedTypes)('accepts allowed type: %s', (mimeType) => {
      const result = PortalValidation.validateFileType(mimeType);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    const unsupportedTypes = [
      'application/zip',
      'text/html',
      'image/bmp',
      'video/avi',
      'audio/flac',
      'application/octet-stream',
      '',
    ];

    it.each(unsupportedTypes)('rejects unsupported type: "%s"', (mimeType) => {
      const result = PortalValidation.validateFileType(mimeType);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported file type');
    });
  });

  describe('validateFileSize', () => {
    it('accepts image file within 5 MB limit', () => {
      const result = PortalValidation.validateFileSize('image/png', 4 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });

    it('accepts image file at exactly 5 MB', () => {
      const result = PortalValidation.validateFileSize('image/jpeg', 5 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });

    it('rejects image file exceeding 5 MB', () => {
      const result = PortalValidation.validateFileSize('image/gif', 5 * 1024 * 1024 + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File exceeds maximum size of 5 MB for image files');
    });

    it('accepts document file within 10 MB limit', () => {
      const result = PortalValidation.validateFileSize('application/pdf', 9 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });

    it('rejects document file exceeding 10 MB', () => {
      const result = PortalValidation.validateFileSize('text/plain', 10 * 1024 * 1024 + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File exceeds maximum size of 10 MB for document files');
    });

    it('accepts video file within 50 MB limit', () => {
      const result = PortalValidation.validateFileSize('video/mp4', 49 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });

    it('rejects video file exceeding 50 MB', () => {
      const result = PortalValidation.validateFileSize('video/webm', 50 * 1024 * 1024 + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File exceeds maximum size of 50 MB for video files');
    });

    it('accepts audio file within 5 MB limit', () => {
      const result = PortalValidation.validateFileSize('audio/mpeg', 3 * 1024 * 1024);
      expect(result.valid).toBe(true);
    });

    it('rejects audio file exceeding 5 MB', () => {
      const result = PortalValidation.validateFileSize('audio/wav', 5 * 1024 * 1024 + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File exceeds maximum size of 5 MB for audio files');
    });

    it('returns error for unsupported file type', () => {
      const result = PortalValidation.validateFileSize('application/zip', 1024);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Unsupported file type');
    });
  });
});
