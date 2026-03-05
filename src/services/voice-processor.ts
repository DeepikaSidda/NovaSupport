/**
 * Voice Processing Service for NovaSupport
 * Uses Amazon Transcribe Streaming for speech-to-text and Amazon Polly for text-to-speech.
 */

import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  AudioStream,
  LanguageCode as StreamLanguageCode,
  MediaEncoding,
} from '@aws-sdk/client-transcribe-streaming';
import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  OutputFormat,
  VoiceId,
} from '@aws-sdk/client-polly';
import { AudioFile, Transcription } from '../types/agent';
import { getFile, uploadFile, getDownloadUrl } from '../utils/s3-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('VoiceProcessor');
const transcribeStreamingClient = new TranscribeStreamingClient({});
const pollyClient = new PollyClient({});

/** Maximum audio duration: 5 minutes (300 seconds) */
export const MAX_AUDIO_DURATION_SECONDS = 300;

/** Retry configuration */
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/** Supported audio formats */
export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'webm' | 'pcm';

const SUPPORTED_AUDIO_FORMATS: AudioFormat[] = ['wav', 'mp3', 'ogg', 'webm', 'pcm'];

/** Supported languages (ISO 639-1 codes) */
export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'pt', 'it', 'nl',
] as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

/** Map ISO 639-1 codes to Transcribe Streaming language codes */
const LANGUAGE_TO_TRANSCRIBE: Record<string, StreamLanguageCode> = {
  en: StreamLanguageCode.EN_US,
  es: StreamLanguageCode.ES_US,
  fr: StreamLanguageCode.FR_FR,
  de: StreamLanguageCode.DE_DE,
  ja: StreamLanguageCode.JA_JP,
  zh: StreamLanguageCode.ZH_CN,
  ko: StreamLanguageCode.KO_KR,
  pt: StreamLanguageCode.PT_BR,
  it: StreamLanguageCode.IT_IT,
};

/** Map ISO 639-1 codes to Polly VoiceId (Neural-compatible voices only) */
const LANGUAGE_TO_POLLY_VOICE: Record<string, VoiceId> = {
  en: VoiceId.Matthew,
  es: VoiceId.Lupe,
  fr: VoiceId.Lea,
  de: VoiceId.Vicki,
  ja: VoiceId.Takumi,
  zh: VoiceId.Zhiyu,
  ko: VoiceId.Seoyeon,
  pt: VoiceId.Camila,
  it: VoiceId.Bianca,
};

/**
 * Input for speech-to-text transcription.
 */
export interface VoiceInput {
  s3Key?: string;
  audioData?: string;
  format: AudioFormat;
  language?: string;
  duration: number;
}

/**
 * Input for text-to-speech generation.
 */
export interface TTSInput {
  text: string;
  language?: string;
  voice?: string;
  speed?: number;
}

/**
 * Error thrown when voice processing fails.
 */
export class VoiceProcessingError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'VoiceProcessingError';
  }
}

// ---------------------------------------------------------------------------
// Technical Terms Dictionary
// ---------------------------------------------------------------------------

export const TECHNICAL_TERMS_DICTIONARY: Record<string, string[]> = {
  awsServices: [
    'Lambda', 'DynamoDB', 'S3', 'EC2', 'CloudWatch', 'CloudFront', 'CloudFormation',
    'SQS', 'SNS', 'API Gateway', 'Bedrock', 'SageMaker', 'ECS', 'EKS', 'Fargate',
    'IAM', 'VPC', 'Route 53', 'RDS', 'Aurora', 'ElastiCache', 'Kinesis',
    'Step Functions', 'EventBridge', 'CodePipeline', 'CodeBuild', 'CodeDeploy',
    'Cognito', 'AppSync', 'Amplify', 'Glue', 'Athena', 'Redshift',
  ],
  programming: [
    'API', 'SDK', 'REST', 'GraphQL', 'JSON', 'XML', 'YAML', 'HTML', 'CSS',
    'JavaScript', 'TypeScript', 'Python', 'Java', 'Node.js', 'React', 'Angular',
    'Vue', 'Docker', 'Kubernetes', 'Terraform', 'CDK', 'CI/CD', 'Git', 'GitHub',
    'npm', 'webpack', 'ESLint', 'JWT', 'OAuth', 'CORS', 'WebSocket', 'gRPC',
    'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Kafka',
  ],
  errorTerms: [
    'stack trace', 'null pointer', 'segfault', 'segmentation fault', 'timeout',
    'deadlock', 'race condition', 'memory leak', 'buffer overflow', 'out of memory',
    'connection refused', 'connection timeout', 'HTTP 500', 'HTTP 404', 'HTTP 403',
    'HTTP 502', 'HTTP 503', 'throttling', 'rate limit', 'access denied',
    'permission denied', 'authentication failed', 'authorization error',
    'SSL certificate', 'TLS handshake', 'DNS resolution', 'ECONNREFUSED',
    'ETIMEDOUT', 'ENOTFOUND',
  ],
};

