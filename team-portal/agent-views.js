/**
 * Agent Views — rendering helpers and view functions for the Team Member Portal.
 * Pure functions that return HTML strings. No side effects.
 */
const AgentViews = (() => {
  const STATUS_CONFIG = {
    assigned:     { label: 'Assigned',          color: 'purple' },
    in_progress:  { label: 'In Progress',       color: 'orange' },
    pending_user: { label: 'Pending User',      color: 'yellow' },
    escalated:    { label: 'Escalated',         color: 'red' },
    resolved:     { label: 'Resolved',          color: 'green' },
    closed:       { label: 'Closed',            color: 'gray' },
    new:          { label: 'New',               color: 'blue' },
    analyzing:    { label: 'Analyzing',         color: 'teal' },
  };

  const PRIORITY_CONFIG = {
    1:  { label: 'Low',      name: 'low' },
    5:  { label: 'Medium',   name: 'medium' },
    8:  { label: 'High',     name: 'high' },
    10: { label: 'Critical', name: 'critical' },
  };

  const VALID_AGENT_STATUSES = ['assigned', 'in_progress', 'pending_user', 'escalated', 'resolved'];

  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusColor(status) { return (STATUS_CONFIG[status] || {}).color || 'gray'; }
  function statusLabel(status) { return (STATUS_CONFIG[status] || {}).label || status || 'Unknown'; }
  function priorityName(p) { return (PRIORITY_CONFIG[p] || {}).name || 'medium'; }
  function priorityLabel(p) { return (PRIORITY_CONFIG[p] || {}).label || 'Medium'; }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_e) { return dateStr; }
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  /* ── Dashboard Rendering (Task 5.2) ── */

  function renderDashboardStats(tickets) {
    const counts = { assigned: 0, in_progress: 0, pending_user: 0, escalated: 0 };
    (tickets || []).forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
    return Object.entries(counts).map(([s, c]) =>
      `<div class="stat-card"><div class="stat-value">${c}</div><div class="stat-label">${esc(statusLabel(s))}</div></div>`
    ).join('');
  }

  function sortTicketsForDashboard(tickets) {
    return (tickets || []).slice().sort((a, b) => {
      if ((b.priority || 5) !== (a.priority || 5)) return (b.priority || 5) - (a.priority || 5);
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  }

  function filterByStatus(tickets, status) {
    if (!status) return tickets;
    return (tickets || []).filter(t => t.status === status);
  }

  function filterByPriority(tickets, priority) {
    if (!priority) return tickets;
    const p = Number(priority);
    return (tickets || []).filter(t => t.priority === p);
  }

  function renderTicketCard(ticket, isTeamTicket) {
    const id = esc((ticket.ticketId || '').substring(0, 8));
    const subject = esc(ticket.subject);
    const color = statusColor(ticket.status);
    const label = statusLabel(ticket.status);
    const pName = priorityName(ticket.priority);
    const pLabel = priorityLabel(ticket.priority);
    const date = formatDate(ticket.createdAt);
    const category = esc(ticket.category || '');

    let html = `<div class="ticket-card" data-ticket-id="${esc(ticket.ticketId)}">
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
    ${category ? `<span>·</span><span>${category}</span>` : ''}
    <span class="assignment-label ${isTeamTicket ? 'assignment-team' : 'assignment-personal'}">${isTeamTicket ? 'Team' : 'Personal'}</span>
  </div>`;
    if (isTeamTicket) {
      html += `\n  <div class="ticket-card-actions"><button class="btn btn-claim" data-claim-id="${esc(ticket.ticketId)}">Claim</button></div>`;
    }
    html += '\n</div>';
    return html;
  }

  function renderMyTickets(tickets, statusFilter, priorityFilter) {
    let filtered = filterByStatus(tickets, statusFilter);
    filtered = filterByPriority(filtered, priorityFilter);
    const sorted = sortTicketsForDashboard(filtered);
    if (sorted.length === 0) return renderEmptyQueue();
    return sorted.map(t => renderTicketCard(t, false)).join('\n');
  }

  function renderTeamTickets(tickets) {
    if (!tickets || tickets.length === 0) return '<p class="empty-state">No unassigned team tickets.</p>';
    return tickets.map(t => renderTicketCard(t, true)).join('\n');
  }

  function renderEmptyQueue() {
    return '<div class="empty-state"><p>No tickets currently assigned to you.</p></div>';
  }

  /* ── Ticket Workspace Rendering (Task 5.3) ── */

  function renderTicketWorkspace(ticket, messages) {
    const subject = esc(ticket.subject);
    const description = esc(ticket.description);
    const color = statusColor(ticket.status);
    const label = statusLabel(ticket.status);
    const pName = priorityName(ticket.priority);
    const pLabel = priorityLabel(ticket.priority);
    const created = formatDate(ticket.createdAt);
    const updated = formatDate(ticket.updatedAt);
    const team = esc(ticket.assignedTeam || 'Unassigned');
    const agent = esc(ticket.assignedTo || 'Unassigned');
    const tags = Array.isArray(ticket.tags) ? ticket.tags : [];

    let html = `<a class="workspace-back" href="#/">← Back to Dashboard</a>
<div class="workspace-header">
  <h2>${subject}</h2>
  <span class="badge badge-${esc(color)}">${esc(label)}</span>
</div>
<div class="workspace-grid">
  <div class="workspace-row"><span class="workspace-label">Status</span><span class="badge badge-${esc(color)}">${esc(label)}</span></div>
  <div class="workspace-row"><span class="workspace-label">Priority</span><span><span class="priority-dot priority-${esc(pName)}"></span> ${esc(pLabel)}</span></div>
  <div class="workspace-row"><span class="workspace-label">Created</span><span>${esc(created)}</span></div>
  <div class="workspace-row"><span class="workspace-label">Updated</span><span>${esc(updated)}</span></div>
  <div class="workspace-row"><span class="workspace-label">Team</span><span>${team}</span></div>
  <div class="workspace-row"><span class="workspace-label">Assigned To</span><span>${agent}</span></div>
  <div class="workspace-row"><span class="workspace-label">Category</span><span>${esc(ticket.category || 'N/A')}</span></div>
  <div class="workspace-row"><span class="workspace-label">Tags</span><span>${tags.length > 0 ? tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : 'None'}</span></div>
</div>
<div class="workspace-description"><h4>Description</h4><p>${description}</p></div>
<div class="translate-section">
  <h4>🌐 Translate Ticket</h4>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <select id="translate-lang-select" class="select-input" style="min-width:180px;">
      <option value="">— Select Language —</option>
      <option value="es">Spanish (Español)</option>
      <option value="fr">French (Français)</option>
      <option value="de">German (Deutsch)</option>
      <option value="pt">Portuguese (Português)</option>
      <option value="it">Italian (Italiano)</option>
      <option value="ja">Japanese (日本語)</option>
      <option value="ko">Korean (한국어)</option>
      <option value="zh">Chinese (中文)</option>
      <option value="ar">Arabic (العربية)</option>
      <option value="hi">Hindi (हिन्दी)</option>
      <option value="te">Telugu (తెలుగు)</option>
      <option value="ta">Tamil (தமிழ்)</option>
      <option value="ru">Russian (Русский)</option>
      <option value="nl">Dutch (Nederlands)</option>
      <option value="tr">Turkish (Türkçe)</option>
      <option value="vi">Vietnamese (Tiếng Việt)</option>
      <option value="th">Thai (ไทย)</option>
      <option value="pl">Polish (Polski)</option>
      <option value="sv">Swedish (Svenska)</option>
      <option value="en">English</option>
    </select>
    <button class="btn btn-primary btn-sm" id="translate-ticket-btn">Translate</button>
  </div>
  <div id="translate-result" class="hidden" style="margin-top:12px;padding:14px;background:var(--bg2,#1a1a2e);border:1px solid var(--border,#2d2d4a);border-radius:8px;">
    <div id="translate-result-lang" style="font-size:0.8rem;color:var(--text2,#a0a0c0);margin-bottom:8px;"></div>
    <div style="margin-bottom:8px;"><strong style="color:var(--text2,#a0a0c0);font-size:0.85rem;">Subject:</strong><p id="translate-result-subject" style="margin:4px 0;"></p></div>
    <div><strong style="color:var(--text2,#a0a0c0);font-size:0.85rem;">Description:</strong><p id="translate-result-description" style="margin:4px 0;"></p></div>
  </div>
  <div id="translate-error" class="field-error hidden"></div>
</div>`;

    // Resolution section for resolved tickets
    if (ticket.status === 'resolved' && ticket.resolution) {
      html += `\n<div class="resolution-section">
  <h4>✅ Resolution</h4>
  <div class="resolution-text">${esc(ticket.resolution)}</div>
  ${ticket.rootCause ? `<div class="resolution-root-cause"><strong>Root Cause:</strong> ${esc(ticket.rootCause)}</div>` : ''}
  ${ticket.resolvedAt ? `<div class="resolution-meta">Resolved on ${esc(formatDate(ticket.resolvedAt))}</div>` : ''}
  <div style="display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap;">
    <select id="resolved-translate-lang" class="select-input" style="min-width:160px;font-size:0.85rem;">
      <option value="">🌐 Translate resolution to...</option>
      <option value="es">Spanish</option>
      <option value="fr">French</option>
      <option value="de">German</option>
      <option value="pt">Portuguese</option>
      <option value="it">Italian</option>
      <option value="ja">Japanese</option>
      <option value="ko">Korean</option>
      <option value="zh">Chinese</option>
      <option value="ar">Arabic</option>
      <option value="hi">Hindi</option>
      <option value="te">Telugu</option>
      <option value="ta">Tamil</option>
      <option value="ru">Russian</option>
      <option value="nl">Dutch</option>
      <option value="tr">Turkish</option>
      <option value="vi">Vietnamese</option>
      <option value="th">Thai</option>
      <option value="pl">Polish</option>
      <option value="sv">Swedish</option>
      <option value="en">English</option>
    </select>
    <button class="btn btn-sm btn-outline" id="resolved-translate-btn" style="font-size:0.82rem;">Translate</button>
  </div>
  <div id="resolved-translate-result" class="hidden" style="margin:8px 0;padding:12px;background:var(--bg2,#1a1a2e);border:1px solid var(--border,#2d2d4a);border-radius:8px;">
    <div id="resolved-translate-result-lang" style="font-size:0.8rem;color:var(--text2,#a0a0c0);margin-bottom:6px;"></div>
    <p id="resolved-translate-result-text" style="margin:0;"></p>
  </div>
</div>`;
    }

    // Status actions (only for non-resolved tickets)
    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      html += `\n<div class="status-actions">
  <label>Change Status:</label>
  ${renderStatusDropdown(ticket.status)}
  <button class="btn btn-primary btn-sm" id="update-status-btn">Update</button>
  <button class="btn btn-sm" id="resolve-btn" style="background:#22c55e;color:white;">✅ Resolve</button>
</div>`;
    }

    // Resolution form (hidden by default)
    html += `\n<div id="resolve-form-container" class="hidden">${renderResolveForm()}</div>`;

    // Messages
    html += `\n<div class="message-section">
  <h4>Messages</h4>
  <div class="message-list" id="message-list">${renderMessageThread(messages)}</div>
  <div class="message-form">
    <textarea id="message-content" placeholder="Type a message to the user..."></textarea>
    <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;">
      <select id="reply-translate-lang" class="select-input" style="min-width:160px;font-size:0.85rem;">
        <option value="">🌐 Translate reply to...</option>
        <option value="es">Spanish</option>
        <option value="fr">French</option>
        <option value="de">German</option>
        <option value="pt">Portuguese</option>
        <option value="it">Italian</option>
        <option value="ja">Japanese</option>
        <option value="ko">Korean</option>
        <option value="zh">Chinese</option>
        <option value="ar">Arabic</option>
        <option value="hi">Hindi</option>
        <option value="te">Telugu</option>
        <option value="ta">Tamil</option>
        <option value="ru">Russian</option>
        <option value="nl">Dutch</option>
        <option value="tr">Turkish</option>
        <option value="vi">Vietnamese</option>
        <option value="th">Thai</option>
        <option value="pl">Polish</option>
        <option value="sv">Swedish</option>
      </select>
      <button class="btn btn-sm" id="reply-translate-btn" style="font-size:0.82rem;">Translate</button>
    </div>
    <button class="btn btn-primary btn-sm" id="send-message-btn">Send</button>
  </div>
  <div id="message-error" class="field-error hidden"></div>
</div>`;

    return html;
  }

  function renderMessageThread(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return '<p class="empty-state">No messages yet.</p>';
    }
    return messages.map(msg =>
      `<div class="message-item">
  <div class="message-content">${esc(msg.content)}</div>
  <div class="message-meta"><span>${esc(msg.userId)}</span> · <span>${timeAgo(msg.createdAt)}</span></div>
</div>`
    ).join('\n');
  }

  function renderStatusDropdown(currentStatus) {
    return `<select id="status-select" class="select-input">
  ${VALID_AGENT_STATUSES.map(s =>
    `<option value="${s}"${s === currentStatus ? ' selected' : ''}>${esc(statusLabel(s))}</option>`
  ).join('\n  ')}
</select>`;
  }

  function renderResolveForm() {
    return `<div class="resolution-form">
  <h4>Resolve Ticket</h4>
  <div class="form-group">
    <label for="resolution-text">Resolution Summary (required)</label>
    <textarea id="resolution-text" rows="3" placeholder="Describe how the issue was resolved..."></textarea>
    <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;">
      <select id="resolve-translate-lang" class="select-input" style="min-width:160px;font-size:0.85rem;">
        <option value="">🌐 Translate to...</option>
        <option value="es">Spanish</option>
        <option value="fr">French</option>
        <option value="de">German</option>
        <option value="pt">Portuguese</option>
        <option value="it">Italian</option>
        <option value="ja">Japanese</option>
        <option value="ko">Korean</option>
        <option value="zh">Chinese</option>
        <option value="ar">Arabic</option>
        <option value="hi">Hindi</option>
        <option value="te">Telugu</option>
        <option value="ta">Tamil</option>
        <option value="ru">Russian</option>
        <option value="nl">Dutch</option>
        <option value="tr">Turkish</option>
        <option value="vi">Vietnamese</option>
        <option value="th">Thai</option>
        <option value="pl">Polish</option>
        <option value="sv">Swedish</option>
        <option value="en">English</option>
      </select>
      <button class="btn btn-sm" id="resolve-translate-btn" style="font-size:0.82rem;">Translate</button>
    </div>
  </div>
  <div class="form-group">
    <label for="root-cause-text">Root Cause (optional)</label>
    <input type="text" id="root-cause-text" placeholder="What caused the issue?">
  </div>
  <div id="resolve-error" class="field-error hidden"></div>
  <div style="display:flex;gap:0.5rem;">
    <button class="btn btn-primary btn-sm" id="submit-resolve-btn">Submit Resolution</button>
    <button class="btn btn-ghost btn-sm" id="cancel-resolve-btn">Cancel</button>
  </div>
</div>`;
  }

  /* ── Profile Rendering (Task 5.4) ── */

  function renderAgentProfile(agentEmail, team, stats) {
    const teamName = team ? esc(team.teamName) : 'Unassigned';
    const teamDesc = team ? esc(team.description) : '';
    const expertise = team && Array.isArray(team.expertise) ? team.expertise : [];
    const savedName = localStorage.getItem('agent_display_name') || '';
    const displayName = savedName || (agentEmail ? agentEmail.split('@')[0] : 'Agent');
    const initials = displayName.split(/[\s._-]+/).map(w => w[0]).join('').substring(0, 2).toUpperCase() || '??';

    let html = `<div class="profile-hero">
  <div class="profile-avatar">${initials}</div>
  <div class="profile-hero-info">
    <div class="profile-name-row">
      <h2 class="profile-name" id="profile-display-name">${esc(displayName)}</h2>
      <button class="btn-edit-name" id="edit-name-btn" title="Edit name">✏️</button>
    </div>
    <div class="profile-name-edit hidden" id="name-edit-form">
      <input type="text" id="name-edit-input" class="name-edit-input" value="${esc(displayName)}" placeholder="Enter your name" maxlength="50">
      <button class="btn btn-primary btn-sm" id="name-save-btn">Save</button>
      <button class="btn btn-ghost btn-sm" id="name-cancel-btn">Cancel</button>
    </div>
    <p class="profile-email">${esc(agentEmail)}</p>
    <span class="badge badge-${team ? 'purple' : 'gray'}">${teamName}</span>
  </div>
</div>`;

    // Quick stats row
    const totalTickets = stats ? Object.values(stats.byStatus || {}).reduce((a, b) => a + b, 0) : 0;
    const openCount = stats && stats.byStatus ? (stats.byStatus['assigned'] || 0) + (stats.byStatus['in_progress'] || 0) + (stats.byStatus['pending_user'] || 0) : 0;
    const avgTime = stats && stats.avgResolutionTimeMs > 0 ? formatDuration(stats.avgResolutionTimeMs) : 'N/A';

    html += `<div class="profile-stats-row">
  <div class="profile-stat-item"><div class="profile-stat-value">${totalTickets}</div><div class="profile-stat-label">Total Tickets</div></div>
  <div class="profile-stat-item"><div class="profile-stat-value">${openCount}</div><div class="profile-stat-label">Open</div></div>
  <div class="profile-stat-item"><div class="profile-stat-value">${stats ? stats.totalResolved || 0 : 0}</div><div class="profile-stat-label">Resolved</div></div>
  <div class="profile-stat-item"><div class="profile-stat-value">${avgTime}</div><div class="profile-stat-label">Avg Resolution</div></div>
</div>`;

    // Team info card
    if (team) {
      html += `<div class="profile-card">
  <h3>👥 Team Details</h3>
  <div class="profile-row"><span class="profile-label">Team</span><span class="profile-value">${teamName}</span></div>
  ${teamDesc ? `<div class="profile-row"><span class="profile-label">Description</span><span class="profile-value" style="max-width:60%;text-align:right;">${teamDesc}</span></div>` : ''}
  ${expertise.length > 0 ? `<div class="profile-row"><span class="profile-label">Expertise</span><span class="profile-value expertise-tags">${expertise.map(e => `<span class="tag">${esc(e)}</span>`).join('')}</span></div>` : ''}
</div>`;
    }

    // Status breakdown
    if (stats && stats.byStatus && Object.keys(stats.byStatus).length > 0) {
      html += `<div class="profile-card">
  <h3>📊 Status Breakdown</h3>
  <div class="perf-grid">`;
      Object.entries(stats.byStatus).forEach(([s, c]) => {
        html += `\n    <div class="perf-card"><div class="perf-value">${c}</div><div class="perf-label">${esc(statusLabel(s))}</div></div>`;
      });
      html += '\n  </div>\n</div>';
    }

    return html;
  }

  function renderPerformanceStats(stats) {
    if (!stats) return '';
    const avgTime = stats.avgResolutionTimeMs != null && stats.avgResolutionTimeMs > 0
      ? formatDuration(stats.avgResolutionTimeMs)
      : 'N/A';

    let html = `<div class="profile-card">
  <h3>📊 Performance</h3>
  <div class="perf-grid">
    <div class="perf-card"><div class="perf-value">${stats.totalResolved || 0}</div><div class="perf-label">Resolved</div></div>
    <div class="perf-card"><div class="perf-value">${avgTime}</div><div class="perf-label">Avg Resolution Time</div></div>`;

    if (stats.byStatus) {
      Object.entries(stats.byStatus).forEach(([s, c]) => {
        html += `\n    <div class="perf-card"><div class="perf-value">${c}</div><div class="perf-label">${esc(statusLabel(s))}</div></div>`;
      });
    }

    html += '\n  </div>\n</div>';
    return html;
  }

  function formatDuration(ms) {
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hrs > 24) return Math.round(hrs / 24) + 'd';
    if (hrs > 0) return hrs + 'h ' + mins + 'm';
    return mins + 'm';
  }

  function computeStats(tickets, agentEmail) {
    const displayName = localStorage.getItem('agent_display_name') || '';
    const mine = (tickets || []).filter(t =>
      t.assignedMemberEmail === agentEmail || t.assignedTo === agentEmail || (displayName && t.assignedTo === displayName)
    );
    const resolved = mine.filter(t => t.status === 'resolved');
    const byStatus = {};
    mine.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

    let avgResolutionTimeMs = 0;
    if (resolved.length > 0) {
      const total = resolved.reduce((sum, t) => {
        const created = new Date(t.createdAt || 0).getTime();
        const resolvedAt = new Date(t.resolvedAt || t.updatedAt || 0).getTime();
        return sum + (resolvedAt - created);
      }, 0);
      avgResolutionTimeMs = total / resolved.length;
    }

    return { totalResolved: resolved.length, byStatus, avgResolutionTimeMs };
  }

  /* ── Live Chats Rendering ── */

  function renderChatList(chatTickets) {
    if (!chatTickets || chatTickets.length === 0) {
      return '<div class="empty-state"><p>No live chat requests right now.</p></div>';
    }
    return chatTickets.map(t => {
      const id = esc((t.ticketId || '').substring(0, 8));
      const subject = esc(t.subject || 'Chat Escalation');
      const user = esc(t.userId || 'Unknown');
      const ago = timeAgo(t.createdAt);
      const isNew = t.status === 'new' || t.status === 'assigned' || t.status === 'analyzing';
      return `<div class="chat-request-card ${isNew ? 'chat-new' : ''}" data-ticket-id="${esc(t.ticketId)}">
  <div class="chat-request-header">
    <span class="chat-request-user">👤 ${user}</span>
    <span class="chat-request-time">${ago}</span>
  </div>
  <div class="chat-request-subject">${subject}</div>
  <div class="chat-request-id">#${id}</div>
  <div class="chat-request-actions">
    ${isNew ? `<button class="btn btn-primary btn-sm btn-accept-chat" data-ticket-id="${esc(t.ticketId)}">Accept Chat</button>` : `<button class="btn btn-sm btn-open-chat" data-ticket-id="${esc(t.ticketId)}">Open Chat</button>`}
  </div>
</div>`;
    }).join('\n');
  }

  function renderChatRoom(ticket, messages) {
    const subject = esc(ticket.subject || 'Chat');
    const user = esc(ticket.userId || 'User');
    const agentEmail = AgentAuth ? AgentAuth.getEmail() : '';

    // Extract issue summary from ticket description (chat escalation transcript)
    let issueSummary = '';
    if (ticket.description && ticket.description.startsWith('Chat Escalation Transcript:')) {
      const transcript = ticket.description.replace('Chat Escalation Transcript:\n\n', '');
      const userMsgs = transcript.split('\n\n')
        .filter(l => l.startsWith('User:'))
        .map(l => l.replace(/^User:\s*/, '').trim())
        .filter(m => m.length > 5 && !/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(m));
      if (userMsgs.length > 0) {
        issueSummary = userMsgs[0];
        if (issueSummary.length > 150) issueSummary = issueSummary.substring(0, 147) + '...';
      }
    }

    let html = `<a class="workspace-back" href="#/chats">← Back to Chats</a>
<div class="chatroom-header">
  <div class="chatroom-info">
    <h3>${subject}</h3>
    <span class="chatroom-user">with ${user}</span>
  </div>
  <span class="badge badge-${statusColor(ticket.status)}">${statusLabel(ticket.status)}</span>
</div>
${issueSummary ? `<div class="chatroom-issue-summary"><span class="chatroom-issue-icon">ℹ️</span><span class="chatroom-issue-text">${esc(issueSummary)}</span></div>` : ''}
<div class="chatroom-messages" id="chatroom-messages">`;

    if (!messages || messages.length === 0) {
      html += '<p class="empty-state">No messages yet. Start the conversation.</p>';
    } else {
      messages.forEach(m => {
        const isAgent = m.userId !== ticket.userId;
        const sender = isAgent ? 'You' : esc(m.userId);
        html += `\n  <div class="chat-msg ${isAgent ? 'chat-msg-agent' : 'chat-msg-user'}">
    <div class="chat-msg-content">${esc(m.content)}</div>
    <div class="chat-msg-meta">${sender} · ${timeAgo(m.createdAt)}</div>
  </div>`;
      });
    }

    html += `\n</div>`;

    // Input area (only if not resolved/closed)
    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      html += `\n<div class="chatroom-input">
  <textarea id="chatroom-input-text" placeholder="Type your reply..." rows="2"></textarea>
  <button class="btn btn-primary" id="chatroom-send-btn">Send</button>
  <button class="btn btn-end-chat" id="chatroom-end-btn">End Chat</button>
</div>
<div id="chatroom-error" class="field-error hidden"></div>`;
    }

    return html;
  }

  /* ── Public API ── */

  return {
    STATUS_CONFIG, PRIORITY_CONFIG, VALID_AGENT_STATUSES,
    esc, statusColor, statusLabel, priorityName, priorityLabel, formatDate, timeAgo,
    renderDashboardStats, sortTicketsForDashboard, filterByStatus, filterByPriority,
    renderTicketCard, renderMyTickets, renderTeamTickets, renderEmptyQueue,
    renderTicketWorkspace, renderMessageThread, renderStatusDropdown, renderResolveForm,
    renderAgentProfile, renderPerformanceStats, computeStats, formatDuration,
    renderChatList, renderChatRoom,
  };
})();
