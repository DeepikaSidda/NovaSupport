/**
 * Unit tests for Routing Agent
 */

import { analyzeAndRoute, fallbackRouting } from '../src/agents/routing-agent';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as ticketAnalyzer from '../src/utils/ticket-analyzer';
import * as dynamodbClient from '../src/utils/dynamodb-client';

// Mock dependencies
jest.mock('../src/utils/ticket-analyzer');
jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Routing Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockTicket = (overrides?: Partial<Ticket>): Ticket => ({
    id: 'ticket-123',
    userId: 'user-456',
    subject: 'Login issue',
    description: 'Cannot log in to my account',
    status: TicketStatus.NEW,
    priority: Priority.MEDIUM,
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    attachments: [],
    ...overrides,
  });

  describe('analyzeAndRoute', () => {
    test('should route ticket to team with matching expertise and lowest workload', async () => {
      const ticket = createMockTicket();

      // Mock ticket analysis
      (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
        ticketId: ticket.id,
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
          primaryExpertise: 'authentication',
          secondaryExpertise: [],
          technicalTerms: ['login', 'account'],
          confidence: 0.9,
        },
        analyzedAt: new Date(),
      });

      // Mock teams with different workloads
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#auth-team',
          SK: 'WORKLOAD',
          teamId: 'auth-team',
          teamName: 'Authentication Team',
          currentTicketCount: 5,
          expertise: ['authentication', 'security'],
          updatedAt: new Date().toISOString(),
        },
        {
          PK: 'TEAM#general-team',
          SK: 'WORKLOAD',
          teamId: 'general-team',
          teamName: 'General Support',
          currentTicketCount: 10,
          expertise: ['general', 'authentication'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await analyzeAndRoute(ticket);

      expect(decision.assignedTo).toBe('auth-team');
      expect(decision.confidence).toBeGreaterThan(0.8);
      expect(decision.requiresSpecializedExpertise).toBe(false);
      expect(decision.reasoning).toContain('authentication');
      expect(decision.reasoning).toContain('lowest workload');
    });

    test('should select team with lowest workload when multiple teams qualify', async () => {
      const ticket = createMockTicket();

      (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
        ticketId: ticket.id,
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
          primaryExpertise: 'billing',
          secondaryExpertise: [],
          technicalTerms: [],
          confidence: 0.8,
        },
        analyzedAt: new Date(),
      });

      // Three teams with billing expertise, different workloads
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#billing-1',
          SK: 'WORKLOAD',
          teamId: 'billing-1',
          teamName: 'Billing Team 1',
          currentTicketCount: 15,
          expertise: ['billing', 'payments'],
          updatedAt: new Date().toISOString(),
        },
        {
          PK: 'TEAM#billing-2',
          SK: 'WORKLOAD',
          teamId: 'billing-2',
          teamName: 'Billing Team 2',
          currentTicketCount: 3, // Lowest workload
          expertise: ['billing', 'subscriptions'],
          updatedAt: new Date().toISOString(),
        },
        {
          PK: 'TEAM#billing-3',
          SK: 'WORKLOAD',
          teamId: 'billing-3',
          teamName: 'Billing Team 3',
          currentTicketCount: 8,
          expertise: ['billing'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await analyzeAndRoute(ticket);

      expect(decision.assignedTo).toBe('billing-2');
      expect(decision.reasoning).toContain('lowest workload: 3 tickets');
      expect(decision.alternativeAssignments).toBeDefined();
      expect(decision.alternativeAssignments?.length).toBeGreaterThan(0);
    });

    test('should flag ticket for manual routing when no teams have required expertise', async () => {
      const ticket = createMockTicket({
        subject: 'Specialized quantum computing issue',
        description: 'Need help with quantum algorithm optimization',
      });

      (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
        ticketId: ticket.id,
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
          primaryExpertise: 'quantum-computing',
          secondaryExpertise: [],
          technicalTerms: ['quantum', 'algorithm'],
          confidence: 0.85,
        },
        analyzedAt: new Date(),
      });

      // Teams without quantum computing expertise
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#general',
          SK: 'WORKLOAD',
          teamId: 'general',
          teamName: 'General Support',
          currentTicketCount: 5,
          expertise: ['general', 'basic-support'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await analyzeAndRoute(ticket);

      expect(decision.assignedTo).toBe('manual-routing-queue');
      expect(decision.confidence).toBe(0);
      expect(decision.requiresSpecializedExpertise).toBe(true);
      expect(decision.reasoning).toContain('No teams found');
      expect(decision.reasoning).toContain('quantum-computing');
    });

    test('should generate routing confidence scores', async () => {
      const ticket = createMockTicket();

      (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
        ticketId: ticket.id,
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
          primaryExpertise: 'database',
          secondaryExpertise: [],
          technicalTerms: [],
          confidence: 0.75,
        },
        analyzedAt: new Date(),
      });

      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#db-team',
          SK: 'WORKLOAD',
          teamId: 'db-team',
          teamName: 'Database Team',
          currentTicketCount: 5,
          expertise: ['database', 'sql'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await analyzeAndRoute(ticket);

      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(typeof decision.confidence).toBe('number');
    });

    test('should include urgency information in reasoning for high-urgency tickets', async () => {
      const ticket = createMockTicket({
        subject: 'URGENT: System down',
        description: 'Critical production issue, system is completely down!',
      });

      (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
        ticketId: ticket.id,
        urgency: {
          hasUrgentKeywords: true,
          urgentKeywords: ['urgent', 'critical', 'down'],
          urgencyScore: 9,
        },
        sentiment: {
          sentiment: 'negative',
          sentimentScore: -0.8,
          isFrustrated: true,
          isAngry: false,
        },
        expertise: {
          primaryExpertise: 'infrastructure',
          secondaryExpertise: [],
          technicalTerms: ['system', 'production'],
          confidence: 0.9,
        },
        analyzedAt: new Date(),
      });

      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#infra',
          SK: 'WORKLOAD',
          teamId: 'infra',
          teamName: 'Infrastructure Team',
          currentTicketCount: 5,
          expertise: ['infrastructure', 'systems'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await analyzeAndRoute(ticket);

      expect(decision.reasoning).toContain('High urgency');
      expect(decision.reasoning).toContain('9/10');
    });

    test('should include sentiment information in reasoning for frustrated customers', async () => {
      const ticket = createMockTicket({
        subject: 'Very frustrated with service',
        description: 'This is unacceptable, I am extremely frustrated!',
      });

      (ticketAnalyzer.analyzeTicket as jest.Mock).mockResolvedValue({
        ticketId: ticket.id,
        urgency: {
          hasUrgentKeywords: false,
          urgentKeywords: [],
          urgencyScore: 6,
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
          confidence: 0.7,
        },
        analyzedAt: new Date(),
      });

      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#general',
          SK: 'WORKLOAD',
          teamId: 'general',
          teamName: 'General Support',
          currentTicketCount: 5,
          expertise: ['general'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await analyzeAndRoute(ticket);

      expect(decision.reasoning).toContain('sentiment');
      expect(decision.reasoning).toContain('Handle with care');
    });
  });

  describe('assignTicket', () => {
    const { assignTicket } = require('../src/agents/routing-agent');

    test('should update ticket record with assignment information', async () => {
      const ticketId = 'ticket-123';
      const routingDecision = {
        assignedTo: 'auth-team',
        reasoning: 'Best match for authentication issues',
        confidence: 0.9,
        requiresSpecializedExpertise: false,
      };

      // Mock getItem to return existing team record
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue({
        PK: 'TEAM#auth-team',
        SK: 'WORKLOAD',
        teamId: 'auth-team',
        teamName: 'Authentication Team',
        currentTicketCount: 5,
        expertise: ['authentication'],
        updatedAt: new Date().toISOString(),
      });

      // Mock updateItem
      (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);

      await assignTicket(ticketId, routingDecision);

      // Verify ticket was updated
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'TICKET#ticket-123',
        'METADATA',
        expect.stringContaining('assignedTo'),
        expect.objectContaining({
          ':assignedTo': 'auth-team',
          ':assignedTeam': 'auth-team',
          ':confidence': 0.9,
        })
      );

      // Verify team workload was incremented
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'TEAM#auth-team',
        'WORKLOAD',
        expect.stringContaining('currentTicketCount'),
        expect.objectContaining({
          ':increment': 1,
        })
      );
    });

    test('should not increment workload for manual routing queue', async () => {
      const ticketId = 'ticket-456';
      const routingDecision = {
        assignedTo: 'manual-routing-queue',
        reasoning: 'No teams available',
        confidence: 0,
        requiresSpecializedExpertise: true,
      };

      (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);

      await assignTicket(ticketId, routingDecision);

      // Verify ticket was updated
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'TICKET#ticket-456',
        'METADATA',
        expect.any(String),
        expect.objectContaining({
          ':assignedTo': 'manual-routing-queue',
        })
      );

      // Verify team workload was NOT incremented (only one call for ticket update)
      const workloadCalls = (dynamodbClient.updateItem as jest.Mock).mock.calls.filter(
        call => call[0].startsWith('TEAM#')
      );
      expect(workloadCalls.length).toBe(0);
    });

    test('should handle team workload increment when team does not exist', async () => {
      const ticketId = 'ticket-789';
      const routingDecision = {
        assignedTo: 'nonexistent-team',
        reasoning: 'Test routing',
        confidence: 0.8,
        requiresSpecializedExpertise: false,
      };

      // Mock getItem to return undefined (team doesn't exist)
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);
      (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);

      // Should not throw error
      await expect(assignTicket(ticketId, routingDecision)).resolves.not.toThrow();

      // Verify ticket was still updated
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'TICKET#ticket-789',
        'METADATA',
        expect.any(String),
        expect.any(Object)
      );
    });

    test('should update GSI keys for team-based queries', async () => {
      const ticketId = 'ticket-999';
      const routingDecision = {
        assignedTo: 'billing-team',
        reasoning: 'Billing expertise required',
        confidence: 0.85,
        requiresSpecializedExpertise: false,
      };

      (dynamodbClient.getItem as jest.Mock).mockResolvedValue({
        PK: 'TEAM#billing-team',
        SK: 'WORKLOAD',
        teamId: 'billing-team',
        currentTicketCount: 10,
      });
      (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);

      await assignTicket(ticketId, routingDecision);

      // Verify GSI keys were set
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'TICKET#ticket-999',
        'METADATA',
        expect.stringContaining('GSI3PK'),
        expect.objectContaining({
          ':gsi3pk': 'TEAM#billing-team',
          ':gsi3sk': expect.any(String),
        })
      );
    });
  });

  describe('decrementTeamWorkload', () => {
    const { decrementTeamWorkload } = require('../src/agents/routing-agent');

    test('should decrement team workload counter', async () => {
      const teamId = 'auth-team';

      (dynamodbClient.getItem as jest.Mock).mockResolvedValue({
        PK: 'TEAM#auth-team',
        SK: 'WORKLOAD',
        teamId: 'auth-team',
        currentTicketCount: 5,
      });
      (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);

      await decrementTeamWorkload(teamId);

      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'TEAM#auth-team',
        'WORKLOAD',
        expect.stringContaining('currentTicketCount'),
        expect.objectContaining({
          ':decrement': 1,
        })
      );
    });

    test('should handle decrement when team does not exist', async () => {
      const teamId = 'nonexistent-team';

      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      // Should not throw error
      await expect(decrementTeamWorkload(teamId)).resolves.not.toThrow();

      // Should not call updateItem
      expect(dynamodbClient.updateItem).not.toHaveBeenCalled();
    });
  });

  describe('fallbackRouting', () => {
    test('should route to team with lowest workload when Nova is unavailable', async () => {
      const ticket = createMockTicket();

      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([
        {
          PK: 'TEAM#team-1',
          SK: 'WORKLOAD',
          teamId: 'team-1',
          teamName: 'Team 1',
          currentTicketCount: 10,
          expertise: ['general'],
          updatedAt: new Date().toISOString(),
        },
        {
          PK: 'TEAM#team-2',
          SK: 'WORKLOAD',
          teamId: 'team-2',
          teamName: 'Team 2',
          currentTicketCount: 3,
          expertise: ['general'],
          updatedAt: new Date().toISOString(),
        },
      ]);

      const decision = await fallbackRouting(ticket);

      expect(decision.assignedTo).toBe('team-2');
      expect(decision.confidence).toBe(0.5);
      expect(decision.reasoning).toContain('Fallback routing');
      expect(decision.reasoning).toContain('Nova unavailable');
    });

    test('should flag for manual routing when no teams are available', async () => {
      const ticket = createMockTicket();

      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([]);

      const decision = await fallbackRouting(ticket);

      expect(decision.assignedTo).toBe('manual-routing-queue');
      expect(decision.confidence).toBe(0);
      expect(decision.requiresSpecializedExpertise).toBe(true);
      expect(decision.reasoning).toContain('No teams available');
    });
  });
});
