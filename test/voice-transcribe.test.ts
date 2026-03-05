/**
 * Unit tests for voice-transcribe Lambda handler
 * Tests Task 4.1: Voice transcribe API endpoint
 */

import { validateTranscribeRequest, handler } from '../src/handlers/voice-transcribe';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock voice-processor
jest.mock('../src/services/voice-processor', () => ({
  transcribeSpeech: jest.fn(),
  isSupportedAudioFormat: jest.requireActual('../src/services/voice-processor').isSupportedAudioFormat,
  isSupportedLanguage: jest.requireActual('../src/services/voice-processor').isSupportedLanguage,
  MAX_AUDIO_DURATION_SECONDS: 300,
  VoiceProcessingError: jest.requireActual('../src/services/voice-processor').VoiceProcessingError,
}));

import { transcribeSpeech, VoiceProcessingError } from '../src/services/voice-processor';

const mockTranscribeSpeech = transcribeSpeech as jest.MockedFunction<typeof transcribeSpeech>;

function makeEvent(body: any): APIGatewayProxyEvent {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/voice/transcribe',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  };
}

describe('validateTranscribeRequest', () => {
  it('returns no errors for valid request with s3Key', () => {
    const errors = validateTranscribeRequest({
      s3Key: 'audio/test.wav',
      format: 'wav',
      duration: 60,
    });
    expect(errors).toEqual([]);
  });

  it('returns no errors for valid request with audioData', () => {
    const errors = validateTranscribeRequest({
      audioData: 'base64data',
      format: 'mp3',
      duration: 10,
      language: 'en',
    });
    expect(errors).toEqual([]);
  });

  it('returns error when neither s3Key nor audioData provided', () => {
    const errors = validateTranscribeRequest({ format: 'wav', duration: 10 });
    expect(errors).toContain('Either s3Key or audioData must be provided');
  });

  it('returns error for unsupported format', () => {
    const errors = validateTranscribeRequest({
      s3Key: 'test.flac',
      format: 'flac',
      duration: 10,
    });
    expect(errors.some(e => e.includes('Unsupported audio format'))).toBe(true);
  });

  it('returns error for missing format', () => {
    const errors = validateTranscribeRequest({ s3Key: 'test.wav', duration: 10 });
    expect(errors.some(e => e.includes('format is required'))).toBe(true);
  });

  it('returns error for duration <= 0', () => {
    const errors = validateTranscribeRequest({ s3Key: 'test.wav', format: 'wav', duration: 0 });
    expect(errors).toContain('duration must be greater than 0');
  });

  it('returns error for duration exceeding max', () => {
    const errors = validateTranscribeRequest({ s3Key: 'test.wav', format: 'wav', duration: 301 });
    expect(errors.some(e => e.includes('must not exceed 300 seconds'))).toBe(true);
  });

  it('returns error for unsupported language', () => {
    const errors = validateTranscribeRequest({
      s3Key: 'test.wav',
      format: 'wav',
      duration: 10,
      language: 'xx',
    });
    expect(errors.some(e => e.includes('Unsupported language'))).toBe(true);
  });

  it('accepts all supported formats', () => {
    for (const format of ['wav', 'mp3', 'ogg', 'webm']) {
      const errors = validateTranscribeRequest({ s3Key: 'test', format, duration: 10 });
      expect(errors).toEqual([]);
    }
  });
});

describe('handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when body is missing', async () => {
    const event = makeEvent(null);
    event.body = null;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('MISSING_BODY');
  });

  it('returns 400 for invalid JSON', async () => {
    const event = makeEvent('not json');
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('INVALID_JSON');
  });

  it('returns 400 for validation errors', async () => {
    const event = makeEvent({ format: 'flac', duration: -1 });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('returns 200 with transcription on success', async () => {
    mockTranscribeSpeech.mockResolvedValue({
      text: 'Hello world',
      language: 'en',
      confidence: 0.9,
      detectedTechnicalTerms: ['API'],
    });

    const event = makeEvent({ s3Key: 'audio/test.wav', format: 'wav', duration: 30 });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.text).toBe('Hello world');
    expect(body.language).toBe('en');
    expect(body.confidence).toBe(0.9);
    expect(body.detectedTechnicalTerms).toEqual(['API']);
  });

  it('returns 400 for VoiceProcessingError', async () => {
    mockTranscribeSpeech.mockRejectedValue(
      new VoiceProcessingError('S3 fetch failed'),
    );

    const event = makeEvent({ s3Key: 'bad-key', format: 'wav', duration: 10 });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('VOICE_PROCESSING_ERROR');
  });

  it('returns 500 for unexpected errors', async () => {
    mockTranscribeSpeech.mockRejectedValue(new Error('Unexpected'));

    const event = makeEvent({ audioData: 'data', format: 'mp3', duration: 5 });
    const result = await handler(event);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error.code).toBe('INTERNAL_ERROR');
  });

  it('includes CORS headers in all responses', async () => {
    const event = makeEvent(null);
    event.body = null;
    const result = await handler(event);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers?.['Content-Type']).toBe('application/json');
  });
});
