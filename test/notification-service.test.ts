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

describe('sendAlertEmail', () => {
  it('returns EmailResult for spike', async () => {
    const r = await sendAlertEmail(mkAlert());
    expect(r).not.toBeNull();
    expect(r!.topicArn).toBe(SNS_TOPICS.alerts);
  });
  it('handles critical_service', async () => {
    expect(await sendAlertEmail(mkAlert({ type: 'critical_service' }))).not.toBeNull();
  });
  it('handles empty actions', async () => {
    expect(await sendAlertEmail(mkAlert({ recommendedActions: [] }))).not.toBeNull();
  });
});

describe('sendFollowUpEmail', () => {
  it('returns EmailResult', async () => {
    const r = await sendFollowUpEmail('user-1', 'TKT-10', 'Please update.');
    expect(r).not.toBeNull();
    expect(r!.topicArn).toBe(SNS_TOPICS.followUps);
  });
});

describe('createInAppNotification', () => {
  it('stores in DynamoDB and returns notification', async () => {
    const n = await createInAppNotification('agent-1', 'escalation', 'Esc: TKT-1', 'Needs attention', 'TKT-1');
    expect(n.notificationId).toMatch(/^NOTIF-/);
    expect(n.userId).toBe('agent-1');
    expect(n.type).toBe('escalation');
    expect(n.read).toBe(false);
    expect(n.ticketId).toBe('TKT-1');
    expect(n.createdAt).toBeInstanceOf(Date);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const s = mockPutItem.mock.calls[0][0];
    expect(s.PK).toBe('NOTIFICATION#agent-1');
    expect(s.read).toBe(false);
  });
  it('creates alert without ticketId', async () => {
    const n = await createInAppNotification('mgr-1', 'alert', 'Alert', 'Spike');
    expect(n.type).toBe('alert');
    expect(n.ticketId).toBeUndefined();
  });
  it('creates follow_up notification', async () => {
    const n = await createInAppNotification('user-1', 'follow_up', 'FU: TKT-5', 'Respond', 'TKT-5');
    expect(n.type).toBe('follow_up');
    expect(n.ticketId).toBe('TKT-5');
  });
});

describe('sendInAppNotification', () => {
  it('stores with correct DynamoDB keys', async () => {
    const notif: InAppNotification = {
      notificationId: 'NOTIF-abc', userId: 'agent-1', type: 'escalation',
      title: 'Esc: TKT-1', message: 'Needs attention', ticketId: 'TKT-1',
      read: false, createdAt: new Date('2024-01-15T10:00:00Z'),
    };
    await sendInAppNotification('agent-1', notif);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const s = mockPutItem.mock.calls[0][0];
    expect(s.PK).toBe('NOTIFICATION#agent-1');
    expect(s.SK).toBe('NOTIF-abc');
    expect(s.read).toBe(false);
  });
});

describe('sendEscalationNotification', () => {
  it('sends both email and in-app', async () => {
    await sendEscalationNotification('TKT-42', mkDecision({ assignTo: 'sec-team' }));
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const s = mockPutItem.mock.calls[0][0];
    expect(s.PK).toBe('NOTIFICATION#sec-team');
    expect(s.type).toBe('escalation');
    expect(s.ticketId).toBe('TKT-42');
  });
  it('defaults to senior-support', async () => {
    await sendEscalationNotification('TKT-99', mkDecision({ assignTo: undefined }));
    expect(mockPutItem.mock.calls[0][0].PK).toBe('NOTIFICATION#senior-support');
  });
  it('includes summary in message', async () => {
    await sendEscalationNotification('TKT-5', mkDecision({ summary: 'Low confidence' }));
    expect(mockPutItem.mock.calls[0][0].message).toBe('Low confidence');
  });
});

describe('sendAlertNotification', () => {
  it('sends to all recipients', async () => {
    await sendAlertNotification(mkAlert(), ['mgr-1', 'mgr-2']);
    expect(mockPutItem).toHaveBeenCalledTimes(2);
    expect(mockPutItem.mock.calls[0][0].PK).toBe('NOTIFICATION#mgr-1');
    expect(mockPutItem.mock.calls[1][0].PK).toBe('NOTIFICATION#mgr-2');
  });
  it('handles empty recipients', async () => {
    await sendAlertNotification(mkAlert(), []);
    expect(mockPutItem).not.toHaveBeenCalled();
  });
});

describe('sendFollowUpNotification', () => {
  it('sends email and in-app', async () => {
    await sendFollowUpNotification('user-1', 'TKT-10', 'Please update.');
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const s = mockPutItem.mock.calls[0][0];
    expect(s.PK).toBe('NOTIFICATION#user-1');
    expect(s.type).toBe('follow_up');
    expect(s.ticketId).toBe('TKT-10');
  });
});

