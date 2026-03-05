/**
 * Property-based tests for Document Analysis Service
 * Property 10: Document Parsing Completeness
 *
 * **Validates: Requirements 6.2, 6.4**
 *
 * For any document attachment (PDF, TXT, LOG), when analyzed, the analysis result
 * should include extracted text, identified error patterns, and a structured summary.
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import {
  extractText,
  extractErrorPatterns,
  extractStackTraces,
  extractTimestamps,
  parseSummaryResponse,
  generateFallbackSummary,
  detectDocumentFormat,
  isSupportedDocumentFormat,
} from '../src/services/document-analyzer';

jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// --- Arbitraries ---

const documentFormatArb = fc.constantFrom<'pdf' | 'txt' | 'log'>('pdf', 'txt', 'log');

/** Generate text content (string) for txt/log formats */
const textContentArb = fc.string({ minLength: 0, maxLength: 500 });

/** Generate a valid JSON summary response string */
const validSummaryJsonArb: fc.Arbitrary<string> = fc.record({
  summary: fc.string({ minLength: 0, maxLength: 200 }),
  keyTechnicalDetails: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
    fc.oneof(fc.string({ minLength: 0, maxLength: 50 }), fc.integer().map(String), fc.constant('true')),
    { minKeys: 0, maxKeys: 5 },
  ),
}).map(obj => JSON.stringify(obj));

/** Generate markdown-wrapped JSON */
const markdownWrappedSummaryArb: fc.Arbitrary<string> = validSummaryJsonArb.map(
  json => `\`\`\`json\n${json}\n\`\`\``
);

/** Generate any response text (valid JSON, markdown-wrapped, or arbitrary) */
const anySummaryResponseArb: fc.Arbitrary<string> = fc.oneof(
  validSummaryJsonArb,
  markdownWrappedSummaryArb,
  fc.string({ minLength: 0, maxLength: 500 }),
);

/** Generate text with embedded error patterns */
const textWithErrorsArb: fc.Arbitrary<string> = fc.tuple(
  fc.array(
    fc.constantFrom(
      'ERROR: something went wrong',
      'FATAL: out of memory',
      'CRITICAL: disk full',
      'NullPointerException: null reference',
      'WARNING: low disk space',
      'FAILED: build step 3',
      'PANIC: kernel error',
    ),
    { minLength: 1, maxLength: 5 }
  ),
  fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
).map(([errors, normals]) => [...errors, ...normals].join('\n'));

/** Generate text with embedded stack traces */
const textWithStackTracesArb: fc.Arbitrary<string> = fc.tuple(
  fc.array(
    fc.constantFrom(
      '  at com.example.MyClass.method(MyClass.java:42)',
      '  at org.test.Runner.run(Runner.java:10)',
      '  File "app.py", line 10',
      'Traceback (most recent call last)',
      'Caused by: java.io.IOException: Connection reset',
    ),
    { minLength: 1, maxLength: 5 }
  ),
  fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 3 }),
).map(([traces, normals]) => [...traces, ...normals].join('\n'));

/** Generate text with embedded ISO timestamps */
const textWithTimestampsArb: fc.Arbitrary<string> = fc.tuple(
  fc.array(
    fc.date({
      min: new Date('2020-01-01T00:00:00Z'),
      max: new Date('2025-12-31T23:59:59Z'),
    }).map(d => `${d.toISOString()} Some event happened`),
    { minLength: 1, maxLength: 5 }
  ),
).map(([lines]) => lines.join('\n'));

/** Generate supported document file names */
const supportedDocFileNameArb: fc.Arbitrary<string> = fc.tuple(
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  fc.constantFrom('.pdf', '.txt', '.log', '.PDF', '.TXT', '.LOG'),
).map(([name, ext]) => name + ext);

// --- Property Tests ---

