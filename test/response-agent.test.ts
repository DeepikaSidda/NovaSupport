import {
  generateResponse,
  detectSentiment,
  adaptTone,
  addUserHistoryContext,
  personalizeResponse,
} from '../src/agents/response-agent';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import { ResponseContext, GeneratedResponse } from '../src/types/agent';
import * as novaClient from '../src/utils/nova-client';

jest.mock('../src/utils/nova-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Response Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockTicket: Ticket = {
    id: 'ticket-123',
    userId: 'user-456',
    subject: 'Cannot login to account',
    description: 'I am unable to login to my account',
    status: TicketStatus.ASSIGNED,
    priority: Priority.HIGH,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
  };

  test('should generate response with knowledge base articles', async () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [{
        articleId: 'kb-001',
        title: 'Password Reset Guide',
        relevantSections: ['Reset instructions'],
        relevanceScore: 0.85,
      }],
      similarTickets: [],
      userHistory: [],
    };

    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: Please reset your password.\nREASONING: KB article found\nSUGGESTED_ACTIONS: Reset password',
    });

    const response = await generateResponse(mockTicket, context);

    expect(response.text).toContain('reset your password');
    expect(response.confidence).toBeGreaterThan(0.5);
    expect(response.referencedArticles).toContain('kb-001');
  });

  test('should handle Nova unavailability with fallback', async () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
    };

    (novaClient.invokeNova2Lite as jest.Mock).mockRejectedValue(
      new novaClient.NovaUnavailableError('Service unavailable')
    );

    const response = await generateResponse(mockTicket, context);

    expect(response.text).toContain('Thank you for contacting support');
    expect(response.confidence).toBe(0.5);
    expect(response.reasoning).toContain('Fallback');
  });

  test('should ensure confidence is in range [0, 1]', async () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [{
        articleId: 'kb-001',
        title: 'Guide',
        relevantSections: ['Content'],
        relevanceScore: 1.0,
      }],
      similarTickets: [],
      userHistory: [],
    };

    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: Detailed solution\nREASONING: High relevance\nSUGGESTED_ACTIONS: Follow steps',
    });

    const response = await generateResponse(mockTicket, context);

    expect(response.confidence).toBeGreaterThanOrEqual(0);
    expect(response.confidence).toBeLessThanOrEqual(1);
  });
});

describe('detectSentiment', () => {
  test('should detect frustrated sentiment', () => {
    expect(detectSentiment('I am so frustrated with this service')).toBe('frustrated');
    expect(detectSentiment('This is unacceptable!')).toBe('frustrated');
    expect(detectSentiment('The worst experience ever')).toBe('frustrated');
    expect(detectSentiment('I am FURIOUS about this')).toBe('frustrated');
  });

  test('should detect positive sentiment', () => {
    expect(detectSentiment('Thank you for the help')).toBe('positive');
    expect(detectSentiment('I appreciate the quick response')).toBe('positive');
    expect(detectSentiment('Great job on fixing this')).toBe('positive');
  });

  test('should default to neutral sentiment', () => {
    expect(detectSentiment('I need help with my account')).toBe('neutral');
    expect(detectSentiment('How do I reset my password?')).toBe('neutral');
    expect(detectSentiment('')).toBe('neutral');
  });
});

describe('adaptTone', () => {
  const baseText = 'Here is the solution to your issue.';

  test('should add empathetic opening for frustrated sentiment', () => {
    const result = adaptTone(baseText, 'frustrated');
    expect(result).toContain('I understand your frustration');
    expect(result).toContain('top priority');
    expect(result).toContain(baseText);
  });

  test('should add warm acknowledgment for positive sentiment', () => {
    const result = adaptTone(baseText, 'positive');
    expect(result).toContain('Thank you for your patience');
    expect(result).toContain(baseText);
  });

  test('should return text unchanged for neutral sentiment', () => {
    const result = adaptTone(baseText, 'neutral');
    expect(result).toBe(baseText);
  });
});