describe('updateTicketStatusToEscalated', () => {
  it('updates ticket metadata', async () => {
    const d = mkDecision({ reason: EscalationReason.SECURITY_ISSUE, urgency: 'critical', assignTo: 'sec-team', summary: 'Breach', attemptedSolutions: ['Auto'] });
    await updateTicketStatusToEscalated('TKT-10', d);
    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const [pk, sk, , values, names] = mockUpdateItem.mock.calls[0];
    expect(pk).toBe('TICKET#TKT-10');
    expect(sk).toBe('METADATA');
    expect(values[':status']).toBe('escalated');
    expect(values[':reason']).toBe(EscalationReason.SECURITY_ISSUE);
    expect(names).toEqual({ '#status': 'status' });
  });
  it('defaults assignTo', async () => {
    await updateTicketStatusToEscalated('TKT-11', mkDecision({ assignTo: undefined }));
    expect(mockUpdateItem.mock.calls[0][3][':assignTo']).toBe('senior-support');
  });
});

describe('getNotifications', () => {
  it('queries with correct PK', async () => {
    mockQueryItems.mockResolvedValueOnce([]);
    await getNotifications('agent-1');
    expect(mockQueryItems).toHaveBeenCalledWith('PK = :pk', { ':pk': 'NOTIFICATION#agent-1' });
  });
  it('maps items correctly', async () => {
    mockQueryItems.mockResolvedValueOnce([{ notificationId: 'N1', userId: 'a', type: 'escalation', title: 'T', message: 'M', ticketId: 'TKT-1', read: false, createdAt: '2024-01-15T10:00:00.000Z' }]);
    const ns = await getNotifications('a');
    expect(ns).toHaveLength(1);
    expect(ns[0].read).toBe(false);
    expect(ns[0].createdAt).toBeInstanceOf(Date);
  });
  it('returns empty when none', async () => {
    mockQueryItems.mockResolvedValueOnce([]);
    expect(await getNotifications('nobody')).toEqual([]);
  });
  it('filters unread only', async () => {
    mockQueryItems.mockResolvedValueOnce([
      { notificationId: 'N1', userId: 'a', type: 'escalation', title: 'R', message: 'r', read: true, createdAt: '2024-01-15T10:00:00Z' },
      { notificationId: 'N2', userId: 'a', type: 'alert', title: 'U', message: 'u', read: false, createdAt: '2024-01-15T11:00:00Z' },
    ]);
    const ns = await getNotifications('a', { unreadOnly: true });
    expect(ns).toHaveLength(1);
    expect(ns[0].notificationId).toBe('N2');
  });
  it('sorts most recent first', async () => {
    mockQueryItems.mockResolvedValueOnce([
      { notificationId: 'OLD', userId: 'a', type: 'escalation', title: 'O', message: 'o', read: false, createdAt: '2024-01-10T10:00:00Z' },
      { notificationId: 'NEW', userId: 'a', type: 'alert', title: 'N', message: 'n', read: false, createdAt: '2024-01-20T10:00:00Z' },
    ]);
    const ns = await getNotifications('a');
    expect(ns[0].notificationId).toBe('NEW');
  });
});

describe('markNotificationRead', () => {
  it('updates read flag and readAt', async () => {
    await markNotificationRead('NOTIF-1', 'agent-1');
    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    const [pk, sk, expr, values, names] = mockUpdateItem.mock.calls[0];
    expect(pk).toBe('NOTIFICATION#agent-1');
    expect(sk).toBe('NOTIF-1');
    expect(expr).toBe('SET #read = :read, readAt = :readAt');
    expect(values[':read']).toBe(true);
    expect(values[':readAt']).toBeDefined();
    expect(names).toEqual({ '#read': 'read' });
  });
});

describe('markAsRead', () => {
  it('is alias for markNotificationRead', async () => {
    await markAsRead('NOTIF-2', 'agent-2');
    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
    expect(mockUpdateItem.mock.calls[0][0]).toBe('NOTIFICATION#agent-2');
  });
});

describe('markMultipleAsRead', () => {
  it('marks all as read', async () => {
    await markMultipleAsRead(['N1', 'N2', 'N3'], 'agent-1');
    expect(mockUpdateItem).toHaveBeenCalledTimes(3);
  });
  it('handles empty array', async () => {
    await markMultipleAsRead([], 'agent-1');
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });
});

describe('SNS failure handling', () => {
  it('does not throw on email failure', async () => {
    await expect(sendEmailNotification('bad@x.com', 'T', 'B')).resolves.toBeUndefined();
  });
  it('stores in-app even if email fails', async () => {
    await sendEscalationNotification('TKT-FAIL', mkDecision());
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  });
});
