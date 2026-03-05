/**
 * API client — all calls go through the deployed API Gateway with Cognito JWT auth.
 */
const API = (() => {
  const base = CONFIG.API_URL;

  async function request(method, path, body) {
    const token = await Auth.getValidIdToken();
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: token } : {}),
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${base}${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data;
  }

  return {
    // Ticket CRUD
    createTicket: (payload) => request('POST', '/tickets', payload),
    listTickets: (status) => request('GET', `/tickets${status ? `?status=${status}` : ''}`),
    getTicket: (id) => request('GET', `/tickets/${id}`),
    updateTicketStatus: (id, status) => request('PUT', `/tickets/${id}/status`, { status }),
    assignTicket: (id, assignedTeam, assignedTo) => request('PUT', `/tickets/${id}/status`, { assignedTeam, assignedTo, status: 'assigned' }),
    uploadAttachment: (ticketId, fileName, fileType, fileSize) =>
      request('POST', `/tickets/${ticketId}/attachments`, { ticketId, fileName, fileType, fileSize }),
    getAttachments: (ticketId) => request('GET', `/tickets/${ticketId}/attachments`),

    // AI Analysis
    analyzeTicket: (ticketId) => request('POST', `/tickets/${ticketId}/analyze`),

    // Similar tickets
    searchSimilar: (ticketId) => request('GET', `/tickets/${ticketId}/similar`),

    // Knowledge base
    listArticles: (category) => request('GET', `/knowledge-base${category ? `?category=${category}` : ''}`),
    searchKnowledge: (query) => request('POST', '/knowledge-base', { query }),

    // Analytics
    getAnalytics: (period) => request('GET', `/admin/analytics${period ? `?period=${period}` : ''}`),

    // Notifications
    getNotifications: (userId, unreadOnly) =>
      request('GET', `/notifications?userId=${encodeURIComponent(userId)}${unreadOnly ? '&unreadOnly=true' : ''}`),
    markNotificationRead: (notificationId, userId) =>
      request('PUT', '/notifications', { notificationId, userId }),

    // Teams
    listTeams: () => request('GET', '/admin/teams'),
    addTeamMember: (teamId, member) => request('POST', `/admin/teams/${teamId}/members`, member),
    removeTeamMember: (teamId, email) => request('DELETE', `/admin/teams/${teamId}/members?email=${encodeURIComponent(email)}`),

    // Ticket messages
    getTicketMessages: (ticketId) => request('GET', `/tickets/${ticketId}/messages`),

    // Resolve ticket
    resolveTicket: (id, resolution, rootCause) =>
      request('PUT', `/tickets/${id}/resolve`, { resolution, rootCause, resolvedBy: Auth.getEmail() }),

    // Send resolution email to user
    sendResolutionEmail: (ticketId) =>
      request('POST', `/tickets/${ticketId}/send-resolution-email`),

    // AI-Suggested Solutions
    getSuggestedSolutions: (ticketId) => request('GET', `/tickets/${ticketId}/similar`),
    searchKnowledgeFallback: (query) => request('POST', '/knowledge-base', { query }),
    recordSolutionFeedback: (solutionId, wasHelpful) =>
      request('POST', `/solutions/${solutionId}/feedback`, { wasHelpful }),

    // Ticket Timeline / Activity Log
    getTicketActivities: (ticketId, lastKey) => {
      const params = new URLSearchParams();
      if (lastKey) params.set('lastKey', lastKey);
      const qs = params.toString();
      return request('GET', `/tickets/${ticketId}/activities${qs ? `?${qs}` : ''}`);
    },

    // Canned Responses CRUD
    listCannedResponses: () => request('GET', '/admin/canned-responses'),
    createCannedResponse: (data) => request('POST', '/admin/canned-responses', data),
    updateCannedResponse: (id, data) => request('PUT', `/admin/canned-responses/${id}`, data),
    deleteCannedResponse: (id) => request('DELETE', `/admin/canned-responses/${id}`),

    // SLA Dashboard
    getSLADashboard: () => request('GET', '/admin/sla-dashboard'),

    // Ticket Merge
    mergeTicket: (ticketId, primaryTicketId) => request('POST', `/tickets/${ticketId}/merge`, { primaryTicketId }),

    // AI-Generated Solution (Nova)
    getAISolution: (ticketId) => request('POST', `/tickets/${ticketId}/ai-solution`),

    // Delete ticket (admin only)
    deleteTicket: (id) => request('DELETE', `/tickets/${id}`),

    // Translation
    translateText: (text, targetLanguage) => request('POST', '/translate', { text, targetLanguage }),
  };
})();