const ALL_TECHNICAL_TERMS: string[] = Object.values(TECHNICAL_TERMS_DICTIONARY).flat();
const TECHNICAL_TERMS_LOWER = ALL_TECHNICAL_TERMS.map(t => t.toLowerCase());

// ---------------------------------------------------------------------------
// Pronunciation Guide
// ---------------------------------------------------------------------------

export const PRONUNCIATION_GUIDE: Record<string, string> = {
  'dynamodb': 'Dynamo D B',
  's3': 'S 3',
  'ec2': 'E C 2',
  'sqs': 'S Q S',
  'sns': 'S N S',
  'iam': 'I A M',
  'vpc': 'V P C',
  'rds': 'R D S',
  'eks': 'E K S',
  'ecs': 'E C S',
  'cdn': 'C D N',
  'api': 'A P I',
  'sdk': 'S D K',
  'graphql': 'Graph Q L',
  'jwt': 'J W T',
  'oauth': 'O Auth',
  'cors': 'CORS',
  'grpc': 'G R P C',
  'sql': 'S Q L',
  'nosql': 'No S Q L',
  'ci/cd': 'C I C D',
  'npm': 'N P M',
  'eslint': 'E S Lint',
  'cli': 'C L I',
  'url': 'U R L',
  'http': 'H T T P',
  'https': 'H T T P S',
  'ssl': 'S S L',
  'tls': 'T L S',
  'dns': 'D N S',
  'tcp': 'T C P',
  'udp': 'U D P',
  'ip': 'I P',
  'ssh': 'S S H',
  'cdk': 'C D K',
  'nginx': 'Engine X',
  'postgresql': 'Postgres Q L',
  'mongodb': 'Mongo D B',
  'elasticsearch': 'Elastic Search',
  'segfault': 'seg fault',
  'econnrefused': 'E CONN REFUSED',
  'etimedout': 'E TIMED OUT',
  'enotfound': 'E NOT FOUND',
};

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isSupportedAudioFormat(format: string): format is AudioFormat {
  return SUPPORTED_AUDIO_FORMATS.includes(format as AudioFormat);
}

export function isSupportedLanguage(language: string): boolean {
  return SUPPORTED_LANGUAGES.includes(language as SupportedLanguage);
}

export function isSupportedOutputLanguage(language: string): boolean {
  return SUPPORTED_LANGUAGES.includes(language as SupportedLanguage);
}

// ---------------------------------------------------------------------------
// Technical Term Detection
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}


export function detectTechnicalTerms(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  const textLower = text.toLowerCase();
  const detected: string[] = [];
  for (let i = 0; i < ALL_TECHNICAL_TERMS.length; i++) {
    const termLower = TECHNICAL_TERMS_LOWER[i];
    const termCanonical = ALL_TECHNICAL_TERMS[i];
    if (termLower.length <= 2) {
      const regex = new RegExp(`\\b${escapeRegex(termLower)}\\b`, 'i');
      if (regex.test(text)) detected.push(termCanonical);
    } else {
      if (textLower.includes(termLower)) detected.push(termCanonical);
    }
  }
  return Array.from(new Set(detected));
}

// ---------------------------------------------------------------------------
// Pronunciation Guide Builder (for Polly SSML)
// ---------------------------------------------------------------------------

