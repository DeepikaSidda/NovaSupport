/**
 * Portal Views — rendering helpers and view functions for the user-facing portal.
 * Exports helper utilities (esc, statusColor, statusLabel, etc.) and view renderers
 * (renderTicketList, renderTicketCard) consumed by portal-app.js and tests.
 */
const PortalViews = (() => {
  const STATUS_CONFIG = {
    new:          { label: 'New',               color: 'blue' },
    analyzing:    { label: 'Analyzing',         color: 'teal' },
    assigned:     { label: 'Assigned',          color: 'purple' },
    in_progress:  { label: 'Working on it',     color: 'orange' },
    pending_user: { label: 'Need Your Details', color: 'yellow' },
    processing:   { label: 'Processing',        color: 'teal' },
    escalated:    { label: 'Escalated',         color: 'red' },
    resolved:     { label: 'Resolved',          color: 'green' },
    closed:       { label: 'Closed',            color: 'gray' },
  };

  const PRIORITY_CONFIG = {
    1:  { label: 'Low',      name: 'low' },
    5:  { label: 'Medium',   name: 'medium' },
    8:  { label: 'High',     name: 'high' },
    10: { label: 'Critical', name: 'critical' },
  };

  /** HTML-escape a string to prevent XSS. */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Return the badge color class name for a status string. */
  function statusColor(status) {
    const cfg = STATUS_CONFIG[status];
    return cfg ? cfg.color : 'gray';
  }

  /** Return the human-readable label for a status string. */
  function statusLabel(status) {
    const cfg = STATUS_CONFIG[status];
    return cfg ? cfg.label : status || 'Unknown';
  }

  /** Return the name key (low, medium, high, critical) for a priority number. */
  function priorityName(priority) {
    const cfg = PRIORITY_CONFIG[priority];
    return cfg ? cfg.name : 'medium';
  }

  /** Return the display label for a priority number. */
  function priorityLabel(priority) {
    const cfg = PRIORITY_CONFIG[priority];
    return cfg ? cfg.label : 'Medium';
  }

  /** Format an ISO date string to a readable format (e.g. "Jan 15, 2025"). */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_e) {
      return dateStr;
    }
  }

  /** Sort tickets by createdAt descending (newest first). Returns a new array. */
  function sortTicketsByDate(tickets) {
    if (!Array.isArray(tickets)) return [];
    return tickets.slice().sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime();
      const db = new Date(b.createdAt || 0).getTime();
      return db - da;
    });
  }

  /** Filter tickets by status. Returns all tickets if status is empty/falsy. */
  function filterTicketsByStatus(tickets, status) {
    if (!Array.isArray(tickets)) return [];
    if (!status) return tickets;
    return tickets.filter((t) => t.status === status);
  }

  /**
   * Render a single ticket card as an HTML string.
   * Each card is a clickable link to #/tickets/{ticketId}.
   */
  function renderTicketCard(ticket) {
    const id = esc((ticket.ticketId || '').substring(0, 8));
    const subject = esc(ticket.subject);
    const status = ticket.status || '';
    const color = statusColor(status);
    const label = statusLabel(status);
    const pName = priorityName(ticket.priority);
    const pLabel = priorityLabel(ticket.priority);
    const date = formatDate(ticket.createdAt);

    return `<a class="ticket-card" href="#/tickets/${esc(ticket.ticketId)}">
  <div class="ticket-card-header">
    <span class="ticket-id">#${id}</span>
    <span class="badge badge-${esc(color)}">${esc(label)}</span>
  </div>
  <div class="ticket-card-subject">${subject}</div>
  <div class="ticket-card-meta">
    <span class="priority-dot priority-${esc(pName)}"></span>
    <span>${esc(pLabel)}</span>
    <span>·</span>
    <span>${esc(date)}</span>
  </div>
</a>`;
  }

  /**
   * Render the full ticket list HTML including status filter results.
   * Sorts by creation date descending, filters by status if provided.
   * Shows empty state with link to create ticket when no tickets match.
   */
  function renderTicketList(tickets, filterStatus) {
    const sorted = sortTicketsByDate(tickets || []);
    const filtered = filterTicketsByStatus(sorted, filterStatus);

    if (filtered.length === 0) {
      return `<div class="empty-state">
  <p>No tickets found.</p>
  <p><a href="#/new">Create your first ticket</a></p>
</div>`;
    }

    return filtered.map((t) => renderTicketCard(t)).join('\n');
  }

  /**
   * Render the full ticket detail view as an HTML string.
   * Shows all ticket fields: subject, description, status, priority,
   * dates, assigned team, tags, and attachments (if any).
   */
  function renderTicketDetail(ticket) {
    const subject = esc(ticket.subject);
    const description = esc(ticket.description);
    const status = ticket.status || '';
    const color = statusColor(status);
    const label = statusLabel(status);
    const pName = priorityName(ticket.priority);
    const pLabel = priorityLabel(ticket.priority);
    const created = formatDate(ticket.createdAt);
    const updated = formatDate(ticket.updatedAt);
    const team = esc(ticket.assignedTeam || 'Unassigned');
    const tags = Array.isArray(ticket.tags) ? ticket.tags : [];

    let html = `<a class="detail-back" href="#/">← My Tickets</a>
<div class="detail-header"><h2>${subject}</h2></div>
<div class="detail-grid">
  <div class="detail-row"><span class="detail-label">Status</span><span class="badge badge-${esc(color)}">${esc(label)}</span></div>
  <div class="detail-row"><span class="detail-label">Priority</span><span><span class="priority-dot priority-${esc(pName)}"></span> ${esc(pLabel)}</span></div>
  <div class="detail-row"><span class="detail-label">Created</span><span>${esc(created)}</span></div>
  <div class="detail-row"><span class="detail-label">Last Updated</span><span>${esc(updated)}</span></div>
  <div class="detail-row"><span class="detail-label">Assigned Team</span><span>${team}</span></div>
  <div class="detail-row"><span class="detail-label">Category</span><span>${esc(ticket.category || 'Pending classification')}</span></div>
  <div class="detail-row"><span class="detail-label">Tags</span><span>${tags.length > 0 ? tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : 'None'}</span></div>
</div>
${renderSLAInfo(ticket)}
<div class="detail-description"><h4>Description</h4><p>${description}</p></div>`;

    // Show resolution if ticket is resolved
    if (ticket.status === 'resolved' && ticket.resolution) {
      html += `\n<div class="resolution-section">
  <h4>✅ Resolution</h4>
  <div class="resolution-text">${esc(ticket.resolution)}</div>
  ${ticket.rootCause ? `<div class="resolution-root-cause"><strong>Root Cause:</strong> ${esc(ticket.rootCause)}</div>` : ''}
  ${ticket.resolvedAt ? `<div class="resolution-meta">Resolved on ${esc(formatDate(ticket.resolvedAt))}</div>` : ''}
</div>`;
    }

    const attachments = Array.isArray(ticket.attachmentIds) ? ticket.attachmentIds : [];
    if (attachments.length > 0) {
      html += `\n<div class="detail-attachments"><h4>Attachments</h4><div class="attachment-list">`;
      html += attachments.map((id) => `<div class="attachment-item">📎 ${esc(id)}</div>`).join('');
      html += `</div></div>`;
    }

    return html;
  }

  /**
   * Render a not-found message with a link back to the ticket list.
   */
  function renderNotFound() {
    return `<div class="not-found"><h3>Ticket not found</h3><p>The ticket you requested does not exist or you do not have access.</p><a href="#/">Back to My Tickets</a></div>`;
  }

  /**
   * Render an error message HTML string.
   * If the error has a `details` array with items, renders the message plus a <ul> list of each detail.
   * Otherwise, renders just the error message in a paragraph.
   * All content is HTML-escaped.
   */
  function renderErrorMessage(error) {
    const message = esc((error && error.message) || 'An unexpected error occurred.');
    const details = error && Array.isArray(error.details) ? error.details : [];

    if (details.length > 0) {
      const items = details.map((d) => `<li>${esc(d)}</li>`).join('');
      return `<div class="error-msg"><p>${message}</p><ul>${items}</ul></div>`;
    }

    return `<div class="error-msg"><p>${message}</p></div>`;
  }

  /**
   * Render an API error. Wrapper around renderErrorMessage for API-specific errors.
   */
  function renderApiError(error) {
    return renderErrorMessage(error);
  }

  /** Return true if the ticket status allows direct editing ("new" or "analyzing"). */
  function isEditableStatus(status) {
    return status === 'new' || status === 'analyzing';
  }

  /**
   * Render a list of messages as HTML.
   * Shows empty state when no messages exist.
   * Supports translation display for non-English tickets.
   */
  function renderMessageList(messages, ticket) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return '<p class="empty-state">No messages yet.</p>';
    }
    const isNonEnglish = ticket && ticket.detectedLanguage && ticket.detectedLanguage !== 'en';
    return messages.map((msg) => {
      const hasTranslation = isNonEnglish && msg.translatedContent;
      const displayContent = hasTranslation ? msg.translatedContent : msg.content;
      const originalContent = msg.content;
      return `<div class="message-item">
  <div class="message-content" data-original="${esc(originalContent)}" data-translated="${esc(hasTranslation ? msg.translatedContent : '')}">${esc(displayContent)}</div>
  ${hasTranslation ? `<div class="message-view-original">
    <button class="btn-link view-original-toggle" data-showing="translated">View original</button>
  </div>` : ''}
  <div class="message-meta"><span>${esc(msg.userId)}</span> · <span>${esc(formatDate(msg.createdAt))}</span><button class="tts-play-btn" data-text="${esc(displayContent)}" title="Listen to message">🔊 Listen</button></div>
</div>`;
    }).join('\n');
  }

  /**
   * Render the ticket detail view with an inline edit form.
   * Used for tickets with editable status ("new" or "analyzing").
   */
  function renderEditableTicketDetail(ticket) {
    const id = esc((ticket.ticketId || '').substring(0, 8));
    const status = ticket.status || '';
    const color = statusColor(status);
    const label = statusLabel(status);
    const created = formatDate(ticket.createdAt);
    const updated = formatDate(ticket.updatedAt);
    const team = esc(ticket.assignedTeam || 'Unassigned');
    const tags = Array.isArray(ticket.tags) ? ticket.tags : [];

    const priorityOptions = [1, 5, 8, 10].map((v) => {
      const selected = ticket.priority === v ? ' selected' : '';
      return `<option value="${v}"${selected}>${esc(PRIORITY_CONFIG[v].label)}</option>`;
    }).join('');

    return `<a class="detail-back" href="#/">← My Tickets</a>
<div class="detail-header">
  <span class="ticket-id">#${id}</span>
  <span class="badge badge-${esc(color)}">${esc(label)}</span>
</div>
<form class="edit-form">
  <div class="form-group">
    <label for="edit-subject">Subject</label>
    <input type="text" id="edit-subject" value="${esc(ticket.subject)}" />
  </div>
  <div class="form-group">
    <label for="edit-description">Description</label>
    <textarea id="edit-description">${esc(ticket.description)}</textarea>
  </div>
  <div class="form-group">
    <label for="edit-priority">Priority</label>
    <select id="edit-priority">${priorityOptions}</select>
  </div>
  <div id="edit-error" class="field-error hidden"></div>
  <button type="submit" id="edit-submit-btn" class="btn-primary">Save Changes</button>
  <a href="#/" class="btn-cancel">Cancel</a>
</form>
<div class="detail-grid">
  <div class="detail-row"><span class="detail-label">Created</span><span>${esc(created)}</span></div>
  <div class="detail-row"><span class="detail-label">Last Updated</span><span>${esc(updated)}</span></div>
  <div class="detail-row"><span class="detail-label">Assigned Team</span><span>${team}</span></div>
  <div class="detail-row"><span class="detail-label">Tags</span><span>${tags.length > 0 ? tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : 'None'}</span></div>
</div>`;
  }

  /**
   * Render the ticket detail view with read-only info and a message form.
   * Used for tickets with assigned status.
   */
  function renderAssignedTicketDetail(ticket, messages) {
    const subject = esc(ticket.subject);
    const description = esc(ticket.description);
    const status = ticket.status || '';
    const color = statusColor(status);
    const label = statusLabel(status);
    const pName = priorityName(ticket.priority);
    const pLabel = priorityLabel(ticket.priority);
    const created = formatDate(ticket.createdAt);
    const updated = formatDate(ticket.updatedAt);
    const team = esc(ticket.assignedTeam || 'Unassigned');
    const tags = Array.isArray(ticket.tags) ? ticket.tags : [];

    return `<a class="detail-back" href="#/">← My Tickets</a>
<div class="detail-header"><h2>${subject}</h2></div>
${ticket.detectedLanguage && ticket.detectedLanguage !== 'en' ? `<div class="lang-badge-row"><span class="lang-badge">🌐 ${esc(getPortalLanguageName(ticket.detectedLanguage))}</span></div>` : ''}
<div class="detail-grid">
  <div class="detail-row"><span class="detail-label">Status</span><span class="badge badge-${esc(color)}">${esc(label)}</span></div>
  <div class="detail-row"><span class="detail-label">Priority</span><span><span class="priority-dot priority-${esc(pName)}"></span> ${esc(pLabel)}</span></div>
  <div class="detail-row"><span class="detail-label">Created</span><span>${esc(created)}</span></div>
  <div class="detail-row"><span class="detail-label">Last Updated</span><span>${esc(updated)}</span></div>
  <div class="detail-row"><span class="detail-label">Assigned Team</span><span>${team}</span></div>
  <div class="detail-row"><span class="detail-label">Category</span><span>${esc(ticket.category || 'Pending classification')}</span></div>
  <div class="detail-row"><span class="detail-label">Tags</span><span>${tags.length > 0 ? tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : 'None'}</span></div>
</div>
${renderSLAInfo(ticket)}
<div class="detail-description"><h4>Description</h4><p>${description}</p></div>
${ticket.status === 'resolved' && ticket.resolution ? `<div class="resolution-section">
  <h4>✅ Resolution</h4>
  <div class="resolution-text">${esc(ticket.resolution)}</div>
  ${ticket.rootCause ? `<div class="resolution-root-cause"><strong>Root Cause:</strong> ${esc(ticket.rootCause)}</div>` : ''}
  ${ticket.resolvedAt ? `<div class="resolution-meta">Resolved on ${esc(formatDate(ticket.resolvedAt))}</div>` : ''}
</div>` : ''}
<div class="message-section">
  <h4>Messages</h4>
  <div class="message-list">${renderMessageList(messages || [], ticket)}</div>
  <form class="message-form">
    <div class="form-group">
      <textarea id="message-content" placeholder="Type your message to the support team..."></textarea>
    </div>
    <div id="message-error" class="field-error hidden"></div>
    <button type="submit" id="message-submit-btn" class="btn-primary">Send Message</button>
  </form>
</div>`;
  }

  /**
   * Render SLA tracking info for a ticket detail view.
   */
  function renderSLAInfo(ticket) {
    if (!ticket.slaResponseDeadline && !ticket.slaResolutionDeadline) {
      return '';
    }

    const now = new Date();
    const respDeadline = ticket.slaResponseDeadline ? new Date(ticket.slaResponseDeadline) : null;
    const resDeadline = ticket.slaResolutionDeadline ? new Date(ticket.slaResolutionDeadline) : null;
    const resolved = ticket.status === 'resolved' || ticket.status === 'closed';

    function timeLeft(deadline, doneAt) {
      if (!deadline) return { text: 'N/A', cls: '' };
      const ref = doneAt ? new Date(doneAt) : now;
      const diff = deadline.getTime() - ref.getTime();
      const mins = Math.round(diff / 60000);
      if (mins < 0) {
        const absMins = Math.abs(mins);
        if (absMins >= 60) return { text: `Breached by ${Math.round(absMins / 60)}h ${absMins % 60}m`, cls: 'sla-breached' };
        return { text: `Breached by ${absMins}m`, cls: 'sla-breached' };
      }
      if (mins < 60) return { text: `${mins}m remaining`, cls: mins < 15 ? 'sla-warning' : 'sla-ok' };
      return { text: `${Math.floor(mins / 60)}h ${mins % 60}m remaining`, cls: 'sla-ok' };
    }

    const resp = timeLeft(respDeadline, ticket.firstResponseAt);
    const res = timeLeft(resDeadline, resolved ? (ticket.resolvedAt || null) : null);

    return `<div class="sla-section">
  <h4>⏱ SLA Tracking</h4>
  <div class="sla-grid">
    <div class="sla-item">
      <span class="sla-label">First Response</span>
      <span class="sla-value ${esc(resp.cls)}">${ticket.firstResponseAt ? '✅ Responded' : esc(resp.text)}</span>
    </div>
    <div class="sla-item">
      <span class="sla-label">Resolution</span>
      <span class="sla-value ${esc(res.cls)}">${resolved ? '✅ Resolved' : esc(res.text)}</span>
    </div>
  </div>
</div>`;
  }

  /** Map language codes to human-readable names. */
  const PORTAL_LANGUAGE_NAMES = {
    es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian',
    ja: 'Japanese', ko: 'Korean', zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)',
    ar: 'Arabic', hi: 'Hindi', ru: 'Russian', nl: 'Dutch', sv: 'Swedish',
    pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
    uk: 'Ukrainian', cs: 'Czech', ro: 'Romanian', da: 'Danish', fi: 'Finnish',
    el: 'Greek', he: 'Hebrew', hu: 'Hungarian', no: 'Norwegian', sk: 'Slovak',
    bg: 'Bulgarian', hr: 'Croatian', ms: 'Malay', tl: 'Filipino',
  };

  function getPortalLanguageName(code) {
    if (!code) return 'Unknown';
    return PORTAL_LANGUAGE_NAMES[code] || code.toUpperCase();
  }

  return {
    STATUS_CONFIG,
    PRIORITY_CONFIG,
    esc,
    statusColor,
    statusLabel,
    priorityName,
    priorityLabel,
    formatDate,
    sortTicketsByDate,
    filterTicketsByStatus,
    renderTicketList,
    renderTicketCard,
    renderTicketDetail,
    renderNotFound,
    renderErrorMessage,
    renderApiError,
    isEditableStatus,
    renderMessageList,
    renderEditableTicketDetail,
    renderAssignedTicketDetail,
    getPortalLanguageName,
  };
})();
