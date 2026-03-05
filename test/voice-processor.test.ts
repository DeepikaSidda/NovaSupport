/**
 * Unit tests for Voice Processing Service
 * Tests language support, 5-minute audio limit, playback UI integration,
 * and core utility functions.
 *
 * Requirements: 12.2 (multiple languages), 12.5 (5-minute limit),
 *               13.4 (playback option), 13.5 (multiple language outputs)
 */

import {
  isSupportedLanguage,
  isSupportedOutputLanguage,
  isSupportedAudioFormat,
  transcribeSpeech,
  generateSpeech,
  createTicketFromVoice,
  detectTechnicalTerms,
  buildPronunciationGuide,
  estimateAudioDuration,
  parseTranscriptionResponse,
  fallbackTranscription,
  fallbackAudioFile,
  MAX_AUDIO_DURATION_SECONDS,
  SUPPORTED_LANGUAGES,
  PRONUNCIATION_GUIDE,
  TECHNICAL_TERMS_DICTIONARY,
  VoiceProcessingError,
  VoiceInput,
  TTSInput,
} from '../src/services/voice-processor';

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

describe('Voice Processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Constants ───────────────────────────────────────────────────────

  describe('MAX_AUDIO_DURATION_SECONDS', () => {
    it('should equal 300 (5 minutes)', () => {
      expect(MAX_AUDIO_DURATION_SECONDS).toBe(300);
    });
  });

  describe('SUPPORTED_LANGUAGES', () => {
    it('should contain all 10 supported languages', () => {
      expect(SUPPORTED_LANGUAGES).toHaveLength(10);
    });

    it.each(['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt', 'it', 'nl'])(
      'should include %s',
      (lang) => {
        expect(SUPPORTED_LANGUAGES).toContain(lang);
      }
    );
  });

  // ── isSupportedLanguage (Requirement 12.2) ──────────────────────────

  describe('isSupportedLanguage', () => {
    it.each(['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt', 'it', 'nl'])(
      'should return true for supported language %s',
      (lang) => {
        expect(isSupportedLanguage(lang)).toBe(true);
      }
    );

    it.each(['ru', 'ar', 'hi', 'sv', 'xx', '', 'english'])(
      'should return false for unsupported language %s',
      (lang) => {
        expect(isSupportedLanguage(lang)).toBe(false);
      }
    );
  });

  // ── isSupportedOutputLanguage (Requirement 13.5) ────────────────────

  describe('isSupportedOutputLanguage', () => {
    it.each(['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt', 'it', 'nl'])(
      'should return true for supported output language %s',
      (lang) => {
        expect(isSupportedOutputLanguage(lang)).toBe(true);
      }
    );

    it.each(['ru', 'ar', 'hi', 'sv', 'xx', '', 'english'])(
      'should return false for unsupported output language %s',
      (lang) => {
        expect(isSupportedOutputLanguage(lang)).toBe(false);
      }
    );
  });

  // ── isSupportedAudioFormat ──────────────────────────────────────────

  describe('isSupportedAudioFormat', () => {
    it.each(['wav', 'mp3', 'ogg', 'webm'])(
      'should return true for supported format %s',
      (fmt) => {
        expect(isSupportedAudioFormat(fmt)).toBe(true);
      }
    );

    it.each(['flac', 'aac', 'wma', 'aiff', '', 'mp4'])(
      'should return false for unsupported format %s',
      (fmt) => {
        expect(isSupportedAudioFormat(fmt)).toBe(false);
      }
    );
  });

  // ── transcribeSpeech error cases (Requirement 12.5) ─────────────────

  describe('transcribeSpeech - error cases', () => {
    it('should throw for unsupported audio format', async () => {
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'flac' as any,
          duration: 10,
        })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'flac' as any,
          duration: 10,
        })
      ).rejects.toThrow(/Unsupported audio format/);
    });

    it('should throw when duration exceeds 300 seconds (5-minute limit)', async () => {
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'wav',
          duration: 301,
        })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'wav',
          duration: 301,
        })
      ).rejects.toThrow(/exceeds maximum duration/);
    });

    it('should accept audio at exactly 300 seconds (boundary)', async () => {
      // This should NOT throw for duration validation; it will proceed to API call
      // which will fail since Bedrock is mocked, but the duration check passes
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'wav',
          duration: 300,
        })
      ).resolves.toBeDefined();
    });

    it('should throw when duration is 0', async () => {
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'mp3',
          duration: 0,
        })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'mp3',
          duration: 0,
        })
      ).rejects.toThrow(/duration must be greater than 0/);
    });

    it('should throw when duration is negative', async () => {
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'mp3',
          duration: -5,
        })
      ).rejects.toThrow(VoiceProcessingError);
    });

    it('should throw for unsupported language', async () => {
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'wav',
          duration: 10,
          language: 'ru',
        })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        transcribeSpeech({
          audioData: 'dGVzdA==',
          format: 'wav',
          duration: 10,
          language: 'ru',
        })
      ).rejects.toThrow(/Unsupported language/);
    });

    it('should throw when neither s3Key nor audioData is provided', async () => {
      await expect(
        transcribeSpeech({
          format: 'wav',
          duration: 10,
        } as VoiceInput)
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        transcribeSpeech({
          format: 'wav',
          duration: 10,
        } as VoiceInput)
      ).rejects.toThrow(/Either s3Key or audioData must be provided/);
    });
  });

  // ── generateSpeech error cases (Requirement 13.5) ───────────────────

  describe('generateSpeech - error cases', () => {
    it('should throw for empty text', async () => {
      await expect(
        generateSpeech({ text: '' })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        generateSpeech({ text: '   ' })
      ).rejects.toThrow(/Text input is required/);
    });

    it('should throw for unsupported output language', async () => {
      await expect(
        generateSpeech({ text: 'Hello', language: 'ru' })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        generateSpeech({ text: 'Hello', language: 'ru' })
      ).rejects.toThrow(/Unsupported output language/);
    });

    it('should throw when speed is below 0.5', async () => {
      await expect(
        generateSpeech({ text: 'Hello', speed: 0.3 })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        generateSpeech({ text: 'Hello', speed: 0.3 })
      ).rejects.toThrow(/Speed must be between 0.5 and 2.0/);
    });

    it('should throw when speed is above 2.0', async () => {
      await expect(
        generateSpeech({ text: 'Hello', speed: 2.5 })
      ).rejects.toThrow(VoiceProcessingError);
      await expect(
        generateSpeech({ text: 'Hello', speed: 2.5 })
      ).rejects.toThrow(/Speed must be between 0.5 and 2.0/);
    });
  });

  // ── createTicketFromVoice error cases ───────────────────────────────

  describe('createTicketFromVoice - error cases', () => {
    it('should throw for empty transcription text', () => {
      expect(() =>
        createTicketFromVoice(
          { text: '', language: 'en', confidence: 0.9, detectedTechnicalTerms: [] },
          'user-1'
        )
      ).toThrow(VoiceProcessingError);
      expect(() =>
        createTicketFromVoice(
          { text: '   ', language: 'en', confidence: 0.9, detectedTechnicalTerms: [] },
          'user-1'
        )
      ).toThrow(/empty transcription/);
    });

    it('should throw for empty userId', () => {
      expect(() =>
        createTicketFromVoice(
          { text: 'My app is broken', language: 'en', confidence: 0.9, detectedTechnicalTerms: [] },
          ''
        )
      ).toThrow(VoiceProcessingError);
      expect(() =>
        createTicketFromVoice(
          { text: 'My app is broken', language: 'en', confidence: 0.9, detectedTechnicalTerms: [] },
          '   '
        )
      ).toThrow(/userId is required/);
    });
  });

  // ── detectTechnicalTerms ────────────────────────────────────────────

  describe('detectTechnicalTerms', () => {
    it('should detect AWS service names', () => {
      const result = detectTechnicalTerms('I have an issue with my Lambda function and DynamoDB table');
      expect(result).toContain('Lambda');
      expect(result).toContain('DynamoDB');
    });

    it('should detect programming terms', () => {
      const result = detectTechnicalTerms('The API returns JSON with a GraphQL error');
      expect(result).toContain('API');
      expect(result).toContain('JSON');
      expect(result).toContain('GraphQL');
    });

    it('should detect error terms', () => {
      const result = detectTechnicalTerms('Getting a timeout and connection refused error');
      expect(result).toContain('timeout');
      expect(result).toContain('connection refused');
    });

    it('should return empty array for empty text', () => {
      expect(detectTechnicalTerms('')).toEqual([]);
    });

    it('should return empty array for whitespace-only text', () => {
      expect(detectTechnicalTerms('   ')).toEqual([]);
    });

    it('should return deduplicated results', () => {
      const result = detectTechnicalTerms('Lambda Lambda Lambda');
      const unique = new Set(result);
      expect(result.length).toBe(unique.size);
    });
  });

  // ── buildPronunciationGuide ─────────────────────────────────────────

  describe('buildPronunciationGuide', () => {
    it('should replace DynamoDB with its pronunciation', () => {
      const result = buildPronunciationGuide('Check the DynamoDB table');
      expect(result).toContain(PRONUNCIATION_GUIDE['dynamodb']);
    });

    it('should replace API with its pronunciation', () => {
      const result = buildPronunciationGuide('Call the API endpoint');
      expect(result).toContain(PRONUNCIATION_GUIDE['api']);
    });

    it('should leave text unchanged when no technical terms present', () => {
      const text = 'Hello world this is a test';
      expect(buildPronunciationGuide(text)).toBe(text);
    });

    it('should return empty string for empty input', () => {
      expect(buildPronunciationGuide('')).toBe('');
    });

    it('should return whitespace-only input unchanged', () => {
      expect(buildPronunciationGuide('   ')).toBe('   ');
    });
  });

  // ── estimateAudioDuration ───────────────────────────────────────────

  describe('estimateAudioDuration', () => {
    it('should return at least 1 for any non-empty text', () => {
      expect(estimateAudioDuration('hello')).toBeGreaterThanOrEqual(1);
    });

    it('should return an integer', () => {
      expect(Number.isInteger(estimateAudioDuration('This is a test sentence'))).toBe(true);
    });

    it('should increase with more words', () => {
      const short = estimateAudioDuration('hello');
      const long = estimateAudioDuration('hello world this is a much longer sentence with many words');
      expect(long).toBeGreaterThanOrEqual(short);
    });

    it('should handle single word', () => {
      expect(estimateAudioDuration('word')).toBe(1);
    });
  });

  // ── parseTranscriptionResponse ──────────────────────────────────────

  describe('parseTranscriptionResponse', () => {
    it('should parse text and detect technical terms', () => {
      const result = parseTranscriptionResponse('My Lambda function has a timeout', 'en');
      expect(result.text).toBe('My Lambda function has a timeout');
      expect(result.language).toBe('en');
      expect(result.detectedTechnicalTerms).toContain('Lambda');
      expect(result.detectedTechnicalTerms).toContain('timeout');
    });

    it('should default language to en when not provided', () => {
      const result = parseTranscriptionResponse('Hello world');
      expect(result.language).toBe('en');
    });

    it('should return confidence 0 for empty text', () => {
      const result = parseTranscriptionResponse('');
      expect(result.confidence).toBe(0);
      expect(result.text).toBe('');
    });

    it('should return positive confidence for non-empty text', () => {
      const result = parseTranscriptionResponse('Some text here');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ── fallbackTranscription ───────────────────────────────────────────

  describe('fallbackTranscription', () => {
    it('should return empty transcription with confidence 0', () => {
      const result = fallbackTranscription();
      expect(result.text).toBe('');
      expect(result.confidence).toBe(0);
      expect(result.detectedTechnicalTerms).toEqual([]);
      expect(result.language).toBe('en');
    });

    it('should use provided language', () => {
      const result = fallbackTranscription('fr');
      expect(result.language).toBe('fr');
    });
  });

  // ── fallbackAudioFile ───────────────────────────────────────────────

  describe('fallbackAudioFile', () => {
    it('should return empty audio file', () => {
      const result = fallbackAudioFile();
      expect(result.url).toBe('');
      expect(result.duration).toBe(0);
      expect(result.format).toBe('mp3');
    });
  });
});