describe('Property-Based Tests: Document Analysis', () => {
  /**
   * Property 10: Document Parsing Completeness
   * **Validates: Requirements 6.2, 6.4**
   */
  describe('Property 10: Document Parsing Completeness', () => {
    test('extractText always returns a string for any input', () => {
      fc.assert(
        fc.property(
          textContentArb,
          fc.constantFrom<'txt' | 'log'>('txt', 'log'),
          (content, format) => {
            const result = extractText(content, format);
            expect(typeof result).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('extractText returns a string for Buffer input', () => {
      fc.assert(
        fc.property(
          textContentArb.map(s => Buffer.from(s)),
          fc.constantFrom<'txt' | 'log'>('txt', 'log'),
          (buffer, format) => {
            const result = extractText(buffer, format);
            expect(typeof result).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('extractText returns a string for PDF format', () => {
      fc.assert(
        fc.property(
          textContentArb.map(s => Buffer.from(s)),
          (buffer) => {
            const result = extractText(buffer, 'pdf');
            expect(typeof result).toBe('string');
          }
        ),
        { numRuns: 100 }
      );
    });

    test('extractErrorPatterns always returns an array of strings', () => {
      fc.assert(
        fc.property(textContentArb, (text) => {
          const result = extractErrorPatterns(text);
          expect(Array.isArray(result)).toBe(true);
          result.forEach(e => expect(typeof e).toBe('string'));
        }),
        { numRuns: 100 }
      );
    });

    test('extractErrorPatterns finds errors in text containing error patterns', () => {
      fc.assert(
        fc.property(textWithErrorsArb, (text) => {
          const result = extractErrorPatterns(text);
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThan(0);
          result.forEach(e => expect(typeof e).toBe('string'));
        }),
        { numRuns: 100 }
      );
    });

    test('extractStackTraces always returns an array of strings', () => {
      fc.assert(
        fc.property(textContentArb, (text) => {
          const result = extractStackTraces(text);
          expect(Array.isArray(result)).toBe(true);
          result.forEach(e => expect(typeof e).toBe('string'));
        }),
        { numRuns: 100 }
      );
    });

    test('extractStackTraces finds traces in text containing stack trace patterns', () => {
      fc.assert(
        fc.property(textWithStackTracesArb, (text) => {
          const result = extractStackTraces(text);
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThan(0);
          result.forEach(e => expect(typeof e).toBe('string'));
        }),
        { numRuns: 100 }
      );
    });

    test('extractTimestamps always returns an array of Dates sorted chronologically', () => {
      fc.assert(
        fc.property(textContentArb, (text) => {
          const result = extractTimestamps(text);
          expect(Array.isArray(result)).toBe(true);
          result.forEach(d => expect(d).toBeInstanceOf(Date));

          // Verify sorted chronologically
          for (let i = 1; i < result.length; i++) {
            expect(result[i].getTime()).toBeGreaterThanOrEqual(result[i - 1].getTime());
          }
        }),
        { numRuns: 100 }
      );
    });

    test('extractTimestamps finds timestamps and returns them sorted', () => {
      fc.assert(
        fc.property(textWithTimestampsArb, (text) => {
          const result = extractTimestamps(text);
          expect(Array.isArray(result)).toBe(true);
          expect(result.length).toBeGreaterThan(0);
          result.forEach(d => expect(d).toBeInstanceOf(Date));

          // Verify sorted chronologically
          for (let i = 1; i < result.length; i++) {
            expect(result[i].getTime()).toBeGreaterThanOrEqual(result[i - 1].getTime());
          }
        }),
        { numRuns: 100 }
      );
    });

    test('parseSummaryResponse always returns {summary: string, keyTechnicalDetails: Record<string, string>}', () => {
      fc.assert(
        fc.property(anySummaryResponseArb, (responseText) => {
          const result = parseSummaryResponse(responseText);

          expect(typeof result.summary).toBe('string');
          expect(typeof result.keyTechnicalDetails).toBe('object');
          expect(result.keyTechnicalDetails).not.toBeNull();

          // All values in keyTechnicalDetails must be strings
          for (const [key, value] of Object.entries(result.keyTechnicalDetails)) {
            expect(typeof key).toBe('string');
            expect(typeof value).toBe('string');
          }
        }),
        { numRuns: 100 }
      );
    });

    test('generateFallbackSummary always returns a non-empty summary', () => {
      fc.assert(
        fc.property(
          textContentArb,
          fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
          fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
          fc.array(
            fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
            { maxLength: 5 }
          ),
          (text, errors, traces, timestamps) => {
            // Sort timestamps as the function expects
            const sortedTimestamps = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
            const result = generateFallbackSummary(text, errors, traces, sortedTimestamps);

            expect(typeof result.summary).toBe('string');
            expect(result.summary.length).toBeGreaterThan(0);
            expect(typeof result.keyTechnicalDetails).toBe('object');
            expect(result.keyTechnicalDetails).not.toBeNull();

            // All values must be strings
            for (const value of Object.values(result.keyTechnicalDetails)) {
              expect(typeof value).toBe('string');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('detectDocumentFormat returns a supported format or null for any filename', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (fileName) => {
            const result = detectDocumentFormat(fileName);
            if (result !== null) {
              expect(['pdf', 'txt', 'log']).toContain(result);
              expect(isSupportedDocumentFormat(result)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('detectDocumentFormat correctly identifies supported extensions', () => {
      fc.assert(
        fc.property(supportedDocFileNameArb, (fileName) => {
          const result = detectDocumentFormat(fileName);
          expect(result).not.toBeNull();
          expect(isSupportedDocumentFormat(result!)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test('isSupportedDocumentFormat returns boolean for any string input', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 20 }), (format) => {
          const result = isSupportedDocumentFormat(format);
          expect(typeof result).toBe('boolean');
        }),
        { numRuns: 100 }
      );
    });
  });
});