export function buildPronunciationGuide(text: string): string {
  if (!text || text.trim().length === 0) return text;
  let result = text;
  const entries = Object.entries(PRONUNCIATION_GUIDE).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [term, pronunciation] of entries) {
    const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
    result = result.replace(regex, pronunciation);
  }
  return result;
}

/**
 * Transcribe audio using Amazon Transcribe Streaming API.
 * Sends PCM audio directly — no S3 upload, no polling. Near real-time results.
 */
async function invokeTranscribeSTT(
  audioBuffer: Buffer,
  format: AudioFormat,
  language?: string
): Promise<string> {
  const languageCode = language && LANGUAGE_TO_TRANSCRIBE[language]
    ? LANGUAGE_TO_TRANSCRIBE[language]
    : 'en-US';

  logger.info('Starting Transcribe Streaming STT', {
    languageCode,
    audioSizeBytes: audioBuffer.length,
    format,
  });

  // Create an async generator that yields audio chunks
  const CHUNK_SIZE = 4096;
  async function* audioStream(): AsyncGenerator<AudioStream> {
    for (let offset = 0; offset < audioBuffer.length; offset += CHUNK_SIZE) {
      const end = Math.min(offset + CHUNK_SIZE, audioBuffer.length);
      yield { AudioEvent: { AudioChunk: audioBuffer.subarray(offset, end) } };
    }
  }

  try {
    const response = await transcribeStreamingClient.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: languageCode,
        MediaEncoding: MediaEncoding.PCM,
        MediaSampleRateHertz: 16000,
        AudioStream: audioStream(),
      })
    );

    // Collect transcript from the streaming response
    let fullTranscript = '';
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent?.Transcript?.Results) {
          for (const result of event.TranscriptEvent.Transcript.Results) {
            // Only use final (non-partial) results
            if (!result.IsPartial && result.Alternatives && result.Alternatives.length > 0) {
              fullTranscript += (fullTranscript ? ' ' : '') + (result.Alternatives[0].Transcript || '');
            }
          }
        }
      }
    }

    logger.info('Transcribe Streaming STT complete', { transcribedLength: fullTranscript.length });
    return fullTranscript;
  } catch (error: any) {
    logger.error('Transcribe Streaming error', error);
    throw new VoiceProcessingError(`Transcribe Streaming API error: ${error.message}`, error);
  }
}

// ---------------------------------------------------------------------------
// Amazon Polly TTS
// ---------------------------------------------------------------------------

/**
 * Generate speech audio using Amazon Polly.
 * Uses the neural engine for higher quality when available.
 * Returns the audio as a Buffer (MP3).
 */
