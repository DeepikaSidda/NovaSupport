/**
 * Unit tests for Image Analysis Service
 * Tests OCR, error detection, UI element detection, format support, and fallback behavior.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import {
  analyzeImage,
  parseAnalysisResponse,
  fallbackAnalysis,
  buildAnalysisSummary,
  detectImageFormat,
  isSupportedFormat,
  ImageInput,
  ImageAnalysisError,
} from '../src/services/image-analyzer';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as s3Client from '../src/utils/s3-client';

// Mock AWS SDK and S3 client
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../src/utils/s3-client');

const mockSend = jest.fn();
const MockBedrockRuntimeClient = BedrockRuntimeClient as jest.MockedClass<typeof BedrockRuntimeClient>;
const mockGetFile = s3Client.getFile as jest.MockedFunction<typeof s3Client.getFile>;

/**
 * Helper: build a mock Nova multimodal response body
 */
function mockNovaResponse(analysis: Record<string, any>): { body: Uint8Array } {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        output: {
          message: {
            content: [{ text: JSON.stringify(analysis) }],
          },
        },
        stopReason: 'end_turn',
      })
    ),
  };
}

describe('Image Analyzer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockBedrockRuntimeClient.prototype.send = mockSend;
  });

  describe('analyzeImage - successful analysis', () => {
    it('should analyze an image from base64 data and return structured results', async () => {
      const novaAnalysis = {
        extractedText: 'Error: Connection timed out\nRetry in 30 seconds',
        detectedErrors: ['Connection timed out'],
        detectedApplication: 'Chrome Browser',
        uiElements: ['error dialog', 'retry button', 'address bar'],
        confidence: 0.92,
      };

      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({
        base64Data: 'aGVsbG8=', // dummy base64
        format: 'png',
      });

      expect(result.extractedText).toBe('Error: Connection timed out\nRetry in 30 seconds');
      expect(result.detectedErrors).toEqual(['Connection timed out']);
      expect(result.detectedApplication).toBe('Chrome Browser');
      expect(result.uiElements).toEqual(['error dialog', 'retry button', 'address bar']);
      expect(result.confidence).toBe(0.92);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));
    });

    it('should fetch image from S3 when s3Key is provided', async () => {
      const imageBuffer = Buffer.from('fake-image-data');
      mockGetFile.mockResolvedValueOnce(imageBuffer);

      const novaAnalysis = {
        extractedText: 'Login failed',
        detectedErrors: ['Invalid credentials'],
        detectedApplication: 'MyApp',
        uiElements: ['login form', 'submit button'],
        confidence: 0.85,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({
        s3Key: 'tickets/123/screenshot.png',
        format: 'png',
      });

      expect(mockGetFile).toHaveBeenCalledWith('tickets/123/screenshot.png');
      expect(result.extractedText).toBe('Login failed');
      expect(result.detectedApplication).toBe('MyApp');
    });
  });

  describe('analyzeImage - OCR text extraction (Req 5.1)', () => {
    it('should extract text from an image with multiple lines', async () => {
      const novaAnalysis = {
        extractedText: 'File not found\nPath: /usr/local/bin\nError code: 404',
        detectedErrors: ['File not found', 'Error code: 404'],
        detectedApplication: 'Terminal',
        uiElements: ['terminal window', 'command prompt'],
        confidence: 0.88,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });

      expect(result.extractedText).toContain('File not found');
      expect(result.extractedText).toContain('Error code: 404');
    });

    it('should return empty extracted text when image has no text', async () => {
      const novaAnalysis = {
        extractedText: '',
        detectedErrors: [],
        detectedApplication: 'Desktop',
        uiElements: ['wallpaper', 'taskbar'],
        confidence: 0.95,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'jpeg' });

      expect(result.extractedText).toBe('');
    });
  });

  describe('analyzeImage - error detection (Req 5.2)', () => {
    it('should identify error messages and codes', async () => {
      const novaAnalysis = {
        extractedText: 'HTTP 500 Internal Server Error\nStack trace: NullPointerException at line 42',
        detectedErrors: ['HTTP 500 Internal Server Error', 'NullPointerException at line 42'],
        detectedApplication: 'IntelliJ IDEA',
        uiElements: ['code editor', 'console panel', 'error highlight'],
        confidence: 0.91,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });

      expect(result.detectedErrors).toHaveLength(2);
      expect(result.detectedErrors).toContain('HTTP 500 Internal Server Error');
      expect(result.detectedErrors).toContain('NullPointerException at line 42');
    });

    it('should return empty errors array when no errors detected', async () => {
      const novaAnalysis = {
        extractedText: 'Welcome to the dashboard',
        detectedErrors: [],
        detectedApplication: 'Dashboard App',
        uiElements: ['navigation bar', 'chart widget'],
        confidence: 0.9,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });

      expect(result.detectedErrors).toEqual([]);
    });
  });

  describe('analyzeImage - UI element detection (Req 5.2, 5.3)', () => {
    it('should detect UI elements and application', async () => {
      const novaAnalysis = {
        extractedText: 'Settings > General > About',
        detectedErrors: [],
        detectedApplication: 'Windows Settings',
        uiElements: ['sidebar menu', 'settings panel', 'breadcrumb navigation', 'toggle switches'],
        confidence: 0.87,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });

      expect(result.detectedApplication).toBe('Windows Settings');
      expect(result.uiElements).toContain('sidebar menu');
      expect(result.uiElements).toContain('toggle switches');
      expect(result.uiElements.length).toBeGreaterThan(0);
    });
  });

  describe('analyzeImage - format support (Req 5.5)', () => {
    it('should support PNG format', async () => {
      const novaAnalysis = {
        extractedText: 'PNG test',
        detectedErrors: [],
        detectedApplication: 'Test App',
        uiElements: ['button'],
        confidence: 0.9,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });
      expect(result.extractedText).toBe('PNG test');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should support JPEG format', async () => {
      const novaAnalysis = {
        extractedText: 'JPEG test',
        detectedErrors: [],
        detectedApplication: 'Test App',
        uiElements: ['form'],
        confidence: 0.88,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'jpeg' });
      expect(result.extractedText).toBe('JPEG test');
    });

    it('should support GIF format', async () => {
      const novaAnalysis = {
        extractedText: 'GIF test',
        detectedErrors: [],
        detectedApplication: 'Test App',
        uiElements: ['image'],
        confidence: 0.82,
      };
      mockSend.mockResolvedValueOnce(mockNovaResponse(novaAnalysis));

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'gif' });
      expect(result.extractedText).toBe('GIF test');
    });

    it('should reject unsupported formats', async () => {
      await expect(
        analyzeImage({ base64Data: 'dGVzdA==', format: 'bmp' as any })
      ).rejects.toThrow(ImageAnalysisError);
      await expect(
        analyzeImage({ base64Data: 'dGVzdA==', format: 'bmp' as any })
      ).rejects.toThrow('Unsupported image format');
    });
  });

  describe('analyzeImage - fallback when Nova is unavailable', () => {
    it('should return fallback analysis when Nova API is unavailable', async () => {
      const unavailableError = new Error('Service unavailable');
      unavailableError.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValue(unavailableError);

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });

      expect(result.extractedText).toBe('');
      expect(result.detectedErrors).toEqual([]);
      expect(result.detectedApplication).toBe('Unknown');
      expect(result.uiElements).toEqual([]);
      expect(result.confidence).toBe(0);
    }, 15000);

    it('should return fallback analysis when throttled', async () => {
      const throttleError = new Error('Rate exceeded');
      throttleError.name = 'ThrottlingException';
      mockSend.mockRejectedValue(throttleError);

      const result = await analyzeImage({ base64Data: 'dGVzdA==', format: 'png' });

      expect(result.confidence).toBe(0);
      expect(result.detectedApplication).toBe('Unknown');
    }, 15000);

    it('should throw when S3 fetch fails', async () => {
      mockGetFile.mockRejectedValueOnce(new Error('Access denied'));

      await expect(
        analyzeImage({ s3Key: 'bad-key', format: 'png' })
      ).rejects.toThrow(ImageAnalysisError);
      await expect(
        analyzeImage({ s3Key: 'bad-key', format: 'png' })
      ).rejects.toThrow('Failed to fetch image from S3');
    });

    it('should throw when neither s3Key nor base64Data is provided', async () => {
      await expect(
        analyzeImage({ format: 'png' } as ImageInput)
      ).rejects.toThrow('Either s3Key or base64Data must be provided');
    });
  });

  describe('parseAnalysisResponse', () => {
    it('should parse valid JSON response', () => {
      const json = JSON.stringify({
        extractedText: 'Hello world',
        detectedErrors: ['Error 1'],
        detectedApplication: 'MyApp',
        uiElements: ['button', 'form'],
        confidence: 0.85,
      });

      const result = parseAnalysisResponse(json);

      expect(result.extractedText).toBe('Hello world');
      expect(result.detectedErrors).toEqual(['Error 1']);
      expect(result.detectedApplication).toBe('MyApp');
      expect(result.uiElements).toEqual(['button', 'form']);
      expect(result.confidence).toBe(0.85);
    });

    it('should handle JSON wrapped in markdown code blocks', () => {
      const response = '```json\n{"extractedText":"test","detectedErrors":[],"detectedApplication":"App","uiElements":[],"confidence":0.9}\n```';

      const result = parseAnalysisResponse(response);

      expect(result.extractedText).toBe('test');
      expect(result.confidence).toBe(0.9);
    });

    it('should clamp confidence to [0, 1]', () => {
      const overConfident = JSON.stringify({
        extractedText: '',
        detectedErrors: [],
        detectedApplication: '',
        uiElements: [],
        confidence: 1.5,
      });
      expect(parseAnalysisResponse(overConfident).confidence).toBe(1);

      const negativeConfidence = JSON.stringify({
        extractedText: '',
        detectedErrors: [],
        detectedApplication: '',
        uiElements: [],
        confidence: -0.5,
      });
      expect(parseAnalysisResponse(negativeConfidence).confidence).toBe(0);
    });

    it('should handle malformed JSON by using raw text as extractedText', () => {
      const result = parseAnalysisResponse('This is not JSON at all');

      expect(result.extractedText).toBe('This is not JSON at all');
      expect(result.detectedErrors).toEqual([]);
      expect(result.detectedApplication).toBe('Unknown');
      expect(result.confidence).toBe(0.3);
    });

    it('should filter non-string values from arrays', () => {
      const json = JSON.stringify({
        extractedText: 'test',
        detectedErrors: ['real error', 123, null, 'another error'],
        detectedApplication: 'App',
        uiElements: ['button', undefined, 'form'],
        confidence: 0.8,
      });

      const result = parseAnalysisResponse(json);

      expect(result.detectedErrors).toEqual(['real error', 'another error']);
      expect(result.uiElements).toEqual(['button', 'form']);
    });

    it('should default missing fields', () => {
      const json = JSON.stringify({});

      const result = parseAnalysisResponse(json);

      expect(result.extractedText).toBe('');
      expect(result.detectedErrors).toEqual([]);
      expect(result.detectedApplication).toBe('Unknown');
      expect(result.uiElements).toEqual([]);
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('buildAnalysisSummary (Req 5.4)', () => {
    it('should build a complete summary with all fields', () => {
      const analysis = {
        extractedText: 'Error: timeout',
        detectedErrors: ['timeout', 'connection refused'],
        detectedApplication: 'Chrome',
        uiElements: ['error page', 'reload button'],
        confidence: 0.9,
      };

      const summary = buildAnalysisSummary(analysis);

      expect(summary).toContain('--- Image Analysis ---');
      expect(summary).toContain('Extracted Text: Error: timeout');
      expect(summary).toContain('Detected Errors: timeout; connection refused');
      expect(summary).toContain('Application: Chrome');
      expect(summary).toContain('UI Elements: error page, reload button');
      expect(summary).toContain('Analysis Confidence: 90%');
    });

    it('should omit sections with no data', () => {
      const analysis = {
        extractedText: '',
        detectedErrors: [],
        detectedApplication: 'Unknown',
        uiElements: [],
        confidence: 0,
      };

      const summary = buildAnalysisSummary(analysis);

      expect(summary).toContain('--- Image Analysis ---');
      expect(summary).not.toContain('Extracted Text:');
      expect(summary).not.toContain('Detected Errors:');
      expect(summary).not.toContain('Application:');
      expect(summary).not.toContain('UI Elements:');
      expect(summary).toContain('Analysis Confidence: 0%');
    });
  });

  describe('detectImageFormat', () => {
    it('should detect PNG format', () => {
      expect(detectImageFormat('screenshot.png')).toBe('png');
      expect(detectImageFormat('SCREENSHOT.PNG')).toBe('png');
    });

    it('should detect JPEG format', () => {
      expect(detectImageFormat('photo.jpg')).toBe('jpeg');
      expect(detectImageFormat('photo.jpeg')).toBe('jpeg');
      expect(detectImageFormat('PHOTO.JPG')).toBe('jpeg');
    });

    it('should detect GIF format', () => {
      expect(detectImageFormat('animation.gif')).toBe('gif');
    });

    it('should return null for unsupported formats', () => {
      expect(detectImageFormat('image.bmp')).toBeNull();
      expect(detectImageFormat('image.tiff')).toBeNull();
      expect(detectImageFormat('noextension')).toBeNull();
    });
  });

  describe('isSupportedFormat', () => {
    it('should return true for supported formats', () => {
      expect(isSupportedFormat('png')).toBe(true);
      expect(isSupportedFormat('jpeg')).toBe(true);
      expect(isSupportedFormat('gif')).toBe(true);
    });

    it('should return false for unsupported formats', () => {
      expect(isSupportedFormat('bmp')).toBe(false);
      expect(isSupportedFormat('tiff')).toBe(false);
      expect(isSupportedFormat('webp')).toBe(false);
    });
  });

  describe('fallbackAnalysis', () => {
    it('should return empty analysis with zero confidence', () => {
      const result = fallbackAnalysis();

      expect(result.extractedText).toBe('');
      expect(result.detectedErrors).toEqual([]);
      expect(result.detectedApplication).toBe('Unknown');
      expect(result.uiElements).toEqual([]);
      expect(result.confidence).toBe(0);
    });
  });
});
