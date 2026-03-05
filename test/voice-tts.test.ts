/**
 * Unit tests for voice-tts Lambda handler
 * Tests Task 4.2: Voice TTS API endpoint
 */

import { validateTTSRequest, handler } from '../src/handlers/voice-tts';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock voice-processor
jest.mock('../src/services/voice-processor', () => ({
  generateSpeech: jest.fn(),
  isSupportedOutputLanguage: jest.requireActual('../src/services/voice-processor').isSupportedOutputLanguage,
  VoiceProcessingError: jest.requireActual('../src/services/voice-processor').VoiceProcessingError,
}));

import { generateSpeech, VoiceProcessingError } from '../src/services/voice-processor';

const mockGenerateSpeech = generateSpeech as jest.MockedFunction<typeof generateSpeech>;

function makeEvent(body: any): APIGatewayProxyEvent {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/voice/tts',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  };
}

describe('validateTTSRequest', () => {
  it('returns no errors for valid request with text only', () => {
    const errors = validateTTSRequest({ text: 'Hello world' });
    expect(errors).toEqual([]);
  });

  it('returns no errors for valid request with all optional fields', () => {
    const errors = validateTTSRequest({
      text: 'Hello world',
      language: 'en',
      voice: 'default',
      speed: 1.5,
    });
    expect(errors).toEqual([]);
  });

  it('returns error when text is missing', () => {
    const errors = validateTTSRequest({ language: 'en' });
    expect(errors).toContain('text is required and must be a non-empty string');
  });

  it('returns error when text is empty string', () => {
    const errors = validateTTSRequest({ text: '' });
    expect(errors).toContain('text is required and must be a non-empty string');
  });

  it('returns error when text is whitespace only', () => {
    const errors = validateTTSRequest({ text: '   ' });
    expect(errors).toContain('text is required and must be a non-empty string');
  });

  it('returns error for unsupported language', () => {
    const errors = validateTTSRequest({ text: 'Hello', language: 'xx' });
    expect(errors.some(e => e.includes('Unsupported language'))).toBe(true);
  });

  it('returns error when speed is below 0.5', () => {
    const errors = validateTTSRequest({ text: 'Hello', speed: 0.3 });
    expect(errors).toContain('speed must be between 0.5 and 2.0');
  });

  it('returns error when speed is above 2.0', () => {
    const errors = validateTTSRequest({ text: 'Hello', speed: 2.5 });
    expect(errors).toContain('speed must be between 0.5 and 2.0');
  });

  it('returns error when speed is not a number', () => {
    const errors = validateTTSRequest({ text: 'Hello', speed: 'fast' });
    expect(errors).toContain('speed must be a number');
  });

  it('accepts speed at boundary values 0.5 and 2.0', () => {
    expect(validateTTSRequest({ text: 'Hello', speed: 0.5 })).toEqual([]);
    expect(validateTTSRequest({ text: 'Hello', speed: 2.0 })).toEqual([]);
  });

  it('returns error for non-object body', () => {
    const errors = validateTTSRequest(null);
    expect(errors).toContain('Request body must be a valid object');
  });

  it('accepts all supported languages', () => {
    for (const lang of ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt', 'it', 'nl']) {
      const errors = validateTTSRequest({ text: 'Hello', language: lang });
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
    const event = makeEvent({ speed: 5.0 });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('returns 200 with audio file on success', async () => {
    mockGenerateSpeech.mockResolvedValue({
      url: 'https://s3.example.com/audio.mp3',
      duration: 5,
      format: 'mp3',
    });

    const event = makeEvent({ text: 'Hello world', language: 'en' });
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.url).toBe('https://s3.example.com/audio.mp3');
    expect(body.duration).toBe(5);
    expect(body.format).toBe('mp3');
  });

  it('returns 400 for VoiceProcessingError', async () => {
    mockGenerateSpeech.mockRejectedValue(
      new VoiceProcessingError('TTS generation failed'),
    );

    const event = makeEvent({ text: 'Hello world' });
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe('VOICE_PROCESSING_ERROR');
  });

  it('returns 500 for unexpected errors', async () => {
    mockGenerateSpeech.mockRejectedValue(new Error('Unexpected'));

    const event = makeEvent({ text: 'Hello world' });
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

  it('passes optional fields to generateSpeech', async () => {
    mockGenerateSpeech.mockResolvedValue({
      url: 'https://s3.example.com/audio.mp3',
      duration: 3,
      format: 'mp3',
    });

    const event = makeEvent({ text: 'Test', language: 'fr', voice: 'custom', speed: 1.5 });
    await handler(event);

    expect(mockGenerateSpeech).toHaveBeenCalledWith({
      text: 'Test',
      language: 'fr',
      voice: 'custom',
      speed: 1.5,
    });
  });
});
