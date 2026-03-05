/**
 * Property-based tests for Voice Processing Service
 * Properties 26, 27, 28, 29
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import {
  createTicketFromVoice,
  detectTechnicalTerms,
  estimateAudioDuration,
  buildPronunciationGuide,
  parseTranscriptionResponse,
  TECHNICAL_TERMS_DICTIONARY,
  PRONUNCIATION_GUIDE,
} from '../src/services/voice-processor';
import { Transcription } from '../src/types/agent';

jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// --- Arbitraries ---

const allTechnicalTerms: string[] = Object.values(TECHNICAL_TERMS_DICTIONARY).flat();
const pronunciationTerms: string[] = Object.keys(PRONUNCIATION_GUIDE);

/** Generate a non-empty, non-whitespace string */
const nonEmptyTextArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 200 })
  .filter(s => s.trim().length > 0);

/** Generate a valid userId */
const userIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

/** Generate a valid Transcription with non-empty text */
const transcriptionArb: fc.Arbitrary<Transcription> = fc.record({
  text: nonEmptyTextArb,
  language: fc.constantFrom('en', 'es', 'fr', 'de', 'ja'),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  detectedTechnicalTerms: fc.array(fc.constantFrom(...allTechnicalTerms.slice(0, 20)), { maxLength: 5 }),
});

/** Generate a known technical term from the dictionary */
const technicalTermArb: fc.Arbitrary<string> = fc.constantFrom(...allTechnicalTerms);

/** Generate a known pronunciation term */
const pronunciationTermArb: fc.Arbitrary<string> = fc.constantFrom(...pronunciationTerms);

/** Generate text that contains a specific technical term */
function textWithTermArb(termArb: fc.Arbitrary<string>): fc.Arbitrary<{ text: string; term: string }> {
  return fc.tuple(
    fc.string({ minLength: 0, maxLength: 50 }),
    termArb,
    fc.string({ minLength: 0, maxLength: 50 }),
  ).map(([prefix, term, suffix]) => ({
    text: `${prefix} ${term} ${suffix}`,
    term,
  }));
}

/** Generate text guaranteed to NOT contain any technical terms */
const noTechTermTextArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', ' ', '.', ',', '!'),
  { minLength: 1, maxLength: 100 },
).filter(s => {
  const lower = s.toLowerCase();
  return !allTechnicalTerms.some(t => lower.includes(t.toLowerCase()));
});

/** Generate text with multiple words for duration testing */
const multiWordTextArb: fc.Arbitrary<string> = fc.array(
  fc.string({ minLength: 1, maxLength: 15 }).filter(s => /\S/.test(s)),
  { minLength: 1, maxLength: 100 },
).map(words => words.join(' '));

// --- Property Tests ---

