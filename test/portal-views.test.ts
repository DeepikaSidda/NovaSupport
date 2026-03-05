import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for user-portal/portal-views.js
 *
 * Since portal-views.js is a browser IIFE module, we evaluate the script
 * using the Function constructor to get the PortalViews object.
 */

const scriptPath = path.join(__dirname, '..', 'user-portal', 'portal-views.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
const loadScript = new Function(scriptContent + '\nreturn PortalViews;');
const PV = loadScript();

describe('PortalViews — esc', () => {
  it('escapes HTML special characters', () => {
    expect(PV.esc('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands and single quotes', () => {
    expect(PV.esc("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
  });

  it('returns empty string for null/undefined', () => {
    expect(PV.esc(null)).toBe('');
    expect(PV.esc(undefined)).toBe('');
  });

  it('converts numbers to string', () => {
    expect(PV.esc(42)).toBe('42');
  });
});

describe('PortalViews — statusColor / statusLabel', () => {
  it('maps known statuses to correct colors', () => {
    expect(PV.statusColor('new')).toBe('blue');
    expect(PV.statusColor('analyzing')).toBe('teal');
    expect(PV.statusColor('escalated')).toBe('red');
    expect(PV.statusColor('closed')).toBe('gray');
  });

  it('returns gray for unknown status', () => {
    expect(PV.statusColor('unknown_status')).toBe('gray');
  });

  it('maps known statuses to correct labels', () => {
    expect(PV.statusLabel('new')).toBe('New');
    expect(PV.statusLabel('in_progress')).toBe('In Progress');
    expect(PV.statusLabel('pending_user')).toBe('Pending You');
  });

  it('returns the raw status string for unknown status', () => {
    expect(PV.statusLabel('custom')).toBe('custom');
  });

  it('returns Unknown for empty/falsy status', () => {
    expect(PV.statusLabel('')).toBe('Unknown');
    expect(PV.statusLabel(undefined)).toBe('Unknown');
  });
});

describe('PortalViews — priorityName / priorityLabel', () => {
  it('maps known priorities to names', () => {
    expect(PV.priorityName(1)).toBe('low');
    expect(PV.priorityName(5)).toBe('medium');
    expect(PV.priorityName(8)).toBe('high');
    expect(PV.priorityName(10)).toBe('critical');
  });

  it('defaults to medium for unknown priority', () => {
    expect(PV.priorityName(3)).toBe('medium');
    expect(PV.priorityName(99)).toBe('medium');
  });

  it('maps known priorities to labels', () => {
    expect(PV.priorityLabel(1)).toBe('Low');
    expect(PV.priorityLabel(10)).toBe('Critical');
  });

  it('defaults to Medium label for unknown priority', () => {
    expect(PV.priorityLabel(7)).toBe('Medium');
  });
});

describe('PortalViews — formatDate', () => {
  it('formats ISO date string to readable format', () => {
    const result = PV.formatDate('2025-01-15T10:30:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });

  it('returns empty string for falsy input', () => {
    expect(PV.formatDate('')).toBe('');
    expect(PV.formatDate(null)).toBe('');
    expect(PV.formatDate(undefined)).toBe('');
  });

  it('returns original string for invalid date', () => {
    expect(PV.formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('PortalViews — sortTicketsByDate', () => {
  it('sorts tickets by createdAt descending', () => {
    const tickets = [
      { ticketId: 'a', createdAt: '2025-01-01T00:00:00Z' },
      { ticketId: 'b', createdAt: '2025-03-01T00:00:00Z' },
      { ticketId: 'c', createdAt: '2025-02-01T00:00:00Z' },
    ];
    const sorted = PV.sortTicketsByDate(tickets);
    expect(sorted.map((t: any) => t.ticketId)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the original array', () => {
    const tickets = [
      { ticketId: 'a', createdAt: '2025-01-01T00:00:00Z' },
      { ticketId: 'b', createdAt: '2025-03-01T00:00:00Z' },
    ];
    const sorted = PV.sortTicketsByDate(tickets);
    expect(sorted).not.toBe(tickets);
    expect(tickets[0].ticketId).toBe('a');
  });

  it('returns empty array for non-array input', () => {
    expect(PV.sortTicketsByDate(null)).toEqual([]);
    expect(PV.sortTicketsByDate(undefined)).toEqual([]);
  });

  it('handles empty array', () => {
    expect(PV.sortTicketsByDate([])).toEqual([]);
  });
});

describe('PortalViews — filterTicketsByStatus', () => {
  const tickets = [
    { ticketId: 'a', status: 'new' },
    { ticketId: 'b', status: 'resolved' },
    { ticketId: 'c', status: 'new' },
    { ticketId: 'd', status: 'closed' },
  ];

  it('returns all tickets when status is empty', () => {
    expect(PV.filterTicketsByStatus(tickets, '')).toEqual(tickets);
    expect(PV.filterTicketsByStatus(tickets, null)).toEqual(tickets);
    expect(PV.filterTicketsByStatus(tickets, undefined)).toEqual(tickets);
  });

  it('filters tickets by matching status', () => {
    const result = PV.filterTicketsByStatus(tickets, 'new');
    expect(result).toHaveLength(2);
    expect(result.every((t: any) => t.status === 'new')).toBe(true);
  });

  it('returns empty array when no tickets match', () => {
    expect(PV.filterTicketsByStatus(tickets, 'escalated')).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(PV.filterTicketsByStatus(null, 'new')).toEqual([]);
  });
});

describe('PortalViews — renderTicketCard', () => {
  const ticket = {
    ticketId: 'abc12345-6789-0000-1111-222233334444',
    subject: 'Login issue',
    status: 'new',
    priority: 8,
    createdAt: '2025-06-01T12:00:00Z',
  };

  it('renders a clickable link with correct href', () => {
    const html = PV.renderTicketCard(ticket);
    expect(html).toContain('href="#/tickets/abc12345-6789-0000-1111-222233334444"');
  });

  it('shows first 8 chars of ticket ID', () => {
    const html = PV.renderTicketCard(ticket);
    expect(html).toContain('#abc12345');
  });

  it('includes subject text', () => {
    const html = PV.renderTicketCard(ticket);
    expect(html).toContain('Login issue');
  });

  it('includes status badge with correct color class', () => {
    const html = PV.renderTicketCard(ticket);
    expect(html).toContain('badge-blue');
    expect(html).toContain('New');
  });

  it('includes priority dot and label', () => {
    const html = PV.renderTicketCard(ticket);
    expect(html).toContain('priority-high');
    expect(html).toContain('High');
  });

  it('includes formatted creation date', () => {
    const html = PV.renderTicketCard(ticket);
    expect(html).toContain('Jun');
    expect(html).toContain('2025');
  });

  it('escapes HTML in subject', () => {
    const xssTicket = { ...ticket, subject: '<img onerror=alert(1)>' };
    const html = PV.renderTicketCard(xssTicket);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('PortalViews — renderTicketList', () => {
  const tickets = [
    { ticketId: 'aaa', subject: 'First', status: 'new', priority: 1, createdAt: '2025-01-01T00:00:00Z' },
    { ticketId: 'bbb', subject: 'Second', status: 'resolved', priority: 5, createdAt: '2025-03-01T00:00:00Z' },
    { ticketId: 'ccc', subject: 'Third', status: 'new', priority: 8, createdAt: '2025-02-01T00:00:00Z' },
  ];

  it('renders all tickets sorted by date descending', () => {
    const html = PV.renderTicketList(tickets, '');
    const firstIdx = html.indexOf('Second');
    const secondIdx = html.indexOf('Third');
    const thirdIdx = html.indexOf('First');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('filters by status when filterStatus is provided', () => {
    const html = PV.renderTicketList(tickets, 'new');
    expect(html).toContain('First');
    expect(html).toContain('Third');
    expect(html).not.toContain('Second');
  });

  it('shows empty state when no tickets exist', () => {
    const html = PV.renderTicketList([], '');
    expect(html).toContain('No tickets found');
    expect(html).toContain('href="#/new"');
    expect(html).toContain('Create your first ticket');
  });

  it('shows empty state when filter matches nothing', () => {
    const html = PV.renderTicketList(tickets, 'escalated');
    expect(html).toContain('No tickets found');
  });

  it('handles null/undefined tickets gracefully', () => {
    const html = PV.renderTicketList(null, '');
    expect(html).toContain('No tickets found');
  });
});

describe('PortalViews — exported configs', () => {
  it('exports STATUS_CONFIG with all 8 statuses', () => {
    expect(Object.keys(PV.STATUS_CONFIG)).toHaveLength(8);
    expect(PV.STATUS_CONFIG.new.label).toBe('New');
    expect(PV.STATUS_CONFIG.closed.color).toBe('gray');
  });

  it('exports PRIORITY_CONFIG with 4 levels', () => {
    expect(Object.keys(PV.PRIORITY_CONFIG)).toHaveLength(4);
    expect(PV.PRIORITY_CONFIG[1].name).toBe('low');
    expect(PV.PRIORITY_CONFIG[10].label).toBe('Critical');
  });
});

describe('PortalViews — renderTicketDetail', () => {
  const baseTicket = {
    ticketId: 'tid-001',
    userId: 'user-001',
    subject: 'Cannot access dashboard',
    description: 'When I click the dashboard link, nothing happens.',
    status: 'in_progress',
    priority: 8,
    assignedTo: 'agent-1',
    assignedTeam: 'Platform Team',
    createdAt: '2025-06-01T10:00:00Z',
    updatedAt: '2025-06-02T14:30:00Z',
    tags: ['dashboard', 'access'],
    category: 'bug',
    attachmentIds: ['att-001', 'att-002'],
  };

  it('includes all required fields', () => {
    const html = PV.renderTicketDetail(baseTicket);
    expect(html).toContain('Cannot access dashboard');
    expect(html).toContain('When I click the dashboard link, nothing happens.');
    expect(html).toContain('In Progress');
    expect(html).toContain('High');
    expect(html).toContain('Jun');
    expect(html).toContain('2025');
    expect(html).toContain('Platform Team');
    expect(html).toContain('dashboard');
    expect(html).toContain('access');
  });

  it('shows status badge with correct color class', () => {
    const html = PV.renderTicketDetail(baseTicket);
    expect(html).toContain('badge-orange');
    expect(html).toContain('In Progress');
  });

  it('shows priority dot with correct class', () => {
    const html = PV.renderTicketDetail(baseTicket);
    expect(html).toContain('priority-high');
  });

  it('shows back link to ticket list', () => {
    const html = PV.renderTicketDetail(baseTicket);
    expect(html).toContain('href="#/"');
    expect(html).toContain('detail-back');
    expect(html).toContain('My Tickets');
  });

  it('shows attachments when present', () => {
    const html = PV.renderTicketDetail(baseTicket);
    expect(html).toContain('detail-attachments');
    expect(html).toContain('attachment-list');
    expect(html).toContain('att-001');
    expect(html).toContain('att-002');
    expect(html).toContain('attachment-item');
  });

  it('hides attachments section when no attachments', () => {
    const noAttachTicket = { ...baseTicket, attachmentIds: [] };
    const html = PV.renderTicketDetail(noAttachTicket);
    expect(html).not.toContain('detail-attachments');
    expect(html).not.toContain('attachment-list');
  });

  it('hides attachments section when attachmentIds is missing', () => {
    const { attachmentIds, ...noField } = baseTicket;
    const html = PV.renderTicketDetail(noField);
    expect(html).not.toContain('detail-attachments');
  });

  it('shows "Unassigned" when assignedTeam is missing', () => {
    const noTeam = { ...baseTicket, assignedTeam: undefined };
    const html = PV.renderTicketDetail(noTeam);
    expect(html).toContain('Unassigned');
  });

  it('shows "None" when tags array is empty', () => {
    const noTags = { ...baseTicket, tags: [] };
    const html = PV.renderTicketDetail(noTags);
    expect(html).toContain('None');
  });

  it('escapes HTML in subject', () => {
    const xss = { ...baseTicket, subject: '<script>alert(1)</script>' };
    const html = PV.renderTicketDetail(xss);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in description', () => {
    const xss = { ...baseTicket, description: '<img onerror=alert(1)>' };
    const html = PV.renderTicketDetail(xss);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes HTML in tags', () => {
    const xss = { ...baseTicket, tags: ['<b>bold</b>'] };
    const html = PV.renderTicketDetail(xss);
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes HTML in assignedTeam', () => {
    const xss = { ...baseTicket, assignedTeam: '"><script>x</script>' };
    const html = PV.renderTicketDetail(xss);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in attachment IDs', () => {
    const xss = { ...baseTicket, attachmentIds: ['<img src=x>'] };
    const html = PV.renderTicketDetail(xss);
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });
});

describe('PortalViews — renderNotFound', () => {
  it('shows not-found message', () => {
    const html = PV.renderNotFound();
    expect(html).toContain('not-found');
    expect(html).toContain('Ticket not found');
  });

  it('provides link back to ticket list', () => {
    const html = PV.renderNotFound();
    expect(html).toContain('href="#/"');
    expect(html).toContain('Back to My Tickets');
  });
});

describe('PortalViews — renderErrorMessage', () => {
  it('renders message with details as a list', () => {
    const error = {
      message: 'Validation failed',
      details: ['Subject is required', 'Description too short'],
    };
    const html = PV.renderErrorMessage(error);
    expect(html).toContain('error-msg');
    expect(html).toContain('<p>Validation failed</p>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Subject is required</li>');
    expect(html).toContain('<li>Description too short</li>');
  });

  it('renders just the message when no details array', () => {
    const error = { message: 'Service temporarily unavailable. Please try again later.' };
    const html = PV.renderErrorMessage(error);
    expect(html).toContain('error-msg');
    expect(html).toContain('Service temporarily unavailable');
    expect(html).not.toContain('<ul>');
    expect(html).not.toContain('<li>');
  });

  it('escapes HTML in message', () => {
    const error = { message: '<script>alert("xss")</script>' };
    const html = PV.renderErrorMessage(error);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in details', () => {
    const error = {
      message: 'Error',
      details: ['<img onerror=alert(1)>'],
    };
    const html = PV.renderErrorMessage(error);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
  });

  it('handles empty details array like no details', () => {
    const error = { message: 'Some error', details: [] };
    const html = PV.renderErrorMessage(error);
    expect(html).toContain('error-msg');
    expect(html).toContain('Some error');
    expect(html).not.toContain('<ul>');
  });

  it('handles error with no message', () => {
    const error = {};
    const html = PV.renderErrorMessage(error);
    expect(html).toContain('error-msg');
    expect(html).toContain('An unexpected error occurred.');
  });

  it('handles null error', () => {
    const html = PV.renderErrorMessage(null);
    expect(html).toContain('error-msg');
    expect(html).toContain('An unexpected error occurred.');
  });

  it('handles undefined error', () => {
    const html = PV.renderErrorMessage(undefined);
    expect(html).toContain('error-msg');
    expect(html).toContain('An unexpected error occurred.');
  });
});

describe('PortalViews — renderApiError', () => {
  it('delegates to renderErrorMessage', () => {
    const error = { message: 'API error', details: ['field invalid'] };
    const apiHtml = PV.renderApiError(error);
    const errHtml = PV.renderErrorMessage(error);
    expect(apiHtml).toBe(errHtml);
  });

  it('renders network error message', () => {
    const error = { message: 'Unable to connect to the server. Check your internet connection.' };
    const html = PV.renderApiError(error);
    expect(html).toContain('Unable to connect to the server');
  });

  it('renders server error message', () => {
    const error = { message: 'Service temporarily unavailable. Please try again later.' };
    const html = PV.renderApiError(error);
    expect(html).toContain('Service temporarily unavailable');
  });
});
