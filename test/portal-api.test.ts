import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests for user-portal/portal-api.js
 *
 * Since portal-api.js is a browser IIFE module that depends on global CONFIG and PortalAuth,
 * we set up the globals and evaluate the script to get the PortalAPI object.
 */

// Set up browser-like globals
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;
(global as any).URLSearchParams = URLSearchParams;

(global as any).CONFIG = {
  API_URL: 'https://api.example.com/dev',
};

(global as any).PortalAuth = {
  getIdToken: jest.fn(() => 'mock-jwt-token'),
};

// Load and evaluate portal-api.js to get PortalAPI
const scriptPath = path.join(__dirname, '..', 'user-portal', 'portal-api.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
// Use Function constructor to evaluate in global scope so `const PortalAPI` becomes accessible
const loadScript = new Function(scriptContent + '\nreturn PortalAPI;');
const PortalAPI = loadScript();

function mockResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('PortalAPI', () => {
  describe('request wrapper', () => {
    it('attaches JWT token as Authorization header', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { ticketId: '123' }));

      await PortalAPI.createTicket({ userId: 'u1', subject: 'Test', description: 'Desc' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBe('mock-jwt-token');
    });

    it('omits Authorization header when no token', async () => {
      (global as any).PortalAuth.getIdToken.mockReturnValueOnce(null);
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await PortalAPI.getTicket('t1');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers.Authorization).toBeUndefined();
    });

    it('sets Content-Type to application/json', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, {}));

      await PortalAPI.getTicket('t1');

      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('error handling', () => {
    it('throws with details array on 400 response', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(400, {
          error: {
            message: 'Validation failed',
            details: ['Subject is required', 'Description is required'],
          },
        })
      );

      try {
        await PortalAPI.createTicket({});
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Validation failed');
        expect(err.details).toEqual(['Subject is required', 'Description is required']);
      }
    });

    it('throws with empty details array when 400 has no details', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(400, { error: { message: 'Bad request' } })
      );

      try {
        await PortalAPI.createTicket({});
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toBe('Bad request');
        expect(err.details).toEqual([]);
      }
    });

    it('throws "Ticket not found" on 404 response', async () => {
      mockFetch.mockResolvedValue(mockResponse(404, {}));

      await expect(PortalAPI.getTicket('nonexistent')).rejects.toThrow('Ticket not found');
    });

    it('throws service unavailable on 500 response', async () => {
      mockFetch.mockResolvedValue(mockResponse(500, {}));

      await expect(PortalAPI.getTicket('t1')).rejects.toThrow(
        'Service temporarily unavailable. Please try again later.'
      );
    });

    it('throws service unavailable on 503 response', async () => {
      mockFetch.mockResolvedValue(mockResponse(503, {}));

      await expect(PortalAPI.getTicket('t1')).rejects.toThrow(
        'Service temporarily unavailable. Please try again later.'
      );
    });

    it('throws network error message when fetch fails', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(PortalAPI.createTicket({})).rejects.toThrow(
        'Unable to connect to the server. Check your internet connection.'
      );
    });

    it('throws generic error with message for other HTTP errors', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(403, { error: { message: 'Forbidden' } })
      );

      await expect(PortalAPI.getTicket('t1')).rejects.toThrow('Forbidden');
    });

    it('throws generic HTTP error when no error message in body', async () => {
      mockFetch.mockResolvedValue(mockResponse(403, {}));

      await expect(PortalAPI.getTicket('t1')).rejects.toThrow('HTTP 403');
    });
  });

  describe('createTicket', () => {
    it('sends POST to /tickets with payload', async () => {
      const payload = { userId: 'u1', subject: 'Help', description: 'Need help', priority: 5 };
      mockFetch.mockResolvedValue(
        mockResponse(200, { ticketId: 'tk-1', status: 'new', priority: 5 })
      );

      const result = await PortalAPI.createTicket(payload);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/dev/tickets');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual(payload);
      expect(result.ticketId).toBe('tk-1');
    });
  });

  describe('listMyTickets', () => {
    it('sends GET with userId param', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { tickets: [] }));

      await PortalAPI.listMyTickets('user-123');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/dev/tickets?userId=user-123');
      expect(opts.method).toBe('GET');
    });

    it('includes status param when provided', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { tickets: [] }));

      await PortalAPI.listMyTickets('user-123', 'resolved');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/dev/tickets?userId=user-123&status=resolved');
    });

    it('omits status param when not provided', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { tickets: [] }));

      await PortalAPI.listMyTickets('user-123');

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain('status=');
    });
  });

  describe('getTicket', () => {
    it('sends GET to /tickets/:id', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(200, { ticketId: 'tk-42', subject: 'Issue' })
      );

      const result = await PortalAPI.getTicket('tk-42');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/dev/tickets/tk-42');
      expect(opts.method).toBe('GET');
      expect(result.ticketId).toBe('tk-42');
    });
  });

  describe('requestUploadUrl', () => {
    it('sends POST to /tickets/:id/attachments with file metadata', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(200, { attachmentId: 'att-1', uploadUrl: 'https://s3.example.com/upload' })
      );

      const result = await PortalAPI.requestUploadUrl('tk-1', 'screenshot.png', 'image/png', 1024);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/dev/tickets/tk-1/attachments');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({
        ticketId: 'tk-1',
        fileName: 'screenshot.png',
        fileType: 'image/png',
        fileSize: 1024,
      });
      expect(result.attachmentId).toBe('att-1');
    });
  });
});
