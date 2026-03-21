/**
 * Unit tests for Notification Service
 * Validates: Requirements 4.4, 4.5, 11.3, 16.3, 16.5
 */
import { EscalationDecision, EscalationReason } from '../src/types/agent';
import { Alert } from '../src/types/analytics';
const mockPutItem = jest.fn().mockResolvedValue(undefined);
const mockUpdateItem = jest.fn().mockResolvedValue(undefined);
const mockQueryItems = jest.fn().mockResolvedValue([]);
jest.mock('../src/utils/dynamodb-client', () => ({
  putItem: (...args: any[]) => mockPutItem(...args),
  updateItem: (...args: any[]) => mockUpdateItem(...args),
  queryItems: (...args: any[]) => mockQueryItems(...args),
}));
jest.mock('../src/utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('uuid', () => ({ v4: () => 'mock-uuid-1234' }));
import {
  sendEscalationNotification, sendEmailNotification, sendInAppNotification,
  sendEscalationEmail, sendAlertEmail, sendFollowUpEmail,
  sendAlertNotification, sendFollowUpNotification, createInAppNotification,
  updateTicketStatusToEscalated, getNotifications, markNotificationRead,
  markAsRead, markMultipleAsRead, publishToSNS, InAppNotification, SNS_TOPICS,
} from '../src/services/notification-service';
function mkDecision(o: Partial<EscalationDecision> = {}): EscalationDecision {
  return { shouldEscalate: true, reason: EscalationReason.LOW_CONFIDENCE, urgency: 'medium', assignTo: 'senior-support', summary: 'Needs human intervention.', attemptedSolutions: ['Attempt 1'], ...o };
}
function mkAlert(o: Partial<Alert> = {}): Alert {
  return { alertId: 'ALERT-001', type: 'spike', description: 'Spike in login failures', affectedUsers: 25, recommendedActions: ['Check auth service'], createdAt: new Date('2024-01-15T10:00:00Z'), ...o };
}
beforeEach(() => jest.clearAllMocks());
describe('publishToSNS', () => {
  it('returns EmailResult', async () => {
    const r = await publishToSNS(SNS_TOPICS.escalation, 'Subj', 'Body');
    expect(r.messageId).toMatch(/^msg-/);
    expect(r.topicArn).toBe(SNS_TOPICS.escalation);
  });
});
describe('sendEmailNotification', () => {
  it('resolves without throwing', async () => {
    await expect(sendEmailNotification('a@b.com', 'S', 'B')).resolves.toBeUndefined();
  });
});
describe('sendEscalationEmail', () => {
  it('returns EmailResult', async () => {
    const r = await sendEscalationEmail('TKT-42', mkDecision({ urgency: 'critical' }));
    expect(r).not.toBeNull();
    expect(r!.topicArn).toBe(SNS_TOPICS.escalation);
  });
  it('works when assignTo undefined', async () => {
    expect(await sendEscalationEmail('TKT-99', mkDecision({ assignTo: undefined }))).not.toBeNull();
  });
});
