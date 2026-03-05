/**
 * Property-based tests for Video Analysis Service
 * Property 11: Video Frame Extraction Rate
 *
 * **Validates: Requirements 7.1**
 *
 * For any video attachment with duration D seconds, when analyzed,
 * the number of extracted key frames should equal D (one frame per second).
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import { extractKeyFrames, generateTimeline } from '../src/services/video-analyzer';
import { ImageAnalysis } from '../src/types/agent';

jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Property-Based Tests: Video Analysis', () => {
  /**
   * Property 11: Video Frame Extraction Rate
   * **Validates: Requirements 7.1**
   */
  describe('Property 11: Video Frame Extraction Rate', () => {
    test('extractKeyFrames returns exactly Math.floor(D) frames for any duration D >= 1', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.integer({ min: 1, max: 300 }),
          (videoData, duration) => {
            const frames = extractKeyFrames(videoData, duration);
            expect(frames.length).toBe(Math.floor(duration));
          }
        ),
        { numRuns: 100 }
      );
    });

    test('each frame has a unique timestamp from 0 to D-1', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.integer({ min: 1, max: 300 }),
          (videoData, duration) => {
            const frames = extractKeyFrames(videoData, duration);
            const timestamps = frames.map(f => f.timestamp);
            const uniqueTimestamps = new Set(timestamps);

            // All timestamps are unique
            expect(uniqueTimestamps.size).toBe(frames.length);

            // Each timestamp is in range [0, D-1]
            for (const ts of timestamps) {
              expect(ts).toBeGreaterThanOrEqual(0);
              expect(ts).toBeLessThanOrEqual(duration - 1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('timestamps are sequential integers starting from 0', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.integer({ min: 1, max: 300 }),
          (videoData, duration) => {
            const frames = extractKeyFrames(videoData, duration);

            for (let i = 0; i < frames.length; i++) {
              expect(frames[i].timestamp).toBe(i);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('each frame has non-empty frameData string', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.integer({ min: 1, max: 300 }),
          (videoData, duration) => {
            const frames = extractKeyFrames(videoData, duration);

            for (const frame of frames) {
              expect(typeof frame.frameData).toBe('string');
              expect(frame.frameData.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('extractKeyFrames works with Buffer input', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).map(s => Buffer.from(s)),
          fc.integer({ min: 1, max: 300 }),
          (videoBuffer, duration) => {
            const frames = extractKeyFrames(videoBuffer, duration);
            expect(frames.length).toBe(Math.floor(duration));

            for (let i = 0; i < frames.length; i++) {
              expect(frames[i].timestamp).toBe(i);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('extractKeyFrames returns empty array for duration <= 0', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          fc.integer({ min: -100, max: 0 }),
          (videoData, duration) => {
            const frames = extractKeyFrames(videoData, duration);
            expect(frames.length).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// --- Append below: keep inside the outer describe if re-opened, or add a
//     second top-level describe that groups with the first one. ---

/**
 * Property-based tests for Video Analysis Service
 * Property 12: Video Timeline Generation
 *
 * **Validates: Requirements 7.2, 7.4**
 *
 * For any video attachment, when analysis is complete, the result should
 * include a timeline summary with timestamped events.
 *
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

describe('Property 12: Video Timeline Generation', () => {
  // ── Generators ──────────────────────────────────────────────────────

  /** Build a random ImageAnalysis with optional detected errors. */
  const imageAnalysisArb = (withErrors: boolean) =>
    fc.record({
      extractedText: fc.string(),
      detectedErrors: withErrors
        ? fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 })
        : fc.constant([] as string[]),
      detectedApplication: fc.string(),
      uiElements: fc.array(fc.string()),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    });

  /** Build a keyFrame entry with a given timestamp. */
  const keyFrameArb = (withErrors: boolean) =>
    fc.record({
      timestamp: fc.integer({ min: 0, max: 300 }),
      analysis: imageAnalysisArb(withErrors),
    });

  /** Build an action entry with a given timestamp. */
  const actionArb = fc.record({
    timestamp: fc.integer({ min: 0, max: 300 }),
    userAction: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    systemResponse: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  });

  // ── Property tests ─────────────────────────────────────────────────

  test('timeline events are sorted by timestamp (ascending)', () => {
    fc.assert(
      fc.property(
        fc.array(keyFrameArb(true), { minLength: 0, maxLength: 20 }),
        fc.array(actionArb, { minLength: 0, maxLength: 20 }),
        (keyFrames, actions) => {
          const timeline = generateTimeline(keyFrames, actions);

          for (let i = 1; i < timeline.length; i++) {
            expect(timeline[i].timestamp).toBeGreaterThanOrEqual(
              timeline[i - 1].timestamp
            );
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('each timeline event has a valid timestamp and non-empty event string', () => {
    fc.assert(
      fc.property(
        fc.array(keyFrameArb(true), { minLength: 0, maxLength: 20 }),
        fc.array(actionArb, { minLength: 0, maxLength: 20 }),
        (keyFrames, actions) => {
          const timeline = generateTimeline(keyFrames, actions);

          for (const entry of timeline) {
            expect(typeof entry.timestamp).toBe('number');
            expect(Number.isFinite(entry.timestamp)).toBe(true);
            expect(typeof entry.event).toBe('string');
            expect(entry.event.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('timeline includes events for user actions when provided', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.string({ minLength: 1 }),
        (ts, actionText) => {
          const keyFrames = [
            {
              timestamp: ts,
              analysis: {
                extractedText: '',
                detectedErrors: [] as string[],
                detectedApplication: '',
                uiElements: [] as string[],
                confidence: 0.5,
              } as ImageAnalysis,
            },
          ];
          const actions = [{ timestamp: ts, userAction: actionText }];

          const timeline = generateTimeline(keyFrames, actions);
          const userEvents = timeline.filter((e) =>
            e.event.startsWith('User action:')
          );

          expect(userEvents.length).toBeGreaterThanOrEqual(1);
          expect(userEvents.some((e) => e.event.includes(actionText))).toBe(
            true
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('timeline includes events for system responses when provided', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.string({ minLength: 1 }),
        (ts, responseText) => {
          const keyFrames = [
            {
              timestamp: ts,
              analysis: {
                extractedText: '',
                detectedErrors: [] as string[],
                detectedApplication: '',
                uiElements: [] as string[],
                confidence: 0.5,
              } as ImageAnalysis,
            },
          ];
          const actions = [{ timestamp: ts, systemResponse: responseText }];

          const timeline = generateTimeline(keyFrames, actions);
          const sysEvents = timeline.filter((e) =>
            e.event.startsWith('System response:')
          );

          expect(sysEvents.length).toBeGreaterThanOrEqual(1);
          expect(sysEvents.some((e) => e.event.includes(responseText))).toBe(
            true
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('timeline includes events for detected errors in frames', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
        (ts, errors) => {
          const keyFrames = [
            {
              timestamp: ts,
              analysis: {
                extractedText: '',
                detectedErrors: errors,
                detectedApplication: '',
                uiElements: [] as string[],
                confidence: 0.5,
              } as ImageAnalysis,
            },
          ];
          const actions: Array<{
            timestamp: number;
            userAction?: string;
            systemResponse?: string;
          }> = [];

          const timeline = generateTimeline(keyFrames, actions);
          const errorEvents = timeline.filter((e) =>
            e.event.startsWith('Error detected:')
          );

          // One timeline event per detected error
          expect(errorEvents.length).toBe(errors.length);
          for (const err of errors) {
            expect(
              errorEvents.some((e) => e.event.includes(err))
            ).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('when frames have no actions, responses, or errors, timeline is empty', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 0, max: 300 }),
            analysis: fc.record({
              extractedText: fc.string(),
              detectedErrors: fc.constant([] as string[]),
              detectedApplication: fc.string(),
              uiElements: fc.array(fc.string()),
              confidence: fc.double({ min: 0, max: 1, noNaN: true }),
            }),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (keyFrames) => {
          // No actions at all
          const actions: Array<{
            timestamp: number;
            userAction?: string;
            systemResponse?: string;
          }> = [];

          const timeline = generateTimeline(keyFrames, actions);
          expect(timeline.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