async function invokePollyTTS(
  text: string,
  language: string,
  voice?: string,
  speed?: number
): Promise<Buffer> {
  let lastError: Error | undefined;
  const voiceId = voice
    ? (voice as VoiceId)
    : (LANGUAGE_TO_POLLY_VOICE[language] || VoiceId.Matthew);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Build SSML with speed control if needed
      let textToSpeak: string;
      let textType: 'text' | 'ssml' = 'text';

      if (speed && speed !== 1.0) {
        const rate = Math.round(speed * 100) + '%';
        textToSpeak = `<speak><prosody rate="${rate}">${text}</prosody></speak>`;
        textType = 'ssml';
      } else {
        textToSpeak = text;
      }

      logger.debug('Calling Polly SynthesizeSpeech', {
        attempt: attempt + 1,
        voiceId,
        textLength: text.length,
        textType,
      });

      const command = new SynthesizeSpeechCommand({
        Text: textToSpeak,
        TextType: textType,
        OutputFormat: OutputFormat.MP3,
        VoiceId: voiceId,
        Engine: Engine.NEURAL,
        SampleRate: '24000',
      });

      let response;
      try {
        response = await pollyClient.send(command);
      } catch (engineError: any) {
        // Fall back to standard engine if neural is not supported for this voice
        if (engineError.name === 'InvalidParameterValueException' ||
            engineError.message?.includes('not available') ||
            engineError.message?.includes('not supported')) {
          logger.warn('Neural engine not available for voice, falling back to standard', {
            voiceId,
            error: engineError.message,
          });
          const fallbackCommand = new SynthesizeSpeechCommand({
            Text: textToSpeak,
            TextType: textType,
            OutputFormat: OutputFormat.MP3,
            VoiceId: voiceId,
            Engine: Engine.STANDARD,
            SampleRate: '22050',
          });
          response = await pollyClient.send(fallbackCommand);
        } else {
          throw engineError;
        }
      }

      if (!response.AudioStream) {
        throw new VoiceProcessingError('Polly returned empty audio stream');
      }

      // Convert the stream to a Buffer using SDK v3 helper
      const stream = response.AudioStream as any;
      let audioBuffer: Buffer;
      if (typeof stream.transformToByteArray === 'function') {
        const bytes = await stream.transformToByteArray();
        audioBuffer = Buffer.from(bytes);
      } else if (stream instanceof Uint8Array || Buffer.isBuffer(stream)) {
        audioBuffer = Buffer.from(stream);
      } else {
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        audioBuffer = Buffer.concat(chunks);
      }
      logger.info('Polly TTS complete', {
        attempt: attempt + 1,
        audioSizeBytes: audioBuffer.length,
      });
      return audioBuffer;
    } catch (error: any) {
      lastError = error;
      logger.warn('Polly TTS invocation failed', {
        attempt: attempt + 1,
        error: error.message,
      });

      const isRetryable =
        error.name === 'ThrottlingException' ||
        error.name === 'ServiceUnavailableException' ||
        error.$metadata?.httpStatusCode === 429 ||
        error.$metadata?.httpStatusCode === 500 ||
        error.$metadata?.httpStatusCode === 503;

      if (!isRetryable) {
        throw new VoiceProcessingError(`Polly TTS API error: ${error.message}`, error);
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoffMs);
      }
    }
  }

  throw new VoiceProcessingError(
    `Polly TTS unavailable after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    lastError
  );
}

// ---------------------------------------------------------------------------
// STT: Speech-to-Text Public API
// ---------------------------------------------------------------------------

export function parseTranscriptionResponse(
  responseText: string,
  requestedLanguage?: string
): Transcription {
  const text = responseText.trim();
  const language = requestedLanguage || 'en';
  const detectedTechnicalTerms = detectTechnicalTerms(text);
  let confidence = 0;
  if (text.length > 0) {
    confidence = Math.min(0.95, 0.5 + text.length / 1000);
  }
  return { text, language, confidence, detectedTechnicalTerms };
}

export function fallbackTranscription(language?: string): Transcription {
  return { text: '', language: language || 'en', confidence: 0, detectedTechnicalTerms: [] };
}

/**
 * Transcribe speech to text using Amazon Transcribe.
 */
export async function transcribeSpeech(input: VoiceInput): Promise<Transcription> {
  logger.info('Starting speech-to-text transcription', {
    hasS3Key: !!input.s3Key,
    hasAudioData: !!input.audioData,
    format: input.format,
    language: input.language || 'auto-detect',
    duration: input.duration,
  });

  if (!isSupportedAudioFormat(input.format)) {
    throw new VoiceProcessingError(`Unsupported audio format: ${input.format}`);
  }
  if (input.duration <= 0) {
    throw new VoiceProcessingError('Audio duration must be greater than 0');
  }
  if (input.duration > MAX_AUDIO_DURATION_SECONDS) {
    throw new VoiceProcessingError(
      `Audio exceeds maximum duration of ${MAX_AUDIO_DURATION_SECONDS} seconds (${input.duration}s provided)`
    );
  }
  if (input.language && !isSupportedLanguage(input.language)) {
    throw new VoiceProcessingError(
      `Unsupported language: ${input.language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
    );
  }

  let audioBuffer: Buffer;
  if (input.audioData) {
    audioBuffer = Buffer.from(input.audioData, 'base64');
  } else if (input.s3Key) {
    try {
      audioBuffer = await getFile(input.s3Key);
    } catch (error: any) {
      throw new VoiceProcessingError(`Failed to fetch audio from S3: ${error.message}`, error);
    }
  } else {
    throw new VoiceProcessingError('Either s3Key or audioData must be provided');
  }

  try {
    const responseText = await invokeTranscribeSTT(audioBuffer, input.format, input.language);
    const transcription = parseTranscriptionResponse(responseText, input.language);
    logger.info('Speech-to-text transcription complete', {
      textLength: transcription.text.length,
      language: transcription.language,
      confidence: transcription.confidence,
      technicalTermCount: transcription.detectedTechnicalTerms.length,
    });
    return transcription;
  } catch (error) {
    if (error instanceof VoiceProcessingError) {
      logger.warn('Transcribe STT unavailable, returning fallback', { error: error.message });
      return fallbackTranscription(input.language);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Ticket Creation from Voice
// ---------------------------------------------------------------------------

export function createTicketFromVoice(
  transcription: Transcription,
  userId: string
): { ticketId: string; description: string } {
  if (!transcription.text || transcription.text.trim().length === 0) {
    throw new VoiceProcessingError('Cannot create ticket from empty transcription');
  }
  if (!userId || userId.trim().length === 0) {
    throw new VoiceProcessingError('userId is required to create a ticket');
  }

  const ticketId = `VOICE-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const descriptionParts: string[] = [`[Voice Ticket] ${transcription.text}`];
  if (transcription.detectedTechnicalTerms.length > 0) {
    descriptionParts.push(`\nDetected Technical Terms: ${transcription.detectedTechnicalTerms.join(', ')}`);
  }
  descriptionParts.push(`\nLanguage: ${transcription.language}`);
  descriptionParts.push(`Transcription Confidence: ${(transcription.confidence * 100).toFixed(0)}%`);

  return { ticketId, description: descriptionParts.join('') };
}

// ---------------------------------------------------------------------------
// TTS: Text-to-Speech Public API
// ---------------------------------------------------------------------------

export function fallbackAudioFile(): AudioFile {
  return { url: '', duration: 0, format: 'mp3' };
}

export function estimateAudioDuration(text: string): number {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const wordsPerSecond = 150 / 60;
  return Math.max(1, Math.ceil(wordCount / wordsPerSecond));
}

/**
 * Convert text to speech using Amazon Polly.
 * Applies pronunciation corrections, generates audio, uploads to S3,
 * and returns an AudioFile with a playback URL.
 */
export async function generateSpeech(input: TTSInput): Promise<AudioFile> {
  const language = input.language || 'en';
  const speed = input.speed !== undefined ? input.speed : 1.0;

  logger.info('Starting text-to-speech generation', {
    textLength: input.text.length,
    language,
    voice: input.voice || 'default',
    speed,
  });

  if (!input.text || input.text.trim().length === 0) {
    throw new VoiceProcessingError('Text input is required for TTS generation');
  }
  if (!isSupportedOutputLanguage(language)) {
    throw new VoiceProcessingError(
      `Unsupported output language: ${language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
    );
  }
  if (speed < 0.5 || speed > 2.0) {
    throw new VoiceProcessingError(`Speed must be between 0.5 and 2.0 (got ${speed})`);
  }

  // Apply pronunciation guide for technical terms
  const pronounceableText = buildPronunciationGuide(input.text);

  try {
    const audioBuffer = await invokePollyTTS(pronounceableText, language, input.voice, speed);

    if (!audioBuffer || audioBuffer.length === 0) {
      logger.warn('Polly TTS returned empty audio, using fallback');
      return fallbackAudioFile();
    }

    // Upload audio to S3 for playback
    const s3Key = `voice-responses/${Date.now()}-${Math.random().toString(36).substring(2, 9)}.mp3`;
    await uploadFile(s3Key, audioBuffer, 'audio/mpeg');
    const url = await getDownloadUrl(s3Key);
    const duration = estimateAudioDuration(input.text);

    logger.info('Text-to-speech generation complete', {
      s3Key,
      duration,
      audioSizeBytes: audioBuffer.length,
      language,
    });

    return { url, duration, format: 'mp3' };
  } catch (error) {
    if (error instanceof VoiceProcessingError) {
      logger.warn('Polly TTS unavailable, returning fallback audio', { error: error.message });
      return fallbackAudioFile();
    }
    throw error;
  }
}
