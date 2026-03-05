/**
 * NovaSupport App — main UI controller with full AI service integration
 */
const App = (() => {
  let allTickets = [];
  let pendingFiles = [];
  let analyticsData = null;
  let autoRefreshInterval = null;
  let isFirstLoad = true;

  // ── Bootstrap ──
  function init() {
    bindAuthUI();
    if (Auth.isAuthenticated()) showApp(); else showAuth();
  }

  // ── Auth UI ──
  let pendingEmail = '';
  function bindAuthUI() {
    document.querySelectorAll('.auth-tab').forEach(t =>
      t.addEventListener('click', () => switchAuthTab(t.dataset.tab)));
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault(); hideEl('login-error');
      try { await Auth.signIn(val('login-email'), val('login-password')); showApp(); }
      catch (err) { showEl('login-error', err.message); }
    });
    document.getElementById('register-form').addEventListener('submit', async e => {
      e.preventDefault(); hideEl('register-error'); hideEl('register-success');
      const email = val('reg-email'), pw = val('reg-password'), confirm = val('reg-confirm');
      if (pw !== confirm) return showEl('register-error', 'Passwords do not match');
      try { await Auth.signUp(email, pw); pendingEmail = email;
        showEl('register-success', 'Account created! Check your email for a code.');
        setTimeout(() => switchAuthTab('confirm'), 1200);
      } catch (err) { showEl('register-error', err.message); }
    });
    document.getElementById('confirm-form').addEventListener('submit', async e => {
      e.preventDefault(); hideEl('confirm-error');
      try { await Auth.confirmSignUp(pendingEmail, val('confirm-code'));
        toast('Email verified! You can now sign in.', 'success'); switchAuthTab('login');
      } catch (err) { showEl('confirm-error', err.message); }
    });
    document.getElementById('logout-btn').addEventListener('click', () => { stopAutoRefresh(); disconnectWebSocket(); Auth.signOut(); showAuth(); });
  }

  function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('confirm-form').classList.toggle('hidden', tab !== 'confirm');
  }
  function showAuth() { document.getElementById('auth-screen').classList.remove('hidden'); document.getElementById('app').classList.add('hidden'); }
  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-email').textContent = Auth.getEmail();
    bindAppUI();
    // Show cached data INSTANTLY so the page never looks empty
    const cached = localStorage.getItem('ns_tickets_cache');
    if (cached) {
      try {
        allTickets = JSON.parse(cached);
        renderDashboardStats();
        renderRecentTickets();
      } catch(e) {}
    }
    // Load fresh dashboard data (awaits token + fetches tickets)
    loadDashboard();
    startAutoRefresh();
    connectWebSocket();
    purgeExpiredBinTickets();
    updateBinBadge();
    // Reset auto-assignment cache so round-robin redistributes fresh on each session
    // NOTE: Don't reset — backend handles round-robin via DynamoDB now
    // try { localStorage.removeItem('ns_ticket_assignments'); } catch (_e) {}
    // Object.keys(localStorage).forEach(k => { if (k.startsWith('ns_rr_')) localStorage.removeItem(k); });
  }

  function showRefreshingIndicator() {
    let el = document.getElementById('last-refreshed');
    if (!el) {
      el = document.createElement('span');
      el.id = 'last-refreshed';
      el.style.cssText = 'font-size:12px;color:#636e72;margin-left:12px;';
      const refreshBtn = document.getElementById('refresh-dashboard');
      if (refreshBtn) refreshBtn.parentNode.insertBefore(el, refreshBtn.nextSibling);
    }
    el.textContent = '⟳ Refreshing...';
  }

  async function backgroundRefresh() {
    try {
      // Pre-warm token first (this is the slow part — Cognito refresh)
      await Auth.getValidIdToken();
    } catch(e) { /* proceed with existing token */ }
    try {
      // Ensure team members are loaded for auto-assign round-robin
      if (!window._apiTeamMembers) {
        try {
          const teamsData = await API.listTeams();
          const apiMembersMap = {};
          (teamsData.teams || []).forEach(t => { if (t.members && t.members.length) apiMembersMap[t.teamId] = t.members; });
          if (Object.keys(apiMembersMap).length) window._apiTeamMembers = apiMembersMap;
        } catch (_e) { /* fallback to localStorage */ }
      }
      const data = await API.listTickets();
      allTickets = filterOutBinTickets(Array.isArray(data) ? data : (data.tickets || []));
      isFirstLoad = false;
      renderDashboardStats();
      renderRecentTickets();
      renderTicketsList();
      hideDebugBanner();
      updateLastRefreshed();
      try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch(e) {}
    } catch(err) {
      console.warn('Background refresh failed:', err);
      if (isFirstLoad && !allTickets.length) {
        showDebugBanner('Failed to load tickets: ' + err.message);
      }
    }
    // Also load notification count in background
    loadNotificationCount();
    updateChatRequestBadge();
  }

  function renderDashboardStats() {
    const counts = { total: allTickets.length, new: 0, in_progress: 0, processing: 0, pending_user: 0, resolved: 0, escalated: 0 };
    allTickets.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
    document.getElementById('stat-total').textContent = counts.total;
    document.getElementById('stat-new').textContent = counts.new;
    document.getElementById('stat-progress').textContent = counts.in_progress + counts.processing + counts.pending_user;
    document.getElementById('stat-resolved').textContent = counts.resolved;
    document.getElementById('stat-escalated').textContent = counts.escalated;
  }

  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(async () => {
      try {
        await silentLoadTickets();
        loadNotificationCount();
        try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch(e) {}
        // Update dashboard stats if on dashboard view
        const dashView = document.getElementById('view-dashboard');
        if (dashView && dashView.classList.contains('active')) {
          renderDashboardStats();
          renderRecentTickets();
        }
        // Update ticket list if on tickets view
        const ticketsView = document.getElementById('view-tickets');
        if (ticketsView && ticketsView.classList.contains('active')) {
          renderTicketsList();
        }
        // Update chat request badge
        updateChatRequestBadge();
        // Update chat requests view if active
        const chatView = document.getElementById('view-chat-requests');
        if (chatView && chatView.classList.contains('active')) {
          loadChatRequests();
        }
        updateLastRefreshed();
      } catch (e) { console.warn('Auto-refresh failed:', e); }
    }, 10000);
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
  }

  async function silentLoadTickets() {
    try {
      const data = await API.listTickets();
      allTickets = filterOutBinTickets(Array.isArray(data) ? data : (data.tickets || []));
    } catch (err) { console.warn('[Auto-refresh] ticket fetch failed:', err); }
  }

  function updateLastRefreshed() {
    let el = document.getElementById('last-refreshed');
    if (!el) {
      el = document.createElement('span');
      el.id = 'last-refreshed';
      el.style.cssText = 'font-size:12px;color:#636e72;margin-left:12px;';
      const refreshBtn = document.getElementById('refresh-dashboard');
      if (refreshBtn) refreshBtn.parentNode.insertBefore(el, refreshBtn.nextSibling);
    }
    const now = new Date();
    el.textContent = `Last updated: ${now.toLocaleTimeString()}`;
  }

  // ── App UI Bindings ──
  function bindAppUI() {
    document.querySelectorAll('.nav-link').forEach(l =>
      l.addEventListener('click', e => { e.preventDefault(); switchView(l.dataset.view); }));
    document.getElementById('refresh-dashboard').addEventListener('click', loadDashboard);
    document.getElementById('filter-status').addEventListener('change', () => renderTicketsList());
    const createForm = document.getElementById('create-ticket-form');
    if (createForm) createForm.addEventListener('submit', handleCreateTicket);
    // File drop zone
    const dz = document.getElementById('drop-zone'), fi = document.getElementById('file-input');
    if (dz && fi) {
      dz.addEventListener('click', () => fi.click());
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addFiles(e.dataTransfer.files); });
      fi.addEventListener('change', () => { addFiles(fi.files); fi.value = ''; });
    }
    const voiceBtn = document.getElementById('voice-record-btn');
    if (voiceBtn) voiceBtn.addEventListener('click', handleVoiceRecord);
    // Knowledge base
    document.getElementById('kb-search-btn').addEventListener('click', handleKBSearch);
    document.getElementById('kb-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleKBSearch(); });
    // Analytics
    document.getElementById('refresh-analytics').addEventListener('click', loadAnalytics);
    document.getElementById('analytics-period').addEventListener('change', loadAnalytics);
    // Notifications
    document.getElementById('refresh-notifications').addEventListener('click', loadNotifications);
    document.getElementById('notif-unread-only').addEventListener('change', loadNotifications);
    // Teams
    document.getElementById('refresh-teams').addEventListener('click', loadTeams);
    document.getElementById('add-team-btn').addEventListener('click', showAddTeamForm);
    // Resolved Tickets
    document.getElementById('refresh-resolved').addEventListener('click', loadResolvedTickets);
    // Chat Requests
    document.getElementById('refresh-chat-requests').addEventListener('click', loadChatRequests);
    // Canned Responses Management
    document.getElementById('refresh-canned-responses').addEventListener('click', loadCannedResponsesManagement);
    document.getElementById('add-canned-response-btn').addEventListener('click', showCannedResponseForm);
    document.getElementById('refresh-sla-dashboard').addEventListener('click', loadSLADashboard);
    // Bin
    document.getElementById('refresh-bin').addEventListener('click', loadBin);
    document.getElementById('empty-bin-btn').addEventListener('click', emptyBin);
  }

  function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view === view));
    if (view !== 'chat-requests') stopChatRequestsPoll();
    if (view === 'dashboard') loadDashboard();
    if (view === 'tickets') loadTickets();
    if (view === 'chat-requests') { loadChatRequests(); markChatRequestsSeen(); startChatRequestsPoll(); }
    if (view === 'analytics') loadAnalytics();
    if (view === 'knowledge') loadKBArticles();
    if (view === 'teams') loadTeams();
    if (view === 'resolved') loadResolvedTickets();
    if (view === 'notifications') loadNotifications();
    if (view === 'canned-responses') loadCannedResponsesManagement();
    if (view === 'sla-dashboard') loadSLADashboard();
    if (view === 'bin') loadBin();
  }

  // ── Dashboard ──
  async function loadDashboard() {
    showRefreshingIndicator();
    try {
      // Pre-fetch team members so auto-assign has them before tickets load
      if (!window._apiTeamMembers) {
        try {
          const teamsData = await API.listTeams();
          const apiMembersMap = {};
          (teamsData.teams || []).forEach(t => { if (t.members && t.members.length) apiMembersMap[t.teamId] = t.members; });
          if (Object.keys(apiMembersMap).length) window._apiTeamMembers = apiMembersMap;
        } catch (_e) { /* API unavailable, auto-assign will use localStorage fallback */ }
      }
      await loadTickets();
      isFirstLoad = false;
      renderDashboardStats();
      renderRecentTickets();
      hideDebugBanner();
      updateLastRefreshed();
      try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch(e) {}
    } catch (err) {
      document.getElementById('stat-total').textContent = '0';
      console.error('Dashboard error:', err);
      showDebugBanner('Dashboard error: ' + err.message);
    }
  }

  // ── Debug Banner (visible on page, no F12 needed) ──
  function showDebugBanner(msg) {
    let banner = document.getElementById('admin-debug-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'admin-debug-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#d63031;color:#fff;padding:10px 16px;font-size:14px;font-family:monospace;white-space:pre-wrap;cursor:pointer;';
      banner.title = 'Click to dismiss';
      banner.addEventListener('click', () => banner.remove());
      document.body.prepend(banner);
    }
    banner.textContent = msg;
  }
  function hideDebugBanner() {
    const banner = document.getElementById('admin-debug-banner');
    if (banner) banner.remove();
  }

  function renderRecentTickets() {
    const container = document.getElementById('recent-tickets');
    const recent = allTickets.slice(0, 5);
    if (!recent.length) { container.innerHTML = '<p class="empty-state">No tickets yet. Create one!</p>'; return; }
    container.innerHTML = recent.map(ticketCard).join('');
    container.querySelectorAll('.ticket-card').forEach(c => c.addEventListener('click', () => openTicketDetail(c.dataset.id)));
    bindCardAssignDropdowns(container);
  }

  // ── Tickets List ──
  async function loadTickets() {
    try {
      const data = await API.listTickets();
      allTickets = filterOutBinTickets(Array.isArray(data) ? data : (data.tickets || []));
    } catch (err) {
      console.error('[Admin] Failed to load tickets:', err);
      allTickets = [];
      showDebugBanner('Failed to load tickets: ' + err.message);
    }
    renderTicketsList();
  }

  function renderTicketsList() {
    const container = document.getElementById('tickets-list');
    const filter = document.getElementById('filter-status').value;
    let filtered = filter ? allTickets.filter(t => t.status === filter) : allTickets;
    if (!filtered.length) { container.innerHTML = '<p class="empty-state">No tickets found.</p>'; return; }
    container.innerHTML = filtered.map(ticketCard).join('');
    container.querySelectorAll('.ticket-card').forEach(c => c.addEventListener('click', () => openTicketDetail(c.dataset.id)));
    bindCardAssignDropdowns(container);
  }

  function ticketCard(t) {
    const tags = (t.tags || []).slice(0, 3).map(tag => `<span class="tag">${esc(tag)}</span>`).join('');
    const isChatEscalation = (t.tags || []).includes('chat-escalation');
    const hasAgent = t.assignedTo && t.assignedTo !== t.assignedTeam;
    return `<div class="ticket-card" data-id="${t.ticketId}">
      <div class="ticket-card-header">
        <span class="ticket-id">${isChatEscalation ? '💬 ' : ''}#${t.ticketId?.slice(0, 8) || '—'}</span>
        <span class="badge badge-${statusColor(t.status)}">${statusLabel(t.status)}</span>
      </div>
      <div class="ticket-card-subject">${esc(t.subject)}</div>
      <div class="ticket-card-meta">
        <span class="priority-dot priority-${priorityName(t.priority)}"></span>
        ${priorityName(t.priority)} · ${timeAgo(t.createdAt)}
      </div>
      <div style="margin-top:6px;padding:5px 10px;border-radius:6px;font-size:0.78rem;display:flex;align-items:center;gap:6px;${hasAgent ? 'background:rgba(0,206,201,0.10);border:1px solid rgba(0,206,201,0.20);color:#00cec9;' : t.assignedTeam ? 'background:rgba(108,92,231,0.10);border:1px solid rgba(108,92,231,0.18);color:#a29bfe;' : 'background:rgba(225,112,85,0.08);border:1px solid rgba(225,112,85,0.15);color:#e17055;'}">
        ${hasAgent ? '👤 ' + esc(t.assignedTo) + ' <span style="opacity:0.6;">(' + esc(t.assignedTeam) + ')</span>' + (t.assignedBy === 'assignment-agent' ? ' <span style="opacity:0.5;font-size:0.7rem;margin-left:auto;">🤖 auto</span>' : '') : t.assignedTeam ? '👥 ' + esc(t.assignedTeam) : '⚠️ Unassigned'}
      </div>
      ${tags ? `<div class="ticket-card-tags">${tags}</div>` : ''}
    </div>`;
  }

  function bindCardAssignDropdowns(container) {
    // no-op — assign is now in the dedicated Chat Requests view
  }

  // ── Ticket Detail with AI Analysis ──
  async function openTicketDetail(id) {
    const modal = document.getElementById('ticket-modal');
    const body = document.getElementById('modal-body');
    modal.classList.remove('hidden');
    body.innerHTML = '<p class="loading">Loading ticket...</p>';
    try {
      const t = await API.getTicket(id);
      
      // Auto-sync resolved ticket data to localStorage for cross-portal sync (demo mode)
      if (t.status === 'resolved' && t.resolution) {
        try {
          const resolutions = JSON.parse(localStorage.getItem('ns_ticket_resolutions') || '{}');
          if (!resolutions[t.ticketId] || resolutions[t.ticketId].resolution !== t.resolution) {
            resolutions[t.ticketId] = {
              resolution: t.resolution,
              rootCause: t.rootCause || null,
              resolvedAt: t.resolvedAt || new Date().toISOString(),
              status: 'resolved'
            };
            localStorage.setItem('ns_ticket_resolutions', JSON.stringify(resolutions));
          }
        } catch (_e) { /* ignore localStorage errors */ }
      }
      
      const isChatEscalation = (t.tags || []).includes('chat-escalation');
      document.getElementById('modal-title').textContent = `${isChatEscalation ? '💬 ' : ''}Ticket #${t.ticketId?.slice(0, 8)}`;
      body.innerHTML = `
        <div class="detail-tabs">
          <button class="detail-tab active" data-dtab="info">Info</button>
          ${isChatEscalation ? '<button class="detail-tab" data-dtab="chat-summary">Chat Summary</button>' : ''}
          <button class="detail-tab" data-dtab="ai">AI Analysis</button>
          <button class="detail-tab" data-dtab="similar">Similar Tickets</button>
          <button class="detail-tab" data-dtab="messages">Messages</button>
          <button class="detail-tab" data-dtab="timeline">Timeline</button>
          <button class="detail-tab" data-dtab="suggested-solutions">Suggested Solutions</button>
          ${t.status !== 'closed' && !t.mergedInto ? '<button class="detail-tab" data-dtab="merge">Merge</button>' : ''}
        </div>
        <div id="dtab-info" class="detail-tab-content active">
          <div class="detail-grid">
            <div class="detail-row"><span class="detail-label">Subject</span><span id="detail-subject-text">${esc(t.subject)}</span></div>
            ${t.detectedLanguage && t.detectedLanguage !== 'en' ? `
            <div class="detail-row"><span class="detail-label">Language</span><span>
              <span class="lang-badge">🌐 ${esc(getLanguageName(t.detectedLanguage))}</span>
              <button class="btn btn-sm btn-outline translation-toggle-btn" id="translation-toggle-btn" data-showing="original">Show Translation</button>
            </span></div>` : ''}
            <div class="detail-row"><span class="detail-label">Status</span>
              <div class="status-control">
                <span class="badge badge-${statusColor(t.status)}">${statusLabel(t.status)}</span>
                <select id="status-change-select" class="select-input select-sm" data-ticket-id="${t.ticketId}">
                  <option value="">— Change Status —</option>
                  ${[
                    {v:'new', l:'🆕 New'},
                    {v:'analyzing', l:'🔍 Analyzing'},
                    {v:'assigned', l:'📋 Assigned'},
                    {v:'in_progress', l:'🔧 Working on it'},
                    {v:'pending_user', l:'❓ Need User Details'},
                    {v:'processing', l:'⚙️ Processing'},
                    {v:'escalated', l:'🚨 Escalated'},
                    {v:'closed', l:'🔒 Closed'}
                  ].filter(s => s.v !== t.status).map(s => `<option value="${s.v}">${s.l}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="detail-row"><span class="detail-label">Priority</span><span><span class="priority-dot priority-${priorityName(t.priority)}"></span> ${priorityName(t.priority)} (${t.priority})</span></div>
            <div class="detail-row"><span class="detail-label">Created</span><span>${t.createdAt || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Assigned To</span><span>${t.assignedTo || 'Unassigned'}</span></div>
            <div class="detail-row"><span class="detail-label">Team</span><span>${t.assignedTeam || '—'}</span></div>
            <div class="detail-row"><span class="detail-label">Category</span><span>${t.category ? `<span class="tag">${esc(t.category)}</span>` : 'Pending'}</span></div>
            <div class="detail-row"><span class="detail-label">Tags</span><span>${(t.tags || []).map(tag => `<span class="tag">${esc(tag)}</span>`).join(' ') || '—'}</span></div>
            ${t.slaResponseDeadline ? `<div class="detail-row"><span class="detail-label">SLA Response</span><span>${t.firstResponseAt ? '✅ ' + t.firstResponseAt : (new Date(t.slaResponseDeadline) < new Date() ? '<span style="color:#dc2626">⚠️ BREACHED</span>' : '⏳ ' + t.slaResponseDeadline)}</span></div>` : ''}
            ${t.slaResolutionDeadline ? `<div class="detail-row"><span class="detail-label">SLA Resolution</span><span>${t.status === 'resolved' || t.status === 'closed' ? '✅ ' + (t.resolvedAt || 'Resolved') : (new Date(t.slaResolutionDeadline) < new Date() ? '<span style="color:#dc2626">⚠️ BREACHED</span>' : '⏳ ' + t.slaResolutionDeadline)}</span></div>` : ''}
            ${t.routingConfidence ? `<div class="detail-row"><span class="detail-label">Routing Confidence</span><span><div class="confidence-bar"><div class="confidence-fill" style="width:${(t.routingConfidence*100).toFixed(0)}%"></div></div> ${(t.routingConfidence*100).toFixed(0)}%</span></div>` : ''}
            ${t.escalationReason ? `<div class="detail-row"><span class="detail-label">Escalation</span><span class="escalation-reason">${esc(t.escalationReason)}</span></div>` : ''}
          </div>
          <div class="detail-description"><h4>Description</h4><p id="detail-description-text">${esc(t.description)}</p></div>
          ${t.detectedLanguage && t.detectedLanguage !== 'en' && t.translatedSubject ? `
          <div class="translation-info" id="translation-info" style="display:none;">
            <div class="translation-note">📝 Translated from ${esc(getLanguageName(t.detectedLanguage))} to English</div>
            <div class="detail-description"><h4>Translated Subject</h4><p id="translated-subject-text">${esc(t.translatedSubject)}</p></div>
            <div class="detail-description"><h4>Translated Description</h4><p id="translated-description-text">${esc(t.translatedDescription || t.description)}</p></div>
          </div>` : ''}
          <div class="detail-description" style="margin-top:16px;">
            <h4>🌐 Translate Ticket</h4>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;">
              <select id="admin-translate-lang" class="select-input" style="min-width:180px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);">
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
              <button class="btn btn-primary btn-sm" id="admin-translate-btn" data-ticket-id="${t.ticketId}">Translate</button>
            </div>
            <div id="admin-translate-result" class="hidden" style="margin-top:12px;padding:14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;">
              <div id="admin-translate-lang-label" style="font-size:0.8rem;color:var(--text2);margin-bottom:8px;"></div>
              <div style="margin-bottom:8px;"><strong style="color:var(--text2);font-size:0.85rem;">Subject:</strong><p id="admin-translate-subject" style="margin:4px 0;"></p></div>
              <div><strong style="color:var(--text2);font-size:0.85rem;">Description:</strong><p id="admin-translate-description" style="margin:4px 0;"></p></div>
            </div>
            <div id="admin-translate-error" style="color:#dc2626;font-size:0.85rem;margin-top:8px;display:none;"></div>
          </div>
          ${(t.attachmentIds && t.attachmentIds.length) ? `
          <div class="detail-description" style="margin-top:16px;">
            <h4>📎 Attachments (${t.attachmentIds.length})</h4>
            <div id="ticket-attachments" style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">
              <p class="loading" style="font-size:0.85rem;">Loading attachments...</p>
            </div>
          </div>` : ''}
          ${t.status === 'resolved' ? `
            <div class="resolve-section resolved-info">
              <h4>✅ Resolution</h4>
              <p>${esc(t.resolution || 'No resolution details')}</p>
              ${t.rootCause ? `<h4>Root Cause</h4><p>${esc(t.rootCause)}</p>` : ''}
              <p class="resolve-meta">Resolved at ${t.resolvedAt || '—'}</p>
              <div style="display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap;">
                <select id="resolved-translate-lang" class="select-input" style="min-width:160px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:0.85rem;">
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
              <div id="resolved-translate-result" class="hidden" style="margin:8px 0;padding:12px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;">
                <div id="resolved-translate-result-lang" style="font-size:0.8rem;color:var(--text2);margin-bottom:6px;"></div>
                <p id="resolved-translate-result-text" style="margin:0;"></p>
              </div>
              <button id="send-resolution-email-btn" class="btn btn-primary btn-sm" data-ticket-id="${t.ticketId}" style="margin-top:12px;">📧 Send Resolution to User</button>
            </div>
          ` : `
            <div class="resolve-section">
              <h4>🔧 Resolve Ticket</h4>
              <div class="resolve-form">
                <label for="resolve-text">Resolution <span class="required">*</span></label>
                <textarea id="resolve-text" class="textarea-input" rows="3" placeholder="Describe how the issue was resolved..."></textarea>
                <div style="display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;">
                  <select id="resolve-translate-lang" class="select-input" style="min-width:160px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:0.85rem;">
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
                  <button class="btn btn-sm btn-outline" id="resolve-translate-btn" style="font-size:0.82rem;">Translate</button>
                </div>
                <label for="resolve-root-cause">Root Cause (optional)</label>
                <input id="resolve-root-cause" class="text-input" type="text" placeholder="What caused the issue?" />
                <button id="resolve-ticket-btn" class="btn btn-success btn-sm" data-ticket-id="${t.ticketId}">✅ Resolve & Store Solution</button>
              </div>
            </div>
          `}
          <div class="delete-ticket-section" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border);">
            <button id="delete-ticket-btn" class="btn btn-sm" data-ticket-id="${t.ticketId}" style="background:#dc2626;color:#fff;border:none;cursor:pointer;">🗑 Move to Bin</button>
          </div>
        </div>
        ${isChatEscalation ? `<div id="dtab-chat-summary" class="detail-tab-content">${renderChatTranscript(t.description)}</div>` : ''}
        <div id="dtab-merge" class="detail-tab-content">
          <div class="merge-section">
            <h4>🔀 Merge This Ticket Into Another</h4>
            <p style="color:var(--text2);font-size:0.9rem;margin-bottom:16px;">Search for the primary ticket to merge this one into. All messages and attachments will be copied.</p>
            <div style="display:flex;gap:8px;margin-bottom:16px;">
              <input type="text" id="merge-search-input" class="text-input" placeholder="Search by ticket ID or subject..." style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);">
              <button class="btn btn-sm btn-outline" id="merge-search-btn">🔍 Search</button>
            </div>
            <div id="merge-search-results"></div>
          </div>
        </div>
        <div id="dtab-ai" class="detail-tab-content">
          <div class="ai-panel">
            <button class="btn btn-primary btn-sm ai-analyze-btn" id="run-ai-analysis" data-ticket-id="${t.ticketId}">🤖 Run Nova AI Analysis</button>
            <div id="ai-results" class="ai-results"><p class="empty-state">Click the button above to trigger AI analysis using Amazon Nova models.</p></div>
          </div>
        </div>
        <div id="dtab-similar" class="detail-tab-content">
          <div id="similar-results" class="similar-results"><p class="loading">Searching for similar tickets...</p></div>
        </div>
        <div id="dtab-messages" class="detail-tab-content">
          <div id="messages-results"><p class="loading">Loading messages...</p></div>
          <div class="canned-response-section" style="margin-top:16px;">
            <label style="font-size:0.85rem;color:var(--text2);margin-bottom:6px;display:block;">📋 Canned Responses</label>
            <select id="canned-response-select" class="select-input" style="width:100%;margin-bottom:10px;">
              <option value="">— Select a canned response —</option>
            </select>
            <textarea id="canned-message-input" class="textarea-input" rows="3" placeholder="Type a message or select a canned response above..." style="width:100%;margin-bottom:8px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-family:inherit;resize:vertical;"></textarea>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
              <select id="reply-translate-lang" class="select-input" style="min-width:160px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:0.85rem;">
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
              <button class="btn btn-sm btn-outline" id="reply-translate-btn" style="font-size:0.82rem;">Translate</button>
            </div>
            <button id="send-canned-message-btn" class="btn btn-primary btn-sm">📨 Send Message</button>
          </div>
        </div>
        <div id="dtab-timeline" class="detail-tab-content">
          <div id="timeline-results"><p class="loading">Loading timeline...</p></div>
        </div>
        <div id="dtab-suggested-solutions" class="detail-tab-content">
          <div id="suggested-solutions-results"><div class="ai-loading"><div class="spinner"></div><p>Searching for suggested solutions...</p></div></div>
        </div>`;

      // Bind detail tabs
      body.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          body.querySelectorAll('.detail-tab').forEach(t2 => t2.classList.remove('active'));
          body.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById(`dtab-${tab.dataset.dtab}`).classList.add('active');
        });
      });

      // Status change
      const statusSelect = document.getElementById('status-change-select');
      statusSelect.addEventListener('change', async () => {
        const newStatus = statusSelect.value;
        if (!newStatus) return;
        try {
          await API.updateTicketStatus(t.ticketId, newStatus);
          toast(`Status updated to ${statusLabel(newStatus)}`, 'success');
          openTicketDetail(t.ticketId); // Refresh
        } catch (err) { toast(err.message, 'error'); }
      });

      // Resolve ticket
      const resolveBtn = document.getElementById('resolve-ticket-btn');
      if (resolveBtn) {
        resolveBtn.addEventListener('click', async () => {
          const resolution = document.getElementById('resolve-text').value.trim();
          const rootCause = document.getElementById('resolve-root-cause').value.trim();
          if (!resolution) { toast('Please enter a resolution', 'error'); return; }
          resolveBtn.disabled = true;
          resolveBtn.textContent = '⏳ Resolving...';
          try {
            await API.resolveTicket(t.ticketId, resolution, rootCause || undefined);
            // Save resolution to localStorage for cross-portal sync (demo mode)
            const resolutions = JSON.parse(localStorage.getItem('ns_ticket_resolutions') || '{}');
            resolutions[t.ticketId] = {
              resolution,
              rootCause: rootCause || null,
              resolvedAt: new Date().toISOString(),
              status: 'resolved'
            };
            localStorage.setItem('ns_ticket_resolutions', JSON.stringify(resolutions));
            toast('Ticket resolved and solution stored in knowledge base', 'success');
            openTicketDetail(t.ticketId);
          } catch (err) {
            toast(err.message, 'error');
            resolveBtn.disabled = false;
            resolveBtn.textContent = '✅ Resolve & Store Solution';
          }
        });
      }

      // Bind resolve translate button
      const resolveTransBtn = document.getElementById('resolve-translate-btn');
      if (resolveTransBtn) {
        resolveTransBtn.addEventListener('click', async () => {
          const langSelect = document.getElementById('resolve-translate-lang');
          const targetLang = langSelect.value;
          const textarea = document.getElementById('resolve-text');
          const text = textarea.value.trim();
          if (!targetLang) { toast('Select a language first', 'error'); return; }
          if (!text) { toast('Type a resolution first', 'error'); return; }
          resolveTransBtn.disabled = true;
          resolveTransBtn.textContent = 'Translating...';
          try {
            const res = await API.translateText(text, targetLang);
            textarea.value = res.translatedText;
          } catch (err) {
            toast('Translation failed: ' + err.message, 'error');
          } finally {
            resolveTransBtn.disabled = false;
            resolveTransBtn.textContent = 'Translate';
          }
        });
      }

      // Bind resolved resolution translate button
      const resolvedTransBtn = document.getElementById('resolved-translate-btn');
      if (resolvedTransBtn) {
        resolvedTransBtn.addEventListener('click', async () => {
          const langSelect = document.getElementById('resolved-translate-lang');
          const targetLang = langSelect.value;
          if (!targetLang) { toast('Select a language first', 'error'); return; }
          if (!t.resolution) { toast('No resolution text to translate', 'error'); return; }
          resolvedTransBtn.disabled = true;
          resolvedTransBtn.textContent = 'Translating...';
          try {
            const res = await API.translateText(t.resolution, targetLang);
            const langName = langSelect.options[langSelect.selectedIndex].text;
            document.getElementById('resolved-translate-result-lang').textContent = '📝 Translated to ' + langName;
            document.getElementById('resolved-translate-result-text').textContent = res.translatedText;
            document.getElementById('resolved-translate-result').classList.remove('hidden');
          } catch (err) {
            toast('Translation failed: ' + err.message, 'error');
          } finally {
            resolvedTransBtn.disabled = false;
            resolvedTransBtn.textContent = 'Translate';
          }
        });
      }

      // Send resolution email button
      const sendEmailBtn = document.getElementById('send-resolution-email-btn');
      if (sendEmailBtn) {
        sendEmailBtn.addEventListener('click', async () => {
          sendEmailBtn.disabled = true;
          sendEmailBtn.textContent = '⏳ Sending...';
          try {
            const result = await API.sendResolutionEmail(t.ticketId);
            toast(`Resolution email sent to ${result.to}`, 'success');
            sendEmailBtn.textContent = '✅ Email Sent';
          } catch (err) {
            toast(err.message, 'error');
            sendEmailBtn.disabled = false;
            sendEmailBtn.textContent = '📧 Send Resolution to User';
          }
        });
      }

      // AI Analysis button
      document.getElementById('run-ai-analysis').addEventListener('click', () => runAIAnalysis(t.ticketId));

      // Delete ticket (move to bin - soft delete)
      const deleteBtn = document.getElementById('delete-ticket-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm('Move this ticket to the Bin? It will be permanently deleted after 30 days.')) return;
          deleteBtn.disabled = true;
          deleteBtn.textContent = '⏳ Moving to Bin...';
          // Soft delete: move to bin in localStorage
          const ticket = allTickets.find(tk => tk.ticketId === t.ticketId);
          if (ticket) {
            const bin = getBinTickets();
            bin.push({ ...ticket, deletedAt: new Date().toISOString() });
            saveBinTickets(bin);
          }
          allTickets = allTickets.filter(tk => tk.ticketId !== t.ticketId);
          try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch (_e) {}
          modal.classList.add('hidden');
          toast('Ticket moved to Bin', 'success');
          renderDashboardStats();
          renderRecentTickets();
          updateBinBadge();
          if (document.getElementById('view-tickets')?.classList.contains('active')) renderTicketsList();
        });
      }

      // Load similar tickets
      loadSimilarTickets(t.ticketId);

      // Load attachments if any
      if (t.attachmentIds && t.attachmentIds.length) loadTicketAttachments(t.ticketId);

      // Load messages
      loadTicketMessages(t.ticketId, t);

      // Load suggested solutions
      loadSuggestedSolutions(t);

      // Load timeline activities
      loadTicketTimeline(t.ticketId);

      // Bind translation toggle
      bindTranslationToggle(t);

      // Bind translate dropdown
      bindAdminTranslate(t);

      // Bind merge search
      bindMergeSearch(t);
    } catch (err) {
      body.innerHTML = `<p class="error-msg">Failed to load ticket: ${esc(err.message)}</p>`;
    }
  }

  async function runAIAnalysis(ticketId) {
    const container = document.getElementById('ai-results');
    container.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>Running Nova AI analysis... This may take a moment.</p></div>';
    try {
      const data = await API.analyzeTicket(ticketId);
      const a = data.analysis || {};
      container.innerHTML = renderAIResults(a);
    } catch (err) {
      container.innerHTML = `<p class="error-msg">Analysis failed: ${esc(err.message)}</p>`;
    }
  }

  function renderAIResults(a) {
    let html = '<div class="ai-results-grid">';
    // Routing
    if (a.routing && !a.routing.error) {
      html += `<div class="ai-card"><h5>🔀 Routing Decision</h5>
        <div class="ai-detail">Assigned to: <strong>${esc(a.routing.assignedTo)}</strong></div>
        <div class="ai-detail">Confidence: <div class="confidence-bar"><div class="confidence-fill" style="width:${((a.routing.confidence||0)*100).toFixed(0)}%"></div></div> ${((a.routing.confidence||0)*100).toFixed(0)}%</div>
        <div class="ai-detail ai-reasoning">${esc(a.routing.reasoning)}</div></div>`;
    }
    // Tagging
    if (a.tagging && !a.tagging.error && a.tagging.tags) {
      html += `<div class="ai-card"><h5>🏷️ Auto-Tags</h5>
        <div class="ai-tags">${a.tagging.tags.map(t => `<span class="tag tag-${t.category}">${esc(t.tag)} <small>${(t.confidence*100).toFixed(0)}%</small></span>`).join('')}</div></div>`;
    }
    // Prioritization
    if (a.prioritization && !a.prioritization.error) {
      html += `<div class="ai-card"><h5>⚡ Priority Score</h5>
        <div class="priority-score-big">${a.prioritization.priorityScore}/10</div>
        <div class="ai-detail">Urgency: ${(a.prioritization.urgencyComponent*100).toFixed(0)}%</div>
        <div class="ai-detail">Sentiment: ${(a.prioritization.sentimentComponent*100).toFixed(0)}%</div>
        <div class="ai-detail">Business Impact: ${(a.prioritization.businessImpactComponent*100).toFixed(0)}%</div></div>`;
    }
    // Analysis (sentiment/urgency)
    if (a.analysis) {
      html += `<div class="ai-card"><h5>🧠 Content Analysis</h5>`;
      if (a.analysis.sentiment) html += `<div class="ai-detail">Sentiment: <span class="badge badge-${a.analysis.sentiment.sentiment === 'negative' ? 'red' : a.analysis.sentiment.sentiment === 'positive' ? 'green' : 'yellow'}">${a.analysis.sentiment.sentiment}</span> (${(a.analysis.sentiment.sentimentScore*100).toFixed(0)}%)</div>`;
      if (a.analysis.urgency) html += `<div class="ai-detail">Urgency: ${a.analysis.urgency.urgencyScore}/10</div>`;
      if (a.analysis.expertise) html += `<div class="ai-detail">Expertise needed: ${esc(a.analysis.expertise.primaryExpertise)}</div>`;
      html += '</div>';
    }
    // Escalation
    if (a.escalation && !a.escalation.error) {
      const esc_class = a.escalation.shouldEscalate ? 'ai-card ai-card-alert' : 'ai-card';
      html += `<div class="${esc_class}"><h5>🚨 Escalation Check</h5>
        <div class="ai-detail">${a.escalation.shouldEscalate ? `<span class="badge badge-red">ESCALATION NEEDED</span> — ${esc(a.escalation.reason)}` : '<span class="badge badge-green">No escalation needed</span>'}</div>
        ${a.escalation.shouldEscalate ? `<div class="ai-detail">Urgency: <span class="badge badge-${a.escalation.urgency === 'critical' ? 'red' : a.escalation.urgency === 'high' ? 'orange' : 'yellow'}">${a.escalation.urgency}</span></div>` : ''}</div>`;
    }
    // Response
    if (a.response && !a.response.error) {
      html += `<div class="ai-card ai-card-wide"><h5>💬 AI Generated Response</h5>
        <div class="ai-response-text">${esc(a.response.text)}</div>
        <div class="ai-detail">Confidence: ${((a.response.confidence||0)*100).toFixed(0)}%</div>
        ${a.response.suggestedActions ? `<div class="ai-detail">Suggested actions: ${a.response.suggestedActions.map(a2 => `<span class="tag">${esc(a2)}</span>`).join('')}</div>` : ''}</div>`;
    }
    // Attachment Analysis
    if (a.attachmentAnalysis && Array.isArray(a.attachmentAnalysis) && a.attachmentAnalysis.length > 0) {
      html += `<div class="ai-card ai-card-wide"><h5>📎 Attachment Analysis (Nova Multimodal)</h5>`;
      a.attachmentAnalysis.forEach(att => {
        html += `<div style="margin-bottom:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border);">`;
        html += `<div style="font-weight:600;margin-bottom:6px;">📄 ${esc(att.fileName)} <span style="opacity:0.5;font-size:0.8rem;">(${att.type || att.fileType})</span></div>`;
        if (att.error) {
          html += `<div style="color:#e17055;">Analysis failed: ${esc(att.error)}</div>`;
        } else if (att.analysis) {
          const an = att.analysis;
          if (att.type === 'image') {
            if (an.extractedText) html += `<div class="ai-detail"><strong>Extracted Text:</strong> ${esc(an.extractedText.substring(0, 500))}</div>`;
            if (an.detectedApplication) html += `<div class="ai-detail"><strong>Application:</strong> ${esc(an.detectedApplication)}</div>`;
            if (an.detectedErrors && an.detectedErrors.length) html += `<div class="ai-detail"><strong>Detected Errors:</strong> ${an.detectedErrors.map(e => '<span class="tag" style="background:#d63031;color:#fff;">' + esc(e) + '</span>').join(' ')}</div>`;
            if (an.uiElements && an.uiElements.length) html += `<div class="ai-detail"><strong>UI Elements:</strong> ${an.uiElements.map(u => '<span class="tag">' + esc(u) + '</span>').join(' ')}</div>`;
            if (an.confidence) html += `<div class="ai-detail"><strong>Confidence:</strong> ${(an.confidence * 100).toFixed(0)}%</div>`;
          } else if (att.type === 'document') {
            if (an.summary) html += `<div class="ai-detail"><strong>Summary:</strong> ${esc(an.summary)}</div>`;
            if (an.errorPatterns && an.errorPatterns.length) html += `<div class="ai-detail"><strong>Error Patterns:</strong> ${an.errorPatterns.map(e => '<span class="tag" style="background:#d63031;color:#fff;">' + esc(e) + '</span>').join(' ')}</div>`;
            if (an.stackTraces && an.stackTraces.length) html += `<div class="ai-detail"><strong>Stack Traces:</strong> ${an.stackTraces.length} found</div>`;
            if (an.keyTechnicalDetails) html += `<div class="ai-detail"><strong>Technical Details:</strong> ${Object.entries(an.keyTechnicalDetails).map(([k,v]) => esc(k) + ': ' + esc(String(v))).join(', ')}</div>`;
          }
        }
        html += `</div>`;
      });
      html += `</div>`;
    }
    html += '</div>';
    return html;
  }

  async function loadTicketAttachments(ticketId) {
    const container = document.getElementById('ticket-attachments');
    if (!container) return;
    try {
      const data = await API.getAttachments(ticketId);
      const attachments = data.attachments || [];
      if (!attachments.length) { container.innerHTML = '<p style="color:var(--text2);font-size:0.85rem;">No attachments found.</p>'; return; }
      container.innerHTML = attachments.map(a => {
        const isImage = (a.fileType || '').startsWith('image/');
        const isVideo = (a.fileType || '').startsWith('video/');
        const sizeKB = a.fileSize ? (a.fileSize / 1024).toFixed(1) + ' KB' : '';
        if (isImage && a.downloadUrl) {
          return `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-width:280px;">
            <img src="${a.downloadUrl}" alt="${esc(a.fileName)}" style="max-width:100%;max-height:200px;display:block;cursor:pointer;" onclick="window.open('${a.downloadUrl}','_blank')">
            <div style="padding:6px 10px;font-size:0.78rem;color:var(--text2);">${esc(a.fileName)} ${sizeKB ? '· ' + sizeKB : ''}</div>
          </div>`;
        }
        if (isVideo && a.downloadUrl) {
          return `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-width:320px;">
            <video src="${a.downloadUrl}" controls style="max-width:100%;max-height:200px;display:block;"></video>
            <div style="padding:6px 10px;font-size:0.78rem;color:var(--text2);">${esc(a.fileName)} ${sizeKB ? '· ' + sizeKB : ''}</div>
          </div>`;
        }
        return `<a href="${a.downloadUrl || '#'}" target="_blank" style="display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--border);border-radius:8px;color:var(--text);text-decoration:none;font-size:0.85rem;">
          📄 ${esc(a.fileName)} ${sizeKB ? '<span style="color:var(--text2);">· ' + sizeKB + '</span>' : ''}
        </a>`;
      }).join('');
    } catch (err) {
      container.innerHTML = '<p style="color:var(--text2);font-size:0.85rem;">Failed to load attachments.</p>';
    }
  }

  async function loadSimilarTickets(ticketId) {
    const container = document.getElementById('similar-results');
    try {
      const data = await API.searchSimilar(ticketId);
      const similar = data.similarTickets || [];
      if (!similar.length) { container.innerHTML = '<p class="empty-state">No similar tickets found.</p>'; return; }
      container.innerHTML = similar.map(s => `
        <div class="similar-card">
          <div class="similar-header"><span class="ticket-id">#${s.ticketId?.slice(0,8)}</span><span class="badge badge-${s.wasSuccessful ? 'green' : 'gray'}">${s.wasSuccessful ? 'Resolved' : 'Unresolved'}</span></div>
          <div class="similar-subject">${esc(s.subject)}</div>
          <div class="similar-meta">Similarity: <div class="confidence-bar"><div class="confidence-fill" style="width:${(s.similarityScore*100).toFixed(0)}%"></div></div> ${(s.similarityScore*100).toFixed(0)}%</div>
          ${s.resolution ? `<div class="similar-resolution">Resolution: ${esc(s.resolution)}</div>` : ''}
        </div>`).join('');
    } catch (err) { container.innerHTML = `<p class="empty-state">Could not search similar tickets: ${esc(err.message)}</p>`; }
  }

  // ── Ticket Timeline ──
  const ACTIVITY_ICONS = {
    status_change: '🔄',
    message: '💬',
    assignment: '👤',
    resolution: '✅',
    escalation: '🚨',
    merge: '🔀',
  };

  async function loadTicketTimeline(ticketId, lastKey) {
    const container = document.getElementById('timeline-results');
    if (!container) return;
    if (!lastKey) {
      container.innerHTML = '<p class="loading">Loading timeline...</p>';
    }
    try {
      const data = await API.getTicketActivities(ticketId, lastKey);
      const activities = data.activities || [];
      if (!activities.length && !lastKey) {
        container.innerHTML = '<p class="empty-state">No activity recorded yet.</p>';
        return;
      }
      const html = activities.map(a => {
        const icon = ACTIVITY_ICONS[a.type] || '📌';
        const time = a.createdAt ? new Date(a.createdAt).toLocaleString() : '—';
        const detail = formatActivityDetail(a);
        return `<div class="timeline-item">
          <div class="timeline-node">${icon}</div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-type">${a.type.replace(/_/g, ' ')}</span>
              <span class="timeline-time">${time}</span>
            </div>
            <div class="timeline-detail">${detail}</div>
            <div class="timeline-actor">${a.actor ? 'by ' + esc(a.actor) : ''}</div>
          </div>
        </div>`;
      }).join('');

      if (lastKey) {
        // Append to existing timeline
        const loadMoreBtn = container.querySelector('.timeline-load-more');
        if (loadMoreBtn) loadMoreBtn.remove();
        container.insertAdjacentHTML('beforeend', html);
      } else {
        container.innerHTML = `<div class="timeline-list">${html}</div>`;
      }

      // Add Load More button if there's a nextKey
      if (data.nextKey) {
        const loadMoreHtml = `<button class="btn btn-outline btn-sm timeline-load-more" style="margin-top:12px;">Load More</button>`;
        container.insertAdjacentHTML('beforeend', loadMoreHtml);
        container.querySelector('.timeline-load-more').addEventListener('click', () => {
          loadTicketTimeline(ticketId, data.nextKey);
        });
      }
    } catch (err) {
      if (!lastKey) {
        container.innerHTML = `<p class="empty-state">Could not load timeline: ${esc(err.message)}</p>`;
      }
    }
  }

  function formatActivityDetail(activity) {
    const d = activity.details || {};
    switch (activity.type) {
      case 'status_change':
        return `Status changed from <strong>${esc(d.oldStatus || '—')}</strong> to <strong>${esc(d.newStatus || '—')}</strong>`;
      case 'message':
        return esc(d.contentPreview || d.content || 'New message');
      case 'assignment':
        return `Assigned from <strong>${esc(d.previousAssignee || 'unassigned')}</strong> to <strong>${esc(d.newAssignee || '—')}</strong>`;
      case 'resolution':
        return 'Ticket resolved';
      case 'escalation':
        return `Escalated — ${esc(d.reason || '')} ${d.urgency ? '(Urgency: ' + esc(d.urgency) + ')' : ''}`;
      case 'merge':
        return `Merged ${d.primaryTicketId ? 'into #' + esc(d.primaryTicketId.slice(0, 8)) : ''} ${d.duplicateTicketId ? 'from #' + esc(d.duplicateTicketId.slice(0, 8)) : ''}`;
      default:
        return esc(JSON.stringify(d));
    }
  }

  // ── Suggested Solutions ──
  async function loadSuggestedSolutions(ticket) {
    const container = document.getElementById('suggested-solutions-results');
    if (!container) return;
    container.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>Generating AI solution &amp; searching knowledge base...</p></div>';

    let html = '';

    // 1. Try similar tickets + KB in parallel with AI solution
    try {
      const [aiResult, similarResult] = await Promise.allSettled([
        API.getAISolution(ticket.ticketId),
        API.getSuggestedSolutions(ticket.ticketId),
      ]);

      // Render Nova AI solution at the top (always if available)
      if (aiResult.status === 'fulfilled' && aiResult.value && aiResult.value.solution) {
        const ai = aiResult.value;
        html += renderAISolutionCard(ai);
      }

      // Render similar ticket solutions
      let solutions = [];
      if (similarResult.status === 'fulfilled') {
        solutions = (similarResult.value.similarTickets || []).filter(s => s.similarityScore >= 0.5).slice(0, 5);
      }
      if (solutions.length) {
        html += '<h5 style="color:var(--text2);margin:16px 0 8px;font-size:0.85rem;">📚 Similar Resolved Tickets</h5>';
        html += renderSuggestedSolutions(solutions);
      }

      // KB fallback if no similar tickets
      if (!solutions.length) {
        try {
          const kbData = await API.searchKnowledgeFallback(ticket.subject + ' ' + ticket.description);
          const articles = (kbData.results || []).slice(0, 5);
          if (articles.length) {
            html += '<h5 style="color:var(--text2);margin:16px 0 8px;font-size:0.85rem;">📖 Related Knowledge Base Articles</h5>';
            html += renderKBFallbackSolutions(articles);
          }
        } catch (kbErr) { console.warn('KB fallback failed:', kbErr); }
      }
    } catch (err) {
      console.warn('Suggested solutions fetch error:', err);
    }

    // 2. If nothing at all (AI failed + no KB + no similar), always show AI solution
    if (!html) {
      container.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>No cached solutions found. Asking Nova AI...</p></div>';
      try {
        const ai = await API.getAISolution(ticket.ticketId);
        if (ai && ai.solution) {
          html = renderAISolutionCard(ai);
        }
      } catch (aiErr) {
        console.warn('AI solution retry failed:', aiErr);
      }
    }

    if (!html) {
      container.innerHTML = '<p class="empty-state">Could not generate a solution. Please deploy the latest backend (npx tsc &amp;&amp; cdk deploy) and try again.</p>';
      return;
    }

    container.innerHTML = '<div class="suggested-solutions-list">' + html + '</div>';
    bindSolutionActions(container, ticket);
  }

  function renderAISolutionCard(ai) {
    return `<div class="ai-solution-card">
      <div class="ai-solution-header"><span class="ai-solution-badge">🤖 Nova AI Solution</span><span class="ai-solution-model">${esc(ai.model || 'Amazon Nova')}</span></div>
      ${ai.diagnosis ? `<div class="ai-solution-section"><span class="ai-solution-label">Diagnosis</span><p>${esc(ai.diagnosis)}</p></div>` : ''}
      <div class="ai-solution-section"><span class="ai-solution-label">Recommended Solution</span><p>${esc(ai.solution)}</p></div>
      ${ai.prevention ? `<div class="ai-solution-section"><span class="ai-solution-label">Prevention</span><p>${esc(ai.prevention)}</p></div>` : ''}
      <div class="ss-actions">
        <button class="btn btn-sm btn-primary ss-apply-btn" data-resolution="${esc(ai.solution)}">📋 Apply Solution</button>
      </div>
    </div>`;
  }

  function renderSuggestedSolutions(solutions) {
    return '<div class="suggested-solutions-list">' + solutions.map(s => {
      const similarityPct = (s.similarityScore * 100).toFixed(0);
      const successPct = s.successRate != null ? (s.successRate * 100).toFixed(0) : (s.wasSuccessful ? '100' : '0');
      return `<div class="suggested-solution-card">
        <div class="ss-header">
          <span class="ss-problem">${esc(s.subject || s.problem || 'Similar Issue')}</span>
          <div class="ss-scores">
            <span class="ss-score" title="Similarity"><span class="ss-score-label">Similarity</span> ${similarityPct}%</span>
            <span class="ss-score" title="Success Rate"><span class="ss-score-label">Success</span> ${successPct}%</span>
          </div>
        </div>
        <div class="ss-resolution">${esc(s.resolution || 'No resolution text available.')}</div>
        <div class="ss-actions">
          <button class="btn btn-sm btn-primary ss-apply-btn" data-resolution="${esc(s.resolution || '')}">📋 Apply Solution</button>
          <button class="btn btn-sm btn-success ss-helpful-btn" data-solution-id="${esc(s.ticketId || s.solutionId || '')}">👍 Helpful</button>
          <button class="btn btn-sm btn-ghost ss-not-helpful-btn" data-solution-id="${esc(s.ticketId || s.solutionId || '')}">👎 Not Helpful</button>
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  function renderKBFallbackSolutions(articles) {
    return '<div class="suggested-solutions-list"><p style="color:#a29bfe;margin-bottom:12px;font-size:0.9rem;">No direct solutions found. Here are related knowledge base articles:</p>' +
      articles.map(a => {
        const relevancePct = a.relevanceScore != null ? (a.relevanceScore * 100).toFixed(0) : '—';
        return `<div class="suggested-solution-card ss-kb-fallback">
          <div class="ss-header">
            <span class="ss-problem">${esc(a.title || 'Knowledge Article')}</span>
            <div class="ss-scores"><span class="ss-score"><span class="ss-score-label">Relevance</span> ${relevancePct}%</span></div>
          </div>
          <div class="ss-resolution">${esc((a.relevantSections || []).slice(0, 2).join(' ') || a.content || 'No content available.')}</div>
        </div>`;
      }).join('') + '</div>';
  }

  function bindSolutionActions(container, ticket) {
    // Apply Solution buttons
    container.querySelectorAll('.ss-apply-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const resolution = btn.getAttribute('data-resolution');
        const resolveText = document.getElementById('resolve-text');
        if (resolveText) {
          resolveText.value = resolution;
          resolveText.focus();
          // Switch to Info tab to show the resolve form
          const infoTab = document.querySelector('.detail-tab[data-dtab="info"]');
          if (infoTab) infoTab.click();
          toast('Solution applied to resolution field', 'success');
        } else {
          toast('Resolution field not available (ticket may already be resolved)', 'error');
        }
      });
    });

    // Helpful buttons
    container.querySelectorAll('.ss-helpful-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const solutionId = btn.getAttribute('data-solution-id');
        btn.disabled = true;
        btn.textContent = '⏳...';
        try {
          await API.recordSolutionFeedback(solutionId, true);
          btn.textContent = '✅ Thanks!';
          btn.closest('.ss-actions').querySelectorAll('.ss-not-helpful-btn').forEach(b => b.disabled = true);
          toast('Feedback recorded — thank you!', 'success');
        } catch (err) {
          btn.textContent = '👍 Helpful';
          btn.disabled = false;
          toast('Failed to record feedback: ' + err.message, 'error');
        }
      });
    });

    // Not Helpful buttons
    container.querySelectorAll('.ss-not-helpful-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const solutionId = btn.getAttribute('data-solution-id');
        btn.disabled = true;
        btn.textContent = '⏳...';
        try {
          await API.recordSolutionFeedback(solutionId, false);
          btn.textContent = '✅ Noted';
          btn.closest('.ss-actions').querySelectorAll('.ss-helpful-btn').forEach(b => b.disabled = true);
          toast('Feedback recorded — thank you!', 'success');
        } catch (err) {
          btn.textContent = '👎 Not Helpful';
          btn.disabled = false;
          toast('Failed to record feedback: ' + err.message, 'error');
        }
      });
    });
  }

  // ── Canned Responses Dropdown ──
  async function loadCannedResponsesDropdown(ticket) {
    const select = document.getElementById('canned-response-select');
    if (!select) return;
    try {
      let responses = [];
      try {
        const data = await API.listCannedResponses();
        responses = data.responses || data.cannedResponses || [];
      } catch (_apiErr) {
        responses = getLocalCannedResponses();
      }
      if (!responses.length) {
        responses = getLocalCannedResponses();
      }
      // Group by category
      const grouped = {};
      responses.forEach(r => {
        const cat = r.category || 'Other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(r);
      });
      let html = '<option value="">— Select a canned response —</option>';
      Object.keys(grouped).sort().forEach(cat => {
        html += `<optgroup label="${esc(cat)}">`;
        grouped[cat].forEach(r => {
          html += `<option value="${esc(r.responseId || r.id)}" data-body="${esc(r.body)}">${esc(r.title)}</option>`;
        });
        html += '</optgroup>';
      });
      select.innerHTML = html;
      // On selection, insert body into message input with token replacement
      select.addEventListener('change', () => {
        const selectedOption = select.options[select.selectedIndex];
        if (!selectedOption || !selectedOption.value) return;
        const body = selectedOption.getAttribute('data-body') || '';
        const replaced = replaceCannedTokens(body, ticket);
        const input = document.getElementById('canned-message-input');
        if (input) {
          input.value = replaced;
          input.focus();
        }
      });
    } catch (err) {
      select.innerHTML = '<option value="">— Could not load canned responses —</option>';
    }
  }

  function replaceCannedTokens(text, ticket) {
    if (!text) return text;
    return text
      .replace(/\{\{ticketId\}\}/g, ticket.ticketId ? ticket.ticketId.slice(0, 8) : '')
      .replace(/\{\{userName\}\}/g, ticket.userId || Auth.getEmail() || '')
      .replace(/\{\{subject\}\}/g, ticket.subject || '')
      .replace(/\{\{status\}\}/g, ticket.status || '')
      .replace(/\{\{category\}\}/g, ticket.category || '')
      .replace(/\{\{assignedTo\}\}/g, ticket.assignedTo || 'Unassigned')
      .replace(/\{\{assignedTeam\}\}/g, ticket.assignedTeam || '');
  }

  let messageRefreshInterval = null;

  async function loadTicketMessages(ticketId, ticket) {
    const container = document.getElementById('messages-results');
    try {
      const data = await API.getTicketMessages(ticketId);
      const messages = data.messages || [];
      if (!messages.length) {
        container.innerHTML = '<p class="empty-state">No messages from the user.</p>';
      } else {
        const isNonEnglish = ticket && ticket.detectedLanguage && ticket.detectedLanguage !== 'en';
        container.innerHTML = messages.map(m => {
          const hasTranslation = isNonEnglish && m.translatedContent;
          return `
          <div class="message-card">
            <div class="message-card-content">${esc(m.content)}</div>
            ${hasTranslation ? `
            <div class="message-translation">
              <div class="message-translation-label">🌐 Translated to ${esc(getLanguageName(ticket.detectedLanguage))}:</div>
              <div class="message-translation-text">${esc(m.translatedContent)}</div>
            </div>` : ''}
            <div class="message-card-meta">
              <span>👤 ${esc(m.userId)}</span>
              <span>· ${timeAgo(m.createdAt)}</span>
            </div>
          </div>`;
        }).join('');
      }
    } catch (err) {
      container.innerHTML = '<p class="empty-state">Could not load messages.</p>';
    }
    // Load canned responses dropdown
    loadCannedResponsesDropdown(ticket || { ticketId });
    // Bind send message button
    const sendBtn = document.getElementById('send-canned-message-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const input = document.getElementById('canned-message-input');
        const content = input.value.trim();
        if (!content) { toast('Please enter a message', 'error'); return; }
        sendBtn.disabled = true;
        sendBtn.textContent = '⏳ Sending...';
        try {
          await API.createTicket({ userId: Auth.getEmail(), subject: `Reply to #${ticketId.slice(0,8)}`, description: content, priority: 5 });
          toast('Message sent', 'success');
          input.value = '';
          loadTicketMessages(ticketId, ticket);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = '📨 Send Message';
        }
      });
    }
    // Bind reply translate button
    const replyTransBtn = document.getElementById('reply-translate-btn');
    if (replyTransBtn) {
      replyTransBtn.addEventListener('click', async () => {
        const langSelect = document.getElementById('reply-translate-lang');
        const targetLang = langSelect.value;
        const input = document.getElementById('canned-message-input');
        const text = input.value.trim();
        if (!targetLang) { toast('Select a language first', 'error'); return; }
        if (!text) { toast('Type a message first', 'error'); return; }
        replyTransBtn.disabled = true;
        replyTransBtn.textContent = 'Translating...';
        try {
          const res = await API.translateText(text, targetLang);
          input.value = res.translatedText;
        } catch (err) {
          toast('Translation failed: ' + err.message, 'error');
        } finally {
          replyTransBtn.disabled = false;
          replyTransBtn.textContent = 'Translate';
        }
      });
    }
    // Start auto-refreshing messages while modal is open
    startMessageRefresh(ticketId);
  }

  function startMessageRefresh(ticketId) {
    stopMessageRefresh();
    messageRefreshInterval = setInterval(async () => {
      const modal = document.getElementById('ticket-modal');
      if (modal.classList.contains('hidden')) { stopMessageRefresh(); return; }
      const container = document.getElementById('messages-results');
      if (!container) { stopMessageRefresh(); return; }
      try {
        const data = await API.getTicketMessages(ticketId);
        const messages = data.messages || [];
        const currentCount = container.querySelectorAll('.message-card').length;
        if (messages.length !== currentCount) {
          // New messages arrived — update silently
          if (!messages.length) {
            container.innerHTML = '<p class="empty-state">No messages from the user.</p>';
          } else {
            container.innerHTML = messages.map(m => `
              <div class="message-card">
                <div class="message-card-content">${esc(m.content)}</div>
                <div class="message-card-meta">
                  <span>👤 ${esc(m.userId)}</span>
                  <span>· ${timeAgo(m.createdAt)}</span>
                </div>
              </div>`).join('');
          }
        }
      } catch(e) { /* silent */ }
    }, 10000);
  }

  function stopMessageRefresh() {
    if (messageRefreshInterval) { clearInterval(messageRefreshInterval); messageRefreshInterval = null; }
  }

  // ── Chat Transcript Renderer ──
  function renderChatTranscript(description) {
    if (!description || !description.startsWith('Chat Escalation Transcript:')) {
      return '<p class="empty-state">No chat transcript available.</p>';
    }
    const transcript = description.replace('Chat Escalation Transcript:\n\n', '');
    const lines = transcript.split('\n\n').filter(l => l.trim());
    if (!lines.length) return '<p class="empty-state">Empty transcript.</p>';
    return `<div class="chat-transcript">${lines.map(line => {
      const isUser = line.startsWith('User:');
      const isAssistant = line.startsWith('Assistant:');
      const content = line.replace(/^(User|Assistant):\s*/, '');
      const cls = isUser ? 'chat-msg chat-msg-user' : isAssistant ? 'chat-msg chat-msg-assistant' : 'chat-msg';
      const icon = isUser ? '👤' : isAssistant ? '🤖' : '💬';
      const label = isUser ? 'Customer' : isAssistant ? 'AI Assistant' : '';
      return `<div class="${cls}"><div class="chat-msg-header">${icon} ${label}</div><div class="chat-msg-body">${esc(content)}</div></div>`;
    }).join('')}</div>`;
  }

  // ── Team Assignment Panel ──
  async function loadAssignPanel(ticket) {
    const container = document.getElementById('assign-panel');
    try {
      const [teamsData, ticketsData] = await Promise.all([API.listTeams(), API.listTickets()]);
      const teams = teamsData.teams || [];
      const tickets = Array.isArray(ticketsData) ? ticketsData : (ticketsData.tickets || []);

      // Count in-progress tickets per team
      const teamWorkload = {};
      tickets.forEach(t => {
        const team = t.assignedTeam || t.assignedTo;
        if (team && ['in_progress', 'assigned', 'processing', 'analyzing'].includes(t.status)) {
          teamWorkload[team] = (teamWorkload[team] || 0) + 1;
        }
      });

      container.innerHTML = `
        <div class="assign-section">
          <h4 style="color:var(--accent2);margin-bottom:12px;">🎯 Assign to Team</h4>
          <p style="color:var(--text2);font-size:0.85rem;margin-bottom:16px;">
            Current: <span class="badge badge-${ticket.assignedTeam ? 'purple' : 'gray'}">${ticket.assignedTeam || 'Unassigned'}</span>
            ${ticket.assignedTo ? ` · Agent: <span class="badge badge-blue">${esc(ticket.assignedTo)}</span>` : ''}
          </p>
          <div class="assign-teams-grid">
            ${teams.map(team => {
              const busy = teamWorkload[team.teamId] || 0;
              const isCurrent = ticket.assignedTeam === team.teamId;
              return `<div class="assign-team-card ${isCurrent ? 'assign-team-current' : ''}" data-team-id="${esc(team.teamId)}">
                <div class="assign-team-header">
                  <span class="assign-team-name">${esc(team.teamName)}</span>
                  <span class="badge badge-${busy > 5 ? 'red' : busy > 2 ? 'yellow' : 'green'}">${busy} active</span>
                </div>
                <div class="assign-team-expertise">${(team.expertise || []).slice(0, 4).map(e => `<span class="tag">${esc(e)}</span>`).join('')}</div>
                <button class="btn btn-sm ${isCurrent ? 'btn-outline' : 'btn-primary'} assign-team-btn" data-team-id="${esc(team.teamId)}" ${isCurrent ? 'disabled' : ''}>
                  ${isCurrent ? '✓ Current Team' : '📋 Assign'}
                </button>
              </div>`;
            }).join('')}
          </div>
        </div>`;

      // Bind assign buttons
      container.querySelectorAll('.assign-team-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const teamId = btn.dataset.teamId;
          btn.disabled = true; btn.textContent = 'Assigning...';
          try {
            await API.assignTicket(ticket.ticketId, teamId, teamId);
            toast(`Assigned to ${teamId}`, 'success');
            openTicketDetail(ticket.ticketId);
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = '📋 Assign'; }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="empty-state">Failed to load teams: ${esc(err.message)}</p>`;
    }
  }

  // ── Chat Requests View ──
  let seenChatCount = 0;
  let chatRequestsPollInterval = null;

  function startChatRequestsPoll() {
    stopChatRequestsPoll();
    chatRequestsPollInterval = setInterval(() => {
      const chatView = document.getElementById('view-chat-requests');
      if (chatView && chatView.classList.contains('active')) {
        loadChatRequests();
      } else {
        stopChatRequestsPoll();
      }
    }, 15000);
  }

  function stopChatRequestsPoll() {
    if (chatRequestsPollInterval) {
      clearInterval(chatRequestsPollInterval);
      chatRequestsPollInterval = null;
    }
  }

  function updateChatRequestBadge() {
    const chatTickets = allTickets.filter(t => (t.tags || []).includes('chat-escalation'));
    const badge = document.getElementById('chat-req-badge');
    const newCount = chatTickets.length - seenChatCount;
    if (newCount > 0) { badge.textContent = newCount; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }

  function markChatRequestsSeen() {
    const chatTickets = allTickets.filter(t => (t.tags || []).includes('chat-escalation'));
    seenChatCount = chatTickets.length;
    const badge = document.getElementById('chat-req-badge');
    if (badge) badge.classList.add('hidden');
  }

  async function loadChatRequests() {
    const container = document.getElementById('chat-requests-list');
    // Only show loading on first load (when container is empty or has loading text)
    if (!container.querySelector('.cr-card')) {
      container.innerHTML = '<p class="loading">Loading chat requests...</p>';
    }
    try {
      // Fetch teams and tickets in parallel
      let apiTeams = [];
      try { const td = await API.listTeams(); apiTeams = td.teams || []; } catch (_e) {}
      const localTeams = getLocalTeams();
      const allTeamIds = new Set(apiTeams.map(t => t.teamId));
      const allTeamsArr = [...apiTeams, ...localTeams.filter(t => !allTeamIds.has(t.teamId))];

      const data = await API.listTickets();
      allTickets = filterOutBinTickets(Array.isArray(data) ? data : (data.tickets || []));
      const chatTickets = allTickets.filter(t => (t.tags || []).includes('chat-escalation'));
      updateChatRequestBadge();

      // Build teams summary boxes
      const teamColors = ['#6c5ce7','#00b894','#0984e3','#e17055','#fdcb6e','#00cec9','#d63031','#a29bfe','#55efc4','#fab1a0'];
      const teamsBoxesHtml = allTeamsArr.length ? `
        <div style="margin-bottom:20px;">
          <h4 style="color:var(--text2);font-size:0.85rem;margin-bottom:10px;">👥 Available Teams</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${allTeamsArr.map((team, i) => {
              const color = teamColors[i % teamColors.length];
              const assignedCount = allTickets.filter(t => t.assignedTeam === team.teamId).length;
              return `<div class="cr-team-box" data-team-id="${esc(team.teamId)}" style="background:${color}18;border:1px solid ${color}40;border-radius:8px;padding:8px 14px;display:flex;align-items:center;gap:8px;min-width:140px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px ${color}30'" onmouseout="this.style.transform='';this.style.boxShadow=''">
                <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                <div>
                  <div style="font-size:0.82rem;font-weight:600;color:var(--text);">${esc(team.teamName)}</div>
                  <div style="font-size:0.72rem;color:var(--text2);">${assignedCount} ticket${assignedCount !== 1 ? 's' : ''}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>` : '';

      if (!chatTickets.length) {
        container.innerHTML = teamsBoxesHtml + '<p class="empty-state">No chat escalation requests yet. When users escalate from the AI chat, they will appear here.</p>';
        return;
      }

      // Build team options helper for assign dropdown
      function buildTeamOptions(currentTeam) {
        return allTeamsArr.map(team =>
          `<option value="${esc(team.teamId)}" ${currentTeam === team.teamId ? 'selected' : ''}>${esc(team.teamName)}</option>`
        ).join('');
      }

      container.innerHTML = teamsBoxesHtml + chatTickets.map(t => {
        // Parse chat transcript
        let transcriptHtml = '';
        // Build a clean problem summary from the subject
        // Subject format: "[Chat Escalation - category] user's problem text"
        let problemSummary = '';
        if (t.subject) {
          // Strip the [Chat Escalation - xxx] prefix
          let raw = t.subject.replace(/^\[Chat Escalation\s*-\s*\w+\]\s*/i, '').trim();
          if (raw) {
            // Title-case it: capitalize first letter of each word
            problemSummary = raw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            // Truncate to ~80 chars
            if (problemSummary.length > 80) problemSummary = problemSummary.substring(0, 77) + '...';
          }
        }
        if (t.description && t.description.startsWith('Chat Escalation Transcript:')) {
          const transcript = t.description.replace('Chat Escalation Transcript:\n\n', '');
          const lines = transcript.split('\n\n').filter(l => l.trim());
          transcriptHtml = lines.map(line => {
            const isUser = line.startsWith('User:');
            const isAssistant = line.startsWith('Assistant:');
            const content = line.replace(/^(User|Assistant):\s*/, '');
            const icon = isUser ? '👤' : isAssistant ? '🤖' : '💬';
            const label = isUser ? 'Customer' : isAssistant ? 'AI Assistant' : '';
            const cls = isUser ? 'cr-msg cr-msg-user' : 'cr-msg cr-msg-bot';
            return `<div class="${cls}"><span class="cr-msg-icon">${icon}</span><div class="cr-msg-body"><div class="cr-msg-label">${label}</div><div class="cr-msg-text">${esc(content)}</div></div></div>`;
          }).join('');
        }

        return `<div class="cr-card" data-id="${t.ticketId}">
          <div class="cr-header">
            <div class="cr-header-left">
              <span class="cr-ticket-id">💬 #${t.ticketId?.slice(0, 8)}</span>
              <span class="badge badge-${statusColor(t.status)}">${statusLabel(t.status)}</span>
              <span class="cr-time">${timeAgo(t.createdAt)}</span>
            </div>
            <div class="cr-header-right">
              ${t.assignedTeam ? `<span class="badge badge-purple">👥 ${esc(t.assignedTeam)}</span>${t.assignedTo && t.assignedTo !== t.assignedTeam ? ` <span class="badge badge-teal">👤 ${esc(t.assignedTo)}</span>` : ''}` : '<span class="badge badge-orange">Unassigned</span>'}
            </div>
          </div>
          ${problemSummary ? `<div class="cr-problem-summary">🔴 <span class="cr-problem-label">Issue:</span> ${esc(problemSummary)}</div>` : ''}
          <div class="cr-user">From: ${esc(t.userId || 'Unknown user')}</div>
          <div class="cr-assigned-agent" style="margin:6px 16px 0;padding:8px 14px;border-radius:8px;font-size:0.85rem;display:flex;align-items:center;gap:8px;${t.assignedTo && t.assignedTo !== t.assignedTeam ? 'background:linear-gradient(135deg,rgba(0,206,201,0.12),rgba(108,92,231,0.10));border:1px solid rgba(0,206,201,0.25);color:#00cec9;' : t.assignedTeam ? 'background:rgba(108,92,231,0.10);border:1px solid rgba(108,92,231,0.20);color:#a29bfe;' : 'background:rgba(225,112,85,0.10);border:1px solid rgba(225,112,85,0.20);color:#e17055;'}">
            <span style="font-size:1.1rem;">${t.assignedTo && t.assignedTo !== t.assignedTeam ? '👤' : t.assignedTeam ? '👥' : '⚠️'}</span>
            <span style="font-weight:600;">${t.assignedTo && t.assignedTo !== t.assignedTeam ? 'Assigned Agent: ' + esc(t.assignedTo) + ' <span style="font-weight:400;opacity:0.7;">(' + esc(t.assignedTeam) + ')</span>' + (t.assignedBy === 'assignment-agent' ? ' <span style="opacity:0.5;font-size:0.7rem;margin-left:auto;">🤖 auto</span>' : '') : t.assignedTeam ? 'Team: ' + esc(t.assignedTeam) + ' <span style="font-weight:400;opacity:0.7;">(no agent assigned)</span>' : 'Not assigned to any team'}</span>
          </div>
          <div class="cr-transcript">${transcriptHtml || '<p class="empty-state">No transcript available.</p>'}</div>
          <div class="cr-live-messages" id="cr-live-msgs-${t.ticketId}">
            <div style="margin:8px 16px 0;padding:6px 0;border-top:1px dashed var(--border);">
              <span style="font-size:0.78rem;color:var(--accent2);font-weight:600;">💬 Live Chat Messages (Agent ↔ Customer)</span>
            </div>
            <div class="cr-live-msgs-list"><p class="empty-state" style="font-size:0.8rem;padding:10px;">Loading messages...</p></div>
          </div>
          <div class="cr-actions" onclick="event.stopPropagation()">
            <select class="cr-assign-select" data-ticket-id="${t.ticketId}">
              <option value="">🎯 Assign to Team...</option>
              ${buildTeamOptions(t.assignedTeam)}
            </select>
            <button class="btn btn-sm btn-outline cr-detail-btn" data-id="${t.ticketId}">View Full Details</button>
          </div>
        </div>`;
      }).join('');

      // Bind assign dropdowns
      container.querySelectorAll('.cr-assign-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const teamId = sel.value;
          const ticketId = sel.dataset.ticketId;
          if (!teamId || !ticketId) return;
          sel.disabled = true;
          try {
            // Auto-assign to a team member (exclude lead & manager roles)
            // Try API-backed teams first, fall back to localStorage
            let teamMembers = [];
            try {
              const td = await API.listTeams();
              const apiTeam = (td.teams || []).find(t => t.teamId === teamId);
              if (apiTeam && apiTeam.members && apiTeam.members.length) {
                teamMembers = apiTeam.members.filter(m => m.role === 'member');
              }
            } catch (_e) {}
            if (!teamMembers.length) {
              const allMembers = getLocalTeamMembers();
              teamMembers = (allMembers[teamId] || []).filter(m => m.role === 'member');
            }
            let assignedTo = teamId; // fallback to team name if no eligible members
            if (teamMembers.length > 0) {
              // Round-robin: track last assigned index per team in localStorage
              const rrKey = 'ns_rr_' + teamId;
              let lastIdx = parseInt(localStorage.getItem(rrKey) || '-1', 10);
              let nextIdx = (lastIdx + 1) % teamMembers.length;
              assignedTo = teamMembers[nextIdx].name;
              localStorage.setItem(rrKey, String(nextIdx));
            }
            await API.assignTicket(ticketId, teamId, assignedTo);
            saveLocalAssignment(ticketId, teamId, assignedTo);
            const memberMsg = assignedTo !== teamId ? ` → ${assignedTo}` : '';
            toast(`Assigned to ${teamId}${memberMsg}`, 'success');
            await silentLoadTickets();
            loadChatRequests();
          } catch (err) { toast(err.message, 'error'); sel.disabled = false; }
        });
      });

      // Bind detail buttons
      container.querySelectorAll('.cr-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => openTicketDetail(btn.dataset.id));
      });

      // Clicking the card also opens detail
      container.querySelectorAll('.cr-card').forEach(card => {
        card.addEventListener('click', () => openTicketDetail(card.dataset.id));
      });

      // Clicking a team box navigates to Teams view and opens that team
      container.querySelectorAll('.cr-team-box').forEach(box => {
        box.addEventListener('click', () => {
          const teamId = box.dataset.teamId;
          switchView('teams');
          // Wait for teams to load, then open the team detail
          setTimeout(async () => {
            let apiT = [];
            try { const td = await API.listTeams(); apiT = td.teams || []; } catch (_e) {}
            const localT = getLocalTeams();
            const ids = new Set(apiT.map(t => t.teamId));
            const merged = [...apiT, ...localT.filter(t => !ids.has(t.teamId))];
            showTeamDetail(teamId, merged, apiT);
          }, 300);
        });
      });

      // Fetch live messages for each chat ticket
      chatTickets.forEach(async (t) => {
        try {
          const msgData = await API.getTicketMessages(t.ticketId);
          const msgs = msgData.messages || [];
          const liveContainer = document.getElementById('cr-live-msgs-' + t.ticketId);
          if (!liveContainer) return;
          const listEl = liveContainer.querySelector('.cr-live-msgs-list');
          if (!listEl) return;
          if (msgs.length === 0) {
            listEl.innerHTML = '<p class="empty-state" style="font-size:0.8rem;padding:10px;">No live chat messages yet.</p>';
            return;
          }
          const ticketOwner = t.userId || '';
          listEl.innerHTML = msgs.map(msg => {
            const isCustomer = msg.userId === ticketOwner;
            const icon = isCustomer ? '👤' : '🧑‍💼';
            const label = isCustomer ? 'Customer' : 'Agent';
            const cls = isCustomer ? 'cr-msg cr-msg-user' : 'cr-msg cr-msg-agent';
            return `<div class="${cls}"><span class="cr-msg-icon">${icon}</span><div class="cr-msg-body"><div class="cr-msg-label">${label} <span style="font-size:0.7rem;opacity:0.6;margin-left:4px;">${timeAgo(msg.createdAt)}</span></div><div class="cr-msg-text">${esc(msg.content)}</div></div></div>`;
          }).join('');
        } catch (_e) {
          const liveContainer = document.getElementById('cr-live-msgs-' + t.ticketId);
          if (liveContainer) {
            const listEl = liveContainer.querySelector('.cr-live-msgs-list');
            if (listEl) listEl.innerHTML = '<p class="empty-state" style="font-size:0.8rem;padding:10px;">Could not load messages.</p>';
          }
        }
      });

    } catch (err) {
      container.innerHTML = `<p class="empty-state">Failed to load chat requests: ${esc(err.message)}</p>`;
    }
  }

  // ── Canned Responses Management ──
  const CANNED_CATEGORIES = ['Hardware','Software','Network','Account & Access','Email','Security','Database','Cloud Infrastructure','Performance','Other'];

  // Demo canned responses shown when API is unavailable or returns empty
  const DEMO_CANNED_RESPONSES = [
    { responseId: 'demo-1', title: 'Lost/Broken MFA Device Recovery', body: 'Hi {{userName}},\n\nWe understand you have lost access to your Multi-Factor Authentication (MFA) device (Ticket: {{ticketId}}). Here is how we will help you regain access:\n\nFor IAM Users:\n1. An administrator will deactivate your current MFA device from the IAM console\n2. Navigate to: IAM > Users > Your Username > Security credentials > MFA device > Deactivate\n3. Once deactivated, you can sign in with just your username and password\n4. After signing in, immediately set up a new MFA device:\n   - Go to IAM > Security credentials > Assign MFA device\n   - Choose Virtual MFA (recommended: Google Authenticator, Authy, or Microsoft Authenticator)\n   - Scan the QR code and enter two consecutive codes to activate\n\nFor Root Account Users:\n1. Go to the AWS sign-in page and click "Sign in using root user email"\n2. Click "Forgot password?" to reset via your registered email\n3. After signing in, go to My Security Credentials > Multi-factor authentication\n4. If you cannot complete this process, you will need to contact AWS Support directly\n5. AWS may require identity verification (government ID, payment method on file, etc.)\n\nPrevention Tips:\n- Always register a backup MFA device\n- Store MFA recovery codes in a secure password manager\n- Consider using a hardware security key (YubiKey) as a backup\n- For organizations, use AWS SSO with centralized MFA management\n\nPlease reply to this ticket once you have regained access, and we will verify your account security.\n\nAccount & Access Support Team', category: 'Account & Access' },
    { responseId: 'demo-2', title: 'Forgotten Credentials Recovery', body: 'Hi {{userName}},\n\nWe received your request regarding forgotten AWS credentials (Ticket: {{ticketId}}). Here are the recovery steps based on your situation:\n\nForgotten Root User Password:\n1. Go to https://signin.aws.amazon.com/\n2. Select "Root user" and enter your root email address\n3. Click "Next" then "Forgot password?"\n4. Check your email for the password reset link (check spam/junk folders)\n5. Create a new strong password (min 8 chars, mix of upper/lower/numbers/symbols)\n6. If you no longer have access to the root email, contact AWS Support for identity verification\n\nForgotten IAM User Password:\n1. Contact your AWS account administrator to reset your password from the IAM console\n2. Admin steps: IAM > Users > Select user > Security credentials > Manage console password\n3. The admin can either set a new password or generate a temporary one requiring change at next sign-in\n\nLost Account ID or Alias:\n1. Check your email for any previous AWS correspondence containing your 12-digit account ID\n2. Check browser bookmarks or saved passwords for the sign-in URL (which may contain the alias)\n3. If you are part of an AWS Organization, your management account admin can provide the account ID\n4. Check your billing statements or invoices as they include the account ID\n\nSign-in Page Confusion:\n- Root user sign-in: Use your EMAIL address at the main AWS sign-in page\n- IAM user sign-in: Use your ACCOUNT ID/ALIAS + IAM USERNAME at the account-specific sign-in URL\n- These are different sign-in flows and using IAM credentials on the root page (or vice versa) will fail\n\nBrowser Troubleshooting:\n- Clear browser cache and cookies for *.aws.amazon.com\n- Try an incognito/private browsing window\n- Disable browser extensions that may interfere (ad blockers, privacy tools)\n\nPlease let us know which scenario applies and we will guide you through the specific steps.\n\nAccount & Access Support Team', category: 'Account & Access' },
    { responseId: 'demo-3', title: 'Over-Permissioned IAM Users/Roles Remediation', body: 'Hi {{userName}},\n\nOur security audit has identified IAM users or roles with excessive permissions in your AWS account (Ticket: {{ticketId}}). This violates the Principle of Least Privilege. Here is our remediation plan:\n\nIssue Identified:\n- One or more IAM entities have overly broad policies (e.g., AdministratorAccess, PowerUserAccess, or wildcard * permissions)\n- This increases the blast radius of any credential compromise\n\nImmediate Actions Required:\n1. Audit Current Permissions:\n   - Use IAM Access Analyzer to identify unused permissions\n   - Review CloudTrail logs to see which API calls each user/role actually makes\n   - Use the IAM policy simulator to test what actions are allowed\n\n2. Generate Least-Privilege Policies:\n   - Use IAM Access Analyzer policy generation based on actual usage\n   - Navigate to: IAM > Access Analyzer > Policy generation\n   - Select the user/role and a CloudTrail trail with 90+ days of data\n\n3. Implement Scoped Policies:\n   - Replace AdministratorAccess with service-specific policies\n   - Use conditions to restrict by IP, time, region, or resource ARN\n   - Example: Instead of "s3:*" on "*", use "s3:GetObject" on "arn:aws:s3:::specific-bucket/*"\n\n4. Set Up Permission Boundaries:\n   - Create permission boundaries to cap maximum permissions for any IAM entity\n\nBest Practices Going Forward:\n- Use IAM roles with temporary credentials instead of long-lived access keys\n- Implement AWS Organizations SCPs for account-level guardrails\n- Enable AWS Config rules: iam-policy-no-statements-with-admin-access\n- Schedule quarterly IAM access reviews\n- Use AWS IAM Identity Center (SSO) for centralized access management\n\nWe will schedule a follow-up review in 30 days to verify remediation.\n\nSecurity Operations Team', category: 'Security' },
    { responseId: 'demo-4', title: 'Publicly Accessible S3 Bucket Remediation', body: 'Hi {{userName}},\n\nA publicly accessible S3 bucket has been detected in your AWS account (Ticket: {{ticketId}}). This is a critical security issue requiring immediate attention.\n\nImmediate Remediation Steps:\n1. Block All Public Access (Account Level):\n   - Go to S3 > Block Public Access settings for this account\n   - Enable ALL four block public access settings\n   - This prevents any bucket from being made public\n\n2. Fix Individual Bucket Policies:\n   - Go to S3 > Select bucket > Permissions tab\n   - Remove any bucket policy with "Principal": "*"\n   - Remove any ACL grants to "Everyone" or "Authenticated Users"\n   - Enable "Block public access" at the bucket level\n\n3. Review Object-Level Permissions:\n   - Check for objects with public ACLs\n   - Remove public ACLs on individual objects\n\n4. Enable Monitoring:\n   - Enable S3 server access logging on all buckets\n   - Enable CloudTrail data events for S3\n   - Set up AWS Config rules: s3-bucket-public-read-prohibited, s3-bucket-public-write-prohibited\n   - Configure Amazon Macie to scan for sensitive data\n\nPrevention Measures:\n- Use S3 Block Public Access at the organization level via SCPs\n- Implement bucket policies that explicitly deny public access\n- Use VPC endpoints for S3 access from within your VPC\n- Enable S3 Object Lock for compliance-critical data\n- Use pre-signed URLs for temporary, controlled access to objects\n\nIf sensitive data was exposed, please escalate immediately for incident response investigation.\n\nSecurity Operations Team', category: 'Security' },
    { responseId: 'demo-5', title: 'Leaked AWS Access Keys Response', body: 'Hi {{userName}},\n\nWe have detected that AWS access keys associated with your account may have been exposed (Ticket: {{ticketId}}). This is a CRITICAL security incident requiring immediate action.\n\nIMMEDIATE ACTIONS (Do These Now):\n1. Deactivate the Compromised Keys:\n   - IAM > Users > Select user > Security credentials > Access keys\n   - Click "Make inactive" on the compromised key pair\n   - Do NOT delete yet as we need it for forensic investigation\n\n2. Create New Access Keys (if needed):\n   - Generate a new key pair from the same Security credentials page\n   - Update all applications and services using the old keys\n   - Better yet, migrate to IAM roles with temporary credentials\n\n3. Check for Unauthorized Activity:\n   - Review CloudTrail logs for the past 24-48 hours\n   - Look for: unfamiliar API calls, new IAM users/roles, EC2 instances in unusual regions, S3 data access\n   - Check for unauthorized resources across all regions\n\n4. Revoke All Active Sessions:\n   - If an IAM role was compromised: IAM > Roles > Select role > Revoke sessions\n\nInvestigation (Our Team Will Handle):\n- Full CloudTrail audit for the affected credentials\n- Review of all resources created or modified during the exposure window\n- Check for persistence mechanisms (new IAM users, roles, Lambda functions)\n- Scan for cryptocurrency mining instances (common attack pattern)\n- Review S3 access logs for data exfiltration\n\nPrevention Going Forward:\n- NEVER hardcode credentials in source code\n- Use AWS Secrets Manager or Parameter Store for credential management\n- Enable git-secrets or pre-commit hooks to prevent accidental commits\n- Use IAM roles for EC2, Lambda, and ECS instead of access keys\n- Enable GuardDuty for continuous threat detection\n- Rotate access keys every 90 days (or eliminate them entirely)\n\nSecurity Incident Response Team', category: 'Security' },
    { responseId: 'demo-6', title: 'Root User Security Best Practices', body: 'Hi {{userName}},\n\nOur security review has identified that the AWS root user account is being used for daily operations (Ticket: {{ticketId}}). This is a significant security risk.\n\nWhy Root User Usage Is Dangerous:\n- The root user has unrestricted access to ALL resources and billing\n- Root credentials cannot be limited by IAM policies or SCPs\n- If compromised, an attacker has complete control of the entire AWS account\n\nImmediate Steps:\n1. Secure the Root Account:\n   - Enable MFA immediately (hardware MFA key recommended)\n   - Go to: My Security Credentials > Multi-factor authentication > Activate MFA\n   - Use a strong, unique password (20+ characters) stored in a password manager\n   - Remove any root user access keys: My Security Credentials > Access keys > Delete\n\n2. Create IAM Admin Users:\n   - Create an IAM user with AdministratorAccess for daily admin tasks\n   - Enable MFA on this IAM user as well\n   - Use this IAM user instead of root for all day-to-day operations\n\n3. Lock Down Root Usage:\n   - Only use root for tasks that specifically require it:\n     * Changing account settings (name, email, password)\n     * Changing the support plan\n     * Closing the account\n     * Enabling MFA delete on S3\n     * Restoring IAM permissions\n   - Set up CloudWatch alarms for root user sign-in events\n   - Enable AWS Config rule: root-account-mfa-enabled\n\n4. Enable Activity Logging:\n   - Ensure CloudTrail is enabled in all regions\n   - Set up SNS alerts for any root user API activity\n   - Monitor with GuardDuty for anomalous root usage\n\nOrganization-Level Controls:\n- Use AWS Organizations with SCPs to restrict root actions across member accounts\n- Implement a break-glass procedure for root access (documented, audited, requires approval)\n- Store root credentials in a physical safe or enterprise vault\n\nSecurity Operations Team', category: 'Security' },
    { responseId: 'demo-7', title: 'CloudTrail Activity Logging Setup', body: 'Hi {{userName}},\n\nOur audit found that AWS CloudTrail is not fully enabled in your account (Ticket: {{ticketId}}). Without CloudTrail, there is no audit log of API calls, making incident investigation impossible.\n\nWhat CloudTrail Does:\n- Records every API call made in your AWS account\n- Captures who made the call, when, from where, and what was changed\n- Essential for security auditing, compliance, and incident investigation\n\nSetup Steps:\n1. Create a Multi-Region Trail:\n   - Go to CloudTrail > Trails > Create trail\n   - Enable for all regions (critical as attacks often target unused regions)\n   - Enable for all accounts in the organization if using AWS Organizations\n\n2. Configure S3 Storage:\n   - Create a dedicated S3 bucket for CloudTrail logs\n   - Enable SSE-KMS encryption\n   - Enable log file validation (detects tampering)\n   - Set up lifecycle rules to archive to Glacier after 90 days\n   - Enable MFA delete on the bucket\n\n3. Enable Data Events (Recommended):\n   - S3 object-level logging: Tracks GetObject, PutObject, DeleteObject\n   - Lambda function invocations\n   - DynamoDB table operations\n   - Note: Data events incur additional costs\n\n4. Set Up Monitoring and Alerts:\n   - Enable CloudTrail Insights for unusual API activity detection\n   - Create CloudWatch alarms for: root user sign-in, IAM policy changes, security group modifications, S3 bucket policy changes, console sign-in failures\n   - Send alerts to SNS topic for immediate notification\n\n5. Integration with Other Services:\n   - Send logs to CloudWatch Logs for real-time analysis\n   - Enable AWS Security Hub for centralized findings\n   - Use Amazon Athena to query CloudTrail logs for investigations\n\nCompliance Note:\n- CloudTrail is required for PCI DSS, HIPAA, SOC 2, and most compliance frameworks\n- Retain logs for at least 1 year (7 years for some requirements)\n\nSecurity Operations Team', category: 'Security' },
    { responseId: 'demo-8', title: 'Unexpected AWS Charges Investigation', body: 'Hi {{userName}},\n\nWe are investigating the unexpected charges on your AWS account (Ticket: {{ticketId}}).\n\nCommon Causes of Unexpected Charges:\n1. Forgotten Resources:\n   - Idle EC2 instances still running (check ALL regions)\n   - Unattached Elastic IPs (charged when NOT associated with a running instance)\n   - Old EBS snapshots and volumes\n   - NAT Gateways running 24/7\n   - Idle RDS instances or Aurora clusters\n   - Unused Elastic Load Balancers\n\n2. Free Tier Expiration:\n   - The 12-month free tier starts from account creation date\n   - Some services have usage limits even within free tier (e.g., 750 hrs/month for t2.micro)\n   - Always-free services have monthly limits that reset\n\n3. Data Transfer Costs:\n   - Cross-region data transfer\n   - Data transfer out to the internet\n   - VPC peering across regions\n\nImmediate Steps to Reduce Costs:\n1. Use Cost Explorer to identify top spending services:\n   - Billing > Cost Explorer > Daily costs by service\n   - Filter by date range to find when charges spiked\n\n2. Check All Regions for Running Resources:\n   - Use AWS Resource Explorer or Tag Editor to find resources across all regions\n   - Pay attention to regions you do not normally use\n\n3. Terminate/Delete Unused Resources:\n   - Stop or terminate idle EC2 instances\n   - Release unattached Elastic IPs\n   - Delete old EBS snapshots and unattached volumes\n   - Delete unused NAT Gateways and Load Balancers\n\nPrevention Measures:\n- Set up AWS Budgets with alerts at 50%, 80%, and 100% of expected spend\n- Enable Cost Anomaly Detection for automatic alerts\n- Use Trusted Advisor to identify idle resources\n- Tag all resources for cost allocation tracking\n- Schedule non-production resources to stop outside business hours\n- Consider Reserved Instances or Savings Plans for predictable workloads\n\nIf charges may be due to unauthorized access, please escalate immediately.\n\nCloud Billing Support Team', category: 'Cloud Infrastructure' },
    { responseId: 'demo-9', title: 'AWS Service Quota Limit Increase', body: 'Hi {{userName}},\n\nYou have hit an AWS service quota (limit) as reported in Ticket: {{ticketId}}. Here is how to resolve this:\n\nUnderstanding Service Quotas:\n- AWS sets default limits on resources per region to prevent accidental over-provisioning\n- Common limits: EC2 instances per region, VPCs per region, S3 buckets per account, IAM roles per account\n- Most limits can be increased upon request\n\nHow to Request a Limit Increase:\n1. Via Service Quotas Console (Recommended):\n   - Go to: Service Quotas > AWS services > Select the service\n   - Find the specific quota and click "Request quota increase"\n   - Enter the desired new value and submit\n   - Most requests are approved within 24 hours\n\n2. Via AWS Support Center:\n   - Go to: Support Center > Create case\n   - Select "Service limit increase"\n   - Choose the service, region, and specify the new limit\n   - Provide a business justification\n\nCommon Quotas and Defaults:\n- EC2 On-Demand instances: Varies by instance type (vCPU-based limits)\n- VPCs per region: 5 (easily increased to 100+)\n- Elastic IPs per region: 5\n- S3 buckets per account: 100\n- IAM roles per account: 1,000\n- Lambda concurrent executions: 1,000\n- CloudFormation stacks per region: 200\n\nRegion-Specific Notes:\n- Not all AWS services are available in all regions\n- Some newer regions must be explicitly enabled in Account Settings > AWS Regions\n- Quotas are per-region, so a limit increase in us-east-1 does not apply to eu-west-1\n\nBest Practices:\n- Request increases proactively before you need them\n- Use Trusted Advisor to monitor quota usage\n- Set up CloudWatch alarms for quota utilization\n- Document quota requirements as part of capacity planning\n\nWe will track the request and update this ticket when approved.\n\nCloud Infrastructure Team', category: 'Cloud Infrastructure' },
    { responseId: 'demo-10', title: 'AWS Account Suspension/Reactivation', body: 'Hi {{userName}},\n\nWe are addressing the AWS account suspension issue reported in Ticket: {{ticketId}}.\n\nCommon Reasons for Account Suspension:\n1. Payment Failure:\n   - Expired or declined credit card on file\n   - Insufficient funds for the billing cycle\n   - Payment method removed or invalid\n\n2. Policy Violation:\n   - Terms of Service violation detected\n   - Abusive or prohibited usage patterns\n   - Fraudulent activity detected\n\nReactivation Steps for Payment Issues:\n1. Sign in to the AWS Management Console (billing access may still work)\n2. Go to: Billing > Payment methods\n3. Update your payment method with a valid credit card\n4. Pay any outstanding balance\n5. Contact AWS Support if the account does not reactivate within 24 hours\n\nReactivation Steps for Policy Violations:\n1. Check your registered email for a notification from AWS explaining the violation\n2. Open a case with AWS Support (you may need to use the account root email)\n3. Provide the requested information or remediation steps\n4. AWS will review and respond within 24-72 hours\n\nImportant Notes About Suspended Accounts:\n- Running resources may be stopped but are NOT immediately deleted\n- You will continue to incur storage charges for EBS volumes, S3, and RDS\n- After extended suspension, AWS may begin terminating resources\n- Data recovery becomes increasingly difficult over time\n\nAccount Closure Information:\n- To close: Account Settings > Close Account\n- You must first terminate all running resources and resolve outstanding charges\n- AWS retains the account for 90 days (you can reopen during this period)\n- After 90 days, the account is permanently closed\n- The email address cannot be reused for a new account during the 90-day period\n- Download any needed data, invoices, or tax documents before closing\n\nMulti-Account Management:\n- If part of an AWS Organization, the management account admin can help\n- Consider consolidated billing to prevent payment issues\n- Set up billing alerts and budgets to catch issues early\n\nAccount Management Team', category: 'Account & Access' },
{ responseId: 'demo-11', title: 'EC2 Instance Unreachable/Down in Production', body: 'Hi {{userName}},\n\nWe are investigating the EC2 instance availability issue reported in Ticket: {{ticketId}}.\n\nImmediate Diagnostic Steps:\n1. Check Instance Status:\n   - Go to EC2 Console > Instances > Select the instance\n   - Review Status Checks tab: System Status Check and Instance Status Check\n   - If System Status Check failed: The underlying host hardware has an issue\n   - If Instance Status Check failed: OS-level or configuration problem\n\n2. Review System Logs:\n   - Actions > Monitor and troubleshoot > Get system log\n   - Look for kernel panics, filesystem errors, or boot failures\n   - Check for out-of-memory (OOM) kills\n\n3. Check Network Connectivity:\n   - Verify Security Group rules allow inbound traffic on required ports\n   - Check Network ACLs on the subnet\n   - Verify the instance has a public IP or is reachable via VPN/Direct Connect\n   - Check route tables for correct routing\n\n4. Review CloudWatch Metrics:\n   - CPUUtilization: Sustained 100% may indicate a hung process\n   - StatusCheckFailed: Confirms the instance is unhealthy\n   - NetworkIn/NetworkOut: Zero traffic indicates network isolation\n\nRecovery Actions:\n- For System Status Check failure: Stop and start the instance (migrates to new host)\n- For Instance Status Check failure: Reboot the instance first, then stop/start if needed\n- If instance is in a stopped state and will not start: Check for insufficient capacity errors\n- For EBS volume issues: Detach and reattach, or restore from snapshot\n\nPrevention:\n- Use Auto Scaling Groups for automatic replacement of unhealthy instances\n- Implement health checks via ELB or Route 53\n- Set up CloudWatch alarms for StatusCheckFailed metrics\n- Use multiple Availability Zones for high availability\n- Enable detailed monitoring (1-minute intervals) for production instances\n\nProduction Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-12', title: 'RDS Database Performance Degradation', body: 'Hi {{userName}},\n\nWe are investigating the RDS performance issue reported in Ticket: {{ticketId}}.\n\nImmediate Diagnosis:\n1. Check CloudWatch Metrics:\n   - CPUUtilization: Above 80% sustained indicates compute bottleneck\n   - FreeableMemory: Low values cause swapping and slow queries\n   - ReadIOPS/WriteIOPS: Compare against baseline for anomalies\n   - DatabaseConnections: Near max_connections limit causes connection refused errors\n   - DiskQueueDepth: High values indicate I/O bottleneck\n   - ReplicaLag: For read replicas, high lag means stale reads\n\n2. Enable Performance Insights:\n   - RDS Console > Select DB > Performance Insights\n   - Identify top SQL queries by wait time, CPU, and I/O\n   - Look for full table scans, missing indexes, and lock contention\n\n3. Review Slow Query Log:\n   - Enable slow_query_log parameter (MySQL) or log_min_duration_statement (PostgreSQL)\n   - Identify queries taking longer than expected\n\nCommon Causes and Fixes:\n- Missing Indexes: Run EXPLAIN on slow queries, add appropriate indexes\n- Connection Exhaustion: Implement connection pooling (RDS Proxy recommended)\n- Instance Too Small: Scale up to a larger instance class (modify DB instance)\n- Storage Bottleneck: Migrate to gp3 or io2 for better IOPS\n- Long-Running Transactions: Identify and terminate blocking sessions\n- Parameter Tuning: Adjust innodb_buffer_pool_size, work_mem, shared_buffers\n\nScaling Options:\n- Vertical: Modify instance class (causes brief downtime for Single-AZ)\n- Read Replicas: Offload read traffic to up to 5 replicas\n- Aurora: Consider migration for auto-scaling storage and better performance\n- RDS Proxy: Manage connection pooling and failover automatically\n\nPrevention:\n- Set up CloudWatch alarms for CPU > 80%, FreeableMemory < 500MB\n- Schedule regular ANALYZE/VACUUM operations\n- Use RDS Performance Insights for continuous monitoring\n- Implement query caching with ElastiCache (Redis/Memcached)\n\nDatabase Operations Team', category: 'Database' },
{ responseId: 'demo-13', title: 'Lambda Function Timeout/Throttling in Production', body: 'Hi {{userName}},\n\nWe are addressing the Lambda function issues reported in Ticket: {{ticketId}}.\n\nDiagnosing the Problem:\n1. Check CloudWatch Metrics:\n   - Duration: Compare against configured timeout\n   - Throttles: Non-zero means concurrency limit reached\n   - Errors: Check invocation errors vs function errors\n   - ConcurrentExecutions: Compare against account/function limit\n   - IteratorAge: For stream-based triggers, high age means processing lag\n\n2. Review CloudWatch Logs:\n   - Look for timeout messages: Task timed out after X seconds\n   - Check for cold start duration in INIT_START/REPORT lines\n   - Look for out-of-memory errors\n\nTimeout Issues:\n- Increase timeout setting (max 15 minutes) if the function legitimately needs more time\n- Optimize code: reduce external API calls, use connection reuse\n- Move long-running tasks to Step Functions or ECS/Fargate\n- Enable Provisioned Concurrency to eliminate cold starts\n- Increase memory allocation (also increases CPU proportionally)\n\nThrottling Issues:\n- Default account concurrency limit: 1,000 per region\n- Request a limit increase via Service Quotas console\n- Set Reserved Concurrency on critical functions to guarantee capacity\n- Implement exponential backoff and retry in calling services\n- Use SQS as a buffer to smooth out traffic spikes\n\nCold Start Optimization:\n- Use Provisioned Concurrency for latency-sensitive functions\n- Keep deployment packages small (use Lambda Layers for dependencies)\n- Choose lighter runtimes (Node.js, Python) over heavier ones (Java, .NET)\n- Use ARM64 (Graviton2) for better price-performance\n- Initialize SDK clients outside the handler function\n\nPrevention:\n- Set up CloudWatch alarms for Throttles > 0 and Duration > 80% of timeout\n- Use AWS X-Ray for distributed tracing\n- Implement dead letter queues (DLQ) for failed invocations\n- Monitor with Lambda Insights for enhanced metrics\n\nServerless Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-14', title: 'Application Load Balancer 5xx Errors Spike', body: 'Hi {{userName}},\n\nWe are investigating the ALB 5xx error spike reported in Ticket: {{ticketId}}.\n\nUnderstanding 5xx Error Types:\n- 502 Bad Gateway: Backend target returned an invalid response or connection was refused\n- 503 Service Unavailable: No healthy targets registered, or all targets are at capacity\n- 504 Gateway Timeout: Backend target did not respond within the idle timeout period\n\nImmediate Diagnosis:\n1. Check ALB CloudWatch Metrics:\n   - HTTPCode_ELB_5XX_Count: Errors generated by the ALB itself\n   - HTTPCode_Target_5XX_Count: Errors returned by backend targets\n   - HealthyHostCount: Number of healthy targets (should be > 0)\n   - UnHealthyHostCount: Targets failing health checks\n   - TargetResponseTime: Average response time from targets\n   - ActiveConnectionCount: Current active connections\n\n2. Check Target Group Health:\n   - EC2 > Target Groups > Select group > Targets tab\n   - Review health check status for each target\n   - Check health check configuration (path, interval, thresholds)\n\n3. Review ALB Access Logs:\n   - Enable access logging to S3 if not already enabled\n   - Look for patterns: specific targets returning errors, specific paths, specific client IPs\n\nCommon Fixes:\n- 502 Errors: Check if application is running on targets, verify security groups allow ALB to reach targets, check application logs for crashes\n- 503 Errors: Register healthy targets, fix health check configuration, scale up target group\n- 504 Errors: Increase ALB idle timeout, optimize backend response time, check for downstream dependencies (database, external APIs)\n\nScaling Response:\n- Enable Auto Scaling for target instances\n- Set scaling policies based on ALBRequestCountPerTarget\n- Pre-warm the ALB for expected traffic spikes (contact AWS Support)\n- Consider using AWS Global Accelerator for improved availability\n\nPrevention:\n- Set up CloudWatch alarms for 5XX error rate > 1%\n- Implement circuit breakers in application code\n- Use multiple AZs with cross-zone load balancing\n- Configure proper health check intervals and thresholds\n\nProduction Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-15', title: 'CodePipeline/CodeBuild Deployment Failure', body: 'Hi {{userName}},\n\nWe are investigating the deployment failure reported in Ticket: {{ticketId}}.\n\nDiagnosing the Failure:\n1. Check CodePipeline Console:\n   - Go to CodePipeline > Select pipeline > View execution history\n   - Identify which stage failed (Source, Build, Deploy, Approval)\n   - Click on the failed action to see error details\n\n2. Review CodeBuild Logs:\n   - Go to CodeBuild > Build history > Select the failed build\n   - Review the build log phases: INSTALL, PRE_BUILD, BUILD, POST_BUILD\n   - Look for: dependency installation failures, compilation errors, test failures, artifact packaging issues\n\n3. Check IAM Permissions:\n   - Verify the CodeBuild service role has permissions for all required AWS services\n   - Check S3 permissions for artifact storage\n   - Verify ECR permissions if building Docker images\n\nCommon Build Failures:\n- Dependency Issues: Lock file mismatch, private registry auth failure, version conflicts\n- Out of Memory: Increase CodeBuild compute type (BUILD_GENERAL1_SMALL to MEDIUM or LARGE)\n- Docker Build: Check Dockerfile syntax, base image availability, layer caching\n- Test Failures: Review test output, check for environment-specific test configurations\n\nCommon Deploy Failures:\n- CloudFormation: Stack rollback due to resource creation failure, check Events tab\n- ECS/Fargate: Task definition errors, container health check failures, insufficient capacity\n- Lambda: Package size exceeded, handler not found, runtime version mismatch\n- Elastic Beanstalk: Health check failure, configuration errors, platform version issues\n\nBest Practices:\n- Use buildspec.yml version 0.2 with proper phase definitions\n- Cache dependencies in S3 to speed up builds\n- Use parameter store or secrets manager for sensitive values (never hardcode)\n- Implement manual approval gates for production deployments\n- Set up SNS notifications for pipeline state changes\n- Use CodePipeline execution history for audit trails\n\nDevOps Team', category: 'Software' },
{ responseId: 'demo-16', title: 'CloudFormation Stack Rollback/Failure', body: 'Hi {{userName}},\n\nWe are investigating the CloudFormation stack failure reported in Ticket: {{ticketId}}.\n\nDiagnosing the Failure:\n1. Check Stack Events:\n   - CloudFormation > Stacks > Select stack > Events tab\n   - Find the first CREATE_FAILED or UPDATE_FAILED event\n   - The Status reason column explains why the resource failed\n\n2. Common Failure Reasons:\n   - Resource limit exceeded (e.g., too many VPCs, EIPs, security groups)\n   - IAM permissions insufficient for the CloudFormation execution role\n   - Resource already exists (name conflict with existing resources)\n   - Invalid parameter values or unsupported configurations\n   - Circular dependencies between resources\n   - Timeout waiting for resource stabilization\n\nRecovery Steps:\n- For CREATE_FAILED: Delete the stack and fix the template, then recreate\n- For UPDATE_ROLLBACK_FAILED: Use Continue Update Rollback with resources to skip\n- For DELETE_FAILED: Identify resources that cannot be deleted, manually clean up, then retry\n\nTemplate Best Practices:\n- Use CloudFormation Linter (cfn-lint) to validate templates before deployment\n- Use Change Sets to preview changes before applying\n- Implement stack policies to prevent accidental updates to critical resources\n- Use nested stacks for complex architectures (keep each stack under 500 resources)\n- Parameterize environment-specific values\n- Use Conditions for optional resources\n- Always define DeletionPolicy for stateful resources (RDS, S3, EFS)\n\nDebugging Tips:\n- Enable CloudFormation termination protection for production stacks\n- Use CloudTrail to see the actual API calls CloudFormation makes\n- Check resource-specific limits before deploying\n- Use drift detection to find manual changes that conflict with the template\n\nInfrastructure Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-17', title: 'VPC Connectivity Issues / Network Troubleshooting', body: 'Hi {{userName}},\n\nWe are investigating the VPC connectivity issue reported in Ticket: {{ticketId}}.\n\nSystematic Troubleshooting:\n1. Security Groups (Stateful):\n   - Check inbound rules on the destination resource\n   - Security groups are stateful: if inbound is allowed, response traffic is automatically allowed\n   - Verify the source security group or CIDR is correct\n   - Remember: security groups only have ALLOW rules (no explicit DENY)\n\n2. Network ACLs (Stateless):\n   - Check BOTH inbound AND outbound rules on the subnet\n   - NACLs are stateless: you must allow traffic in both directions\n   - Rules are evaluated in order (lowest number first)\n   - Check for explicit DENY rules that may block traffic\n\n3. Route Tables:\n   - Verify the subnet route table has correct routes\n   - For internet access: route to Internet Gateway (0.0.0.0/0 > igw-xxx)\n   - For NAT access: route to NAT Gateway (0.0.0.0/0 > nat-xxx)\n   - For VPC peering: route to peering connection for the peer CIDR\n   - For VPN: route to Virtual Private Gateway\n\n4. VPC Flow Logs:\n   - Enable VPC Flow Logs if not already active\n   - Check for REJECT entries to identify blocked traffic\n   - Filter by source/destination IP and port\n\nCommon Scenarios:\n- Cannot reach internet from private subnet: Check NAT Gateway exists and route table points to it\n- Cannot SSH to EC2: Check security group allows port 22 from your IP, instance has public IP or bastion host\n- Cross-VPC communication fails: Check VPC peering connection is active, route tables updated in BOTH VPCs, security groups reference correct CIDR\n- DNS resolution fails: Ensure enableDnsHostnames and enableDnsSupport are true on the VPC\n\nAdvanced Connectivity:\n- AWS Transit Gateway: Hub-and-spoke model for connecting multiple VPCs\n- AWS PrivateLink: Access services privately without internet exposure\n- VPC Endpoints: Gateway endpoints for S3/DynamoDB, Interface endpoints for other services\n\nNetwork Operations Team', category: 'Network' },
{ responseId: 'demo-18', title: 'AWS Direct Connect / VPN Connectivity Issues', body: 'Hi {{userName}},\n\nWe are investigating the hybrid connectivity issue reported in Ticket: {{ticketId}}.\n\nDirect Connect Troubleshooting:\n1. Check Physical Connection:\n   - Direct Connect Console > Connections > Verify state is Available\n   - If state is Down: Contact your colocation provider or AWS partner\n   - Check for CRC errors or link flaps in your router logs\n\n2. Check Virtual Interfaces (VIFs):\n   - Verify BGP session state is UP (not idle or active)\n   - Check BGP peer IP addresses and ASN configuration\n   - Verify VLAN ID matches on both sides\n   - For private VIF: Check Virtual Private Gateway attachment\n   - For transit VIF: Check Transit Gateway association\n\n3. BGP Route Propagation:\n   - Verify routes are being advertised from on-premises\n   - Check route table propagation is enabled on the VGW/TGW\n   - Verify no route filters are blocking prefixes\n\nSite-to-Site VPN Troubleshooting:\n1. Check Tunnel Status:\n   - VPC Console > Site-to-Site VPN Connections > Select connection > Tunnel Details\n   - Both tunnels should show UP status\n   - If DOWN: Check IKE Phase 1 and Phase 2 parameters match\n\n2. Common VPN Issues:\n   - IKE version mismatch (IKEv1 vs IKEv2)\n   - Pre-shared key mismatch\n   - Encryption/authentication algorithm mismatch\n   - NAT-Traversal issues (UDP port 4500 blocked)\n   - Interesting traffic not being generated (for policy-based VPNs)\n\n3. Performance Issues:\n   - Single VPN tunnel max throughput: ~1.25 Gbps\n   - Use ECMP with multiple tunnels for higher throughput\n   - Consider Direct Connect for consistent, high-bandwidth needs\n   - Enable VPN acceleration for improved performance\n\nHybrid Architecture Best Practices:\n- Use redundant connections (2 Direct Connect + VPN backup)\n- Implement BGP communities for route preference\n- Monitor with CloudWatch metrics: TunnelState, TunnelDataIn/Out\n- Set up CloudWatch alarms for tunnel state changes\n\nNetwork Operations Team', category: 'Network' },
{ responseId: 'demo-19', title: 'ECS/Fargate Task Failure and Container Issues', body: 'Hi {{userName}},\n\nWe are investigating the ECS/Fargate task failure reported in Ticket: {{ticketId}}.\n\nDiagnosing Task Failures:\n1. Check Stopped Task Reason:\n   - ECS Console > Clusters > Select cluster > Tasks tab > Stopped\n   - Click on the stopped task to see Stopped reason and Container exit codes\n   - Exit code 0: Normal exit\n   - Exit code 1: Application error\n   - Exit code 137: Out of memory (OOM killed) or SIGKILL\n   - Exit code 139: Segmentation fault\n\n2. Review Container Logs:\n   - ECS Console > Task > Logs tab (if using awslogs driver)\n   - CloudWatch Logs > Log group: /ecs/task-definition-name\n   - Look for application startup errors, dependency connection failures, configuration issues\n\n3. Check Task Definition:\n   - Verify container image URI is correct and accessible\n   - Check memory and CPU limits are sufficient\n   - Verify environment variables and secrets are correctly configured\n   - Check health check configuration (command, interval, retries)\n\nCommon Issues:\n- Image Pull Failures: Check ECR permissions, image exists, VPC has NAT/VPC endpoint for ECR\n- OOM Kills: Increase task memory, check for memory leaks in application\n- Health Check Failures: Verify health check endpoint responds within timeout\n- Service Not Stabilizing: Check desired count vs running count, review deployment configuration\n- Networking: Verify security groups, task role permissions, service discovery configuration\n\nScaling and Deployment:\n- Use Application Auto Scaling with target tracking (CPU/Memory utilization)\n- Implement rolling deployments with minimum healthy percent\n- Use circuit breaker for automatic rollback on deployment failures\n- Consider Fargate Spot for non-critical workloads (up to 70% savings)\n\nContainer Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-20', title: 'EKS Cluster and Kubernetes Troubleshooting', body: 'Hi {{userName}},\n\nWe are investigating the EKS cluster issue reported in Ticket: {{ticketId}}.\n\nCluster Diagnostics:\n1. Check Cluster Status:\n   - EKS Console > Clusters > Verify status is ACTIVE\n   - Check Kubernetes version and platform version\n   - Review cluster logging (API server, audit, authenticator, controller manager, scheduler)\n\n2. Node Group Issues:\n   - Check managed node group status and health\n   - Verify nodes are in Ready state: kubectl get nodes\n   - Check for NotReady nodes: kubectl describe node <node-name>\n   - Common causes: instance type capacity, AMI issues, user data script failures\n\n3. Pod Troubleshooting:\n   - kubectl get pods -A (check for non-Running pods)\n   - kubectl describe pod <pod-name> (check Events section)\n   - kubectl logs <pod-name> (check application logs)\n   - Common states: Pending (scheduling issues), CrashLoopBackOff (app crashes), ImagePullBackOff (image issues)\n\nCommon EKS Issues:\n- Authentication: Verify aws-auth ConfigMap has correct IAM role mappings\n- Networking: Check VPC CNI plugin, verify pods can reach services, check CoreDNS\n- Storage: Verify EBS CSI driver is installed for persistent volumes\n- Load Balancer: Check AWS Load Balancer Controller is deployed and has correct IAM permissions\n- Scaling: Verify Cluster Autoscaler or Karpenter is configured correctly\n\nBest Practices:\n- Use managed node groups for simplified lifecycle management\n- Implement Pod Disruption Budgets for high availability\n- Use Fargate profiles for serverless pod execution\n- Enable control plane logging to CloudWatch\n- Use AWS Distro for OpenTelemetry for observability\n- Regularly update EKS version (stay within supported versions)\n\nKubernetes Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-21', title: 'AWS Outposts / On-Premises Integration Issues', body: 'Hi {{userName}},\n\nWe are addressing the on-premises/hybrid integration issue reported in Ticket: {{ticketId}}.\n\nAWS Outposts Troubleshooting:\n1. Outpost Connectivity:\n   - Verify Service Link connection to the parent AWS Region\n   - Check network requirements: minimum 1 Gbps uplink, <150ms latency to region\n   - Verify DNS resolution for AWS service endpoints\n   - Check firewall rules allow required AWS IP ranges\n\n2. Capacity Issues:\n   - Review available capacity on the Outpost rack\n   - Check EC2 instance availability for the Outpost\n   - Monitor local storage (EBS) capacity\n   - Plan for capacity with AWS support if nearing limits\n\nHybrid Storage (Storage Gateway):\n- File Gateway: Check NFS/SMB mount connectivity, verify IAM role permissions for S3\n- Volume Gateway: Check iSCSI target connectivity, verify snapshot schedules\n- Tape Gateway: Check virtual tape library status, verify backup software integration\n- Common fix: Restart the gateway VM if it becomes unresponsive\n\nAWS Systems Manager (Hybrid):\n- Verify SSM Agent is installed and running on on-premises servers\n- Check hybrid activation status in Systems Manager > Fleet Manager\n- Verify outbound HTTPS (443) connectivity to SSM endpoints\n- Check IAM instance profile or service role permissions\n- Use Session Manager for secure remote access without SSH/RDP\n\nMigration Services:\n- AWS Application Migration Service (MGN): Check replication status, verify agent connectivity\n- AWS Database Migration Service (DMS): Check replication instance, verify endpoint connectivity\n- AWS DataSync: Check agent status, verify NFS/SMB source connectivity\n\nBest Practices:\n- Use AWS Transit Gateway for centralized hybrid networking\n- Implement consistent monitoring across on-premises and cloud (CloudWatch Agent)\n- Use AWS Config for compliance across hybrid environments\n- Document network architecture including all connectivity paths\n\nHybrid Infrastructure Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-22', title: 'AWS Migration Troubleshooting (MGN/DMS/DataSync)', body: 'Hi {{userName}},\n\nWe are addressing the migration issue reported in Ticket: {{ticketId}}.\n\nApplication Migration Service (MGN):\n1. Replication Issues:\n   - Check source server agent status in MGN console\n   - Verify network connectivity: TCP 443 (HTTPS) and TCP 1500 (replication)\n   - Check replication lag and data backlog\n   - Verify staging area subnet has sufficient IP addresses\n   - Check IAM permissions for the replication server\n\n2. Launch/Cutover Issues:\n   - Review launch template settings (instance type, subnet, security groups)\n   - Check post-launch actions for errors\n   - Verify boot mode compatibility (BIOS vs UEFI)\n   - Check driver compatibility for the target instance type\n\nDatabase Migration Service (DMS):\n1. Replication Instance:\n   - Verify replication instance is in Available state\n   - Check CPU and memory utilization (scale up if needed)\n   - Verify security group allows connectivity to source and target\n\n2. Task Failures:\n   - Check table statistics for error counts\n   - Review task logs in CloudWatch for specific error messages\n   - Common issues: data type incompatibility, foreign key constraints, LOB handling\n   - For CDC (Change Data Capture): verify source database logging is enabled\n\nDataSync:\n1. Agent Issues:\n   - Verify agent status is Online in DataSync console\n   - Check agent VM has sufficient resources (4 vCPU, 16 GB RAM minimum)\n   - Verify network connectivity to AWS endpoints (port 443)\n\n2. Transfer Issues:\n   - Check task execution status and error logs\n   - Verify source/destination permissions\n   - Review data verification results\n\nMigration Best Practices:\n- Always perform a test migration before production cutover\n- Use AWS Migration Hub for centralized tracking\n- Plan for rollback scenarios\n- Schedule cutover during low-traffic windows\n- Validate data integrity post-migration\n\nMigration Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-23', title: 'CloudWatch Alarms and Monitoring Setup', body: 'Hi {{userName}},\n\nWe are addressing the monitoring and alerting issue reported in Ticket: {{ticketId}}.\n\nCloudWatch Alarms Setup:\n1. Critical Alarms to Configure:\n   - EC2: CPUUtilization > 80%, StatusCheckFailed > 0, DiskSpaceUtilization > 85%\n   - RDS: CPUUtilization > 80%, FreeableMemory < 500MB, FreeStorageSpace < 10%\n   - Lambda: Errors > 0, Throttles > 0, Duration > 80% of timeout\n   - ALB: HTTPCode_ELB_5XX_Count > 10, TargetResponseTime > 5s, UnHealthyHostCount > 0\n   - SQS: ApproximateAgeOfOldestMessage > threshold, NumberOfMessagesSent = 0\n\n2. Alarm Configuration Best Practices:\n   - Use appropriate evaluation periods (avoid false positives)\n   - Set up composite alarms for complex conditions\n   - Configure alarm actions: SNS for notifications, Auto Scaling for remediation\n   - Use anomaly detection for metrics with variable baselines\n\nCloudWatch Logs:\n- Install CloudWatch Agent on EC2 instances for OS-level metrics and custom logs\n- Use Log Insights for querying across log groups\n- Set up metric filters to create custom metrics from log patterns\n- Configure log retention policies to manage costs\n- Use Contributor Insights to identify top contributors to issues\n\nCloudWatch Dashboards:\n- Create operational dashboards for each environment (dev, staging, prod)\n- Include key metrics: error rates, latency, throughput, resource utilization\n- Use cross-account and cross-region dashboards for multi-account setups\n- Share dashboards with stakeholders via public URLs (with authentication)\n\nAdvanced Monitoring:\n- AWS X-Ray: Distributed tracing for microservices\n- CloudWatch ServiceLens: Unified observability with traces, metrics, and logs\n- CloudWatch Synthetics: Canary scripts for endpoint monitoring\n- CloudWatch RUM: Real user monitoring for web applications\n- Amazon Managed Grafana: Advanced visualization and alerting\n\nMonitoring Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-24', title: 'AWS GuardDuty Security Findings Response', body: 'Hi {{userName}},\n\nGuardDuty has detected security findings in your account as reported in Ticket: {{ticketId}}.\n\nUnderstanding Finding Severity:\n- Critical/High: Requires immediate investigation and response\n- Medium: Should be investigated within 24 hours\n- Low: Review during regular security reviews\n\nCommon Finding Types and Response:\n1. UnauthorizedAccess:EC2/MaliciousIPCaller:\n   - An EC2 instance is communicating with a known malicious IP\n   - Action: Isolate the instance (modify security group to deny all traffic), investigate for compromise\n\n2. Recon:EC2/PortProbeUnprotectedPort:\n   - An EC2 instance has an unprotected port being probed\n   - Action: Review security groups, close unnecessary ports, check for exposed services\n\n3. CryptoCurrency:EC2/BitcoinTool:\n   - Cryptocurrency mining detected on an EC2 instance\n   - Action: Likely compromised. Isolate immediately, capture forensic image, terminate and replace\n\n4. UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B:\n   - Successful console login from an unusual location\n   - Action: Verify with the user, check for unauthorized activity, consider enforcing MFA\n\n5. Trojan:EC2/DNSDataExfiltration:\n   - Data exfiltration via DNS queries detected\n   - Action: Isolate instance, investigate DNS query logs, check for malware\n\nIncident Response Steps:\n1. Contain: Isolate affected resources (security groups, NACL deny rules)\n2. Investigate: Review CloudTrail, VPC Flow Logs, and application logs\n3. Eradicate: Remove malware, rotate credentials, patch vulnerabilities\n4. Recover: Restore from clean backups, verify integrity\n5. Document: Record findings, timeline, and remediation steps\n\nPrevention:\n- Enable GuardDuty in all regions and all accounts\n- Integrate with Security Hub for centralized findings\n- Set up automated remediation with EventBridge and Lambda\n- Conduct regular security assessments\n\nSecurity Incident Response Team', category: 'Security' },
{ responseId: 'demo-25', title: 'AWS Backup and Disaster Recovery', body: 'Hi {{userName}},\n\nWe are addressing the backup/disaster recovery concern reported in Ticket: {{ticketId}}.\n\nAWS Backup Setup:\n1. Create a Backup Plan:\n   - AWS Backup Console > Backup plans > Create plan\n   - Define backup rules: frequency (daily, weekly), retention period, lifecycle to cold storage\n   - Assign resources by tags or resource IDs\n   - Enable cross-region backup for DR\n   - Enable cross-account backup for additional protection\n\n2. Supported Services:\n   - EC2 (AMIs), EBS (snapshots), RDS (automated + manual snapshots)\n   - DynamoDB (on-demand + continuous backups with PITR)\n   - EFS, FSx, S3, Aurora, DocumentDB, Neptune, Storage Gateway\n\nDisaster Recovery Strategies (by RTO/RPO):\n1. Backup and Restore (Hours RTO, Hours RPO):\n   - Lowest cost, highest recovery time\n   - Regular backups to S3/Glacier, restore when needed\n   - Suitable for non-critical workloads\n\n2. Pilot Light (Minutes-Hours RTO, Minutes RPO):\n   - Core infrastructure running in DR region (databases replicating)\n   - Scale up compute resources when disaster occurs\n   - Moderate cost, faster recovery\n\n3. Warm Standby (Minutes RTO, Seconds-Minutes RPO):\n   - Scaled-down but fully functional copy in DR region\n   - Scale up to production capacity during failover\n   - Higher cost, near-instant recovery\n\n4. Multi-Site Active-Active (Near-Zero RTO, Near-Zero RPO):\n   - Full production capacity in multiple regions\n   - Use Route 53 health checks for automatic failover\n   - Highest cost, best availability\n\nTesting DR:\n- Schedule regular DR drills (at least quarterly)\n- Test backup restoration to verify data integrity\n- Document runbooks for each DR scenario\n- Use AWS Elastic Disaster Recovery for automated failover\n- Measure actual RTO/RPO against targets\n\nDisaster Recovery Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-26', title: 'API Gateway Errors and Throttling', body: 'Hi {{userName}},\n\nWe are investigating the API Gateway issue reported in Ticket: {{ticketId}}.\n\nDiagnosing API Gateway Errors:\n1. Check CloudWatch Metrics:\n   - 4XXError: Client-side errors (auth failures, bad requests, throttling)\n   - 5XXError: Server-side errors (Lambda errors, integration timeouts)\n   - Count: Total API calls\n   - Latency/IntegrationLatency: Response time breakdown\n\n2. Enable CloudWatch Logs:\n   - API Gateway Console > Stages > Select stage > Logs/Tracing\n   - Enable CloudWatch Logs (Full request/response logging for debugging)\n   - Enable X-Ray tracing for distributed tracing\n\nCommon Error Codes:\n- 403 Forbidden: API key invalid/missing, WAF blocking, resource policy denying\n- 429 Too Many Requests: Throttling limit reached (default: 10,000 RPS per region)\n- 500 Internal Server Error: Lambda function error, integration configuration issue\n- 502 Bad Gateway: Lambda returned invalid response format, integration timeout\n- 504 Gateway Timeout: Integration timeout exceeded (max 29 seconds for REST API)\n\nThrottling Solutions:\n- Request a limit increase for account-level throttling\n- Configure usage plans with API keys for per-client throttling\n- Implement caching to reduce backend calls (TTL-based)\n- Use SQS for async processing of high-volume requests\n- Consider HTTP API (cheaper, faster) vs REST API based on feature needs\n\nPerformance Optimization:\n- Enable API caching (0.5 GB to 237 GB)\n- Use Lambda Provisioned Concurrency to eliminate cold starts\n- Implement request validation at API Gateway level (before hitting Lambda)\n- Use VPC Link for private integrations\n- Consider CloudFront distribution in front of API Gateway for global caching\n\nAPI Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-27', title: 'AWS Cloud9 / Development Environment Issues', body: 'Hi {{userName}},\n\nWe are addressing the development environment issue reported in Ticket: {{ticketId}}.\n\nCloud9 IDE Troubleshooting:\n1. Environment Not Loading:\n   - Check EC2 instance status (Cloud9 uses an EC2 instance)\n   - Verify the instance type has sufficient resources\n   - Check security group allows inbound from Cloud9 service\n   - Verify IAM permissions for the Cloud9 environment owner\n\n2. Disk Space Issues:\n   - Default EBS volume is 10 GB, which fills up quickly\n   - Resize EBS volume: EC2 Console > Volumes > Modify > Increase size\n   - After resize, extend the filesystem: sudo growpart /dev/xvda 1 && sudo resize2fs /dev/xvda1\n\n3. Connectivity Issues:\n   - Verify VPC and subnet configuration\n   - Check that the subnet has internet access (for package installations)\n   - For no-ingress environments: verify Systems Manager connectivity\n\nLocal Development with AWS:\n- AWS CLI Configuration: aws configure (set region, access key, output format)\n- AWS SAM CLI: For local Lambda testing (sam local invoke, sam local start-api)\n- AWS CDK: For infrastructure as code development\n- LocalStack: For offline AWS service emulation\n- Docker: For containerized development matching production\n\nCredential Management for Development:\n- Use AWS SSO (Identity Center) for temporary credentials\n- Use aws-vault or granted for secure credential management\n- Never commit credentials to version control\n- Use .env files with .gitignore for local configuration\n- Use AWS Secrets Manager or Parameter Store for shared secrets\n\nCI/CD Development Workflow:\n- Use feature branches with CodeCommit or GitHub\n- Set up CodeBuild for automated testing on pull requests\n- Use CDK pipelines for self-mutating deployment pipelines\n- Implement environment-specific configurations (dev/staging/prod)\n\nDeveloper Experience Team', category: 'Software' },
{ responseId: 'demo-28', title: 'S3 Data Recovery and Versioning', body: 'Hi {{userName}},\n\nWe are addressing the S3 data issue reported in Ticket: {{ticketId}}.\n\nData Recovery Options:\n1. If Versioning Was Enabled:\n   - Deleted objects have a delete marker (not permanently removed)\n   - To restore: S3 Console > Show versions > Delete the delete marker\n   - To restore a previous version: Copy the desired version to the same key\n   - Use S3 Batch Operations for bulk restoration\n\n2. If Versioning Was NOT Enabled:\n   - Deleted objects cannot be recovered from S3 directly\n   - Check if AWS Backup has a recovery point\n   - Check if cross-region replication was configured (data may exist in replica bucket)\n   - Contact AWS Support immediately (no guarantees, but worth trying for recent deletions)\n\n3. Accidental Bucket Deletion:\n   - If the bucket was deleted, all objects are permanently removed\n   - Restore from backups or replicated copies only\n\nPrevention Setup:\n- Enable Versioning: S3 > Bucket > Properties > Bucket Versioning > Enable\n- Enable MFA Delete: Requires MFA to permanently delete versions (root account only)\n- Object Lock: WORM (Write Once Read Many) protection for compliance\n- Lifecycle Rules: Transition old versions to Glacier, expire after retention period\n- Cross-Region Replication: Automatic copy to another region for DR\n- S3 Replication Time Control: Guaranteed 15-minute replication SLA\n\nAccess Issues:\n- 403 Access Denied: Check bucket policy, IAM policy, S3 Block Public Access, ACLs, and VPC endpoint policy\n- Use IAM Access Analyzer for S3 to identify unintended access\n- Enable S3 server access logging for audit trails\n\nCost Optimization:\n- Use S3 Intelligent-Tiering for automatic cost optimization\n- Set lifecycle rules to transition to S3 Glacier for archival data\n- Use S3 Storage Lens for usage analytics and recommendations\n- Delete incomplete multipart uploads (they incur storage costs)\n\nStorage Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-29', title: 'DynamoDB Performance and Capacity Issues', body: 'Hi {{userName}},\n\nWe are investigating the DynamoDB issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Performance Issues:\n1. Check CloudWatch Metrics:\n   - ConsumedReadCapacityUnits / ConsumedWriteCapacityUnits: Compare against provisioned\n   - ThrottledRequests: Non-zero indicates capacity exceeded\n   - ReadThrottleEvents / WriteThrottleEvents: Per-partition throttling\n   - SuccessfulRequestLatency: Should be single-digit milliseconds\n   - SystemErrors: AWS-side errors (rare, usually transient)\n\n2. Hot Partition Detection:\n   - Use CloudWatch Contributor Insights for DynamoDB\n   - Identify partition keys with disproportionate traffic\n   - Redesign key schema to distribute load evenly\n\nCapacity Management:\n- On-Demand Mode: Automatic scaling, pay per request, good for unpredictable workloads\n- Provisioned Mode: Set RCU/WCU manually or with Auto Scaling\n- Auto Scaling: Configure target utilization (typically 70%), min/max capacity\n- Reserved Capacity: Up to 77% savings for predictable workloads\n\nCommon Issues and Fixes:\n- Throttling: Switch to on-demand mode, or increase provisioned capacity\n- Hot Partitions: Add a random suffix to partition key, use write sharding\n- Large Items: Keep items under 400 KB, store large data in S3 with pointer in DynamoDB\n- Scan Performance: Use parallel scans, or better yet, create a GSI for the access pattern\n- GSI Throttling: GSIs have their own capacity, ensure they are adequately provisioned\n\nBackup and Recovery:\n- Enable Point-in-Time Recovery (PITR) for continuous backups (35-day window)\n- Use On-Demand Backups for long-term retention\n- Use AWS Backup for centralized backup management\n- Global Tables for multi-region active-active replication\n\nDatabase Operations Team', category: 'Database' },
{ responseId: 'demo-30', title: 'AWS Cost Optimization Review', body: 'Hi {{userName}},\n\nWe have completed a cost optimization review for your account as requested in Ticket: {{ticketId}}.\n\nImmediate Savings Opportunities:\n1. Right-Sizing:\n   - Use AWS Compute Optimizer to identify over-provisioned EC2 instances\n   - Check RDS instances for low CPU utilization (consider smaller instance class)\n   - Review Lambda memory settings (right-size using AWS Lambda Power Tuning)\n   - Check EBS volumes for over-provisioned IOPS\n\n2. Unused Resources:\n   - Unattached EBS volumes (still incur storage charges)\n   - Unassociated Elastic IPs ($3.60/month each when not attached)\n   - Idle NAT Gateways ($32/month + data processing)\n   - Old EBS snapshots and AMIs\n   - Unused Elastic Load Balancers\n   - Stopped RDS instances (auto-start after 7 days)\n\n3. Pricing Models:\n   - Reserved Instances: Up to 72% savings for 1-3 year commitments\n   - Savings Plans: Flexible pricing for EC2, Lambda, and Fargate\n   - Spot Instances: Up to 90% savings for fault-tolerant workloads\n   - Fargate Spot: Up to 70% savings for ECS/EKS tasks\n\nStorage Optimization:\n- S3 Intelligent-Tiering: Automatic cost optimization for S3\n- EBS gp3 vs gp2: gp3 is 20% cheaper with better baseline performance\n- Delete old snapshots and set lifecycle policies\n- Use S3 Glacier for archival data\n\nArchitectural Savings:\n- Use serverless (Lambda, Fargate, DynamoDB on-demand) for variable workloads\n- Implement caching (ElastiCache, CloudFront) to reduce backend load\n- Use VPC endpoints to avoid NAT Gateway data processing charges\n- Schedule non-production environments to stop outside business hours\n\nGovernance:\n- Set up AWS Budgets with alerts at 50%, 80%, 100% thresholds\n- Enable Cost Anomaly Detection for automatic alerts\n- Use AWS Organizations with consolidated billing\n- Implement tagging strategy for cost allocation\n- Review Cost Explorer weekly for trends\n\nCloud FinOps Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-31', title: 'ElastiCache Redis/Memcached Performance Issues', body: 'Hi {{userName}},\n\nWe are investigating the ElastiCache performance issue reported in Ticket: {{ticketId}}.\n\nDiagnosing the Problem:\n1. Check CloudWatch Metrics:\n   - CPUUtilization: Above 65% on Redis indicates potential bottleneck\n   - EngineCPUUtilization: Redis-specific CPU (excludes I/O threads)\n   - CurrConnections: Compare against maxclients setting\n   - Evictions: Non-zero means cache is full and evicting keys\n   - CacheHitRate: Low rate means cache is not effective\n   - ReplicationLag: For read replicas, high lag means stale data\n   - SwapUsage: Should be near zero, high swap kills performance\n   - DatabaseMemoryUsagePercentage: Above 80% risks OOM\n\n2. Common Performance Issues:\n   - Hot Keys: Single keys receiving disproportionate traffic\n   - Large Keys: Keys with values over 1 MB cause latency spikes\n   - Slow Commands: KEYS, SMEMBERS on large sets, SORT operations\n   - Connection Storms: Application creating too many connections\n\nFixes:\n- Hot Keys: Use read replicas, implement client-side caching, shard the key\n- Evictions: Scale up node type or add shards (cluster mode)\n- High CPU: Enable cluster mode for horizontal scaling, optimize Lua scripts\n- Connection Issues: Use connection pooling, set appropriate timeout values\n- Memory: Set appropriate maxmemory-policy (allkeys-lru recommended for caching)\n\nScaling Options:\n- Vertical: Change node type (causes brief downtime for non-cluster mode)\n- Horizontal: Add shards in cluster mode (online resharding supported)\n- Read Replicas: Add up to 5 replicas per shard for read scaling\n- Global Datastore: Cross-region replication for disaster recovery\n\nBest Practices:\n- Set TTL on all cache keys to prevent unbounded growth\n- Use Redis cluster mode for workloads exceeding single-node capacity\n- Enable automatic backups and set appropriate retention\n- Monitor with CloudWatch alarms for Evictions > 0 and CPU > 65%\n\nDatabase Operations Team', category: 'Database' },
{ responseId: 'demo-32', title: 'SES Email Delivery and Bounce Issues', body: 'Hi {{userName}},\n\nWe are investigating the email delivery issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Delivery Problems:\n1. Check SES Dashboard:\n   - SES Console > Account dashboard\n   - Review Send statistics: delivery rate, bounce rate, complaint rate\n   - Bounce rate should be below 5%, complaint rate below 0.1%\n   - Check if account is in sandbox mode (can only send to verified addresses)\n\n2. Check Sending Status:\n   - Verify sender identity (domain or email) is verified\n   - Check for sending quota limits (SES > Account dashboard > Sending limits)\n   - Review suppression list for bounced addresses\n\nCommon Issues:\n- Sandbox Mode: New accounts can only send to verified emails. Request production access via SES Console > Account dashboard > Request production access\n- Bounces: Hard bounces (invalid address) vs soft bounces (mailbox full). Remove hard-bounced addresses immediately\n- Complaints: Recipients marking email as spam. Review email content and sending practices\n- Throttling: Exceeding sending rate. Request limit increase or implement sending queue\n- SPF/DKIM/DMARC: Missing DNS records cause emails to land in spam\n\nDNS Configuration:\n- SPF: Add TXT record with v=spf1 include:amazonses.com ~all\n- DKIM: Enable Easy DKIM in SES and add the 3 CNAME records to DNS\n- DMARC: Add TXT record _dmarc.yourdomain.com with policy\n- Custom MAIL FROM: Configure for better deliverability\n\nBest Practices:\n- Set up SNS notifications for bounces and complaints\n- Implement automatic suppression list management\n- Use configuration sets for tracking and event publishing\n- Warm up new sending domains gradually\n- Use dedicated IPs for high-volume sending\n- Monitor reputation dashboard daily\n\nEmail Operations Team', category: 'Email' },
{ responseId: 'demo-33', title: 'AWS WAF and DDoS Protection (Shield)', body: 'Hi {{userName}},\n\nWe are addressing the security/DDoS concern reported in Ticket: {{ticketId}}.\n\nAWS WAF Setup and Troubleshooting:\n1. Check WAF Web ACL:\n   - WAF Console > Web ACLs > Select the ACL\n   - Review rules and their actions (Allow, Block, Count)\n   - Check sampled requests to see what is being blocked/allowed\n   - Review CloudWatch metrics: AllowedRequests, BlockedRequests, CountedRequests\n\n2. Common WAF Rules to Implement:\n   - AWS Managed Rules: AWSManagedRulesCommonRuleSet (OWASP top 10)\n   - Rate-based rules: Block IPs exceeding request threshold (e.g., 2000 req/5min)\n   - IP reputation: AWSManagedRulesAmazonIpReputationList\n   - SQL injection: AWSManagedRulesSQLiRuleSet\n   - Bot control: AWSManagedRulesBotControlRuleSet\n   - Geographic restrictions: Block traffic from specific countries\n\n3. Troubleshooting False Positives:\n   - Set rules to Count mode first to evaluate impact\n   - Review sampled requests to identify legitimate traffic being blocked\n   - Create scope-down statements to exclude specific paths or IPs\n   - Use regex pattern sets for fine-grained matching\n\nDDoS Protection (AWS Shield):\n- Shield Standard: Free, automatic protection against common L3/L4 attacks\n- Shield Advanced: Paid, provides enhanced detection, 24/7 DRT access, cost protection\n- Enable Shield Advanced on: CloudFront, ALB, ELB, Elastic IP, Global Accelerator\n- Set up health checks in Route 53 for proactive engagement\n\nDuring an Active Attack:\n1. Check Shield Console > Events for detected attacks\n2. If Shield Advanced: Contact AWS DDoS Response Team (DRT) via Support\n3. Scale up resources (Auto Scaling, CloudFront) to absorb traffic\n4. Add rate-based WAF rules to throttle attack traffic\n5. Use CloudFront geographic restrictions if attack is region-specific\n\nSecurity Operations Team', category: 'Security' },
{ responseId: 'demo-34', title: 'Amazon Cognito Authentication Issues', body: 'Hi {{userName}},\n\nWe are investigating the Cognito authentication issue reported in Ticket: {{ticketId}}.\n\nCommon Cognito Issues:\n1. User Cannot Sign In:\n   - Verify user status in User Pool: Cognito > User pools > Users\n   - Check if user is CONFIRMED (not UNCONFIRMED or FORCE_CHANGE_PASSWORD)\n   - Verify the app client ID is correct in your application\n   - Check if the user pool has the correct sign-in attributes configured\n   - Verify password policy requirements are met\n\n2. Token Issues:\n   - ID token expired: Default expiry is 1 hour, implement token refresh\n   - Invalid token: Verify the token issuer matches your user pool\n   - Token not accepted by API Gateway: Check authorizer configuration\n   - Refresh token expired: Default is 30 days, user must re-authenticate\n\n3. Social/Federation Sign-In:\n   - Verify identity provider configuration (Google, Facebook, SAML, OIDC)\n   - Check callback URLs match exactly (including trailing slashes)\n   - Verify attribute mapping between IdP and Cognito\n   - Check OAuth scopes are correctly configured\n\n4. Custom Authentication:\n   - Lambda triggers failing: Check CloudWatch Logs for trigger errors\n   - Pre-authentication: Verify Lambda function returns correct response format\n   - Custom message: Check Lambda has permissions and returns valid HTML\n\nHosted UI Issues:\n- Verify domain is configured (Cognito domain or custom domain)\n- Check callback and logout URLs in app client settings\n- Verify OAuth flows are enabled (Authorization code grant recommended)\n- Clear browser cookies if seeing stale session issues\n\nBest Practices:\n- Enable MFA (at least optional, required for sensitive apps)\n- Use Cognito Advanced Security for adaptive authentication\n- Implement proper token refresh logic in your application\n- Use groups for role-based access control\n- Enable user pool deletion protection\n\nIdentity Team', category: 'Account & Access' },
{ responseId: 'demo-35', title: 'CloudFront Distribution Issues and Cache Problems', body: 'Hi {{userName}},\n\nWe are investigating the CloudFront issue reported in Ticket: {{ticketId}}.\n\nCommon CloudFront Issues:\n1. 403 Access Denied:\n   - S3 origin: Verify Origin Access Control (OAC) or Origin Access Identity (OAI) is configured\n   - Update S3 bucket policy to allow CloudFront access\n   - Check if S3 Block Public Access is interfering\n   - Verify the default root object is set (e.g., index.html)\n\n2. 502/504 Errors:\n   - Origin not responding: Check origin server health\n   - SSL/TLS mismatch: Verify origin protocol policy matches origin configuration\n   - Origin timeout: Increase origin response timeout (default 30s, max 60s)\n   - Custom origin: Verify security group allows CloudFront IP ranges\n\n3. Stale Content / Cache Issues:\n   - Create invalidation: CloudFront > Distribution > Invalidations > Create\n   - Use versioned file names (e.g., app.v2.js) instead of invalidations\n   - Check Cache-Control and Expires headers from origin\n   - Review cache policy and TTL settings\n\n4. SSL/TLS Certificate Issues:\n   - Custom domain requires ACM certificate in us-east-1 region\n   - Verify certificate covers all alternate domain names (CNAMEs)\n   - Check certificate is not expired\n   - Verify DNS CNAME points to CloudFront distribution domain\n\nPerformance Optimization:\n- Enable compression (Gzip and Brotli)\n- Use cache policies to maximize cache hit ratio\n- Enable Origin Shield for additional caching layer\n- Use Lambda@Edge or CloudFront Functions for edge computing\n- Configure multiple origins with origin groups for failover\n\nMonitoring:\n- Enable standard logging or real-time logs\n- Monitor CacheHitRate, 4xxErrorRate, 5xxErrorRate in CloudWatch\n- Use CloudFront reports for popular objects and viewer statistics\n\nCDN Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-36', title: 'Route 53 DNS Resolution and Failover Issues', body: 'Hi {{userName}},\n\nWe are investigating the DNS/Route 53 issue reported in Ticket: {{ticketId}}.\n\nDiagnosing DNS Issues:\n1. Check Hosted Zone:\n   - Route 53 > Hosted zones > Verify records exist\n   - Verify NS records at registrar match Route 53 hosted zone NS records\n   - Check for conflicting records (e.g., CNAME at zone apex)\n   - Verify record TTL values are appropriate\n\n2. DNS Resolution Testing:\n   - Use dig or nslookup to test resolution from different locations\n   - Check DNS propagation status using online tools\n   - Verify DNSSEC configuration if enabled\n   - Test with Route 53 Resolver query logging enabled\n\n3. Health Check Issues:\n   - Verify health check endpoint is accessible from AWS health checkers\n   - Check security groups/firewalls allow Route 53 health checker IPs\n   - Review health check threshold settings (request interval, failure threshold)\n   - Check CloudWatch alarm for health check status\n\nRouting Policies:\n- Simple: Single resource, no health checks\n- Weighted: Distribute traffic by percentage (useful for blue/green deployments)\n- Latency-based: Route to lowest-latency region\n- Failover: Active-passive with health checks\n- Geolocation: Route based on user location\n- Multivalue Answer: Return multiple healthy IPs\n\nCommon Fixes:\n- Domain not resolving: Verify NS records at registrar, check hosted zone ID\n- Failover not working: Verify health checks are passing/failing correctly\n- Slow propagation: Lower TTL before making changes, wait for old TTL to expire\n- ALIAS vs CNAME: Use ALIAS for zone apex (naked domain), CNAME for subdomains\n\nBest Practices:\n- Use ALIAS records for AWS resources (free, supports zone apex)\n- Enable health checks for all failover configurations\n- Use private hosted zones for internal DNS in VPCs\n- Enable query logging for troubleshooting\n- Set appropriate TTLs (300s for dynamic, 86400s for static)\n\nDNS Operations Team', category: 'Network' },
{ responseId: 'demo-37', title: 'SQS Queue Processing Issues and Dead Letter Queues', body: 'Hi {{userName}},\n\nWe are investigating the SQS processing issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Queue Issues:\n1. Check CloudWatch Metrics:\n   - ApproximateNumberOfMessagesVisible: Messages waiting to be processed\n   - ApproximateNumberOfMessagesNotVisible: Messages being processed (in-flight)\n   - ApproximateAgeOfOldestMessage: How long the oldest message has been waiting\n   - NumberOfMessagesSent/Received/Deleted: Throughput metrics\n   - ApproximateNumberOfMessagesDelayed: Messages in delay period\n\n2. Common Issues:\n   - Messages not being processed: Check consumer is running and polling\n   - Duplicate processing: Ensure idempotent consumers (SQS delivers at-least-once)\n   - Messages going to DLQ: Check maxReceiveCount and consumer error handling\n   - Visibility timeout too short: Message reappears before processing completes\n   - FIFO ordering issues: Verify MessageGroupId usage\n\nDead Letter Queue (DLQ) Management:\n- Review messages in DLQ to understand failure patterns\n- Use DLQ redrive to move messages back to source queue after fixing the issue\n- Set up CloudWatch alarms for ApproximateNumberOfMessagesVisible > 0 on DLQ\n- Implement DLQ consumers for alerting and analysis\n\nPerformance Tuning:\n- Standard Queue: Nearly unlimited throughput\n- FIFO Queue: 300 msg/s without batching, 3000 msg/s with batching (per API action)\n- Use long polling (WaitTimeSeconds=20) to reduce empty responses and cost\n- Use batch operations (SendMessageBatch, ReceiveMessage MaxNumberOfMessages=10)\n- Set visibility timeout to 6x your processing time\n\nSNS Integration:\n- Fan-out pattern: SNS topic to multiple SQS queues\n- Verify SNS subscription is confirmed\n- Check SQS queue policy allows SNS to send messages\n- Use message filtering to reduce unnecessary processing\n\nMessaging Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-38', title: 'Secrets Manager and Parameter Store Issues', body: 'Hi {{userName}},\n\nWe are addressing the secrets/configuration management issue reported in Ticket: {{ticketId}}.\n\nSecrets Manager Troubleshooting:\n1. Access Denied Errors:\n   - Verify IAM policy allows secretsmanager:GetSecretValue\n   - Check resource-based policy on the secret\n   - If using KMS encryption: verify IAM policy allows kms:Decrypt\n   - Check VPC endpoint policy if accessing from within a VPC\n\n2. Rotation Issues:\n   - Check rotation Lambda function logs in CloudWatch\n   - Verify Lambda has network access to the database/service\n   - Check Lambda execution role has required permissions\n   - Verify the rotation Lambda can access Secrets Manager endpoint\n   - Test rotation manually: Secrets Manager > Secret > Rotate secret immediately\n\n3. Application Integration:\n   - Use AWS SDK caching (built-in for most SDKs) to reduce API calls\n   - Implement retry logic for transient failures\n   - Cache secrets locally with appropriate TTL\n   - Use the Secrets Manager caching library for your language\n\nParameter Store Troubleshooting:\n- Throughput exceeded: Standard parameters have lower throughput, use Advanced tier\n- Parameter not found: Check the exact path including leading slash\n- Decryption failed: Verify KMS key permissions for SecureString parameters\n- Cross-account access: Use resource-based policies or IAM roles\n\nBest Practices:\n- Use Secrets Manager for credentials that need rotation (database passwords, API keys)\n- Use Parameter Store for configuration values (feature flags, endpoints, settings)\n- Enable automatic rotation with appropriate schedules (30, 60, or 90 days)\n- Use resource tags for access control and cost allocation\n- Never log or print secret values\n- Use VPC endpoints for private access without internet\n- Implement secret versioning for rollback capability\n\nSecurity Operations Team', category: 'Security' },
{ responseId: 'demo-39', title: 'AWS Compliance and Audit Readiness (HIPAA/PCI/SOC)', body: 'Hi {{userName}},\n\nWe are addressing the compliance concern reported in Ticket: {{ticketId}}.\n\nAWS Compliance Framework:\n1. Shared Responsibility Model:\n   - AWS is responsible for: Security OF the cloud (infrastructure, hardware, facilities)\n   - Customer is responsible for: Security IN the cloud (data, IAM, encryption, network config)\n   - Understanding this boundary is critical for audit preparation\n\n2. Key Compliance Services:\n   - AWS Config: Continuous compliance monitoring with managed rules\n   - AWS Security Hub: Centralized security findings and compliance checks\n   - AWS Audit Manager: Automated evidence collection for audits\n   - AWS Artifact: Access to AWS compliance reports and agreements\n\nHIPAA Compliance:\n- Sign a Business Associate Agreement (BAA) via AWS Artifact\n- Use only HIPAA-eligible services for PHI data\n- Enable encryption at rest (KMS) and in transit (TLS) for all PHI\n- Implement access logging (CloudTrail, S3 access logs, VPC Flow Logs)\n- Use AWS Config rules: encrypted-volumes, rds-storage-encrypted, s3-bucket-ssl-requests-only\n\nPCI DSS Compliance:\n- Isolate cardholder data environment (CDE) in dedicated VPC\n- Implement network segmentation with security groups and NACLs\n- Enable file integrity monitoring (use AWS Config for resource changes)\n- Implement centralized logging with CloudWatch and CloudTrail\n- Use AWS WAF to protect web applications\n- Regular vulnerability scanning and penetration testing\n\nSOC 2 Compliance:\n- Enable CloudTrail in all regions for audit logging\n- Implement change management with AWS Config\n- Use AWS Organizations SCPs for preventive controls\n- Set up automated alerting for security events\n- Document incident response procedures\n\nAudit Preparation:\n- Use AWS Audit Manager to map controls to frameworks\n- Generate compliance reports from Security Hub\n- Download AWS SOC reports from AWS Artifact\n- Maintain evidence of regular access reviews\n- Document all security configurations and exceptions\n\nCompliance Team', category: 'Security' },
{ responseId: 'demo-40', title: 'Step Functions Workflow Execution Failures', body: 'Hi {{userName}},\n\nWe are investigating the Step Functions execution failure reported in Ticket: {{ticketId}}.\n\nDiagnosing Execution Failures:\n1. Check Execution History:\n   - Step Functions Console > State machines > Select machine > Executions\n   - Click on the failed execution to see the visual workflow\n   - Click on the failed state to see input, output, and error details\n   - Review the execution event history for the exact error\n\n2. Common Failure Types:\n   - States.TaskFailed: The invoked service (Lambda, ECS, etc.) returned an error\n   - States.Timeout: State exceeded its TimeoutSeconds\n   - States.Permissions: IAM role missing required permissions\n   - States.Runtime: Invalid state machine definition or input processing error\n   - States.DataLimitExceeded: Payload exceeded 256 KB limit\n\n3. Lambda Integration Issues:\n   - Check Lambda function logs in CloudWatch\n   - Verify Lambda function returns valid JSON output\n   - Check for Lambda timeout (separate from Step Functions timeout)\n   - Verify Step Functions execution role can invoke the Lambda\n\nError Handling Best Practices:\n- Use Catch blocks on every Task state for graceful error handling\n- Implement Retry with exponential backoff for transient errors\n- Use ResultPath to preserve original input alongside error info\n- Set appropriate TimeoutSeconds on all Task states\n- Use Heartbeat for long-running tasks to detect stuck executions\n\nPerformance and Limits:\n- Standard Workflows: Exactly-once execution, up to 1 year duration, priced per state transition\n- Express Workflows: At-least-once, up to 5 minutes, priced per execution and duration\n- Use Express for high-volume, short-duration workflows (IoT, streaming)\n- Use Standard for long-running, auditable workflows\n- Payload limit: 256 KB per state (use S3 for larger data)\n\nMonitoring:\n- Enable CloudWatch logging for execution history\n- Set up alarms for ExecutionsFailed and ExecutionsTimedOut\n- Use X-Ray tracing for distributed tracing across services\n\nWorkflow Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-41', title: 'AWS KMS Key Management and Encryption Issues', body: 'Hi {{userName}},\n\nWe are addressing the encryption/KMS issue reported in Ticket: {{ticketId}}.\n\nCommon KMS Issues:\n1. Access Denied (kms:Decrypt or kms:Encrypt):\n   - Check IAM policy allows the required KMS actions\n   - Check KMS key policy grants access to the IAM principal\n   - Both IAM policy AND key policy must allow access (they work together)\n   - For cross-account: key policy must allow the external account, and external account IAM must allow KMS actions\n\n2. Key States:\n   - Enabled: Normal operation\n   - Disabled: Cannot be used for encrypt/decrypt, can be re-enabled\n   - Pending Deletion: Scheduled for deletion (7-30 day waiting period)\n   - Pending Import: Waiting for key material import\n   - If key is pending deletion: Cancel deletion immediately if still needed\n\n3. Key Rotation:\n   - AWS managed keys: Automatically rotated every year\n   - Customer managed keys: Enable automatic rotation (rotates every year)\n   - Manual rotation: Create new key, update aliases, re-encrypt data\n   - Old key versions are retained for decryption of previously encrypted data\n\nEncryption Best Practices:\n- Use separate KMS keys for different environments (dev/staging/prod)\n- Enable automatic key rotation for customer managed keys\n- Use key aliases for easier key management\n- Implement key policies following least privilege\n- Use grants for temporary access instead of modifying key policies\n- Monitor key usage with CloudTrail\n\nService-Specific Encryption:\n- S3: SSE-S3 (free), SSE-KMS (audit trail), SSE-C (customer-provided keys)\n- EBS: Enable default encryption at account level\n- RDS: Enable encryption at creation (cannot encrypt existing unencrypted DB)\n- DynamoDB: Encryption at rest is always enabled (AWS owned or customer managed)\n- Lambda: Environment variables encrypted with KMS\n\nSecurity Operations Team', category: 'Security' },
{ responseId: 'demo-42', title: 'Elastic Beanstalk Deployment and Health Issues', body: 'Hi {{userName}},\n\nWe are investigating the Elastic Beanstalk issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Health Issues:\n1. Check Environment Health:\n   - EB Console > Environments > Select environment\n   - Health status: Green (OK), Yellow (Warning), Red (Degraded), Grey (Unknown)\n   - Click on Health tab for detailed instance-level health\n   - Review Causes section for specific health degradation reasons\n\n2. Check Logs:\n   - EB Console > Environments > Logs > Request Logs (Last 100 lines or Full)\n   - Key log files: /var/log/eb-engine.log, /var/log/web.stdout.log, /var/log/nginx/error.log\n   - Enable log streaming to CloudWatch for persistent access\n\n3. Common Deployment Failures:\n   - Application crashes on startup: Check web.stdout.log for application errors\n   - Health check failing: Verify application responds on the health check path (default: /)\n   - Timeout during deployment: Increase deployment timeout in rolling update settings\n   - Immutable deployment failure: Check for capacity issues in the AZ\n\nDeployment Strategies:\n- All at once: Fastest, causes downtime (use for dev only)\n- Rolling: Updates batches, no downtime but reduced capacity\n- Rolling with additional batch: Maintains full capacity during update\n- Immutable: Launches new instances, safest for production\n- Blue/Green: Use environment swap for zero-downtime with instant rollback\n\nConfiguration Issues:\n- .ebextensions: YAML files in .ebextensions/ folder for customization\n- Platform hooks: Scripts in .platform/hooks/ for lifecycle events\n- Procfile: Define process commands for multi-process applications\n- Environment variables: Set via EB Console > Configuration > Software\n\nBest Practices:\n- Use managed platform updates for automatic patching\n- Enable enhanced health reporting\n- Configure Auto Scaling based on application metrics\n- Use .ebignore to exclude unnecessary files from deployment\n- Implement health check endpoints that verify downstream dependencies\n\nPlatform Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-43', title: 'Amazon Redshift Performance and Query Issues', body: 'Hi {{userName}},\n\nWe are investigating the Redshift performance issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Performance Issues:\n1. Check Query Performance:\n   - Use SYS_QUERY_HISTORY or STL_QUERY for query execution details\n   - Check STL_ALERT_EVENT_LOG for query alerts and recommendations\n   - Review SVL_QUERY_REPORT for step-level execution details\n   - Use EXPLAIN to analyze query plans\n\n2. Common Performance Problems:\n   - Disk-based queries: Insufficient memory causing spill to disk\n   - Skewed data distribution: Uneven data across slices\n   - Missing sort keys: Full table scans instead of zone map filtering\n   - Stale statistics: Run ANALYZE after significant data changes\n   - WLM queue contention: Queries waiting for available slots\n\n3. CloudWatch Metrics to Monitor:\n   - CPUUtilization: Sustained high CPU indicates query optimization needed\n   - PercentageDiskSpaceUsed: Above 80% impacts performance\n   - ReadIOPS/WriteIOPS: High I/O indicates disk-based operations\n   - DatabaseConnections: Near limit causes connection refused\n   - QueryDuration: Track p50, p90, p99 for SLA monitoring\n\nOptimization Steps:\n- Table Design: Choose appropriate distribution keys (KEY, EVEN, ALL) and sort keys\n- VACUUM: Reclaim space and re-sort data after deletes/updates\n- ANALYZE: Update statistics for the query optimizer\n- WLM Configuration: Set up queues with appropriate concurrency and memory allocation\n- Concurrency Scaling: Enable for burst capacity during peak loads\n- Result Caching: Enabled by default, cache repeated query results\n\nScaling Options:\n- Resize: Change node type or count (classic resize or elastic resize)\n- Elastic Resize: Add/remove nodes in minutes (recommended)\n- Concurrency Scaling: Automatic burst capacity for read queries\n- Redshift Spectrum: Query S3 data directly without loading\n- RA3 nodes: Managed storage that scales independently from compute\n\nData Warehouse Team', category: 'Database' },
{ responseId: 'demo-44', title: 'EventBridge Rules and Event Processing Issues', body: 'Hi {{userName}},\n\nWe are investigating the EventBridge issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Event Issues:\n1. Check Rule Status:\n   - EventBridge Console > Rules > Verify rule is ENABLED\n   - Check the event bus (default or custom) the rule is attached to\n   - Review the event pattern for correctness\n   - Check target configuration and permissions\n\n2. Events Not Triggering:\n   - Verify event pattern matches the actual event structure exactly\n   - Use EventBridge Sandbox to test patterns against sample events\n   - Check if the event source is sending events (CloudTrail, custom app)\n   - Verify the rule is on the correct event bus\n   - Check CloudWatch metrics: TriggeredRules, Invocations, FailedInvocations\n\n3. Target Failures:\n   - Check target-specific CloudWatch metrics\n   - Lambda target: Check Lambda function logs and permissions\n   - SQS target: Verify queue policy allows EventBridge to send messages\n   - Step Functions: Check execution role permissions\n   - Cross-account targets: Verify resource-based policies\n\nEvent Pattern Tips:\n- Use prefix matching for partial string matches\n- Use exists filter to check for field presence\n- Use numeric matching for range comparisons\n- Test patterns in the console sandbox before deploying\n- Use content-based filtering to reduce unnecessary invocations\n\nBest Practices:\n- Use dead-letter queues (DLQ) on rules for failed event delivery\n- Implement retry policies with appropriate backoff\n- Use EventBridge Archive for event replay capability\n- Use Schema Registry for event schema discovery and code generation\n- Monitor with CloudWatch: FailedInvocations alarm > 0\n- Use EventBridge Pipes for point-to-point integrations with filtering and enrichment\n\nEvent-Driven Architecture Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-45', title: 'Amazon OpenSearch Service Performance and Cluster Issues', body: 'Hi {{userName}},\n\nWe are investigating the OpenSearch cluster issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Cluster Health:\n1. Check Cluster Status:\n   - OpenSearch Console > Domains > Select domain > Cluster health tab\n   - Green: All shards allocated\n   - Yellow: Primary shards allocated, some replicas unassigned\n   - Red: Some primary shards unassigned (data loss risk)\n\n2. Key CloudWatch Metrics:\n   - ClusterStatus.red/yellow: Cluster health issues\n   - FreeStorageSpace: Below 20% causes performance degradation\n   - JVMMemoryPressure: Above 80% causes garbage collection issues\n   - CPUUtilization: Sustained above 80% indicates scaling needed\n   - MasterReachableFromNode: Master node connectivity\n   - ThreadpoolSearchQueue/Rejected: Search thread pool saturation\n   - IndexingRate/SearchRate: Throughput metrics\n\n3. Common Issues:\n   - Red cluster: Unassigned primary shards due to disk space, node failure, or shard allocation issues\n   - Slow queries: Missing or incorrect index mappings, too many shards, large aggregations\n   - Indexing bottleneck: Bulk indexing too fast, refresh interval too low\n   - JVM pressure: Increase instance type or reduce shard count\n\nOptimization:\n- Shard Strategy: Aim for 10-50 GB per shard, avoid too many small shards\n- Index Lifecycle: Use ISM policies to roll over, shrink, and delete old indices\n- Mapping: Define explicit mappings instead of dynamic mapping\n- Refresh Interval: Set to 30s for write-heavy workloads (default 1s)\n- Bulk Operations: Use bulk API with 5-15 MB request size\n\nScaling:\n- Data nodes: Add nodes for storage and throughput\n- Dedicated master nodes: Use 3 dedicated masters for cluster stability\n- UltraWarm: Cost-effective warm storage for infrequently accessed data\n- Cold storage: Lowest cost for rarely accessed data\n\nSearch Operations Team', category: 'Database' },
{ responseId: 'demo-46', title: 'EFS/FSx File System Performance and Mount Issues', body: 'Hi {{userName}},\n\nWe are investigating the file system issue reported in Ticket: {{ticketId}}.\n\nEFS Troubleshooting:\n1. Mount Failures:\n   - Verify security group allows NFS traffic (port 2049) from the client\n   - Check mount target exists in the same AZ as the EC2 instance\n   - Verify VPC DNS resolution is enabled\n   - Use amazon-efs-utils package for simplified mounting with TLS\n   - Check /var/log/amazon/efs/mount.log for mount helper errors\n\n2. Performance Issues:\n   - Check CloudWatch metrics: TotalIOBytes, PercentIOLimit, BurstCreditBalance\n   - Bursting mode: Performance scales with file system size (baseline 50 KB/s per GB)\n   - If BurstCreditBalance is depleted: Switch to Provisioned Throughput or Elastic mode\n   - Elastic throughput: Automatically scales, recommended for unpredictable workloads\n\n3. Common EFS Fixes:\n   - Slow performance: Switch from General Purpose to Max I/O performance mode (for highly parallel workloads)\n   - High latency: Use One Zone storage class if multi-AZ is not needed\n   - Cost optimization: Enable Lifecycle Management to move infrequently accessed files to IA storage\n\nFSx Troubleshooting:\n- FSx for Windows: Check Active Directory connectivity, DNS resolution, security group rules\n- FSx for Lustre: Verify S3 data repository association, check client Lustre driver version\n- FSx for NetApp ONTAP: Check SVM status, verify iSCSI/NFS/SMB connectivity\n- FSx for OpenZFS: Check volume capacity, verify NFS export settings\n\nBest Practices:\n- Use EFS for shared Linux file storage across multiple instances\n- Use FSx for Windows for Windows-based workloads requiring SMB\n- Use FSx for Lustre for high-performance computing (HPC) workloads\n- Enable encryption at rest and in transit\n- Set up CloudWatch alarms for PercentIOLimit and BurstCreditBalance\n- Use Access Points for application-specific entry points with POSIX permissions\n\nStorage Operations Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-47', title: 'Kinesis Data Streams Processing Issues', body: 'Hi {{userName}},\n\nWe are investigating the Kinesis streaming issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Stream Issues:\n1. Check CloudWatch Metrics:\n   - IncomingRecords/IncomingBytes: Producer throughput\n   - GetRecords.IteratorAgeMilliseconds: Consumer lag (should be near zero)\n   - ReadProvisionedThroughputExceeded: Consumer throttling\n   - WriteProvisionedThroughputExceeded: Producer throttling\n   - GetRecords.Success: Consumer read success rate\n\n2. Producer Issues:\n   - ProvisionedThroughputExceededException: Shard write limit exceeded (1 MB/s or 1000 records/s per shard)\n   - Use Kinesis Producer Library (KPL) for automatic batching and retry\n   - Implement partition key strategy to distribute across shards evenly\n   - Use random partition keys if ordering is not required\n\n3. Consumer Issues:\n   - High iterator age: Consumer falling behind, add more consumers or shards\n   - Enhanced fan-out: Dedicated 2 MB/s throughput per consumer per shard\n   - Checkpoint failures: Verify DynamoDB table for KCL lease management\n   - Lambda consumer: Check batch size, parallelization factor, error handling\n\nScaling:\n- Add shards: UpdateShardCount API (doubles capacity per split)\n- On-demand mode: Automatic scaling, no capacity planning needed\n- Provisioned mode: Manual shard management, lower cost for predictable workloads\n- Use enhanced fan-out for multiple consumers reading the same stream\n\nKinesis Data Firehose:\n- Check delivery stream status and error logs\n- Verify S3/Redshift/OpenSearch destination permissions\n- Check buffer size and interval settings\n- Review data transformation Lambda function if configured\n\nBest Practices:\n- Use on-demand mode for variable or unpredictable workloads\n- Implement dead-letter queues for failed records\n- Monitor IteratorAgeMilliseconds with CloudWatch alarms\n- Use server-side encryption with KMS\n\nStreaming Data Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-48', title: 'AWS Organizations and Multi-Account Management', body: 'Hi {{userName}},\n\nWe are addressing the multi-account management issue reported in Ticket: {{ticketId}}.\n\nCommon Organizations Issues:\n1. SCP (Service Control Policy) Problems:\n   - SCP blocking legitimate actions: Check the SCP hierarchy (Root > OU > Account)\n   - SCPs are deny-by-default if using allowlist strategy\n   - SCPs do not grant permissions, they set maximum permission boundaries\n   - Use the IAM policy simulator to test effective permissions\n   - Check all SCPs in the path from root to the account\n\n2. Account Creation/Invitation:\n   - New account creation: Use Organizations API or Console\n   - Verify email address is unique and not used by another AWS account\n   - Invited accounts: Check invitation status, resend if expired\n   - Root user access for member accounts: Use password reset via email\n\n3. Consolidated Billing:\n   - Verify all accounts are linked to the management account\n   - Check for billing anomalies across member accounts\n   - Use Cost Explorer with account-level filtering\n   - Set up AWS Budgets per account or OU\n\nMulti-Account Strategy:\n- Use AWS Control Tower for automated multi-account setup with guardrails\n- Organize accounts by environment (dev, staging, prod) or team\n- Use separate accounts for: logging, security, shared services, workloads\n- Implement landing zone with centralized logging and security\n\nCross-Account Access:\n- Use IAM roles for cross-account access (AssumeRole)\n- Use AWS RAM (Resource Access Manager) for resource sharing\n- Use Organizations-level service integrations (CloudTrail, Config, GuardDuty)\n- Implement centralized identity with IAM Identity Center (SSO)\n\nBest Practices:\n- Enable all features in Organizations (not just consolidated billing)\n- Use SCPs to enforce security guardrails across all accounts\n- Centralize CloudTrail logs in a dedicated logging account\n- Enable GuardDuty, Security Hub, and Config in all accounts\n- Use delegated administrator for security services\n- Tag accounts for cost allocation and management\n\nCloud Governance Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-49', title: 'AWS Transfer Family (SFTP/FTPS/FTP) Issues', body: 'Hi {{userName}},\n\nWe are investigating the file transfer issue reported in Ticket: {{ticketId}}.\n\nDiagnosing Transfer Issues:\n1. Connection Failures:\n   - Verify server endpoint is active: Transfer Family Console > Servers\n   - Check security group allows inbound on port 22 (SFTP), 21 (FTP), 990 (FTPS)\n   - For VPC endpoint: Verify Elastic IP associations and subnet routing\n   - Check user authentication: Service managed, custom IdP, or directory service\n   - Verify SSH key format (OpenSSH format required for SFTP)\n\n2. Authentication Issues:\n   - Service managed users: Verify SSH public key is correctly added\n   - Custom IdP (Lambda/API Gateway): Check Lambda function logs for auth errors\n   - Directory service: Verify AD connectivity and user credentials\n   - Check IAM role assigned to the user has S3/EFS permissions\n\n3. Transfer Failures:\n   - Permission denied: Check IAM role policy for S3 bucket/prefix access\n   - Slow transfers: Check network bandwidth, consider VPC endpoint for private connectivity\n   - File not appearing in S3: Check home directory mapping and logical directory configuration\n   - Large file failures: Check S3 multipart upload permissions\n\nConfiguration Best Practices:\n- Use VPC-hosted endpoints for internal transfers (no public internet exposure)\n- Implement logical directory mappings to restrict user access to specific S3 prefixes\n- Enable CloudWatch logging for audit and troubleshooting\n- Use managed workflows for post-upload processing (copy, tag, decrypt)\n- Set up S3 event notifications for downstream processing\n\nSecurity:\n- Use SFTP (SSH-based) over FTP for encrypted transfers\n- Implement IP allowlisting via security groups\n- Use customer-managed KMS keys for server-side encryption\n- Enable CloudTrail for API-level audit logging\n- Rotate SSH keys and credentials regularly\n\nFile Transfer Team', category: 'Cloud Infrastructure' },
{ responseId: 'demo-50', title: 'AWS Amplify Hosting and Build Failures', body: 'Hi {{userName}},\n\nWe are investigating the Amplify issue reported in Ticket: {{ticketId}}.\n\nBuild Failures:\n1. Check Build Logs:\n   - Amplify Console > App > Select branch > Build logs\n   - Review each phase: Provision, Build, Deploy, Verify\n   - Common build errors: dependency installation failures, build script errors, out of memory\n\n2. Common Build Issues:\n   - Node version mismatch: Specify in amplify.yml or .nvmrc\n   - Memory exceeded: Increase build compute (General, Large) in App settings > Build settings\n   - Environment variables: Verify all required env vars are set in Amplify Console\n   - Build command: Check amplify.yml or build settings match your framework\n   - Monorepo: Set correct appRoot in build settings\n\n3. Deployment Issues:\n   - Custom domain not working: Verify DNS CNAME records point to Amplify\n   - SSL certificate pending: DNS validation records must be added\n   - Redirects not working: Check redirects/rewrites in amplify.yml or Console\n   - SPA routing: Add rewrite rule: </^[^.]+$|.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/> to /index.html with 200 status\n\nAmplify Backend Issues:\n- API (AppSync/REST): Check resolver logs, verify schema, test in AppSync Console\n- Auth (Cognito): Check user pool configuration, verify auth rules\n- Storage (S3): Check bucket policy and CORS configuration\n- Functions (Lambda): Check CloudWatch Logs for function errors\n\nPerformance Optimization:\n- Enable branch-level caching for faster builds\n- Use Amplify CDN for global content delivery\n- Implement preview deployments for pull requests\n- Use environment variables for stage-specific configuration\n\nBest Practices:\n- Use amplify.yml for reproducible build configuration\n- Set up branch-based deployments (main=prod, develop=staging)\n- Enable access control for non-production branches\n- Monitor build times and set up notifications for failures\n- Use Amplify Studio for visual development and content management\n\nFrontend Operations Team', category: 'Software' },
  ];

  // ── Local Storage CRUD for Canned Responses ──
  const CANNED_STORAGE_KEY = 'ns_canned_responses';
  const CANNED_VERSION_KEY = 'ns_canned_responses_version';
  const CANNED_DATA_VERSION = 5; // bump this whenever DEMO_CANNED_RESPONSES changes
  let _useLocalCanned = false; // flag: true when API is unavailable

  function getLocalCannedResponses() {
    try {
      const storedVersion = parseInt(localStorage.getItem(CANNED_VERSION_KEY), 10);
      if (storedVersion === CANNED_DATA_VERSION) {
        const stored = localStorage.getItem(CANNED_STORAGE_KEY);
        if (stored) return JSON.parse(stored);
      }
    } catch (_e) {}
    // Version mismatch or first time — seed from demo data
    const copy = JSON.parse(JSON.stringify(DEMO_CANNED_RESPONSES));
    localStorage.setItem(CANNED_STORAGE_KEY, JSON.stringify(copy));
    localStorage.setItem(CANNED_VERSION_KEY, String(CANNED_DATA_VERSION));
    return copy;
  }

  function saveLocalCannedResponses(responses) {
    localStorage.setItem(CANNED_STORAGE_KEY, JSON.stringify(responses));
  }

  function localCreateCanned(data) {
    const responses = getLocalCannedResponses();
    const newItem = { responseId: 'local-' + Date.now(), title: data.title, body: data.body, category: data.category, createdAt: new Date().toISOString() };
    responses.push(newItem);
    saveLocalCannedResponses(responses);
    return newItem;
  }

  function localUpdateCanned(id, data) {
    const responses = getLocalCannedResponses();
    const idx = responses.findIndex(r => (r.responseId || r.id) === id);
    if (idx === -1) throw new Error('Canned response not found');
    responses[idx] = { ...responses[idx], ...data, updatedAt: new Date().toISOString() };
    saveLocalCannedResponses(responses);
    return responses[idx];
  }

  function localDeleteCanned(id) {
    const responses = getLocalCannedResponses();
    const filtered = responses.filter(r => (r.responseId || r.id) !== id);
    if (filtered.length === responses.length) throw new Error('Canned response not found');
    saveLocalCannedResponses(filtered);
  }

  async function loadCannedResponsesManagement() {
    const container = document.getElementById('canned-responses-list');
    container.innerHTML = '<p class="loading">Loading canned responses...</p>';
    try {
      let responses = [];
      try {
        const data = await API.listCannedResponses();
        responses = data.responses || data.cannedResponses || [];
        _useLocalCanned = false;
      } catch (_apiErr) {
        _useLocalCanned = true;
        responses = getLocalCannedResponses();
      }
      if (!responses.length) {
        _useLocalCanned = true;
        responses = getLocalCannedResponses();
      }
      // Group by category
      const grouped = {};
      responses.forEach(r => {
        const cat = r.category || 'Other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(r);
      });
      let html = '';
      // Store responses in a map for edit lookups (avoids data-attribute escaping issues)
      const _cannedMap = {};
      Object.keys(grouped).sort().forEach(cat => {
        html += `<div class="canned-category-group">
          <h3 class="canned-category-title">${esc(cat)}</h3>
          <div class="canned-cards">`;
        grouped[cat].forEach(r => {
          const rid = r.responseId || r.id;
          _cannedMap[rid] = r;
          html += `<div class="canned-card" data-id="${esc(rid)}">
            <div class="canned-card-header">
              <span class="canned-card-title">${esc(r.title)}</span>
              <span class="tag">${esc(r.category)}</span>
            </div>
            <div class="canned-card-body">${esc((r.body || '').slice(0, 200))}${(r.body || '').length > 200 ? '...' : ''}</div>
            <div class="canned-card-actions">
              <button class="btn btn-sm btn-outline canned-edit-btn" data-id="${esc(rid)}">✏️ Edit</button>
              <button class="btn btn-sm btn-ghost canned-delete-btn" data-id="${esc(rid)}" data-title="${esc(r.title)}" style="color:var(--red);">🗑 Delete</button>
            </div>
          </div>`;
        });
        html += '</div></div>';
      });
      container.innerHTML = html;
      // Bind edit buttons
      container.querySelectorAll('.canned-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = _cannedMap[btn.dataset.id];
          if (item) showCannedResponseForm(btn.dataset.id, item.title, item.body, item.category);
        });
      });
      // Bind delete buttons
      container.querySelectorAll('.canned-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete canned response "${btn.dataset.title}"?`)) return;
          btn.disabled = true;
          try {
            if (_useLocalCanned) {
              localDeleteCanned(btn.dataset.id);
            } else {
              await API.deleteCannedResponse(btn.dataset.id);
            }
            toast('Canned response deleted', 'success');
            loadCannedResponsesManagement();
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
        });
      });
    } catch (err) {
      container.innerHTML = `<p class="empty-state">Failed to load canned responses: ${esc(err.message)}</p>`;
    }
  }

  function showCannedResponseForm(editId, editTitle, editBody, editCategory) {
    const formContainer = document.getElementById('canned-response-form-container');
    const isEdit = editId && typeof editId === 'string';
    formContainer.classList.remove('hidden');
    formContainer.innerHTML = `
      <div class="canned-form" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;">
        <h4 style="color:var(--accent2);margin-bottom:16px;">${isEdit ? '✏️ Edit' : '➕ New'} Canned Response</h4>
        <div class="form-group" style="margin-bottom:12px;">
          <label for="canned-form-title">Title</label>
          <input type="text" id="canned-form-title" class="text-input" placeholder="Response title..." value="${isEdit ? esc(editTitle) : ''}" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);width:100%;">
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label for="canned-form-category">Category</label>
          <select id="canned-form-category" class="select-input" style="width:100%;">
            ${CANNED_CATEGORIES.map(c => `<option value="${esc(c)}" ${isEdit && editCategory === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label for="canned-form-body">Body <span style="color:var(--text2);font-size:0.8rem;">(supports {{ticketId}}, {{userName}}, {{subject}}, {{status}} tokens)</span></label>
          <textarea id="canned-form-body" class="textarea-input" rows="5" placeholder="Response body text..." style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);width:100%;font-family:inherit;resize:vertical;">${isEdit ? esc(editBody) : ''}</textarea>
        </div>
        <div style="display:flex;gap:12px;">
          <button id="canned-form-save" class="btn btn-primary btn-sm">${isEdit ? 'Update' : 'Create'}</button>
          <button id="canned-form-cancel" class="btn btn-ghost btn-sm">Cancel</button>
        </div>
      </div>`;
    document.getElementById('canned-form-cancel').addEventListener('click', () => {
      formContainer.classList.add('hidden');
      formContainer.innerHTML = '';
    });
    document.getElementById('canned-form-save').addEventListener('click', async () => {
      const title = document.getElementById('canned-form-title').value.trim();
      const body = document.getElementById('canned-form-body').value.trim();
      const category = document.getElementById('canned-form-category').value;
      if (!title) { toast('Title is required', 'error'); return; }
      if (!body) { toast('Body is required', 'error'); return; }
      const saveBtn = document.getElementById('canned-form-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Saving...';
      try {
        if (_useLocalCanned) {
          if (isEdit) {
            localUpdateCanned(editId, { title, body, category });
            toast('Canned response updated', 'success');
          } else {
            localCreateCanned({ title, body, category });
            toast('Canned response created', 'success');
          }
        } else {
          if (isEdit) {
            await API.updateCannedResponse(editId, { title, body, category });
            toast('Canned response updated', 'success');
          } else {
            await API.createCannedResponse({ title, body, category });
            toast('Canned response created', 'success');
          }
        }
        formContainer.classList.add('hidden');
        formContainer.innerHTML = '';
        loadCannedResponsesManagement();
      } catch (err) {
        toast(err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Update' : 'Create';
      }
    });
    // Scroll to form
    formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Translation Toggle ──
  const LANGUAGE_NAMES = {
    es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian',
    ja: 'Japanese', ko: 'Korean', zh: 'Chinese', 'zh-TW': 'Chinese (Traditional)',
    ar: 'Arabic', hi: 'Hindi', ru: 'Russian', nl: 'Dutch', sv: 'Swedish',
    pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
    uk: 'Ukrainian', cs: 'Czech', ro: 'Romanian', da: 'Danish', fi: 'Finnish',
    el: 'Greek', he: 'Hebrew', hu: 'Hungarian', no: 'Norwegian', sk: 'Slovak',
    bg: 'Bulgarian', hr: 'Croatian', ms: 'Malay', tl: 'Filipino',
  };

  function getLanguageName(code) {
    if (!code) return 'Unknown';
    return LANGUAGE_NAMES[code] || code.toUpperCase();
  }

  function bindTranslationToggle(ticket) {
    const toggleBtn = document.getElementById('translation-toggle-btn');
    if (!toggleBtn) return;

    const subjectEl = document.getElementById('detail-subject-text');
    const descriptionEl = document.getElementById('detail-description-text');
    const translationInfo = document.getElementById('translation-info');

    toggleBtn.addEventListener('click', () => {
      const showing = toggleBtn.dataset.showing;
      if (showing === 'original') {
        // Switch to translation
        if (subjectEl && ticket.translatedSubject) {
          subjectEl.textContent = ticket.translatedSubject;
        }
        if (descriptionEl && ticket.translatedDescription) {
          descriptionEl.textContent = ticket.translatedDescription;
        }
        if (translationInfo) translationInfo.style.display = 'none';
        toggleBtn.textContent = 'Show Original';
        toggleBtn.dataset.showing = 'translation';
      } else {
        // Switch back to original
        if (subjectEl) subjectEl.textContent = ticket.subject;
        if (descriptionEl) descriptionEl.textContent = ticket.description;
        if (translationInfo) translationInfo.style.display = 'none';
        toggleBtn.textContent = 'Show Translation';
        toggleBtn.dataset.showing = 'original';
      }
    });
  }

  function closeModal() { stopMessageRefresh(); document.getElementById('ticket-modal').classList.add('hidden'); }

  function bindAdminTranslate(ticket) {
    const btn = document.getElementById('admin-translate-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const langSelect = document.getElementById('admin-translate-lang');
      const targetLang = langSelect.value;
      if (!targetLang) { toast('Please select a language', 'error'); return; }
      const resultDiv = document.getElementById('admin-translate-result');
      const errorDiv = document.getElementById('admin-translate-error');
      errorDiv.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Translating...';
      try {
        const [subjectRes, descRes] = await Promise.all([
          API.translateText(ticket.subject, targetLang),
          API.translateText(ticket.description, targetLang),
        ]);
        const langName = langSelect.options[langSelect.selectedIndex].text;
        document.getElementById('admin-translate-lang-label').textContent = '📝 Translated to ' + langName;
        document.getElementById('admin-translate-subject').textContent = subjectRes.translatedText;
        document.getElementById('admin-translate-description').textContent = descRes.translatedText;
        resultDiv.classList.remove('hidden');
      } catch (err) {
        errorDiv.textContent = 'Translation failed: ' + err.message;
        errorDiv.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Translate';
      }
    });
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ── Create Ticket ──
  async function handleCreateTicket(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-ticket-btn');
    const result = document.getElementById('create-ticket-result');
    btn.disabled = true; btn.textContent = 'Creating...'; result.classList.add('hidden');
    try {
      const payload = { userId: Auth.getEmail(), subject: val('ticket-subject'), description: val('ticket-description'), priority: parseInt(val('ticket-priority')) };
      const data = await API.createTicket(payload);
      for (const file of pendingFiles) {
        try { const uploadData = await API.uploadAttachment(data.ticketId, file.name, file.type, file.size);
          await fetch(uploadData.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        } catch (err) { console.warn('Attachment upload failed:', err); }
      }
      result.className = 'create-result success';
      result.innerHTML = `✓ Ticket <strong>#${data.ticketId?.slice(0,8)}</strong> created! AI analysis will begin automatically.`;
      result.classList.remove('hidden');
      toast('Ticket created!', 'success');
      document.getElementById('create-ticket-form').reset();
      pendingFiles = []; document.getElementById('file-list').innerHTML = '';
      setTimeout(() => switchView('tickets'), 1500);
    } catch (err) {
      result.className = 'create-result error'; result.textContent = `Error: ${err.message}`;
      result.classList.remove('hidden'); toast(err.message, 'error');
    } finally { btn.disabled = false; btn.textContent = 'Create Ticket'; }
  }

  // ── Files ──
  function addFiles(fileList) { for (const f of fileList) pendingFiles.push(f); renderFileList(); }
  function renderFileList() {
    document.getElementById('file-list').innerHTML = pendingFiles.map((f, i) =>
      `<div class="file-item"><span>${esc(f.name)} (${formatSize(f.size)})</span><button type="button" class="btn-remove" onclick="App.removeFile(${i})">✕</button></div>`).join('');
  }
  function removeFile(i) { pendingFiles.splice(i, 1); renderFileList(); }

  // ── Voice ──
  let mediaRecorder = null, audioChunks = [];
  function handleVoiceRecord() {
    const btn = document.getElementById('voice-record-btn'), status = document.getElementById('voice-status');
    if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); btn.textContent = '🎤 Record Voice'; status.textContent = 'Processing...'; return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      audioChunks = []; mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => { const blob = new Blob(audioChunks, { type: 'audio/webm' }); const file = new File([blob], 'voice-ticket.webm', { type: 'audio/webm' }); pendingFiles.push(file); renderFileList(); status.textContent = `Recorded ${(blob.size/1024).toFixed(1)} KB`; stream.getTracks().forEach(t => t.stop()); };
      mediaRecorder.start(); btn.textContent = '⏹ Stop Recording'; status.textContent = 'Recording...';
    }).catch(() => { status.textContent = 'Microphone access denied'; });
  }

  // ── Knowledge Base ──
  async function loadKBArticles() {
    const container = document.getElementById('kb-articles');
    try {
      const data = await API.listArticles();
      const articles = data.articles || [];
      const solutions = data.solutions || [];
      let html = '';

      // Render solutions from resolved tickets
      if (solutions.length) {
        html += `<h3 style="color:#a29bfe;margin-bottom:12px;">🧠 Solutions from Resolved Tickets</h3>`;
        html += solutions.map(s => {
          const problem = (s.problem || '').split('\n');
          const subject = problem[0] || 'Untitled';
          const desc = problem.slice(1).join(' ').trim();
          return `<div class="kb-article-card">
            <div class="kb-article-header"><h4>${esc(subject)}</h4><span class="tag">${esc(s.category || 'resolved')}</span></div>
            <p class="kb-article-excerpt" style="color:#a0a0c0;"><strong style="color:#6C5CE7;">Resolution:</strong> ${esc((s.resolution || '').slice(0, 200))}${(s.resolution||'').length > 200 ? '...' : ''}</p>
            ${s.rootCause ? `<p class="kb-article-excerpt" style="color:#a0a0c0;"><strong style="color:#e17055;">Root Cause:</strong> ${esc(s.rootCause)}</p>` : ''}
            <div class="kb-article-meta">${(s.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')} · 🎫 Ticket ${esc((s.ticketId||'').slice(0,8))} · ${s.createdAt ? timeAgo(s.createdAt) : ''}</div>
          </div>`;
        }).join('');
      }

      // Render manual articles
      if (articles.length) {
        html += `<h3 style="color:#a29bfe;margin:20px 0 12px;">📚 Knowledge Articles</h3>`;
        html += articles.map(a => `
          <div class="kb-article-card">
            <div class="kb-article-header"><h4>${esc(a.title)}</h4><span class="tag">${esc(a.category)}</span></div>
            <p class="kb-article-excerpt">${esc((a.content || '').slice(0, 200))}...</p>
            <div class="kb-article-meta">${(a.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')} · 👁 ${a.viewCount || 0} views</div>
          </div>`).join('');
      }

      if (!html) { container.innerHTML = '<p class="empty-state">No articles or solutions in the knowledge base yet.</p>'; return; }
      container.innerHTML = html;
    } catch (err) { container.innerHTML = `<p class="empty-state">Failed to load knowledge base: ${esc(err.message)}</p>`; }
  }

  async function handleKBSearch() {
    const query = val('kb-search-input');
    if (!query) return;
    const container = document.getElementById('kb-results');
    container.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>Searching with AI...</p></div>';
    try {
      const data = await API.searchKnowledge(query);
      const results = data.results || [];
      if (!results.length) { container.innerHTML = '<p class="empty-state">No results found.</p>'; return; }
      container.innerHTML = `<h3>Search Results</h3>` + results.map(r => `
        <div class="kb-result-card">
          <div class="kb-result-header"><h4>${esc(r.title)}</h4><span class="relevance-score">${((r.relevanceScore||0)*100).toFixed(0)}% match</span></div>
          <div class="kb-result-sections">${(r.relevantSections || []).slice(0,2).map(s => `<p>${esc(s)}</p>`).join('')}</div>
        </div>`).join('');
    } catch (err) { container.innerHTML = `<p class="empty-state">Search failed: ${esc(err.message)}</p>`; }
  }

  // ── Analytics ──
  async function loadAnalytics() {
    const period = document.getElementById('analytics-period').value;
    const overview = document.getElementById('analytics-overview');
    overview.innerHTML = '<p class="loading">Loading analytics...</p>';
    try {
      const data = await API.getAnalytics(period);
      analyticsData = data;
      const ov = data.overview || {};
      // Use the same filtered count as the tickets view so numbers stay consistent
      const visibleTotal = allTickets.length || ov.totalTickets || 0;
      overview.innerHTML = `
        <div class="stat-card"><div class="stat-value">${visibleTotal}</div><div class="stat-label">Total Tickets</div></div>
        <div class="stat-card stat-new"><div class="stat-value">${ov.statusCounts?.new || 0}</div><div class="stat-label">New</div></div>
        <div class="stat-card stat-resolved"><div class="stat-value">${ov.statusCounts?.resolved || 0}</div><div class="stat-label">Resolved</div></div>
        <div class="stat-card stat-escalated"><div class="stat-value">${ov.statusCounts?.escalated || 0}</div><div class="stat-label">Escalated</div></div>`;

      // AI Performance
      const aiPerf = document.getElementById('ai-performance');
      const report = data.performanceReport;
      if (report) {
        aiPerf.innerHTML = `
          <div class="ai-metric"><span class="ai-metric-value">${report.aiResolvedPercentage?.toFixed(1) || 0}%</span><span class="ai-metric-label">AI Resolved</span></div>
          <div class="ai-metric"><span class="ai-metric-value">${report.averageResolutionTime ? (report.averageResolutionTime/60000).toFixed(1)+'m' : '—'}</span><span class="ai-metric-label">Avg Resolution</span></div>
          <div class="ai-metric"><span class="ai-metric-value">${report.averageFirstResponseTime ? (report.averageFirstResponseTime/1000).toFixed(1)+'s' : '—'}</span><span class="ai-metric-label">Avg First Response</span></div>
          <div class="ai-metric"><span class="ai-metric-value">${report.satisfactionScore?.toFixed(1) || '—'}/5</span><span class="ai-metric-label">Satisfaction</span></div>`;
      } else { aiPerf.innerHTML = '<p class="empty-state">No performance data yet.</p>'; }

      // Trend Alerts with severity color coding
      const alertsContainer = document.getElementById('trend-alerts');
      const alerts = data.alerts || [];
      const trends = data.trends || [];
      if (alerts.length) {
        alertsContainer.innerHTML = alerts.map(a => {
          // Match alert to trend for severity info
          const matchedTrend = trends.find(t => a.description && a.description.includes(t.issueDescription));
          const severity = matchedTrend ? matchedTrend.severity : (a.type === 'spike' ? 'high' : 'medium');
          const severityClass = `alert-severity-${severity || 'medium'}`;
          const severityBadgeColor = severity === 'high' ? 'red' : severity === 'medium' ? 'orange' : 'yellow';
          return `<div class="alert-card ${severityClass}">
            <div class="alert-header"><span class="badge badge-${severityBadgeColor}">${severity || a.type}</span><span class="alert-users">${a.affectedUsers} users affected</span></div>
            <p>${esc(a.description)}</p>
            <div class="alert-actions">${(a.recommendedActions || []).map(act => `<span class="tag">${esc(act)}</span>`).join('')}</div>
          </div>`;
        }).join('');
      } else { alertsContainer.innerHTML = '<p class="empty-state">No trend alerts detected.</p>'; }

      // Team Performance table
      const teamPerfContainer = document.getElementById('team-performance');
      const teamPerf = data.teamPerformance || [];
      if (teamPerf.length) {
        teamPerfContainer.innerHTML = `<table class="perf-table">
          <thead><tr><th>Team</th><th>Tickets</th><th>Avg Resolution</th><th>Avg Response</th><th>Satisfaction</th><th>AI Resolved</th></tr></thead>
          <tbody>${teamPerf.map(tp => `<tr>
            <td>${esc(tp.team)}</td>
            <td>${tp.metrics.totalTickets}</td>
            <td>${tp.metrics.averageResolutionTime ? (tp.metrics.averageResolutionTime/60000).toFixed(1)+'m' : '—'}</td>
            <td>${tp.metrics.averageFirstResponseTime ? (tp.metrics.averageFirstResponseTime/1000).toFixed(1)+'s' : '—'}</td>
            <td>${tp.metrics.satisfactionScore?.toFixed(1) || '—'}/5</td>
            <td>${tp.metrics.aiResolvedPercentage?.toFixed(1) || 0}%</td>
          </tr>`).join('')}</tbody>
        </table>`;
      } else { teamPerfContainer.innerHTML = '<p class="empty-state">No team data yet.</p>'; }

      // Top Issues list
      const topIssuesContainer = document.getElementById('top-issues');
      const topIssues = data.topIssues || [];
      if (topIssues.length) {
        topIssuesContainer.innerHTML = topIssues.map((issue, i) => `
          <div class="issue-row"><span class="issue-rank">#${i+1}</span><span class="issue-name">${esc(issue.issue)}</span><span class="issue-count">${issue.count} tickets</span></div>
        `).join('');
      } else { topIssuesContainer.innerHTML = '<p class="empty-state">No issue data yet.</p>'; }

      // Charts
      renderAnalyticsCharts(ov);
    } catch (err) { overview.innerHTML = `<p class="error-msg">Failed to load analytics: ${esc(err.message)}</p>`; }
  }

  function renderAnalyticsCharts(ov) {
    const sc = ov.statusCounts || {};
    drawBarChart('chart-status', 'Tickets by Status',
      ['New', 'Analyzing', 'Assigned', 'In Progress', 'Pending', 'Escalated', 'Resolved', 'Closed'],
      [sc.new||0, sc.analyzing||0, sc.assigned||0, sc.in_progress||0, sc.pending_user||0, sc.escalated||0, sc.resolved||0, sc.closed||0],
      ['#6C5CE7','#00B894','#0984E3','#FDCB6E','#E17055','#D63031','#00CEC9','#636E72']);
    const pc = ov.priorityCounts || {};
    drawBarChart('chart-priority', 'Tickets by Priority',
      ['Low (1)','Medium (5)','High (8)','Critical (10)'],
      [pc['1']||0, pc['5']||0, pc['8']||0, pc['10']||0],
      ['#00B894','#FDCB6E','#E17055','#D63031']);
    // Category distribution chart
    const cc = ov.categoryCounts || {};
    const catLabels = Object.keys(cc).slice(0, 8);
    const catValues = catLabels.map(k => cc[k]);
    const catColors = ['#6C5CE7','#00B894','#0984E3','#FDCB6E','#E17055','#D63031','#00CEC9','#636E72'];
    drawBarChart('chart-category', 'Tickets by Category', catLabels, catValues, catColors);
  }

  function drawBarChart(canvasId, title, labels, values, colors) {
    const canvas = document.getElementById(canvasId); if (!canvas) return;
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...values, 1), barW = (w-60)/labels.length, chartH = h-50;
    labels.forEach((label, i) => {
      const barH = (values[i]/max)*(chartH-20), x = 40+i*barW+barW*0.15, bw = barW*0.7;
      ctx.fillStyle = colors[i%colors.length]; ctx.fillRect(x, chartH-barH, bw, barH);
      ctx.fillStyle = '#b2bec3'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(label, x+bw/2, chartH+14);
      if (values[i] > 0) { ctx.fillStyle = '#dfe6e9'; ctx.fillText(values[i], x+bw/2, chartH-barH-5); }
    });
  }

  // ── Teams ──
  async function loadTeams() {
    const container = document.getElementById('teams-grid');
    container.innerHTML = '<p class="loading">Loading teams...</p>';
    try {
      let apiTeams = [];
      try {
        const [teamsData, ticketsData] = await Promise.all([API.listTeams(), API.listTickets()]);
        apiTeams = teamsData.teams || [];
        allTickets = filterOutBinTickets(Array.isArray(ticketsData) ? ticketsData : (ticketsData.tickets || []));
        // Cache API team members for auto-assign
        const apiMembersMap = {};
        apiTeams.forEach(t => { if (t.members && t.members.length) apiMembersMap[t.teamId] = t.members; });
        if (Object.keys(apiMembersMap).length) window._apiTeamMembers = apiMembersMap;
      } catch (_e) {
        // API unavailable, use local only
      }

      // Merge API teams with locally created teams
      const localTeams = getLocalTeams();
      const allTeamIds = new Set(apiTeams.map(t => t.teamId));
      const mergedTeams = [...apiTeams, ...localTeams.filter(t => !allTeamIds.has(t.teamId))];

      if (!mergedTeams.length) { container.innerHTML = '<p class="empty-state">No teams configured. Click "+ Add Team" to create one.</p>'; return; }

      // Count real tickets per team (by assignedTeam, and also by individual member names)
      const teamCounts = {};
      allTickets.forEach(t => {
        if (t.assignedTeam) teamCounts[t.assignedTeam] = (teamCounts[t.assignedTeam] || 0) + 1;
        // Also count by assignedTo (member name) so team detail can match
        if (t.assignedTo && t.assignedTo !== t.assignedTeam) {
          teamCounts[t.assignedTo] = (teamCounts[t.assignedTo] || 0) + 1;
        }
      });

      const allMembers = getLocalTeamMembers();

      container.innerHTML = mergedTeams.map(t => {
        const realCount = teamCounts[t.teamId] || 0;
        const memberCount = (t.members || allMembers[t.teamId] || []).length;
        return `
        <div class="team-card" data-team-id="${esc(t.teamId)}" style="cursor:pointer;">
          <div class="team-card-header">
            <h3 class="team-name">${esc(t.teamName)}</h3>
            <span class="badge badge-${realCount > 10 ? 'red' : realCount > 5 ? 'yellow' : 'green'}">${realCount} tickets</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="color:var(--text2);font-size:0.85rem;">👥 ${memberCount} member${memberCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="team-id">ID: ${esc(t.teamId)}</div>
          <div class="team-expertise">${(t.expertise || []).map(e => `<span class="tag">${esc(e)}</span>`).join('')}</div>
          <div class="team-meta">Last updated: ${timeAgo(t.updatedAt)}</div>
        </div>`;
      }).join('');
      container.querySelectorAll('.team-card').forEach(card => {
        card.addEventListener('click', () => showTeamDetail(card.dataset.teamId, mergedTeams, apiTeams));
      });
    } catch (err) { container.innerHTML = `<p class="empty-state">Failed to load teams: ${esc(err.message)}</p>`; }
  }

  async function showTeamTickets(teamId, teams) {
    const container = document.getElementById('teams-grid');
    const team = teams.find(t => t.teamId === teamId);
    const teamName = team ? team.teamName : teamId;

    container.innerHTML = `
      <div style="grid-column:1/-1;">
        <button class="btn btn-ghost" id="back-to-teams" style="margin-bottom:16px;">← Back to Teams</button>
        <h2 style="color:#dfe6e9;margin-bottom:4px;">📋 ${esc(teamName)}</h2>
        <p style="color:#636e72;margin-bottom:16px;">Team ID: ${esc(teamId)} · ${(team?.expertise || []).map(e => '<span class="tag">' + esc(e) + '</span>').join(' ')}</p>
        <p class="loading">Loading tickets...</p>
      </div>`;

    document.getElementById('back-to-teams').addEventListener('click', () => loadTeams());

    try {
      if (!allTickets.length) {
        const data = await API.listTickets();
        allTickets = filterOutBinTickets(Array.isArray(data) ? data : (data.tickets || []));
      }
      const teamMembers = ((teams.find(t => t.teamId === teamId) || {}).members || []).map(m => m.name);
      const teamTickets = allTickets.filter(t => t.assignedTeam === teamId || t.assignedTo === teamId || (t.assignedTo && teamMembers.includes(t.assignedTo)));

      const ticketsHtml = teamTickets.length
        ? `<div class="tickets-grid">${teamTickets.map(ticketCard).join('')}</div>`
        : '<p class="empty-state">No tickets assigned to this team.</p>';

      container.innerHTML = `
        <div style="grid-column:1/-1;">
          <button class="btn btn-ghost" id="back-to-teams" style="margin-bottom:16px;">← Back to Teams</button>
          <h2 style="color:#dfe6e9;margin-bottom:4px;">📋 ${esc(teamName)}</h2>
          <p style="color:#636e72;margin-bottom:16px;">Team ID: ${esc(teamId)} · ${(team?.expertise || []).map(e => '<span class="tag">' + esc(e) + '</span>').join(' ')}</p>
          <div style="color:#b2bec3;margin-bottom:16px;font-size:0.95rem;">${teamTickets.length} ticket${teamTickets.length !== 1 ? 's' : ''} assigned</div>
          ${ticketsHtml}
        </div>`;

      document.getElementById('back-to-teams').addEventListener('click', () => loadTeams());
      container.querySelectorAll('.ticket-card').forEach(c => c.addEventListener('click', () => openTicketDetail(c.dataset.id)));
    } catch (err) {
      container.innerHTML = `
        <div style="grid-column:1/-1;">
          <button class="btn btn-ghost" id="back-to-teams" style="margin-bottom:16px;">← Back to Teams</button>
          <h2 style="color:#dfe6e9;margin-bottom:8px;">📋 ${esc(teamName)}</h2>
          <p class="empty-state">Failed to load tickets: ${esc(err.message)}</p>
        </div>`;
      document.getElementById('back-to-teams').addEventListener('click', () => loadTeams());
    }
  }

  // ── Team Management (localStorage-backed) ──
  const TEAMS_STORAGE_KEY = 'ns_teams_members';

  function getLocalTeamMembers() {
    try {
      const stored = localStorage.getItem(TEAMS_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (_e) {}
    return {};
  }

  function saveLocalTeamMembers(data) {
    localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(data));
  }

  function getLocalTeams() {
    const key = 'ns_local_teams';
    try {
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored);
    } catch (_e) {}
    return [];
  }

  function saveLocalTeams(teams) {
    localStorage.setItem('ns_local_teams', JSON.stringify(teams));
  }

  function showAddTeamForm() {
    const container = document.getElementById('teams-grid');
    container.innerHTML = `
      <div style="grid-column:1/-1;max-width:600px;">
        <button class="btn btn-ghost" id="back-to-teams-from-add" style="margin-bottom:16px;">← Back to Teams</button>
        <h3 style="color:var(--text);margin-bottom:16px;">➕ Create New Team</h3>
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:block;color:var(--text2);font-size:0.85rem;margin-bottom:4px;">Team Name <span style="color:#e74c3c;">*</span></label>
          <input type="text" id="new-team-name" class="text-input" placeholder="e.g. Cloud Architecture" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);">
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:block;color:var(--text2);font-size:0.85rem;margin-bottom:4px;">Team ID <span style="color:#e74c3c;">*</span></label>
          <input type="text" id="new-team-id" class="text-input" placeholder="e.g. cloud-architecture-team" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);">
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:block;color:var(--text2);font-size:0.85rem;margin-bottom:4px;">Description</label>
          <textarea id="new-team-desc" class="textarea-input" rows="2" placeholder="What does this team handle?" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-family:inherit;resize:vertical;"></textarea>
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label style="display:block;color:var(--text2);font-size:0.85rem;margin-bottom:4px;">Expertise Tags (comma-separated)</label>
          <input type="text" id="new-team-expertise" class="text-input" placeholder="e.g. aws, cloud, architecture, design" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);">
        </div>
        <button class="btn btn-primary" id="save-new-team">💾 Create Team</button>
      </div>`;
    document.getElementById('back-to-teams-from-add').addEventListener('click', () => loadTeams());
    document.getElementById('new-team-name').addEventListener('input', () => {
      const name = document.getElementById('new-team-name').value;
      const idField = document.getElementById('new-team-id');
      if (!idField._userEdited) idField.value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '') + '-team';
    });
    document.getElementById('new-team-id').addEventListener('input', function() { this._userEdited = true; });
    document.getElementById('save-new-team').addEventListener('click', () => {
      const name = document.getElementById('new-team-name').value.trim();
      const id = document.getElementById('new-team-id').value.trim();
      const desc = document.getElementById('new-team-desc').value.trim();
      const expertise = document.getElementById('new-team-expertise').value.split(',').map(s => s.trim()).filter(Boolean);
      if (!name || !id) { toast('Team name and ID are required', 'error'); return; }
      const localTeams = getLocalTeams();
      if (localTeams.find(t => t.teamId === id)) { toast('Team ID already exists', 'error'); return; }
      localTeams.push({ teamId: id, teamName: name, description: desc, expertise, members: [], updatedAt: new Date().toISOString() });
      saveLocalTeams(localTeams);
      toast('Team created successfully', 'success');
      loadTeams();
    });
  }

  function showTeamDetail(teamId, teams, apiTeams) {
    const container = document.getElementById('teams-grid');
    const team = teams.find(t => t.teamId === teamId);
    if (!team) { toast('Team not found', 'error'); return; }
    const allMembers = getLocalTeamMembers();
    const members = team.members || allMembers[teamId] || [];
    const isLocalTeam = getLocalTeams().find(t => t.teamId === teamId);

    const memberNames = members.map(m => m.name);
    const teamTickets = allTickets.filter(t => t.assignedTeam === teamId || t.assignedTo === teamId || (t.assignedTo && memberNames.includes(t.assignedTo)));

    container.innerHTML = `
      <div style="grid-column:1/-1;">
        <button class="btn btn-ghost" id="back-to-teams-detail" style="margin-bottom:16px;">← Back to Teams</button>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <h2 style="color:var(--text);margin:0;">👥 ${esc(team.teamName)}</h2>
          ${isLocalTeam ? '<button class="btn btn-sm btn-outline" id="delete-team-btn" style="color:#e74c3c;border-color:#e74c3c;">🗑 Delete Team</button>' : ''}
        </div>
        <p style="color:var(--text2);margin-bottom:4px;">ID: ${esc(teamId)} · ${teamTickets.length} ticket${teamTickets.length !== 1 ? 's' : ''} assigned</p>
        ${team.description ? `<p style="color:var(--text2);font-size:0.9rem;margin-bottom:8px;">${esc(team.description)}</p>` : ''}
        <div style="margin-bottom:16px;">${(team.expertise || []).map(e => '<span class="tag">' + esc(e) + '</span>').join(' ')}</div>

        <div style="display:flex;gap:24px;flex-wrap:wrap;">
          <div style="flex:1;min-width:320px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <h3 style="color:var(--text);margin:0;">Team Members (${members.length})</h3>
              <button class="btn btn-sm btn-primary" id="add-member-btn">+ Add Member</button>
            </div>
            <div id="add-member-form" style="display:none;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px;">
              <div style="display:flex;gap:8px;margin-bottom:8px;">
                <input type="text" id="member-name" class="text-input" placeholder="Full Name" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);">
                <input type="email" id="member-email" class="text-input" placeholder="Email" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);">
              </div>
              <div style="display:flex;gap:8px;">
                <select id="member-role" class="select-input" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);">
                  <option value="member">Member</option>
                  <option value="lead">Team Lead</option>
                  <option value="manager">Manager</option>
                </select>
                <button class="btn btn-sm btn-primary" id="save-member-btn">Add</button>
                <button class="btn btn-sm btn-ghost" id="cancel-member-btn">Cancel</button>
              </div>
            </div>
            <div id="members-list">
              ${members.length ? members.map((m, i) => `
                <div class="member-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:36px;height:36px;border-radius:50%;background:${m.role === 'lead' ? 'linear-gradient(135deg,#6c5ce7,#a29bfe)' : m.role === 'manager' ? 'linear-gradient(135deg,#e17055,#fab1a0)' : 'linear-gradient(135deg,#00b894,#55efc4)'};display:flex;align-items:center;justify-content:center;font-weight:600;color:#fff;font-size:14px;">${esc((m.name || '?')[0].toUpperCase())}</div>
                    <div>
                      <div style="color:var(--text);font-weight:500;">${esc(m.name)}</div>
                      <div style="color:var(--text2);font-size:0.8rem;">${esc(m.email)} · <span class="badge badge-${m.role === 'lead' ? 'purple' : m.role === 'manager' ? 'orange' : 'green'}" style="font-size:0.7rem;">${esc(m.role)}</span></div>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-ghost remove-member-btn" data-email="${esc(m.email)}" data-name="${esc(m.name)}" style="color:#e74c3c;font-size:0.8rem;">✕ Remove</button>
                </div>
              `).join('') : '<p class="empty-state">No members yet. Click "Add Member" to get started.</p>'}
            </div>
          </div>

          <div style="flex:1;min-width:320px;">
            <h3 style="color:var(--text);margin-bottom:12px;">Assigned Tickets (${teamTickets.length})</h3>
            ${teamTickets.length ? teamTickets.slice(0, 10).map(t => `
              <div class="ticket-card" data-id="${t.ticketId}" style="margin-bottom:8px;cursor:pointer;">
                <div class="ticket-card-header">
                  <span class="ticket-id">#${t.ticketId?.slice(0, 8) || '—'}</span>
                  <span class="badge badge-${statusColor(t.status)}">${statusLabel(t.status)}</span>
                </div>
                <div class="ticket-card-subject">${esc(t.subject)}</div>
                <div class="ticket-card-meta">${timeAgo(t.createdAt)}${t.assignedTo && t.assignedTo !== t.assignedTeam ? ' · 👤 ' + esc(t.assignedTo) : ''}</div>
              </div>
            `).join('') + (teamTickets.length > 10 ? `<p style="color:var(--text2);font-size:0.85rem;">...and ${teamTickets.length - 10} more</p>` : '') : '<p class="empty-state">No tickets assigned.</p>'}
          </div>
        </div>
      </div>`;

    document.getElementById('back-to-teams-detail').addEventListener('click', () => loadTeams());

    // Add member form toggle
    document.getElementById('add-member-btn').addEventListener('click', () => {
      document.getElementById('add-member-form').style.display = 'block';
      document.getElementById('member-name').focus();
    });
    document.getElementById('cancel-member-btn').addEventListener('click', () => {
      document.getElementById('add-member-form').style.display = 'none';
    });

    // Save member
    document.getElementById('save-member-btn').addEventListener('click', async () => {
      const name = document.getElementById('member-name').value.trim();
      const email = document.getElementById('member-email').value.trim();
      const role = document.getElementById('member-role').value;
      if (!name || !email) { toast('Name and email are required', 'error'); return; }
      if (members.find(m => m.email === email)) { toast('Member with this email already exists', 'error'); return; }
      const saveBtn = document.getElementById('save-member-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Adding...';
      try {
        await API.addTeamMember(teamId, { name, email, role });
        // Also keep localStorage in sync for offline/assignment fallback
        const allMem = getLocalTeamMembers();
        if (!allMem[teamId]) allMem[teamId] = [];
        allMem[teamId].push({ name, email, role, addedAt: new Date().toISOString() });
        saveLocalTeamMembers(allMem);
        toast(`${name} added to ${team.teamName}`, 'success');
        // Refresh team data from API
        const teamsData = await API.listTeams();
        const refreshedTeams = teamsData.teams || [];
        const localTeams = getLocalTeams();
        const allTeamIds = new Set(refreshedTeams.map(t => t.teamId));
        const merged = [...refreshedTeams, ...localTeams.filter(t => !allTeamIds.has(t.teamId))];
        showTeamDetail(teamId, merged, refreshedTeams);
      } catch (err) {
        toast(err.message || 'Failed to add member', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add';
      }
    });

    // Remove member buttons
    container.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const email = btn.dataset.email;
        const memberName = btn.dataset.name || 'Member';
        if (!confirm(`Remove ${memberName} from this team?`)) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await API.removeTeamMember(teamId, email);
          // Also remove from localStorage fallback
          const allMem = getLocalTeamMembers();
          if (allMem[teamId]) {
            allMem[teamId] = allMem[teamId].filter(m => m.email !== email);
            saveLocalTeamMembers(allMem);
          }
          toast(`${memberName} removed`, 'success');
          // Refresh team data from API
          const teamsData = await API.listTeams();
          const refreshedTeams = teamsData.teams || [];
          const localTeams = getLocalTeams();
          const allTeamIds = new Set(refreshedTeams.map(t => t.teamId));
          const merged = [...refreshedTeams, ...localTeams.filter(t => !allTeamIds.has(t.teamId))];
          showTeamDetail(teamId, merged, refreshedTeams);
        } catch (err) {
          toast(err.message || 'Failed to remove member', 'error');
          btn.disabled = false;
          btn.textContent = '✕ Remove';
        }
      });
    });

    // Delete team (local teams only)
    const deleteBtn = document.getElementById('delete-team-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (!confirm('Delete this team? This cannot be undone.')) return;
        const localTeams = getLocalTeams().filter(t => t.teamId !== teamId);
        saveLocalTeams(localTeams);
        const allMem = getLocalTeamMembers();
        delete allMem[teamId];
        saveLocalTeamMembers(allMem);
        toast('Team deleted', 'success');
        loadTeams();
      });
    }

    // Ticket card clicks
    container.querySelectorAll('.ticket-card').forEach(c => c.addEventListener('click', () => openTicketDetail(c.dataset.id)));
  }

  // ── Resolved Tickets (grouped by team) ──
  async function loadResolvedTickets() {
    const container = document.getElementById('resolved-grid');
    container.innerHTML = '<p class="loading">Loading resolved tickets...</p>';
    try {
      const [teamsData, ticketsData] = await Promise.all([API.listTeams(), API.listTickets('resolved')]);
      const teams = teamsData.teams || [];
      const resolved = (Array.isArray(ticketsData) ? ticketsData : (ticketsData.tickets || [])).filter(t => t.status === 'resolved');

      if (!resolved.length) { container.innerHTML = '<p class="empty-state">No resolved tickets yet.</p>'; return; }

      // Group by team
      const byTeam = {};
      resolved.forEach(t => {
        const team = t.assignedTeam || t.assignedTo || 'Unassigned';
        if (!byTeam[team]) byTeam[team] = [];
        byTeam[team].push(t);
      });

      // Build team cards with resolved count
      const teamCards = teams.map(t => {
        const count = (byTeam[t.teamId] || []).length;
        if (count === 0) return '';
        return `
        <div class="team-card resolved-team-card" data-team-id="${esc(t.teamId)}" style="cursor:pointer;border-left:3px solid #00b894;">
          <div class="team-card-header">
            <h3 class="team-name">✅ ${esc(t.teamName)}</h3>
            <span class="badge badge-green">${count} resolved</span>
          </div>
          <div class="team-id">ID: ${esc(t.teamId)}</div>
          <div class="team-expertise">${(t.expertise || []).map(e => `<span class="tag">${esc(e)}</span>`).join('')}</div>
        </div>`;
      }).filter(Boolean);

      // Unassigned resolved tickets
      const unassigned = byTeam['Unassigned'] || [];
      if (unassigned.length) {
        teamCards.push(`
        <div class="team-card resolved-team-card" data-team-id="Unassigned" style="cursor:pointer;border-left:3px solid #636e72;">
          <div class="team-card-header">
            <h3 class="team-name">✅ Unassigned</h3>
            <span class="badge badge-gray">${unassigned.length} resolved</span>
          </div>
          <div class="team-id">Tickets resolved without team assignment</div>
        </div>`);
      }

      if (!teamCards.length) { container.innerHTML = '<p class="empty-state">No resolved tickets yet.</p>'; return; }

      container.innerHTML = teamCards.join('');
      container.querySelectorAll('.resolved-team-card').forEach(card => {
        card.addEventListener('click', () => showResolvedTeamTickets(card.dataset.teamId, teams, byTeam));
      });
    } catch (err) { container.innerHTML = `<p class="empty-state">Failed to load resolved tickets: ${esc(err.message)}</p>`; }
  }

  function showResolvedTeamTickets(teamId, teams, byTeam) {
    const container = document.getElementById('resolved-grid');
    const team = teams.find(t => t.teamId === teamId);
    const teamName = team ? team.teamName : teamId;
    const tickets = byTeam[teamId] || [];

    const ticketsHtml = tickets.length
      ? `<div class="tickets-grid">${tickets.map(ticketCard).join('')}</div>`
      : '<p class="empty-state">No resolved tickets for this team.</p>';

    container.innerHTML = `
      <div style="grid-column:1/-1;">
        <button class="btn btn-ghost" id="back-to-resolved" style="margin-bottom:16px;">← Back to Resolved Teams</button>
        <h2 style="color:#00b894;margin-bottom:4px;">✅ ${esc(teamName)} — Resolved</h2>
        <p style="color:#636e72;margin-bottom:16px;">${tickets.length} resolved ticket${tickets.length !== 1 ? 's' : ''}</p>
        ${ticketsHtml}
      </div>`;

    document.getElementById('back-to-resolved').addEventListener('click', () => loadResolvedTickets());
    container.querySelectorAll('.ticket-card').forEach(c => c.addEventListener('click', () => openTicketDetail(c.dataset.id)));
  }

  // ── Notifications ──
  async function loadNotifications() {
    const container = document.getElementById('notifications-list');
    const unreadOnly = document.getElementById('notif-unread-only').checked;
    container.innerHTML = '<p class="loading">Loading notifications...</p>';
    try {
      const data = await API.getNotifications(Auth.getEmail(), unreadOnly);
      const notifs = data.notifications || [];
      if (!notifs.length) { container.innerHTML = '<p class="empty-state">No notifications.</p>'; return; }
      container.innerHTML = notifs.map(n => `
        <div class="notif-card ${n.read ? 'notif-read' : 'notif-unread'}" data-id="${n.notificationId}">
          <div class="notif-header">
            <span class="notif-type badge badge-${n.type === 'escalation' ? 'red' : n.type === 'alert' ? 'orange' : 'blue'}">${n.type}</span>
            <span class="notif-time">${timeAgo(n.createdAt)}</span>
          </div>
          <div class="notif-title">${esc(n.title)}</div>
          <div class="notif-message">${esc(n.message)}</div>
          ${!n.read ? `<button class="btn btn-sm btn-ghost notif-mark-read" data-nid="${n.notificationId}">Mark as read</button>` : ''}
        </div>`).join('');
      container.querySelectorAll('.notif-mark-read').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await API.markNotificationRead(btn.dataset.nid, Auth.getEmail()); toast('Marked as read', 'success'); loadNotifications(); loadNotificationCount(); }
          catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) { container.innerHTML = `<p class="empty-state">Failed to load notifications: ${esc(err.message)}</p>`; }
  }

  async function loadNotificationCount() {
    try {
      const data = await API.getNotifications(Auth.getEmail(), true);
      const count = (data.notifications || []).length;
      const badge = document.getElementById('notif-badge');
      if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    } catch { /* ignore */ }
  }

  // ── Bin (Soft Delete / Trash) ──
  const BIN_STORAGE_KEY = 'ns_bin_tickets';
  const BIN_DELETED_IDS_KEY = 'ns_permanently_deleted';
  const BIN_RETENTION_DAYS = 30;

  // ── Local Assignment Persistence ──
  const ASSIGN_STORAGE_KEY = 'ns_ticket_assignments';
  function getLocalAssignments() {
    try { return JSON.parse(localStorage.getItem(ASSIGN_STORAGE_KEY) || '{}'); } catch (_e) { return {}; }
  }
  function saveLocalAssignment(ticketId, assignedTeam, assignedTo) {
    const data = getLocalAssignments();
    data[ticketId] = { assignedTeam, assignedTo, assignedAt: new Date().toISOString() };
    try { localStorage.setItem(ASSIGN_STORAGE_KEY, JSON.stringify(data)); } catch (_e) {}
  }
  function applyLocalAssignments(tickets) {
    const data = getLocalAssignments();
    return tickets.map(t => {
      const local = data[t.ticketId];
      if (local) return { ...t, assignedTeam: local.assignedTeam, assignedTo: local.assignedTo };
      return t;
    });
  }

  // ── Assignment Agent (Client-Side): round-robin to team members (excludes lead/manager) ──
  // Mirrors the backend assignment-agent.ts logic for offline/demo mode.
  // Each ticket gets the NEXT member. Chat-escalation + its paired ticket share the same agent.
  function autoAssignTicketsToAgents(tickets) {
    // Use cached API members if available, fall back to localStorage
    const membersMap = window._apiTeamMembers || getLocalTeamMembers();
    const chatUserAgent = {};
    let assignmentCount = 0;
    const assignmentLog = [];

    const sorted = [...tickets].sort((a, b) => {
      const aChat = (a.tags || []).includes('chat-escalation') ? 0 : 1;
      const bChat = (b.tags || []).includes('chat-escalation') ? 0 : 1;
      return aChat - bChat;
    });

    // Statuses that should NOT be re-assigned (terminal states only)
    const skipStatuses = new Set(['resolved', 'closed']);

    sorted.forEach(t => {
      if (!t.assignedTeam) return;
      if (skipStatuses.has(t.status)) return;
      // Skip if already assigned to a specific member (not just team)
      if (t.assignedTo && t.assignedTo !== t.assignedTeam) return;

      const eligible = (membersMap[t.assignedTeam] || []).filter(m => m.role === 'member');
      if (eligible.length === 0) return;

      const isChatEsc = (t.tags || []).includes('chat-escalation');
      const userTeamKey = (t.userId || t.ticketId) + '::' + t.assignedTeam;

      let memberName;
      if (!isChatEsc && chatUserAgent[userTeamKey]) {
        memberName = chatUserAgent[userTeamKey];
      } else {
        const rrKey = 'ns_rr_' + t.assignedTeam;
        let lastIdx = parseInt(localStorage.getItem(rrKey) || '-1', 10);
        let nextIdx = (lastIdx + 1) % eligible.length;
        memberName = eligible[nextIdx].name;
        localStorage.setItem(rrKey, String(nextIdx));
      }

      if (isChatEsc) {
        chatUserAgent[userTeamKey] = memberName;
      }

      t.assignedTo = memberName;
      t.assignedBy = 'assignment-agent';
      saveLocalAssignment(t.ticketId, t.assignedTeam, memberName);
      API.assignTicket(t.ticketId, t.assignedTeam, memberName).catch(() => {});
      assignmentCount++;
      assignmentLog.push(`#${t.ticketId?.slice(0,8)} → ${memberName} (${t.assignedTeam})`);
    });

    if (assignmentCount > 0) {
      console.log(`[Assignment Agent] Round-robin assigned ${assignmentCount} ticket(s):\n` + assignmentLog.join('\n'));
    }

    return tickets;
  }

  function getBinTickets() {
    try { return JSON.parse(localStorage.getItem(BIN_STORAGE_KEY) || '[]'); } catch (_e) { return []; }
  }
  function getBinTicketIds() {
    return new Set(getBinTickets().map(t => t.ticketId));
  }
  function getPermanentlyDeletedIds() {
    try { return new Set(JSON.parse(localStorage.getItem(BIN_DELETED_IDS_KEY) || '[]')); } catch (_e) { return new Set(); }
  }
  function addPermanentlyDeletedId(ticketId) {
    const ids = getPermanentlyDeletedIds();
    ids.add(ticketId);
    try { localStorage.setItem(BIN_DELETED_IDS_KEY, JSON.stringify([...ids])); } catch (_e) {}
  }
  function removePermanentlyDeletedId(ticketId) {
    const ids = getPermanentlyDeletedIds();
    ids.delete(ticketId);
    try { localStorage.setItem(BIN_DELETED_IDS_KEY, JSON.stringify([...ids])); } catch (_e) {}
  }
  function filterOutBinTickets(tickets) {
    const binIds = getBinTicketIds();
    const permDeletedIds = getPermanentlyDeletedIds();
    let filtered = tickets;
    if (binIds.size || permDeletedIds.size) {
      filtered = tickets.filter(t => !binIds.has(t.ticketId) && !permDeletedIds.has(t.ticketId));
    }
    filtered = applyLocalAssignments(filtered);
    return autoAssignTicketsToAgents(filtered);
  }
  function saveBinTickets(bin) {
    try { localStorage.setItem(BIN_STORAGE_KEY, JSON.stringify(bin)); } catch (_e) {}
  }
  function purgeExpiredBinTickets() {
    const bin = getBinTickets();
    const cutoff = Date.now() - BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const kept = bin.filter(t => new Date(t.deletedAt).getTime() > cutoff);
    if (kept.length !== bin.length) {
      const purged = bin.filter(t => new Date(t.deletedAt).getTime() <= cutoff);
      purged.forEach(t => addPermanentlyDeletedId(t.ticketId));
      saveBinTickets(kept);
      if (purged.length > 0) console.log(`[Bin] Purged ${purged.length} expired ticket(s)`);
    }
    return kept;
  }
  function updateBinBadge() {
    const bin = purgeExpiredBinTickets();
    const badge = document.getElementById('bin-badge');
    if (!badge) return;
    if (bin.length > 0) { badge.textContent = bin.length; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }
  function loadBin() {
    const bin = purgeExpiredBinTickets();
    updateBinBadge();
    const container = document.getElementById('bin-list');
    if (!bin.length) { container.innerHTML = '<p class="empty-state">Bin is empty.</p>'; return; }
    container.innerHTML = bin.map(t => {
      const deletedDate = new Date(t.deletedAt);
      const expiresAt = new Date(deletedDate.getTime() + BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
      return `<div class="ticket-card bin-ticket-card" style="opacity:0.85;">
        <div class="ticket-card-header">
          <span class="ticket-id">#${t.ticketId?.slice(0, 8) || '—'}</span>
          <span class="badge badge-gray">Deleted</span>
        </div>
        <div class="ticket-card-subject">${esc(t.subject)}</div>
        <div class="ticket-card-meta">
          <span class="priority-dot priority-${priorityName(t.priority)}"></span>
          ${priorityName(t.priority)} · Deleted ${timeAgo(t.deletedAt)} · <span style="color:${daysLeft <= 7 ? '#dc2626' : '#636e72'};">${daysLeft} day${daysLeft !== 1 ? 's' : ''} left</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;">
          <button class="btn btn-sm btn-outline bin-restore-btn" data-id="${t.ticketId}">♻️ Restore</button>
          <button class="btn btn-sm bin-permanent-delete-btn" data-id="${t.ticketId}" style="background:#dc2626;color:#fff;border:none;">🗑 Delete Permanently</button>
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.bin-restore-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); restoreFromBin(btn.dataset.id); });
    });
    container.querySelectorAll('.bin-permanent-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); permanentDeleteFromBin(btn.dataset.id); });
    });
  }
  function restoreFromBin(ticketId) {
    const bin = getBinTickets();
    const ticket = bin.find(t => t.ticketId === ticketId);
    if (!ticket) return;
    // Remove deletedAt and put back in allTickets
    delete ticket.deletedAt;
    allTickets.unshift(ticket);
    saveBinTickets(bin.filter(t => t.ticketId !== ticketId));
    removePermanentlyDeletedId(ticketId);
    try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch (_e) {}
    toast('Ticket restored', 'success');
    loadBin();
    renderDashboardStats();
    renderRecentTickets();
    updateBinBadge();
  }
  async function permanentDeleteFromBin(ticketId) {
    if (!confirm('Permanently delete this ticket? This cannot be undone.')) return;
    const bin = getBinTickets();
    saveBinTickets(bin.filter(t => t.ticketId !== ticketId));
    addPermanentlyDeletedId(ticketId);
    // Delete from DynamoDB backend
    try { await API.deleteTicket(ticketId); } catch (_e) { console.warn('Backend delete failed:', _e); }
    // Remove from allTickets in case it's still there
    allTickets = allTickets.filter(t => t.ticketId !== ticketId);
    try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch (_e) {}
    toast('Ticket permanently deleted', 'success');
    loadBin();
    updateBinBadge();
    renderDashboardStats();
    renderRecentTickets();
  }
  async function emptyBin() {
    const bin = getBinTickets();
    if (!bin.length) { toast('Bin is already empty', 'info'); return; }
    if (!confirm(`Permanently delete all ${bin.length} ticket(s) in the Bin? This cannot be undone.`)) return;
    // Delete each from DynamoDB backend, then mark as permanently deleted locally
    for (const t of bin) {
      addPermanentlyDeletedId(t.ticketId);
      try { await API.deleteTicket(t.ticketId); } catch (_e) { console.warn('Backend delete failed for', t.ticketId, _e); }
    }
    saveBinTickets([]);
    // Remove from allTickets
    const deletedIds = new Set(bin.map(t => t.ticketId));
    allTickets = allTickets.filter(t => !deletedIds.has(t.ticketId));
    try { localStorage.setItem('ns_tickets_cache', JSON.stringify(allTickets)); } catch (_e) {}
    toast('Bin emptied', 'success');
    loadBin();
    updateBinBadge();
    renderDashboardStats();
    renderRecentTickets();
  }

  // ── Toast ──
  function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div'); el.className = `toast toast-${type}`; el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  // ── Helpers ──
  function val(id) { return document.getElementById(id).value.trim(); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function showEl(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.classList.remove('hidden'); }
  function hideEl(id) { document.getElementById(id).classList.add('hidden'); }
  function formatSize(b) { return b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'; }
  function statusColor(s) { return { new:'blue', analyzing:'teal', assigned:'purple', in_progress:'yellow', pending_user:'orange', processing:'teal', escalated:'red', resolved:'green', closed:'gray' }[s] || 'gray'; }
  function statusLabel(s) { return { new:'New', analyzing:'Analyzing', assigned:'Assigned', in_progress:'Working on it', pending_user:'Need User Details', processing:'Processing', escalated:'Escalated', resolved:'Resolved', closed:'Closed' }[s] || s; }
  function priorityName(p) { if (p >= 10) return 'critical'; if (p >= 8) return 'high'; if (p >= 5) return 'medium'; return 'low'; }
  function timeAgo(d) { if (!d) return '—'; const diff = Date.now()-new Date(d).getTime(); const mins = Math.floor(diff/60000);
    if (mins < 1) return 'just now'; if (mins < 60) return `${mins}m ago`; const hrs = Math.floor(mins/60);
    if (hrs < 24) return `${hrs}h ago`; return `${Math.floor(hrs/24)}d ago`; }

  // ── Ticket Merge ──
  function bindMergeSearch(ticket) {
    const searchBtn = document.getElementById('merge-search-btn');
    const searchInput = document.getElementById('merge-search-input');
    if (!searchBtn || !searchInput) return;

    const doSearch = async () => {
      const query = searchInput.value.trim();
      const container = document.getElementById('merge-search-results');
      if (!query) { container.innerHTML = '<p class="empty-state">Enter a ticket ID or keyword to search.</p>'; return; }
      container.innerHTML = '<p class="loading">Searching...</p>';
      // Filter from local tickets list
      const results = allTickets.filter(t =>
        t.ticketId !== ticket.ticketId &&
        !t.mergedInto &&
        t.status !== 'closed' &&
        (t.ticketId.toLowerCase().includes(query.toLowerCase()) || (t.subject || '').toLowerCase().includes(query.toLowerCase()))
      ).slice(0, 10);

      if (!results.length) { container.innerHTML = '<p class="empty-state">No matching tickets found.</p>'; return; }
      container.innerHTML = results.map(r => `
        <div class="merge-result-card">
          <div class="merge-result-info">
            <span class="ticket-id">#${r.ticketId.slice(0, 8)}</span>
            <span class="badge badge-${statusColor(r.status)}">${statusLabel(r.status)}</span>
            <span style="color:var(--text);margin-left:8px;">${esc(r.subject)}</span>
          </div>
          <button class="btn btn-sm btn-primary merge-confirm-btn" data-primary-id="${r.ticketId}" data-primary-subject="${esc(r.subject)}">🔀 Merge Into This</button>
        </div>`).join('');

      container.querySelectorAll('.merge-confirm-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const primaryId = btn.dataset.primaryId;
          const primarySubject = btn.dataset.primarySubject;
          if (!confirm(`Merge ticket #${ticket.ticketId.slice(0, 8)} into #${primaryId.slice(0, 8)} (${primarySubject})?\n\nThis will close the current ticket and copy all messages/attachments to the primary ticket.`)) return;
          btn.disabled = true;
          btn.textContent = '⏳ Merging...';
          try {
            await API.mergeTicket(ticket.ticketId, primaryId);
            toast(`Ticket merged into #${primaryId.slice(0, 8)}`, 'success');
            openTicketDetail(ticket.ticketId);
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '🔀 Merge Into This';
          }
        });
      });
    };

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  }

  // ── SLA Dashboard ──
  async function loadSLADashboard() {
    const container = document.getElementById('sla-dashboard-content');
    container.innerHTML = '<p class="loading">Loading SLA metrics...</p>';
    try {
      const data = await API.getSLADashboard();
      const m = data.metrics || data;
      const compliancePct = m.compliancePercentage != null ? m.compliancePercentage : 0;
      const complianceColor = compliancePct > 90 ? 'green' : compliancePct >= 70 ? 'yellow' : 'red';

      let html = `<div class="sla-summary">
        <div class="sla-metric-card"><div class="sla-metric-value">${m.totalOpen || 0}</div><div class="sla-metric-label">Open Tickets</div></div>
        <div class="sla-metric-card sla-${complianceColor}"><div class="sla-metric-value">${compliancePct.toFixed(1)}%</div><div class="sla-metric-label">SLA Compliance</div></div>
        <div class="sla-metric-card sla-red"><div class="sla-metric-value">${m.breachedCount || 0}</div><div class="sla-metric-label">Breached</div></div>
        <div class="sla-metric-card sla-yellow"><div class="sla-metric-value">${m.atRiskCount || 0}</div><div class="sla-metric-label">At Risk</div></div>
        <div class="sla-metric-card"><div class="sla-metric-value">${m.avgResponseTime ? formatDuration(m.avgResponseTime) : '—'}</div><div class="sla-metric-label">Avg Response</div></div>
        <div class="sla-metric-card"><div class="sla-metric-value">${m.avgResolutionTime ? formatDuration(m.avgResolutionTime) : '—'}</div><div class="sla-metric-label">Avg Resolution</div></div>
      </div>`;

      // Per-priority breakdown — backend returns at top level, not inside metrics
      const priorities = data.priorityBreakdown || m.priorityBreakdown || m.perPriority || [];
      if (priorities.length) {
        html += `<h3 class="sla-section-title">Per-Priority Breakdown</h3><div class="sla-priority-grid">`;
        priorities.forEach(p => {
          const pComp = p.compliancePercentage != null ? p.compliancePercentage : 0;
          const pColor = pComp > 90 ? 'green' : pComp >= 70 ? 'yellow' : 'red';
          html += `<div class="sla-priority-card">
            <div class="sla-priority-name"><span class="priority-dot priority-${(p.priority || '').toLowerCase()}"></span>${esc(p.priority || p.level || '—')}</div>
            <div class="sla-priority-stats">
              <span class="sla-stat">Breached: <strong>${p.breachedCount || p.breachCount || 0}</strong></span>
              <span class="sla-stat sla-${pColor}">Compliance: <strong>${pComp.toFixed(1)}%</strong></span>
            </div>
          </div>`;
        });
        html += '</div>';
      }

      // Breached tickets table — backend returns at top level, not inside metrics
      const breached = data.breachedTickets || m.breachedTickets || [];
      if (breached.length) {
        html += `<h3 class="sla-section-title" style="color:#ef4444;">🚨 Breached Tickets</h3>
          <table class="sla-table"><thead><tr><th>Ticket</th><th>Subject</th><th>Priority</th><th>Time Since Breach</th><th>Team</th></tr></thead><tbody>`;
        breached.forEach(t => {
          const breachMins = typeof t.timeSinceBreach === 'number' ? formatDuration(t.timeSinceBreach * 60000) : (t.timeSinceBreach || '—');
          html += `<tr class="sla-row-breach">
            <td>#${esc((t.ticketId || '').slice(0, 8))}</td>
            <td>${esc(t.subject || '—')}</td>
            <td><span class="priority-dot priority-${(t.priority || '').toLowerCase()}"></span>${esc(t.priority || '—')}</td>
            <td>${breachMins}</td>
            <td>${esc(t.assignedTeam || 'Unassigned')}</td>
          </tr>`;
        });
        html += '</tbody></table>';
      }

      // At-risk tickets table — backend returns at top level, not inside metrics
      const atRisk = data.atRiskTickets || m.atRiskTickets || [];
      if (atRisk.length) {
        html += `<h3 class="sla-section-title" style="color:#f59e0b;">⚠️ At-Risk Tickets</h3>
          <table class="sla-table"><thead><tr><th>Ticket</th><th>Subject</th><th>Priority</th><th>Time Remaining</th><th>Team</th></tr></thead><tbody>`;
        atRisk.forEach(t => {
          const remainMins = typeof t.timeRemaining === 'number' ? formatDuration(t.timeRemaining * 60000) : (t.timeRemaining || '—');
          html += `<tr class="sla-row-risk">
            <td>#${esc((t.ticketId || '').slice(0, 8))}</td>
            <td>${esc(t.subject || '—')}</td>
            <td><span class="priority-dot priority-${(t.priority || '').toLowerCase()}"></span>${esc(t.priority || '—')}</td>
            <td>${remainMins}</td>
            <td>${esc(t.assignedTeam || 'Unassigned')}</td>
          </tr>`;
        });
        html += '</tbody></table>';
      }

      if (!breached.length && !atRisk.length && compliancePct >= 90) {
        html += '<p class="empty-state" style="color:#22c55e;margin-top:24px;">✅ All SLAs are on track. No breaches or at-risk tickets.</p>';
      }

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<p class="empty-state">Failed to load SLA dashboard: ${esc(err.message)}</p>`;
    }
  }

  function formatDuration(ms) {
    if (!ms || ms <= 0) return '—';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  }

  // ── WebSocket Real-time Notifications ──
  let ws = null, wsReconnectDelay = 1000, wsReconnectTimer = null, wsConnected = false;

  function connectWebSocket() {
    if (!CONFIG.WS_URL) return; // not configured yet
    const token = Auth.getIdToken();
    if (!token) return;
    try {
      ws = new WebSocket(`${CONFIG.WS_URL}?token=${encodeURIComponent(token)}`);
    } catch (e) { console.warn('[WS] Failed to create WebSocket:', e); return; }

    ws.onopen = () => {
      wsConnected = true;
      wsReconnectDelay = 1000;
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWSMessage(msg);
      } catch (e) { /* ignore non-JSON */ }
    };

    ws.onclose = () => {
      wsConnected = false;
      console.log('[WS] Disconnected, reconnecting in', wsReconnectDelay, 'ms');
      wsReconnectTimer = setTimeout(() => {
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
        if (Auth.isAuthenticated()) connectWebSocket();
      }, wsReconnectDelay);
    };

    ws.onerror = () => { /* onclose will fire */ };
  }

  function handleWSMessage(msg) {
    if (msg.type === 'ticket_update') {
      // Update ticket in local list
      const idx = allTickets.findIndex(t => t.ticketId === msg.ticketId);
      if (idx !== -1) {
        allTickets[idx].status = msg.status || allTickets[idx].status;
        renderTicketsList();
        const dashView = document.getElementById('view-dashboard');
        if (dashView && dashView.classList.contains('active')) { renderDashboardStats(); renderRecentTickets(); }
      }
      // If viewing this ticket in modal, refresh it
      const modalTitle = document.getElementById('modal-title');
      if (modalTitle && modalTitle.textContent.includes(msg.ticketId?.slice(0, 8))) {
        openTicketDetail(msg.ticketId);
      }
      toast(`Ticket #${(msg.ticketId || '').slice(0, 8)} updated: ${msg.status || 'changed'}`, 'info');
    }
    if (msg.type === 'new_message') {
      toast(`New message on ticket #${(msg.ticketId || '').slice(0, 8)}`, 'info');
      // Refresh messages if viewing that ticket
      const modalTitle = document.getElementById('modal-title');
      if (modalTitle && modalTitle.textContent.includes(msg.ticketId?.slice(0, 8))) {
        loadTicketMessages(msg.ticketId);
      }
    }
  }

  function disconnectWebSocket() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    wsConnected = false;
  }

  // ── Public API ──
  document.addEventListener('DOMContentLoaded', init);
  return { switchView, closeModal, removeFile };
})();
