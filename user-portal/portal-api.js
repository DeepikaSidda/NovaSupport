/**
 * Portal API client — authenticated fetch wrapper for the user-facing portal.
 * Attaches Cognito JWT token to all requests via PortalAuth.
 * Exposes only user-relevant endpoints: createTicket, listMyTickets, getTicket, requestUploadUrl.
 */
const PortalAPI = (() => {
  const base = CONFIG.API_URL;

  async function request(method, path, body) {
    let token;
    try {
      token = await PortalAuth.getValidIdToken();
    } catch(e) {
      token = PortalAuth.getIdToken();
    }
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {}),
      },
    };
    if (body) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(`${base}${path}`, opts);
    } catch (_err) {
      throw new Error('Unable to connect to the server. Check your internet connection.');
    }

    let data;
    try {
      data = await res.json();
    } catch (_err) {
      data = {};
    }

    if (!res.ok) {
      if (res.status === 401) {
        PortalAuth.signOut();
        location.hash = '#/';
        location.reload();
        throw new Error('Session expired. Please sign in again.');
      }
      if (res.status === 400) {
        const err = new Error(data.error?.message || 'Validation error');
        err.details = data.error?.details || [];
        throw err;
      }
      if (res.status === 404) {
        throw new Error('Ticket not found');
      }
      if (res.status === 409) {
        throw new Error(data.error?.message || 'This ticket can no longer be edited. It has been assigned to a team.');
      }
      if (res.status >= 500) {
        throw new Error('Service temporarily unavailable. Please try again later.');
      }
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }

    return data;
  }

  return {
    createTicket: (payload) => {
      // Add idempotency key to prevent duplicate ticket creation on retries
      const idempotencyKey = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      return request('POST', '/tickets', { ...payload, idempotencyKey });
    },

    listMyTickets: async (userId, status) => {
      const params = new URLSearchParams({ userId });
      if (status) params.set('status', status);
      const data = await request('GET', `/tickets?${params.toString()}`);
      return data;
    },

    getTicket: async (ticketId) => {
      const ticket = await request('GET', `/tickets/${ticketId}`);
      return ticket;
    },

    requestUploadUrl: (ticketId, fileName, fileType, fileSize) =>
      request('POST', `/tickets/${ticketId}/attachments`, { ticketId, fileName, fileType, fileSize }),

    editTicket: (ticketId, payload) => request('PUT', `/tickets/${ticketId}`, payload),

    addMessage: (ticketId, payload) => request('POST', `/tickets/${ticketId}/messages`, payload),

    getMessages: (ticketId) => request('GET', `/tickets/${ticketId}/messages`),

    sendChatMessage: (payload) => request('POST', '/chat', payload),

    transcribeAudio: (payload) => request('POST', '/voice/transcribe', payload),

    textToSpeech: (payload) => request('POST', '/voice/tts', payload),

    rateTicket: (ticketId, rating, feedback) =>
      request('PUT', `/tickets/${ticketId}/rate`, { rating, feedback }),

    // Ticket Timeline / Activity Log
    getTicketActivities: (ticketId, lastKey) => {
      const params = new URLSearchParams();
      if (lastKey) params.set('lastKey', lastKey);
      const qs = params.toString();
      return request('GET', `/tickets/${ticketId}/activities${qs ? `?${qs}` : ''}`);
    },
  };
})();
