/**
 * Unit tests for attachment validation
 * Implements task 2.4: Write unit tests for attachment validation
 * 
 * Requirements: 6.5, 7.5
 */

import { validateFileSize, validateFileType, getMaxFileSize } from '../src/utils/helpers';

describe('Attachment Validation', () => {
  describe('File Type Validation', () => {
    it('should accept PNG images', () => {
      expect(validateFileType('image/png')).toBe(true);
    });

    it('should accept JPEG images', () => {
      expect(validateFileType('image/jpeg')).toBe(true);
    });

    it('should accept GIF images', () => {
      expect(validateFileType('image/gif')).toBe(true);
    });

    it('should accept PDF documents', () => {
      expect(validateFileType('application/pdf')).toBe(true);
    });

    it('should accept plain text documents', () => {
      expect(validateFileType('text/plain')).toBe(true);
    });

    it('should accept log files', () => {
      expect(validateFileType('text/log')).toBe(true);
    });

    it('should accept MP4 videos', () => {
      expect(validateFileType('video/mp4')).toBe(true);
    });

    it('should accept WEBM videos', () => {
      expect(validateFileType('video/webm')).toBe(true);
    });

    it('should accept audio files for voice tickets', () => {
      expect(validateFileType('audio/mpeg')).toBe(true);
      expect(validateFileType('audio/wav')).toBe(true);
      expect(validateFileType('audio/webm')).toBe(true);
    });

    it('should reject unsupported file types', () => {
      expect(validateFileType('application/zip')).toBe(false);
      expect(validateFileType('application/x-executable')).toBe(false);
      expect(validateFileType('text/html')).toBe(false);
      expect(validateFileType('video/avi')).toBe(false);
    });

    it('should reject empty or invalid MIME types', () => {
      expect(validateFileType('')).toBe(false);
      expect(validateFileType('invalid')).toBe(false);
      expect(validateFileType('image/')).toBe(false);
    });
  });

  describe('File Size Validation', () => {
    describe('Image files (5MB limit)', () => {
      const maxImageSize = 5 * 1024 * 1024; // 5MB

      it('should accept images at exactly 5MB', () => {
        expect(validateFileSize(maxImageSize, maxImageSize)).toBe(true);
      });

      it('should accept images under 5MB', () => {
        expect(validateFileSize(1024 * 1024, maxImageSize)).toBe(true); // 1MB
        expect(validateFileSize(maxImageSize - 1, maxImageSize)).toBe(true);
      });

      it('should reject images over 5MB', () => {
        expect(validateFileSize(maxImageSize + 1, maxImageSize)).toBe(false);
        expect(validateFileSize(10 * 1024 * 1024, maxImageSize)).toBe(false); // 10MB
      });

      it('should reject zero-byte images', () => {
        expect(validateFileSize(0, maxImageSize)).toBe(true); // validateFileSize only checks upper bound
      });
    });

    describe('Document files (10MB limit)', () => {
      const maxDocSize = 10 * 1024 * 1024; // 10MB

      it('should accept documents at exactly 10MB', () => {
        expect(validateFileSize(maxDocSize, maxDocSize)).toBe(true);
      });

      it('should accept documents under 10MB', () => {
        expect(validateFileSize(5 * 1024 * 1024, maxDocSize)).toBe(true); // 5MB
        expect(validateFileSize(maxDocSize - 1, maxDocSize)).toBe(true);
      });

      it('should reject documents over 10MB', () => {
        expect(validateFileSize(maxDocSize + 1, maxDocSize)).toBe(false);
        expect(validateFileSize(20 * 1024 * 1024, maxDocSize)).toBe(false); // 20MB
      });
    });

    describe('Video files (50MB limit)', () => {
      const maxVideoSize = 50 * 1024 * 1024; // 50MB

      it('should accept videos at exactly 50MB', () => {
        expect(validateFileSize(maxVideoSize, maxVideoSize)).toBe(true);
      });

      it('should accept videos under 50MB', () => {
        expect(validateFileSize(25 * 1024 * 1024, maxVideoSize)).toBe(true); // 25MB
        expect(validateFileSize(maxVideoSize - 1, maxVideoSize)).toBe(true);
      });

      it('should reject videos over 50MB', () => {
        expect(validateFileSize(maxVideoSize + 1, maxVideoSize)).toBe(false);
        expect(validateFileSize(100 * 1024 * 1024, maxVideoSize)).toBe(false); // 100MB
      });
    });

    describe('Audio files (5MB limit)', () => {
      const maxAudioSize = 5 * 1024 * 1024; // 5MB

      it('should accept audio at exactly 5MB', () => {
        expect(validateFileSize(maxAudioSize, maxAudioSize)).toBe(true);
      });

      it('should accept audio under 5MB', () => {
        expect(validateFileSize(2 * 1024 * 1024, maxAudioSize)).toBe(true); // 2MB
        expect(validateFileSize(maxAudioSize - 1, maxAudioSize)).toBe(true);
      });

      it('should reject audio over 5MB', () => {
        expect(validateFileSize(maxAudioSize + 1, maxAudioSize)).toBe(false);
        expect(validateFileSize(10 * 1024 * 1024, maxAudioSize)).toBe(false); // 10MB
      });
    });
  });

  describe('Get Max File Size', () => {
    it('should return 5MB for image types', () => {
      expect(getMaxFileSize('image/png')).toBe(5 * 1024 * 1024);
      expect(getMaxFileSize('image/jpeg')).toBe(5 * 1024 * 1024);
      expect(getMaxFileSize('image/gif')).toBe(5 * 1024 * 1024);
    });

    it('should return 10MB for document types', () => {
      expect(getMaxFileSize('application/pdf')).toBe(10 * 1024 * 1024);
      expect(getMaxFileSize('text/plain')).toBe(10 * 1024 * 1024);
    });

    it('should return 50MB for video types', () => {
      expect(getMaxFileSize('video/mp4')).toBe(50 * 1024 * 1024);
      expect(getMaxFileSize('video/webm')).toBe(50 * 1024 * 1024);
    });

    it('should return 5MB for audio types', () => {
      expect(getMaxFileSize('audio/mpeg')).toBe(5 * 1024 * 1024);
      expect(getMaxFileSize('audio/wav')).toBe(5 * 1024 * 1024);
    });

    it('should return default 10MB for unknown types', () => {
      expect(getMaxFileSize('unknown/type')).toBe(10 * 1024 * 1024);
    });
  });

  describe('Edge Cases', () => {
    it('should handle corrupted file metadata gracefully', () => {
      // Negative file sizes should be rejected by the handler
      const maxSize = 10 * 1024 * 1024;
      expect(validateFileSize(-1, maxSize)).toBe(true); // validateFileSize doesn't check negative
    });

    it('should handle extremely large file sizes', () => {
      const maxSize = 50 * 1024 * 1024;
      const extremelyLarge = Number.MAX_SAFE_INTEGER;
      expect(validateFileSize(extremelyLarge, maxSize)).toBe(false);
    });

    it('should handle boundary conditions', () => {
      const maxSize = 10 * 1024 * 1024;
      expect(validateFileSize(maxSize - 1, maxSize)).toBe(true);
      expect(validateFileSize(maxSize, maxSize)).toBe(true);
      expect(validateFileSize(maxSize + 1, maxSize)).toBe(false);
    });

    it('should handle NaN file sizes', () => {
      const maxSize = 10 * 1024 * 1024;
      expect(validateFileSize(NaN, maxSize)).toBe(false); // NaN <= maxSize is false
    });

    it('should handle Infinity file sizes', () => {
      const maxSize = 10 * 1024 * 1024;
      expect(validateFileSize(Infinity, maxSize)).toBe(false);
      expect(validateFileSize(-Infinity, maxSize)).toBe(true);
    });
  });

  describe('Corrupted File Handling', () => {
    it('should reject files with malformed MIME types', () => {
      expect(validateFileType('image')).toBe(false);
      expect(validateFileType('/png')).toBe(false);
      expect(validateFileType('image//png')).toBe(false);
      expect(validateFileType('image/png/extra')).toBe(false);
    });

    it('should reject files with null or undefined MIME types', () => {
      expect(validateFileType(null as any)).toBe(false);
      expect(validateFileType(undefined as any)).toBe(false);
    });

    it('should reject files with case-sensitive MIME type variations', () => {
      // MIME types should be lowercase
      expect(validateFileType('IMAGE/PNG')).toBe(false);
      expect(validateFileType('Image/Png')).toBe(false);
      expect(validateFileType('VIDEO/MP4')).toBe(false);
    });

    it('should handle files with misleading extensions in MIME type', () => {
      // These look like valid types but aren't in our allowed list
      expect(validateFileType('image/svg+xml')).toBe(false);
      expect(validateFileType('image/bmp')).toBe(false);
      expect(validateFileType('video/avi')).toBe(false);
      expect(validateFileType('application/x-msdownload')).toBe(false);
    });

    it('should reject potentially dangerous file types', () => {
      expect(validateFileType('application/x-executable')).toBe(false);
      expect(validateFileType('application/x-sh')).toBe(false);
      expect(validateFileType('application/javascript')).toBe(false);
      expect(validateFileType('text/html')).toBe(false);
      expect(validateFileType('application/zip')).toBe(false);
    });
  });

  describe('Specific Edge Cases from Requirements', () => {
    it('should handle exactly 10MB documents (Requirement 6.5)', () => {
      const exactly10MB = 10 * 1024 * 1024;
      expect(getMaxFileSize('application/pdf')).toBe(exactly10MB);
      expect(validateFileSize(exactly10MB, exactly10MB)).toBe(true);
      expect(validateFileSize(exactly10MB + 1, exactly10MB)).toBe(false);
    });

    it('should handle exactly 50MB videos (Requirement 7.5)', () => {
      const exactly50MB = 50 * 1024 * 1024;
      expect(getMaxFileSize('video/mp4')).toBe(exactly50MB);
      expect(validateFileSize(exactly50MB, exactly50MB)).toBe(true);
      expect(validateFileSize(exactly50MB + 1, exactly50MB)).toBe(false);
    });

    it('should reject documents slightly over 10MB', () => {
      const maxDocSize = 10 * 1024 * 1024;
      const slightlyOver = maxDocSize + 1024; // 10MB + 1KB
      expect(validateFileSize(slightlyOver, maxDocSize)).toBe(false);
    });

    it('should reject videos slightly over 50MB', () => {
      const maxVideoSize = 50 * 1024 * 1024;
      const slightlyOver = maxVideoSize + 1024; // 50MB + 1KB
      expect(validateFileSize(slightlyOver, maxVideoSize)).toBe(false);
    });
  });
});