describe('Property-Based Tests: Voice Processing', () => {
  /**
   * Property 26: Voice Transcription to Ticket Creation
   * **Validates: Requirements 12.1, 12.3**
   *
   * For any voice input, when transcribed by the Voice Processor,
   * a ticket should be created with the transcription as the description.
   */
  describe('Property 26: Voice Transcription to Ticket Creation', () => {
    test('createTicketFromVoice returns a ticket with non-empty ticketId starting with VOICE-', () => {
      fc.assert(
        fc.property(transcriptionArb, userIdArb, (transcription, userId) => {
          const result = createTicketFromVoice(transcription, userId);

          expect(result.ticketId).toBeDefined();
          expect(result.ticketId.length).toBeGreaterThan(0);
          expect(result.ticketId.startsWith('VOICE-')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test('createTicketFromVoice description contains [Voice Ticket] prefix', () => {
      fc.assert(
        fc.property(transcriptionArb, userIdArb, (transcription, userId) => {
          const result = createTicketFromVoice(transcription, userId);

          expect(result.description).toContain('[Voice Ticket]');
        }),
        { numRuns: 100 }
      );
    });

    test('createTicketFromVoice description contains the transcription text', () => {
      fc.assert(
        fc.property(transcriptionArb, userIdArb, (transcription, userId) => {
          const result = createTicketFromVoice(transcription, userId);

          expect(result.description).toContain(transcription.text);
        }),
        { numRuns: 100 }
      );
    });

    test('createTicketFromVoice description includes language and confidence metadata', () => {
      fc.assert(
        fc.property(transcriptionArb, userIdArb, (transcription, userId) => {
          const result = createTicketFromVoice(transcription, userId);

          expect(result.description).toContain(`Language: ${transcription.language}`);
          expect(result.description).toContain('Transcription Confidence:');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 27: Technical Term Transcription Accuracy
   * **Validates: Requirements 12.4**
   *
   * For any voice input containing known technical terms from the domain vocabulary,
   * the transcription should correctly identify those terms.
   */
  describe('Property 27: Technical Term Transcription Accuracy', () => {
    test('detectTechnicalTerms finds a known term when present in text', () => {
      fc.assert(
        fc.property(textWithTermArb(technicalTermArb), ({ text, term }) => {
          const detected = detectTechnicalTerms(text);

          // The canonical form of the term should be in the results
          expect(detected).toContain(term);
        }),
        { numRuns: 100 }
      );
    });

    test('detectTechnicalTerms returns empty array for text without technical terms', () => {
      fc.assert(
        fc.property(noTechTermTextArb, (text) => {
          const detected = detectTechnicalTerms(text);

          expect(detected).toEqual([]);
        }),
        { numRuns: 100 }
      );
    });

    test('parseTranscriptionResponse populates detectedTechnicalTerms correctly', () => {
      fc.assert(
        fc.property(textWithTermArb(technicalTermArb), ({ text, term }) => {
          const transcription = parseTranscriptionResponse(text);

          expect(transcription.detectedTechnicalTerms).toContain(term);
        }),
        { numRuns: 100 }
      );
    });

    test('detectTechnicalTerms returns deduplicated results', () => {
      fc.assert(
        fc.property(textWithTermArb(technicalTermArb), ({ text }) => {
          const detected = detectTechnicalTerms(text);
          const unique = new Set(detected);

          expect(detected.length).toBe(unique.size);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 28: Text-to-Speech Generation
   * **Validates: Requirements 13.1**
   *
   * For any generated response text, when converted to speech,
   * an audio file should be produced and made available for playback.
   */
  describe('Property 28: Text-to-Speech Generation', () => {
    test('estimateAudioDuration returns a positive number >= 1 for any non-empty text', () => {
      fc.assert(
        fc.property(nonEmptyTextArb, (text) => {
          const duration = estimateAudioDuration(text);

          expect(duration).toBeGreaterThanOrEqual(1);
          expect(Number.isFinite(duration)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test('estimateAudioDuration increases with text length (more words = longer duration)', () => {
      fc.assert(
        fc.property(
          multiWordTextArb,
          multiWordTextArb,
          (shortText, extraText) => {
            const longText = `${shortText} ${extraText}`;
            const shortDuration = estimateAudioDuration(shortText);
            const longDuration = estimateAudioDuration(longText);

            expect(longDuration).toBeGreaterThanOrEqual(shortDuration);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('estimateAudioDuration returns an integer (ceiling of calculation)', () => {
      fc.assert(
        fc.property(multiWordTextArb, (text) => {
          const duration = estimateAudioDuration(text);

          expect(Number.isInteger(duration)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 29: Technical Term Pronunciation
   * **Validates: Requirements 13.3**
   *
   * For any response containing known technical terms, the generated audio
   * should pronounce those terms according to domain-specific pronunciation rules.
   */
  describe('Property 29: Technical Term Pronunciation', () => {
    test('buildPronunciationGuide replaces known terms with their pronunciation', () => {
      fc.assert(
        fc.property(pronunciationTermArb, (term) => {
          const text = `Please check the ${term} configuration`;
          const result = buildPronunciationGuide(text);
          const expectedPronunciation = PRONUNCIATION_GUIDE[term];

          expect(result).toContain(expectedPronunciation);
        }),
        { numRuns: 100 }
      );
    });

    test('buildPronunciationGuide returns text unchanged when no technical terms present', () => {
      // Use simple text that won't match any pronunciation guide entries
      const safePlainTextArb = fc.constantFrom(
        'Hello world',
        'This is a test message',
        'Please help me with my issue',
        'Thank you for your support',
        'The weather is nice today',
        'I need assistance with my account',
        'Can you help me please',
        'Good morning everyone',
      );

      fc.assert(
        fc.property(safePlainTextArb, (text) => {
          const result = buildPronunciationGuide(text);

          expect(result).toBe(text);
        }),
        { numRuns: 100 }
      );
    });

    test('buildPronunciationGuide output should not contain the original technical term (case-insensitive)', () => {
      // Filter to terms whose pronunciation is different from the original
      const replacedTerms = pronunciationTerms.filter(
        t => PRONUNCIATION_GUIDE[t].toLowerCase() !== t.toLowerCase()
      );

      if (replacedTerms.length === 0) return; // skip if no such terms

      const replacedTermArb = fc.constantFrom(...replacedTerms);

      fc.assert(
        fc.property(replacedTermArb, (term) => {
          // Construct text with the term surrounded by word boundaries
          const text = `Check the ${term} service`;
          const result = buildPronunciationGuide(text);

          // The original term should be replaced - check case-insensitively
          // Use a word-boundary regex to verify the original term is gone
          const termRegex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}\\b`, 'i');
          expect(termRegex.test(result)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });
});