describe('addUserHistoryContext', () => {
  const baseText = 'Here is your answer.';

  test('should return text unchanged when no user history', () => {
    expect(addUserHistoryContext(baseText, [])).toBe(baseText);
  });

  test('should add welcome back and reference unresolved tickets', () => {
    const history: Ticket[] = [{
      id: 'old-1',
      userId: 'user-1',
      subject: 'Billing issue',
      description: 'Charged twice',
      status: TicketStatus.IN_PROGRESS,
      priority: Priority.MEDIUM,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    }];

    const result = addUserHistoryContext(baseText, history);
    expect(result).toContain('Welcome back');
    expect(result).toContain('open ticket');
    expect(result).toContain('Billing issue');
    expect(result).toContain(baseText);
  });

  test('should reference resolved tickets for returning customers', () => {
    const history: Ticket[] = [{
      id: 'old-2',
      userId: 'user-1',
      subject: 'Password reset',
      description: 'Needed reset',
      status: TicketStatus.RESOLVED,
      priority: Priority.LOW,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      attachments: [],
    }];

    const result = addUserHistoryContext(baseText, history);
    expect(result).toContain('Welcome back');
    expect(result).toContain('Password reset');
    expect(result).toContain(baseText);
  });
});

describe('personalizeResponse', () => {
  const baseResponse: GeneratedResponse = {
    text: 'Please try resetting your password.',
    confidence: 0.8,
    reasoning: 'KB article matched',
    referencedArticles: ['kb-001'],
    suggestedActions: ['Reset password'],
  };

  const ticket: Ticket = {
    id: 'ticket-999',
    userId: 'user-1',
    subject: 'Login broken',
    description: 'I am frustrated that I cannot login',
    status: TicketStatus.ASSIGNED,
    priority: Priority.HIGH,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
  };

  test('should adapt tone for frustrated user', () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
    };

    const result = personalizeResponse(baseResponse, ticket, context);
    expect(result.text).toContain('I understand your frustration');
    expect(result.text).toContain(baseResponse.text);
  });

  test('should add user history context', () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [{
        id: 'old-1',
        userId: 'user-1',
        subject: 'Previous issue',
        description: 'Old problem',
        status: TicketStatus.RESOLVED,
        priority: Priority.LOW,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        attachments: [],
      }],
    };

    const neutralTicket = { ...ticket, description: 'Cannot login to my account' };
    const result = personalizeResponse(baseResponse, neutralTicket, context);
    expect(result.text).toContain('Welcome back');
  });

  test('should preserve non-text fields from original response', () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [],
      similarTickets: [],
      userHistory: [],
    };

    const result = personalizeResponse(baseResponse, ticket, context);
    expect(result.confidence).toBe(baseResponse.confidence);
    expect(result.reasoning).toBe(baseResponse.reasoning);
    expect(result.referencedArticles).toEqual(baseResponse.referencedArticles);
    expect(result.suggestedActions).toEqual(baseResponse.suggestedActions);
  });
});

describe('generateResponse with personalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockTicket: Ticket = {
    id: 'ticket-p1',
    userId: 'user-1',
    subject: 'Terrible service',
    description: 'This is the worst experience, I am furious',
    status: TicketStatus.ASSIGNED,
    priority: Priority.CRITICAL,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
  };

  test('should include personalization in generated response', async () => {
    const context: ResponseContext = {
      knowledgeBaseResults: [{
        articleId: 'kb-002',
        title: 'Service Recovery',
        relevantSections: ['Steps to recover'],
        relevanceScore: 0.9,
      }],
      similarTickets: [],
      userHistory: [{
        id: 'old-t',
        userId: 'user-1',
        subject: 'Previous complaint',
        description: 'Had issues before',
        status: TicketStatus.CLOSED,
        priority: Priority.MEDIUM,
        createdAt: new Date(),
        updatedAt: new Date(),
        tags: [],
        attachments: [],
      }],
    };

    (novaClient.invokeNova2Lite as jest.Mock).mockResolvedValue({
      text: 'RESPONSE: We will fix this immediately.\nREASONING: Urgent issue\nSUGGESTED_ACTIONS: none',
    });

    const response = await generateResponse(mockTicket, context);

    // Should have frustrated tone adaptation
    expect(response.text).toContain('I understand your frustration');
    // Should have user history context
    expect(response.text).toContain('Welcome back');
    // Should still contain the actual response
    expect(response.text).toContain('We will fix this immediately');
  });
});
