/**
 * Property-based tests for Knowledge Base Section Extraction
 * Tests task 5.6: Write property test for section extraction
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 * Property 15: Knowledge Base Section Extraction
 * **Validates: Requirements 8.3**
 */

import * as fc from 'fast-check';
import { extractRelevantSections } from '../src/services/knowledge-base';

describe('Property-Based Tests: Knowledge Base Section Extraction', () => {
  /**
   * Generator for non-empty paragraph text (no double newlines or markdown headers inside).
   * Produces a single "paragraph" of printable text.
   */
  const paragraphArb = fc
    .stringOf(
      fc.oneof(
        fc.constant('a'),
        fc.constant('b'),
        fc.constant('c'),
        fc.constant(' '),
        fc.constant('.'),
        fc.constant('1'),
        fc.constant('X')
      ),
      { minLength: 1, maxLength: 60 }
    )
    .filter((s) => s.trim().length > 0);

  /**
   * Generator for multi-paragraph content separated by double newlines.
   * Produces content with at least 2 paragraphs so the function must split.
   */
  const multiParagraphContentArb = fc
    .array(paragraphArb, { minLength: 2, maxLength: 8 })
    .map((paragraphs) => paragraphs.join('\n\n'));

  /**
   * Generator for multi-section content using markdown headers as separators.
   */
  const markdownSectionContentArb = fc
    .array(paragraphArb, { minLength: 2, maxLength: 6 })
    .map((sections) =>
      sections.map((s, i) => (i === 0 ? s : `## Section ${i}\n${s}`)).join('\n')
    );

  /**
   * Property 15: Knowledge Base Section Extraction
   * **Validates: Requirements 8.3**
   *
   * For any non-empty article content with multiple paragraphs,
   * each returned section should be a substring of the original content (after trimming),
   * and the content should actually be split into multiple parts (not returned as one blob).
   */
  test('Property 15a: Each extracted section is a trimmed substring of the original content', () => {
    fc.assert(
      fc.property(multiParagraphContentArb, (content) => {
        const sections = extractRelevantSections(content);

        // Each section must be a substring of the original content
        for (const section of sections) {
          expect(content).toContain(section);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * For multi-paragraph content, the function should return multiple sections,
   * not the entire article as a single string.
   */
  test('Property 15b: Multi-paragraph content is split into multiple sections (not entire document)', () => {
    fc.assert(
      fc.property(multiParagraphContentArb, (content) => {
        const sections = extractRelevantSections(content);

        // Must have more than one section for multi-paragraph content
        expect(sections.length).toBeGreaterThan(1);

        // No single section should equal the entire original content
        for (const section of sections) {
          expect(section).not.toEqual(content.trim());
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Joining all extracted sections should reconstruct the meaningful text
   * content of the original — no text is lost.
   */
  test('Property 15c: All meaningful text from the original is preserved across sections', () => {
    fc.assert(
      fc.property(multiParagraphContentArb, (content) => {
        const sections = extractRelevantSections(content);
        const joined = sections.join(' ');

        // Every non-empty trimmed paragraph from the original should appear in some section
        const originalParagraphs = content
          .split(/\n\n+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const para of originalParagraphs) {
          const found = sections.some((sec) => sec.includes(para));
          expect(found).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Empty or whitespace-only content should return an empty array.
   */
  test('Property 15d: Empty or whitespace-only content returns empty array', () => {
    const whitespaceArb = fc.oneof(
      fc.constant(''),
      fc.constant('   '),
      fc.constant('\n\n'),
      fc.constant('\t  \n  '),
      fc.stringOf(fc.oneof(fc.constant(' '), fc.constant('\n'), fc.constant('\t')))
    );

    fc.assert(
      fc.property(whitespaceArb, (content) => {
        const sections = extractRelevantSections(content);
        expect(sections).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.3**
   *
   * Markdown header-separated content should also be split into sections.
   */
  test('Property 15e: Markdown header content is split into sections', () => {
    fc.assert(
      fc.property(markdownSectionContentArb, (content) => {
        const sections = extractRelevantSections(content);

        // Should produce multiple sections
        expect(sections.length).toBeGreaterThan(1);

        // Each section is a substring of the original
        for (const section of sections) {
          expect(content).toContain(section);
        }
      }),
      { numRuns: 100 }
    );
  });
});
