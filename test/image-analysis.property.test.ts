/**
 * Property-based tests for Image Analysis Service
 * Property 9: Image Analysis Extraction
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 *
 * For any image attachment, when analyzed by the Multimodal Analyzer,
 * the analysis result should include extracted text (if text is present),
 * detected UI elements, and identified error messages (if present).
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import {
  parseAnalysisResponse,
  fallbackAnalysis,
  buildAnalysisSummary,
  detectImageFormat,
  isSupportedFormat,
} from '../src/services/image-analyzer';
import { ImageAnalysis } from '../src/types/agent';

jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// --- Arbitraries ---

/** Generate a valid ImageAnalysis object */
const imageAnalysisArb: fc.Arbitrary<ImageAnalysis> = fc.record({
  extractedText: fc.string({ minLength: 0, maxLength: 200 }),
  detectedErrors: fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 10 }),
  detectedApplication: fc.string({ minLength: 1, maxLength: 50 }),
  uiElements: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 10 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

/** Generate a valid JSON response string that Nova might return */
const validJsonResponseArb: fc.Arbitrary<string> = fc.record({
  extractedText: fc.string({ minLength: 0, maxLength: 200 }),
  detectedErrors: fc.array(fc.string({ minLength: 1, maxLength: 80 }), { maxLength: 5 }),
  detectedApplication: fc.string({ minLength: 1, maxLength: 50 }),
  uiElements: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
  confidence: fc.double({ min: -2, max: 3, noNaN: true }),
}).map(obj => JSON.stringify(obj));

/** Generate a JSON response wrapped in markdown code blocks */
const markdownWrappedJsonArb: fc.Arbitrary<string> = validJsonResponseArb.map(
  json => `\`\`\`json\n${json}\n\`\`\``
);

/** Generate any arbitrary string (including non-JSON) */
const arbitraryResponseArb: fc.Arbitrary<string> = fc.oneof(
  validJsonResponseArb,
  markdownWrappedJsonArb,
  fc.string({ minLength: 0, maxLength: 500 }),
);

/** Generate supported image file names */
const supportedFileNameArb: fc.Arbitrary<string> = fc.tuple(
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  fc.constantFrom('.png', '.jpg', '.jpeg', '.gif', '.PNG', '.JPG', '.JPEG', '.GIF'),
).map(([name, ext]) => name + ext);

// --- Property Tests ---

describe('Property-Based Tests: Image Analysis', () => {
  /**
   * Property 9: Image Analysis Extraction
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   */
  describe('Property 9: Image Analysis Extraction', () => {
    test('parseAnalysisResponse always returns a valid ImageAnalysis with all required fields', () => {
      fc.assert(
        fc.property(arbitraryResponseArb, (responseText) => {
          const result = parseAnalysisResponse(responseText);

          // extractedText is always a string
          expect(typeof result.extractedText).toBe('string');

          // detectedErrors is always an array of strings
          expect(Array.isArray(result.detectedErrors)).toBe(true);
          result.detectedErrors.forEach(e => expect(typeof e).toBe('string'));

          // detectedApplication is always a string
          expect(typeof result.detectedApplication).toBe('string');

          // uiElements is always an array of strings
          expect(Array.isArray(result.uiElements)).toBe(true);
          result.uiElements.forEach(e => expect(typeof e).toBe('string'));

          // confidence is always a number in [0, 1]
          expect(typeof result.confidence).toBe('number');
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
        }),
        { numRuns: 100 }
      );
    });

    test('parseAnalysisResponse clamps confidence to [0, 1] for any numeric input', () => {
      fc.assert(
        fc.property(validJsonResponseArb, (responseText) => {
          const result = parseAnalysisResponse(responseText);

          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(1);
        }),
        { numRuns: 100 }
      );
    });

    test('parseAnalysisResponse filters non-string values from detectedErrors and uiElements', () => {
      const mixedArrayResponseArb = fc.record({
        extractedText: fc.string(),
        detectedErrors: fc.array(fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer(),
          fc.constant(null),
        ), { maxLength: 10 }),
        detectedApplication: fc.string(),
        uiElements: fc.array(fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer(),
          fc.constant(null),
        ), { maxLength: 10 }),
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      }).map(obj => JSON.stringify(obj));

      fc.assert(
        fc.property(mixedArrayResponseArb, (responseText) => {
          const result = parseAnalysisResponse(responseText);

          // All items in arrays must be strings after filtering
          result.detectedErrors.forEach(e => expect(typeof e).toBe('string'));
          result.uiElements.forEach(e => expect(typeof e).toBe('string'));
        }),
        { numRuns: 100 }
      );
    });

    test('fallbackAnalysis returns valid structure with confidence 0', () => {
      // Run this as a property that holds for every invocation
      fc.assert(
        fc.property(fc.constant(null), () => {
          const result = fallbackAnalysis();

          expect(typeof result.extractedText).toBe('string');
          expect(result.extractedText).toBe('');
          expect(Array.isArray(result.detectedErrors)).toBe(true);
          expect(result.detectedErrors).toEqual([]);
          expect(typeof result.detectedApplication).toBe('string');
          expect(Array.isArray(result.uiElements)).toBe(true);
          expect(result.uiElements).toEqual([]);
          expect(result.confidence).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    test('buildAnalysisSummary always produces a non-empty string for any valid ImageAnalysis', () => {
      fc.assert(
        fc.property(imageAnalysisArb, (analysis) => {
          const summary = buildAnalysisSummary(analysis);

          expect(typeof summary).toBe('string');
          expect(summary.length).toBeGreaterThan(0);
          // Should always contain the header
          expect(summary).toContain('--- Image Analysis ---');
          // Should always contain confidence
          expect(summary).toContain('Analysis Confidence:');
        }),
        { numRuns: 100 }
      );
    });

    test('detectImageFormat returns a supported format or null for any filename', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (fileName) => {
            const result = detectImageFormat(fileName);
            if (result !== null) {
              expect(['png', 'jpeg', 'gif']).toContain(result);
              expect(isSupportedFormat(result)).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('detectImageFormat correctly identifies supported extensions', () => {
      fc.assert(
        fc.property(supportedFileNameArb, (fileName) => {
          const result = detectImageFormat(fileName);
          expect(result).not.toBeNull();
          expect(isSupportedFormat(result!)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    test('isSupportedFormat returns boolean for any string input', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 20 }), (format) => {
          const result = isSupportedFormat(format);
          expect(typeof result).toBe('boolean');
        }),
        { numRuns: 100 }
      );
    });
  });
});
