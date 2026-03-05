/**
 * Unit tests for Video Analysis Service
 * Tests video format detection, format validation, size limits,
 * analyzeVideo error cases, parseFrameResponse, fallbackFrameAnalysis,
 * and buildVideoSummary.
 *
 * Requirements: 7.5 (MP4/WEBM up to 50MB)
 */

import {
  detectVideoFormat,
  isSupportedVideoFormat,
  analyzeVideo,
  parseFrameResponse,
  fallbackFrameAnalysis,
  buildVideoSummary,
  MAX_VIDEO_SIZE_BYTES,
  VideoAnalysisError,
  VideoInput,
} from '../src/services/video-analyzer';
import { ImageAnalysis } from '../src/types/agent';

jest.mock('../src/utils/s3-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));
jest.mock('@aws-sdk/client-bedrock-runtime');

describe('Video Analyzer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Format Detection Tests ──────────────────────────────────────────

  describe('detectVideoFormat', () => {
    it('should detect MP4 format', () => {
      expect(detectVideoFormat('video.mp4')).toBe('mp4');
    });

    it('should detect WEBM format', () => {
      expect(detectVideoFormat('video.webm')).toBe('webm');
    });

    it('should return null for AVI (unsupported)', () => {
      expect(detectVideoFormat('video.avi')).toBeNull();
    });

    it('should return null for MOV (unsupported)', () => {
      expect(detectVideoFormat('video.mov')).toBeNull();
    });

    it('should be case insensitive', () => {
      expect(detectVideoFormat('VIDEO.MP4')).toBe('mp4');
      expect(detectVideoFormat('Video.Webm')).toBe('webm');
    });
  });

  // ── Format Validation Tests ─────────────────────────────────────────

  describe('isSupportedVideoFormat', () => {
    it('should return true for mp4', () => {
      expect(isSupportedVideoFormat('mp4')).toBe(true);
    });

    it('should return true for webm', () => {
      expect(isSupportedVideoFormat('webm')).toBe(true);
    });

    it('should return false for avi', () => {
      expect(isSupportedVideoFormat('avi')).toBe(false);
    });

    it('should return false for mov', () => {
      expect(isSupportedVideoFormat('mov')).toBe(false);
    });
  });

  // ── Size Limit Tests ────────────────────────────────────────────────

  describe('MAX_VIDEO_SIZE_BYTES', () => {
    it('should equal 50 * 1024 * 1024 (50MB)', () => {
      expect(MAX_VIDEO_SIZE_BYTES).toBe(50 * 1024 * 1024);
    });
  });

  describe('analyzeVideo - 50MB size limit', () => {
    it('should throw VideoAnalysisError when data exceeds 50MB', async () => {
      // Create a string that exceeds MAX_VIDEO_SIZE_BYTES
      const oversizedData = 'x'.repeat(MAX_VIDEO_SIZE_BYTES + 1);

      await expect(
        analyzeVideo({
          base64Data: oversizedData,
          format: 'mp4',
          duration: 5,
        })
      ).rejects.toThrow(VideoAnalysisError);

      await expect(
        analyzeVideo({
          base64Data: oversizedData,
          format: 'mp4',
          duration: 5,
        })
      ).rejects.toThrow(/exceeds maximum size of 50MB/);
    });
  });

  // ── analyzeVideo Error Cases ────────────────────────────────────────

  describe('analyzeVideo - error cases', () => {
    it('should throw VideoAnalysisError for unsupported format', async () => {
      await expect(
        analyzeVideo({
          base64Data: 'dGVzdA==',
          format: 'avi' as any,
          duration: 5,
        })
      ).rejects.toThrow(VideoAnalysisError);

      await expect(
        analyzeVideo({
          base64Data: 'dGVzdA==',
          format: 'avi' as any,
          duration: 5,
        })
      ).rejects.toThrow(/Unsupported video format/);
    });

    it('should throw VideoAnalysisError when duration is 0', async () => {
      await expect(
        analyzeVideo({
          base64Data: 'dGVzdA==',
          format: 'mp4',
          duration: 0,
        })
      ).rejects.toThrow(VideoAnalysisError);

      await expect(
        analyzeVideo({
          base64Data: 'dGVzdA==',
          format: 'mp4',
          duration: 0,
        })
      ).rejects.toThrow(/duration must be greater than 0/);
    });

    it('should throw VideoAnalysisError when duration is negative', async () => {
      await expect(
        analyzeVideo({
          base64Data: 'dGVzdA==',
          format: 'webm',
          duration: -3,
        })
      ).rejects.toThrow(VideoAnalysisError);
    });

    it('should throw VideoAnalysisError when neither s3Key nor base64Data provided', async () => {
      await expect(
        analyzeVideo({
          format: 'mp4',
          duration: 5,
        } as VideoInput)
      ).rejects.toThrow(VideoAnalysisError);

      await expect(
        analyzeVideo({
          format: 'mp4',
          duration: 5,
        } as VideoInput)
      ).rejects.toThrow(/Either s3Key or base64Data must be provided/);
    });
  });

  // ── parseFrameResponse Tests ────────────────────────────────────────

  describe('parseFrameResponse', () => {
    it('should parse valid JSON response correctly', () => {
      const json = JSON.stringify({
        extractedText: 'Error: Connection refused',
        detectedErrors: ['Connection refused'],
        detectedApplication: 'Chrome',
        uiElements: ['error page', 'reload button'],
        confidence: 0.88,
        userAction: 'Clicked refresh',
        systemResponse: 'Page reload failed',
      });

      const result = parseFrameResponse(json);

      expect(result.analysis.extractedText).toBe('Error: Connection refused');
      expect(result.analysis.detectedErrors).toEqual(['Connection refused']);
      expect(result.analysis.detectedApplication).toBe('Chrome');
      expect(result.analysis.uiElements).toEqual(['error page', 'reload button']);
      expect(result.analysis.confidence).toBe(0.88);
      expect(result.userAction).toBe('Clicked refresh');
      expect(result.systemResponse).toBe('Page reload failed');
    });

    it('should parse JSON wrapped in markdown code blocks', () => {
      const response = '```json\n{"extractedText":"test","detectedErrors":[],"detectedApplication":"App","uiElements":["btn"],"confidence":0.9,"userAction":"typing"}\n```';

      const result = parseFrameResponse(response);

      expect(result.analysis.extractedText).toBe('test');
      expect(result.analysis.confidence).toBe(0.9);
      expect(result.userAction).toBe('typing');
    });

    it('should fall back to raw text extraction for invalid JSON', () => {
      const result = parseFrameResponse('This is not valid JSON at all');

      expect(result.analysis.extractedText).toBe('This is not valid JSON at all');
      expect(result.analysis.detectedErrors).toEqual([]);
      expect(result.analysis.detectedApplication).toBe('Unknown');
      expect(result.analysis.uiElements).toEqual([]);
      expect(result.analysis.confidence).toBe(0.3);
      expect(result.userAction).toBeUndefined();
      expect(result.systemResponse).toBeUndefined();
    });

    it('should provide default values for missing fields', () => {
      const json = JSON.stringify({});

      const result = parseFrameResponse(json);

      expect(result.analysis.extractedText).toBe('');
      expect(result.analysis.detectedErrors).toEqual([]);
      expect(result.analysis.detectedApplication).toBe('Unknown');
      expect(result.analysis.uiElements).toEqual([]);
      expect(result.analysis.confidence).toBe(0.5);
      expect(result.userAction).toBeUndefined();
      expect(result.systemResponse).toBeUndefined();
    });
  });

  // ── fallbackFrameAnalysis Tests ─────────────────────────────────────

  describe('fallbackFrameAnalysis', () => {
    it('should return empty/default ImageAnalysis with confidence 0', () => {
      const result = fallbackFrameAnalysis();

      expect(result.extractedText).toBe('');
      expect(result.detectedErrors).toEqual([]);
      expect(result.detectedApplication).toBe('Unknown');
      expect(result.uiElements).toEqual([]);
      expect(result.confidence).toBe(0);
    });
  });

  // ── buildVideoSummary Tests ─────────────────────────────────────────

  describe('buildVideoSummary', () => {
    it('should generate summary with frame count', () => {
      const keyFrames = [
        { timestamp: 0, analysis: makeAnalysis() },
        { timestamp: 1, analysis: makeAnalysis() },
        { timestamp: 2, analysis: makeAnalysis() },
      ];

      const summary = buildVideoSummary(keyFrames, [], []);

      expect(summary).toContain('3 frame(s) analyzed');
    });

    it('should include detected applications', () => {
      const keyFrames = [
        { timestamp: 0, analysis: makeAnalysis({ detectedApplication: 'Chrome' }) },
        { timestamp: 1, analysis: makeAnalysis({ detectedApplication: 'Chrome' }) },
      ];

      const summary = buildVideoSummary(keyFrames, [], []);

      expect(summary).toContain('Chrome');
      expect(summary).toContain('Application(s) detected');
    });

    it('should include error count', () => {
      const keyFrames = [
        { timestamp: 0, analysis: makeAnalysis({ detectedErrors: ['Error 1', 'Error 2'] }) },
        { timestamp: 1, analysis: makeAnalysis({ detectedErrors: ['Error 3'] }) },
      ];

      const summary = buildVideoSummary(keyFrames, [], []);

      expect(summary).toContain('3 unique error(s) found');
    });

    it('should include action count', () => {
      const keyFrames = [
        { timestamp: 0, analysis: makeAnalysis() },
      ];
      const actions = ['Clicked button', 'Typed text'];

      const summary = buildVideoSummary(keyFrames, [], actions);

      expect(summary).toContain('2 user action(s) detected');
    });

    it('should return default message when no findings', () => {
      const summary = buildVideoSummary([], [], []);

      expect(summary).toBe('Video analyzed but no significant findings detected.');
    });
  });
});

/** Helper to create an ImageAnalysis with optional overrides */
function makeAnalysis(overrides: Partial<ImageAnalysis> = {}): ImageAnalysis {
  return {
    extractedText: '',
    detectedErrors: [],
    detectedApplication: 'Unknown',
    uiElements: [],
    confidence: 0.5,
    ...overrides,
  };
}
