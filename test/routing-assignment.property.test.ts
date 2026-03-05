/**
 * Property-based tests for intelligent routing assignment
 * Tests task 4.3: Write property test for routing assignment
 * 
 * Feature: novasupport-agentic-ai-support-ticket-system
 */

import * as fc from 'fast-check';
import { analyzeAndRoute } from '../src/agents/routing-agent';
import { Ticket, TicketStatus, Priority } from '../src/types/ticket';
import * as ticketAnalyzer from '../src/utils/ticket-analyzer';
import * as dynamodbClient from '../src/utils/dynamodb-client';
import { TeamWorkloadRecord } from '../src/types/dynamodb-schemas';

// Mock dependencies
jest.mock('../src/utils/ticket-analyzer');
jest.mock('../src/utils/dynamodb-client');
jest.mock('../src/utils/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('Property-Based Tests: Intelligent Routing Assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Property 1: Intelligent Routing Assignment
   * **Validates: Requirements 1.1, 1.2, 1.3**
   * 
   * For any ticket, when the Routing Agent analyzes and routes it, the assigned
   * team or individual should have relevant expertise for the ticket's category
   * and content, and if multiple teams qualify, the team with the lowest current
   * workload should be selected.
   */
  test('Property 1: Assigned team has relevant expertise and lowest workload among qualified teams', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          expertise: fc.constantFrom(
            'authentication',
            'billing',
            'database',
            'infrastructure',
            'api',
            'security',
            'general'
          ),
          urgencyScore: fc.integer({ min: 1, max: 10 }),
          // Generate 2-5 teams with varying workloads
          teamCount: fc.integer({ min: 2, max: 5 }),
        }),
        async (testData) => {
          // Create test ticket
          const ticket: Ticket = {
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

          // Mock ticket analysis with the specified expertise
          jest.mocked(ticketAnalyzer.analyzeTicket).mockResolvedValue({
            ticketId: ticket.id,
            urgency: {
              hasUrgentKeywords: testData.urgencyScore > 7,
              urgentKeywords: testData.urgencyScore > 7 ? ['urgent'] : [],
              urgencyScore: testData.urgencyScore,
            },
            sentiment: {
              sentiment: 'neutral',
              sentimentScore: 0,
              isFrustrated: false,
              isAngry: false,
            },
            expertise: {
              primaryExpertise: testData.expertise,
              secondaryExpertise: [],
              technicalTerms: [],
              confidence: 0.85,
            },
            analyzedAt: new Date(),
          });

          // Generate teams: some with matching expertise, some without
          const teams: TeamWorkloadRecord[] = [];
          const matchingTeams: { teamId: string; workload: number }[] = [];
          
          for (let i = 0; i < testData.teamCount; i++) {
            const hasMatchingExpertise = i < Math.ceil(testData.teamCount / 2); // At least half have matching expertise
            const workload = Math.floor(Math.random() * 30); // Random workload 0-29
            
            const teamId = `team-${i}`;
            // For general expertise, only include it in matching teams
            // For other expertise, include both the specific expertise and general
            const expertise = hasMatchingExpertise 
              ? [testData.expertise]
              : testData.expertise === 'general' 
                ? ['other-expertise', 'support'] // Don't include 'general' for non-matching teams when testing general
                : ['other-expertise'];
            
            teams.push({
              PK: `TEAM#${teamId}`,
              SK: 'WORKLOAD',
              teamId,
              teamName: `Team ${i}`,
              currentTicketCount: workload,
              expertise,
              updatedAt: new Date().toISOString(),
            });
            
            if (hasMatchingExpertise) {
              matchingTeams.push({ teamId, workload });
            }
          }

          // Mock DynamoDB to return our generated teams
          jest.mocked(dynamodbClient.scanItems).mockResolvedValue(teams);

          // Execute routing
          const decision = await analyzeAndRoute(ticket);

          // Skip validation if no teams match (manual routing case)
          if (decision.assignedTo === 'manual-routing-queue') {
            expect(matchingTeams.length).toBe(0);
            return;
          }

          // Property 1a: Assigned team must have relevant expertise
          const assignedTeam = teams.find(t => t.teamId === decision.assignedTo);
          expect(assignedTeam).toBeDefined();
          expect(assignedTeam!.expertise).toContain(testData.expertise);

          // Property 1b: If multiple teams qualify, assigned team should have lowest workload
          if (matchingTeams.length > 1) {
            const lowestWorkload = Math.min(...matchingTeams.map(t => t.workload));
            expect(assignedTeam!.currentTicketCount).toBe(lowestWorkload);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Routing confidence is in valid range
   */
  test('Property: Routing confidence score is in range [0, 1]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          expertise: fc.constantFrom('authentication', 'billing', 'database', 'general'),
          expertiseConfidence: fc.float({ min: 0, max: 1, noNaN: true }),
        }),
        async (testData) => {
          const ticket: Ticket = {
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

          jest.mocked(ticketAnalyzer.analyzeTicket).mockResolvedValue({
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
              primaryExpertise: testData.expertise,
              secondaryExpertise: [],
              technicalTerms: [],
              confidence: testData.expertiseConfidence,
            },
            analyzedAt: new Date(),
          });

          // Create at least one matching team
          jest.mocked(dynamodbClient.scanItems).mockResolvedValue([
            {
              PK: 'TEAM#test-team',
              SK: 'WORKLOAD',
              teamId: 'test-team',
              teamName: 'Test Team',
              currentTicketCount: 5,
              expertise: [testData.expertise, 'general'],
              updatedAt: new Date().toISOString(),
            },
          ]);

          const decision = await analyzeAndRoute(ticket);

          // Property: Confidence must be in valid range [0, 1]
          expect(decision.confidence).toBeGreaterThanOrEqual(0);
          expect(decision.confidence).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Manual routing when no expertise match
   */
  test('Property: Tickets requiring unavailable expertise are flagged for manual routing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          requiredExpertise: fc.constantFrom(
            'quantum-computing',
            'blockchain',
            'machine-learning',
            'specialized-domain'
          ),
        }),
        async (testData) => {
          const ticket: Ticket = {
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

          jest.mocked(ticketAnalyzer.analyzeTicket).mockResolvedValue({
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
              primaryExpertise: testData.requiredExpertise,
              secondaryExpertise: [],
              technicalTerms: [],
              confidence: 0.85,
            },
            analyzedAt: new Date(),
          });

          // Create teams without the required expertise
          jest.mocked(dynamodbClient.scanItems).mockResolvedValue([
            {
              PK: 'TEAM#general-team',
              SK: 'WORKLOAD',
              teamId: 'general-team',
              teamName: 'General Team',
              currentTicketCount: 5,
              expertise: ['general', 'basic-support'],
              updatedAt: new Date().toISOString(),
            },
          ]);

          const decision = await analyzeAndRoute(ticket);

          // Property: Should be flagged for manual routing
          expect(decision.assignedTo).toBe('manual-routing-queue');
          expect(decision.confidence).toBe(0);
          expect(decision.requiresSpecializedExpertise).toBe(true);
          expect(decision.reasoning).toContain('No teams found');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Workload balancing with equal expertise
   */
  test('Property: Among equally qualified teams, lowest workload team is selected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          expertise: fc.constantFrom('billing', 'authentication', 'api'),
          // Generate 3 teams with different workloads
          workloads: fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 3, maxLength: 3 }),
        }),
        async (testData) => {
          const ticket: Ticket = {
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

          jest.mocked(ticketAnalyzer.analyzeTicket).mockResolvedValue({
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
              primaryExpertise: testData.expertise,
              secondaryExpertise: [],
              technicalTerms: [],
              confidence: 0.85,
            },
            analyzedAt: new Date(),
          });

          // Create 3 teams with same expertise but different workloads
          const teams: TeamWorkloadRecord[] = testData.workloads.map((workload, i) => ({
            PK: `TEAM#team-${i}`,
            SK: 'WORKLOAD',
            teamId: `team-${i}`,
            teamName: `Team ${i}`,
            currentTicketCount: workload,
            expertise: [testData.expertise, 'general'],
            updatedAt: new Date().toISOString(),
          }));

          jest.mocked(dynamodbClient.scanItems).mockResolvedValue(teams);

          const decision = await analyzeAndRoute(ticket);

          // Property: Should select team with lowest workload
          const lowestWorkload = Math.min(...testData.workloads);
          const assignedTeam = teams.find(t => t.teamId === decision.assignedTo);
          
          expect(assignedTeam).toBeDefined();
          expect(assignedTeam!.currentTicketCount).toBe(lowestWorkload);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Alternative assignments are also qualified
   */
  test('Property: Alternative assignments have relevant expertise', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticketId: fc.uuid(),
          userId: fc.uuid(),
          subject: fc.string({ minLength: 5, maxLength: 100 }),
          description: fc.string({ minLength: 10, maxLength: 500 }),
          expertise: fc.constantFrom('authentication', 'billing', 'database'),
        }),
        async (testData) => {
          const ticket: Ticket = {
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

          jest.mocked(ticketAnalyzer.analyzeTicket).mockResolvedValue({
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
              primaryExpertise: testData.expertise,
              secondaryExpertise: [],
              technicalTerms: [],
              confidence: 0.85,
            },
            analyzedAt: new Date(),
          });

          // Create multiple teams with matching expertise
          const teams: TeamWorkloadRecord[] = [
            {
              PK: 'TEAM#team-1',
              SK: 'WORKLOAD',
              teamId: 'team-1',
              teamName: 'Team 1',
              currentTicketCount: 5,
              expertise: [testData.expertise, 'general'],
              updatedAt: new Date().toISOString(),
            },
            {
              PK: 'TEAM#team-2',
              SK: 'WORKLOAD',
              teamId: 'team-2',
              teamName: 'Team 2',
              currentTicketCount: 10,
              expertise: [testData.expertise, 'general'],
              updatedAt: new Date().toISOString(),
            },
            {
              PK: 'TEAM#team-3',
              SK: 'WORKLOAD',
              teamId: 'team-3',
              teamName: 'Team 3',
              currentTicketCount: 15,
              expertise: [testData.expertise, 'general'],
              updatedAt: new Date().toISOString(),
            },
          ];

          jest.mocked(dynamodbClient.scanItems).mockResolvedValue(teams);

          const decision = await analyzeAndRoute(ticket);

          // Property: All alternative assignments should have relevant expertise
          if (decision.alternativeAssignments && decision.alternativeAssignments.length > 0) {
            for (const alt of decision.alternativeAssignments) {
              const altTeam = teams.find(t => t.teamId === alt.assignedTo);
              expect(altTeam).toBeDefined();
              expect(altTeam!.expertise).toContain(testData.expertise);
              
              // Alternative confidence should also be in valid range
              expect(alt.confidence).toBeGreaterThanOrEqual(0);
              expect(alt.confidence).toBeLessThanOrEqual(1);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
