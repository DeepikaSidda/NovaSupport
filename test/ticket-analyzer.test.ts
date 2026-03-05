/**
 * Unit tests for ticket analyzer
 */

import { analyzeTicket } from '../src/utils/ticket-analyzer';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as novaClient from '../src/utils/nova-client';

// Mock the Nova client
jest.mock('../src/utils/nova-client');

describe('Ticket Analyzer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockTicket = (subject: string, description: string): Ticket => ({
    id: 'test-ticket-123',
    userId: 'user-456',
    subject,
    description,
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
  });

  describe('Urgency Detection', () => {
    it('should detect urgent keywords in ticket content', async () => {
      const ticket = createMockTicket(
        'URGENT: System is down',
        'Our production system crashed and is not working. This is critical!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: true,
            urgentKeywords: ['urgent', 'down', 'crashed', 'not working', 'critical'],
            urgencyScore: 9,
          },
          sentiment: {
            sentiment: 'negative',
            sentimentScore: -0.7,
            isFrustrated: true,
            isAngry: false,
          },
          expertise: {
            primaryExpertise: 'infrastructure',
            secondaryExpertise: ['database'],
            technicalTerms: ['production', 'system'],
            confidence: 0.85,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.urgency.hasUrgentKeywords).toBe(true);
      expect(analysis.urgency.urgentKeywords).toContain('urgent');
      expect(analysis.urgency.urgencyScore).toBeGreaterThanOrEqual(7);
    });

    it('should assign low urgency score for non-urgent tickets', async () => {
      const ticket = createMockTicket(
        'Feature request: Add dark mode',
        'It would be nice to have a dark mode option in the settings.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 2,
          },
          sentiment: {
            sentiment: 'positive',
            sentimentScore: 0.3,
            isFrustrated: false,
            isAngry: false,
          },
          expertise: {
            primaryExpertise: 'ui/ux',
            secondaryExpertise: [],
            technicalTerms: ['dark mode', 'settings'],
            confidence: 0.9,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.urgency.hasUrgentKeywords).toBe(false);
      expect(analysis.urgency.urgencyScore).toBeLessThanOrEqual(3);
    });

    it('should clamp urgency score to valid range [0, 10]', async () => {
      const ticket = createMockTicket('Test', 'Test description');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 15, // Invalid: exceeds max
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
            confidence: 0.5,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.urgency.urgencyScore).toBeLessThanOrEqual(10);
      expect(analysis.urgency.urgencyScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Sentiment Analysis', () => {
    it('should detect negative sentiment and frustration', async () => {
      const ticket = createMockTicket(
        'This is unacceptable',
        'I am extremely frustrated with this service. This is the worst experience ever!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 5,
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
            confidence: 0.6,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.sentiment.sentiment).toBe('negative');
      expect(analysis.sentiment.sentimentScore).toBeLessThan(0);
      expect(analysis.sentiment.isFrustrated).toBe(true);
      expect(analysis.sentiment.isAngry).toBe(true);
    });

    it('should detect positive sentiment', async () => {
      const ticket = createMockTicket(
        'Thank you for the great service',
        'I really appreciate your help. The support team is excellent!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 1,
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
            confidence: 0.7,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.sentiment.sentiment).toBe('positive');
      expect(analysis.sentiment.sentimentScore).toBeGreaterThan(0);
      expect(analysis.sentiment.isFrustrated).toBe(false);
      expect(analysis.sentiment.isAngry).toBe(false);
    });

    it('should clamp sentiment score to valid range [-1, 1]', async () => {
      const ticket = createMockTicket('Test', 'Test description');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 5,
          },
          sentiment: {
            sentiment: 'negative',
            sentimentScore: -2.5, // Invalid: below min
            isFrustrated: false,
            isAngry: false,
          },
          expertise: {
            primaryExpertise: 'general',
            secondaryExpertise: [],
            technicalTerms: [],
            confidence: 0.5,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.sentiment.sentimentScore).toBeGreaterThanOrEqual(-1);
      expect(analysis.sentiment.sentimentScore).toBeLessThanOrEqual(1);
    });
  });

  describe('Expertise Identification', () => {
    it('should identify authentication expertise', async () => {
      const ticket = createMockTicket(
        'Cannot login to my account',
        'I keep getting "access denied" when trying to sign in with my password.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 6,
          },
          sentiment: {
            sentiment: 'negative',
            sentimentScore: -0.4,
            isFrustrated: true,
            isAngry: false,
          },
          expertise: {
            primaryExpertise: 'authentication',
            secondaryExpertise: ['security'],
            technicalTerms: ['login', 'access denied', 'password', 'sign in'],
            confidence: 0.95,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('authentication');
      expect(analysis.expertise.technicalTerms).toContain('login');
      expect(analysis.expertise.confidence).toBeGreaterThan(0.8);
    });

    it('should identify billing expertise', async () => {
      const ticket = createMockTicket(
        'Incorrect charge on my invoice',
        'I was charged twice for my subscription payment this month.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 7,
          },
          sentiment: {
            sentiment: 'negative',
            sentimentScore: -0.5,
            isFrustrated: true,
            isAngry: false,
          },
          expertise: {
            primaryExpertise: 'billing',
            secondaryExpertise: ['payments'],
            technicalTerms: ['charge', 'invoice', 'subscription', 'payment'],
            confidence: 0.92,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('billing');
      expect(analysis.expertise.technicalTerms).toContain('invoice');
    });

    it('should clamp confidence score to valid range [0, 1]', async () => {
      const ticket = createMockTicket('Test', 'Test description');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 5,
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
            confidence: 1.5, // Invalid: exceeds max
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.confidence).toBeLessThanOrEqual(1);
      expect(analysis.expertise.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Structured Results', () => {
    it('should return complete analysis structure', async () => {
      const ticket = createMockTicket('Test ticket', 'Test description');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: {
            hasUrgentKeywords: false,
            urgentKeywords: [],
            urgencyScore: 5,
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
            confidence: 0.5,
          },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      // Verify structure
      expect(analysis).toHaveProperty('ticketId');
      expect(analysis).toHaveProperty('urgency');
      expect(analysis).toHaveProperty('sentiment');
      expect(analysis).toHaveProperty('expertise');
      expect(analysis).toHaveProperty('analyzedAt');

      // Verify urgency structure
      expect(analysis.urgency).toHaveProperty('hasUrgentKeywords');
      expect(analysis.urgency).toHaveProperty('urgentKeywords');
      expect(analysis.urgency).toHaveProperty('urgencyScore');

      // Verify sentiment structure
      expect(analysis.sentiment).toHaveProperty('sentiment');
      expect(analysis.sentiment).toHaveProperty('sentimentScore');
      expect(analysis.sentiment).toHaveProperty('isFrustrated');
      expect(analysis.sentiment).toHaveProperty('isAngry');

      // Verify expertise structure
      expect(analysis.expertise).toHaveProperty('primaryExpertise');
      expect(analysis.expertise).toHaveProperty('secondaryExpertise');
      expect(analysis.expertise).toHaveProperty('technicalTerms');
      expect(analysis.expertise).toHaveProperty('confidence');
    });

    it('should include ticket ID in analysis', async () => {
      const ticket = createMockTicket('Test', 'Test');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: { hasUrgentKeywords: false, urgentKeywords: [], urgencyScore: 5 },
          sentiment: { sentiment: 'neutral', sentimentScore: 0, isFrustrated: false, isAngry: false },
          expertise: { primaryExpertise: 'general', secondaryExpertise: [], technicalTerms: [], confidence: 0.5 },
        }),
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.ticketId).toBe(ticket.id);
    });

    it('should include timestamp in analysis', async () => {
      const ticket = createMockTicket('Test', 'Test');
      const beforeAnalysis = new Date();

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: JSON.stringify({
          urgency: { hasUrgentKeywords: false, urgentKeywords: [], urgencyScore: 5 },
          sentiment: { sentiment: 'neutral', sentimentScore: 0, isFrustrated: false, isAngry: false },
          expertise: { primaryExpertise: 'general', secondaryExpertise: [], technicalTerms: [], confidence: 0.5 },
        }),
      });

      const analysis = await analyzeTicket(ticket);
      const afterAnalysis = new Date();

      expect(analysis.analyzedAt).toBeInstanceOf(Date);
      expect(analysis.analyzedAt.getTime()).toBeGreaterThanOrEqual(beforeAnalysis.getTime());
      expect(analysis.analyzedAt.getTime()).toBeLessThanOrEqual(afterAnalysis.getTime());
    });
  });

  describe('Error Handling and Fallback', () => {
    it('should use fallback analysis when Nova is unavailable', async () => {
      const ticket = createMockTicket(
        'URGENT: Login broken',
        'Cannot access my account. This is critical!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      // Should still return valid analysis structure
      expect(analysis).toHaveProperty('ticketId');
      expect(analysis).toHaveProperty('urgency');
      expect(analysis).toHaveProperty('sentiment');
      expect(analysis).toHaveProperty('expertise');

      // Fallback should detect urgent keywords
      expect(analysis.urgency.hasUrgentKeywords).toBe(true);
      expect(analysis.urgency.urgentKeywords.length).toBeGreaterThan(0);
    });

    it('should handle malformed Nova responses gracefully', async () => {
      const ticket = createMockTicket('Test', 'Test');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: 'This is not valid JSON',
      });

      await expect(analyzeTicket(ticket)).rejects.toThrow('Failed to parse analysis response');
    });

    it('should handle Nova response with markdown code blocks', async () => {
      const ticket = createMockTicket('Test', 'Test');

      jest.mocked(novaClient.invokeNova2Lite).mockResolvedValue({
        text: '```json\n{"urgency":{"hasUrgentKeywords":false,"urgentKeywords":[],"urgencyScore":5},"sentiment":{"sentiment":"neutral","sentimentScore":0,"isFrustrated":false,"isAngry":false},"expertise":{"primaryExpertise":"general","secondaryExpertise":[],"technicalTerms":[],"confidence":0.5}}\n```',
      });

      const analysis = await analyzeTicket(ticket);

      expect(analysis.ticketId).toBe(ticket.id);
      expect(analysis.urgency.urgencyScore).toBe(5);
    });
  });

  // Task 3.4: Comprehensive tests for graceful degradation to rule-based fallback
  describe('Rule-Based Fallback Analysis (Task 3.4)', () => {
    it('should detect multiple urgent keywords in fallback mode', async () => {
      const ticket = createMockTicket(
        'URGENT: System crashed and is down',
        'Emergency! The production system is broken and not working. This is critical!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.urgency.hasUrgentKeywords).toBe(true);
      expect(analysis.urgency.urgentKeywords).toContain('urgent');
      expect(analysis.urgency.urgentKeywords).toContain('emergency');
      expect(analysis.urgency.urgentKeywords).toContain('down');
      expect(analysis.urgency.urgentKeywords).toContain('broken');
      expect(analysis.urgency.urgentKeywords).toContain('not working');
      expect(analysis.urgency.urgentKeywords).toContain('critical');
      expect(analysis.urgency.urgencyScore).toBeGreaterThan(7);
    });

    it('should detect negative sentiment in fallback mode', async () => {
      const ticket = createMockTicket(
        'This is unacceptable',
        'I am extremely frustrated and angry. This is the worst service ever. Terrible experience!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Rate limited')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.sentiment.sentiment).toBe('negative');
      expect(analysis.sentiment.sentimentScore).toBeLessThan(0);
      expect(analysis.sentiment.isFrustrated).toBe(true);
      expect(analysis.sentiment.isAngry).toBe(true);
    });

    it('should detect positive sentiment in fallback mode', async () => {
      const ticket = createMockTicket(
        'Thanks for the great support',
        'I really appreciate your excellent help. Great service!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('API unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.sentiment.sentiment).toBe('positive');
      expect(analysis.sentiment.sentimentScore).toBeGreaterThan(0);
      expect(analysis.sentiment.isFrustrated).toBe(false);
      expect(analysis.sentiment.isAngry).toBe(false);
    });

    it('should detect authentication expertise in fallback mode', async () => {
      const ticket = createMockTicket(
        'Cannot login',
        'Getting access denied error when trying to sign in with my password'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service down')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('authentication');
      expect(analysis.expertise.confidence).toBe(0.5); // Lower confidence for fallback
    });

    it('should detect billing expertise in fallback mode', async () => {
      const ticket = createMockTicket(
        'Payment issue',
        'My invoice shows incorrect charges for my subscription'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Throttled')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('billing');
      expect(analysis.expertise.confidence).toBe(0.5);
    });

    it('should detect database expertise in fallback mode', async () => {
      const ticket = createMockTicket(
        'Database query failing',
        'SQL query returns error. Cannot access data from the table.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Model unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('database');
    });

    it('should detect networking expertise in fallback mode', async () => {
      const ticket = createMockTicket(
        'Connection timeout',
        'Network connection keeps timing out. DNS resolution failing with high latency.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service error')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('networking');
    });

    it('should detect UI/UX expertise in fallback mode', async () => {
      const ticket = createMockTicket(
        'Button not working',
        'The submit button on the page is not displaying correctly. Interface layout is broken.'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('API error')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('ui/ux');
    });

    it('should default to general expertise when no keywords match in fallback mode', async () => {
      const ticket = createMockTicket(
        'Need help',
        'I have a question about the product'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.expertise.primaryExpertise).toBe('general');
      expect(analysis.expertise.confidence).toBe(0.5);
    });

    it('should assign neutral sentiment when no sentiment keywords found in fallback mode', async () => {
      const ticket = createMockTicket(
        'Question about feature',
        'How does the export functionality work?'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.sentiment.sentiment).toBe('neutral');
      expect(analysis.sentiment.sentimentScore).toBe(0);
      expect(analysis.sentiment.isFrustrated).toBe(false);
      expect(analysis.sentiment.isAngry).toBe(false);
    });

    it('should calculate urgency score based on keyword count in fallback mode', async () => {
      const ticket = createMockTicket(
        'URGENT CRITICAL',
        'ASAP emergency - system down'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Rate limit exceeded')
      );

      const analysis = await analyzeTicket(ticket);

      // Should find: urgent, critical, asap, emergency, down
      // Score = min(10, count * 2 + 3) = min(10, 5 * 2 + 3) = 10
      expect(analysis.urgency.urgencyScore).toBe(10);
    });

    it('should cap urgency score at 10 in fallback mode', async () => {
      const ticket = createMockTicket(
        'URGENT CRITICAL ASAP EMERGENCY',
        'System down broken not working crashed error'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('API down')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.urgency.urgencyScore).toBeLessThanOrEqual(10);
      expect(analysis.urgency.urgencyScore).toBeGreaterThanOrEqual(0);
    });

    it('should return lower confidence for fallback analysis', async () => {
      const ticket = createMockTicket(
        'Login issue',
        'Cannot access account'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Service unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      // Fallback should always return 0.5 confidence
      expect(analysis.expertise.confidence).toBe(0.5);
    });

    it('should handle case-insensitive keyword matching in fallback mode', async () => {
      const ticket = createMockTicket(
        'URGENT: LOGIN BROKEN',
        'CANNOT ACCESS MY ACCOUNT. THIS IS CRITICAL!'
      );

      jest.mocked(novaClient.invokeNova2Lite).mockRejectedValue(
        new novaClient.NovaUnavailableError('Unavailable')
      );

      const analysis = await analyzeTicket(ticket);

      expect(analysis.urgency.hasUrgentKeywords).toBe(true);
      expect(analysis.urgency.urgentKeywords.length).toBeGreaterThan(0);
      expect(analysis.expertise.primaryExpertise).toBe('authentication');
    });
  });
});

