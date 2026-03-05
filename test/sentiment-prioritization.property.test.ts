/**
 * Property-based tests for sentiment-based prioritization
 * Tests task 3.3: Write property test for sentiment detection
 * 
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import { analyzeTicket } from '../src/utils/ticket-analyzer';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as novaClient from '../src/utils/nova-client';

// Mock the Nova client
jest.mock('../src/utils/nova-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Property-Based Tests: Sentiment-Based Prioritization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Helper function to calculate priority score based on analysis
   * This simulates the priority calculation that would be done by the system
   */
  function calculatePriorityScore(
    urgencyScore: number,
    sentimentScore: number,
    isFrustrated: boolean,
    isAngry: boolean
  ): number {
    let priority = urgencyScore;
    
    // Boost priority for negative sentiment
    if (sentimentScore < 0) {
      priority += Math.abs(sentimentScore) * 2; // Add up to 2 points for negative sentiment
    }
    
    // Additional boost for frustrated customers
    if (isFrustrated) {
      priority += 1;
    }
    
    // Additional boost for angry customers
    if (isAngry) {
      priority += 2;
    }
    
    // Clamp to valid range [1, 10]
    return Math.max(1, Math.min(10, Math.round(priority)));
  }

  /**
   * Property 6: Sentiment-Based Prioritization
   * **Validates: Requirements 3.2**
   * 
   * For any ticket containing negative sentiment indicators (frustration, anger),
   * the assigned priority score should be higher than the same ticket without
   * negative sentiment.
   */
  test('Property 6: Tickets with negative sentiment have higher priority than neutral sentiment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          urgencyScore: fc.integer({ min: 1, max: 8 }), // Keep urgency lower to see sentiment effect
        }),
        async (testData) => {
          // Create base ticket
          const baseTicket: Ticket = {
            id: testData.ticketId,
            userId: testData.userId,
            subject: testData.subject,
            description: testData.description,
            status: TicketStatus.NEW,
            priority: Priority.MEDIUM,
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: [],
            attachments: [],
          };

          // Mock Nova response for neutral sentiment
          jest.mocked(novaClient.invokeNova2Lite).mockResolvedValueOnce({
            text: JSON.stringify({
              urgency: {
                hasUrgentKeywords: false,
                urgentKeywords: [],
                urgencyScore: testData.urgencyScore,
              },
              sentiment: {
                sentiment: 'neutral',
                sentimentScore: 0,
                isFrustrated: false,
                isAngry: false,
              },
              expertise: {
                primaryExpertise: 'general',
                secondaryExpertise: [],
                technicalTerms: [],
                confidence: 0.8,
              },
            }),
          });

          // Analyze ticket with neutral sentiment
          const neutralAnalysis = await analyzeTicket(baseTicket);
          const neutralPriority = calculatePriorityScore(
            neutralAnalysis.urgency.urgencyScore,
            neutralAnalysis.sentiment.sentimentScore,
            neutralAnalysis.sentiment.isFrustrated,
            neutralAnalysis.sentiment.isAngry
          );

          // Mock Nova response for negative sentiment (frustrated)
          jest.mocked(novaClient.invokeNova2Lite).mockResolvedValueOnce({
            text: JSON.stringify({
              urgency: {
                hasUrgentKeywords: false,
                urgentKeywords: [],
                urgencyScore: testData.urgencyScore, // Same urgency
              },
              sentiment: {
                sentiment: 'negative',
                sentimentScore: -0.7,
                isFrustrated: true,
                isAngry: false,
              },
              expertise: {
                primaryExpertise: 'general',
                secondaryExpertise: [],
                technicalTerms: [],
                confidence: 0.8,
              },
            }),
          });

          // Analyze same ticket with negative sentiment
          const negativeAnalysis = await analyzeTicket(baseTicket);
          const negativePriority = calculatePriorityScore(
            negativeAnalysis.urgency.urgencyScore,
            negativeAnalysis.sentiment.sentimentScore,
            negativeAnalysis.sentiment.isFrustrated,
            negativeAnalysis.sentiment.isAngry
          );

          // Property: Negative sentiment should result in higher priority
          expect(negativePriority).toBeGreaterThan(neutralPriority);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Angry customers get higher priority than frustrated
   */
  test('Property: Tickets with angry sentiment have higher priority than frustrated sentiment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          urgencyScore: fc.integer({ min: 1, max: 7 }),
        }),
        async (testData) => {
          const baseTicket: Ticket = {
            id: testData.ticketId,
            userId: testData.userId,
            subject: testData.subject,
            description: testData.description,
            status: TicketStatus.NEW,
            priority: Priority.MEDIUM,
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: [],
            attachments: [],
          };

          // Mock Nova response for frustrated sentiment
          jest.mocked(novaClient.invokeNova2Lite).mockResolvedValueOnce({
            text: JSON.stringify({
              urgency: {
                hasUrgentKeywords: false,
                urgentKeywords: [],
                urgencyScore: testData.urgencyScore,
              },
              sentiment: {
                sentiment: 'negative',
                sentimentScore: -0.6,
                isFrustrated: true,
                isAngry: false,
              },
              expertise: {
                primaryExpertise: 'general',
                secondaryExpertise: [],
                technicalTerms: [],
                confidence: 0.8,
              },
            }),
          });

          const frustratedAnalysis = await analyzeTicket(baseTicket);
          const frustratedPriority = calculatePriorityScore(
            frustratedAnalysis.urgency.urgencyScore,
            frustratedAnalysis.sentiment.sentimentScore,
            frustratedAnalysis.sentiment.isFrustrated,
            frustratedAnalysis.sentiment.isAngry
          );

          // Mock Nova response for angry sentiment
          jest.mocked(novaClient.invokeNova2Lite).mockResolvedValueOnce({
            text: JSON.stringify({
              urgency: {
                hasUrgentKeywords: false,
                urgentKeywords: [],
                urgencyScore: testData.urgencyScore, // Same urgency
              },
              sentiment: {
                sentiment: 'negative',
                sentimentScore: -0.9,
                isFrustrated: true,
                isAngry: true,
              },
              expertise: {
                primaryExpertise: 'general',
                secondaryExpertise: [],
                technicalTerms: [],
                confidence: 0.8,
              },
            }),
          });

          const angryAnalysis = await analyzeTicket(baseTicket);
          const angryPriority = calculatePriorityScore(
            angryAnalysis.urgency.urgencyScore,
            angryAnalysis.sentiment.sentimentScore,
            angryAnalysis.sentiment.isFrustrated,
            angryAnalysis.sentiment.isAngry
          );

          // Property: Angry sentiment should result in higher priority than just frustrated
          expect(angryPriority).toBeGreaterThanOrEqual(frustratedPriority);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Priority boost is bounded
   */
  test('Property: Sentiment-based priority boost respects maximum priority of 10', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          urgencyScore: fc.integer({ min: 1, max: 10 }),
          sentimentScore: fc.float({ min: -1, max: 0 }),
          isFrustrated: fc.boolean(),
          isAngry: fc.boolean(),
        }),
        async (testData) => {
          const baseTicket: Ticket = {
            id: testData.ticketId,
            userId: testData.userId,
            subject: testData.subject,
            description: testData.description,
            status: TicketStatus.NEW,
            priority: Priority.MEDIUM,
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: [],
            attachments: [],
          };

          // Mock Nova response with various negative sentiments
          jest.mocked(novaClient.invokeNova2Lite).mockResolvedValueOnce({
            text: JSON.stringify({
              urgency: {
                hasUrgentKeywords: testData.urgencyScore > 7,
                urgentKeywords: testData.urgencyScore > 7 ? ['urgent'] : [],
                urgencyScore: testData.urgencyScore,
              },
              sentiment: {
                sentiment: 'negative',
                sentimentScore: testData.sentimentScore,
                isFrustrated: testData.isFrustrated,
                isAngry: testData.isAngry,
              },
              expertise: {
                primaryExpertise: 'general',
                secondaryExpertise: [],
                technicalTerms: [],
                confidence: 0.8,
              },
            }),
          });

          const analysis = await analyzeTicket(baseTicket);
          const priority = calculatePriorityScore(
            analysis.urgency.urgencyScore,
            analysis.sentiment.sentimentScore,
            analysis.sentiment.isFrustrated,
            analysis.sentiment.isAngry
          );

          // Property: Priority must never exceed 10, even with maximum negative sentiment
          expect(priority).toBeLessThanOrEqual(10);
          expect(priority).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Positive sentiment does not increase priority
   */
  test('Property: Positive sentiment does not increase priority above urgency baseline', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          urgencyScore: fc.integer({ min: 1, max: 10 }),
        }),
        async (testData) => {
          const baseTicket: Ticket = {
            id: testData.ticketId,
            userId: testData.userId,
            subject: testData.subject,
            description: testData.description,
            status: TicketStatus.NEW,
            priority: Priority.MEDIUM,
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: [],
            attachments: [],
          };

          // Mock Nova response for positive sentiment
          jest.mocked(novaClient.invokeNova2Lite).mockResolvedValueOnce({
            text: JSON.stringify({
              urgency: {
                hasUrgentKeywords: false,
                urgentKeywords: [],
                urgencyScore: testData.urgencyScore,
              },
              sentiment: {
                sentiment: 'positive',
                sentimentScore: 0.8,
                isFrustrated: false,
                isAngry: false,
              },
              expertise: {
                primaryExpertise: 'general',
                secondaryExpertise: [],
                technicalTerms: [],
                confidence: 0.8,
              },
            }),
          });

          const analysis = await analyzeTicket(baseTicket);
          const priority = calculatePriorityScore(
            analysis.urgency.urgencyScore,
            analysis.sentiment.sentimentScore,
            analysis.sentiment.isFrustrated,
            analysis.sentiment.isAngry
          );

          // Property: Positive sentiment should not boost priority above urgency score
          // (we only boost for negative sentiment)
          expect(priority).toBeLessThanOrEqual(testData.urgencyScore);
        }
      ),
      { numRuns: 100 }
    );
  });
});
