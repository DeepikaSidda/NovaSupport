/**
 * Agent API client — authenticated fetch wrapper for the Team Member Portal.
 * Attaches Cognito JWT via AgentAuth. Handles errors with user-friendly messages.
 */
const AgentAPI = (() => {
  const base = CONFIG.API_URL;

  async function request(method, path, body) {
    let token;
    try {
      token = await AgentAuth.getValidIdToken();
    } catch (e) {
      token = AgentAuth.getIdToken();
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
        AgentAuth.signOut();
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
        throw new Error(data.error?.message || 'Ticket already claimed by another agent.');
      }
      if (res.status >= 500) {
        throw new Error('Service temporarily unavailable. Please try again later.');
      }
      throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    return data;
  }

  return {
    listTickets: (status) => request('GET', `/tickets${status ? `?status=${status}` : ''}`),
    getTicket: (id) => request('GET', `/tickets/${id}`),
    updateTicketStatus: (id, status, assignedTo) => {
      const body = { status };
      if (assignedTo) body.assignedTo = assignedTo;
      return request('PUT', `/tickets/${id}/status`, body);
    },
    getTicketMessages: (id) => request('GET', `/tickets/${id}/messages`),
    sendMessage: (id, payload) => request('POST', `/tickets/${id}/messages`, payload),
    resolveTicket: (id, resolution, rootCause) =>
      request('PUT', `/tickets/${id}/resolve`, { resolution, rootCause, resolvedBy: AgentAuth.getEmail() }),
    listTeams: () => request('GET', '/admin/teams'),
    translateText: (text, targetLanguage) => request('POST', '/translate', { text, targetLanguage }),
  };
})();
