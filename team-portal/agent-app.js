/**
 * Agent App — application controller for the Team Member Portal.
 * Handles routing, state management, event binding, and API interactions.
 */
const AgentApp = (() => {
  let allTickets = [];
  let myTickets = [];
  let teamTickets = [];
  let agentTeam = null;
  let allTeams = [];
  let autoRefreshInterval = null;
  let chatPollInterval = null;
  let chatBadgePollInterval = null;
  let appUIBound = false;

  /* ── Helpers ── */

  /** Check if a ticket is assigned to the current agent (by email, name, or display name) */
  function isMyTicket(ticket) {
    const email = AgentAuth.getEmail();
    const displayName = localStorage.getItem('agent_display_name') || '';
    if (ticket.assignedMemberEmail && ticket.assignedMemberEmail === email) return true;
    if (ticket.assignedTo === email) return true;
    if (displayName && ticket.assignedTo === displayName) return true;
    return false;
  }

  function showEl(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function hideEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  }

  function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
  function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

  function showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('agent-email').textContent = localStorage.getItem('agent_display_name') || AgentAuth.getEmail() || '';
    startChatBadgePoll();
  }

  /* ── Toast Notifications (Task 7.6) ── */

  function toast(message, type) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type || 'info'}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  /* ── Auth UI (Task 7.1) ── */

  let pendingEmail = '';

  function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('confirm-form').classList.toggle('hidden', tab !== 'confirm');
  }

  function bindAuthUI() {
    document.querySelectorAll('.auth-tab').forEach(t =>
      t.addEventListener('click', () => switchAuthTab(t.dataset.tab)));

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('login-error');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value.trim();
      try {
        await AgentAuth.signIn(email, password);
        showApp();
        bindAppUI();
        navigate(location.hash || '#/');
      } catch (err) {
        showEl('login-error', err.message);
      }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('register-error'); hideEl('register-success');
      const email = document.getElementById('reg-email').value.trim();
      const pw = document.getElementById('reg-password').value.trim();
      const confirm = document.getElementById('reg-confirm').value.trim();
      if (pw !== confirm) return showEl('register-error', 'Passwords do not match');
      try {
        await AgentAuth.signUp(email, pw);
        pendingEmail = email;
        showEl('register-success', 'Account created! Check your email for a code.');
        setTimeout(() => switchAuthTab('confirm'), 1200);
      } catch (err) { showEl('register-error', err.message); }
    });

    document.getElementById('confirm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('confirm-error');
      try {
        await AgentAuth.confirmSignUp(pendingEmail, document.getElementById('confirm-code').value.trim());
        toast('Email verified! You can now sign in.', 'success');
        switchAuthTab('login');
      } catch (err) { showEl('confirm-error', err.message); }
    });
  }

  /* ── Router (Task 7.2) ── */

  function navigate(hash) {
    if (!hash || hash === '#' || hash === '#/' || hash === '#/dashboard') {
      showView('dashboard');
      loadDashboard();
      return;
    }
    if (hash === '#/profile') {
      showView('profile');
      loadProfile();
      return;
    }
    if (hash === '#/chats') {
      showView('chats');
      loadChats();
      return;
    }
    const chatroomMatch = hash.match(/^#\/chatroom\/(.+)$/);
    if (chatroomMatch) {
      showView('chatroom');
      loadChatRoom(chatroomMatch[1]);
      return;
    }
    const ticketMatch = hash.match(/^#\/ticket\/(.+)$/);
    if (ticketMatch) {
      showView('ticket');
      loadTicketWorkspace(ticketMatch[1]);
      return;
    }
    // Fallback
    showView('dashboard');
    loadDashboard();
  }

  function showView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewId = 'view-' + viewName;
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');

    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.view === viewName);
    });

    // Stop auto-refresh when leaving dashboard
    if (viewName !== 'dashboard') stopAutoRefresh();
    // Stop chat message polling when leaving chatroom
    if (viewName !== 'chatroom') stopChatPoll();
  }

  /* ── Dashboard Controller (Task 7.3) ── */

  async function loadDashboard() {
    const myContainer = document.getElementById('my-tickets');
    const teamContainer = document.getElementById('team-tickets');
    const statsPanel = document.getElementById('stats-panel');
    myContainer.innerHTML = '<p class="loading">Loading tickets...</p>';
    teamContainer.innerHTML = '';

    try {
      showLoading();
      const data = await AgentAPI.listTickets();
      allTickets = data.tickets || [];
      const email = AgentAuth.getEmail();

      // Separate personal vs team tickets
      myTickets = allTickets.filter(t => isMyTicket(t));
      
      // Resolve agent's team from tickets
      const myTeamId = findAgentTeam(myTickets);
      if (myTeamId && !agentTeam) {
        await resolveTeamInfo(myTeamId);
      }

      // Team tickets: assigned to agent's team but not to any individual
      if (agentTeam) {
        teamTickets = allTickets.filter(t =>
          t.assignedTeam === agentTeam.teamId && (!t.assignedTo || t.assignedTo === '')
        );
        document.getElementById('agent-team').textContent = agentTeam.teamName || '';
      } else {
        teamTickets = [];
      }

      // Render
      const statusFilter = document.getElementById('filter-status').value;
      const priorityFilter = document.getElementById('filter-priority').value;
      statsPanel.innerHTML = AgentViews.renderDashboardStats(myTickets);
      myContainer.innerHTML = AgentViews.renderMyTickets(myTickets, statusFilter, priorityFilter);
      teamContainer.innerHTML = AgentViews.renderTeamTickets(teamTickets);

      // Bind ticket card clicks
      bindTicketCardClicks(myContainer);
      bindTicketCardClicks(teamContainer);
      bindClaimButtons(teamContainer);

      // Start auto-refresh
      startAutoRefresh();
    } catch (err) {
      myContainer.innerHTML = `<p class="empty-state">${AgentViews.esc(err.message)}</p>`;
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function findAgentTeam(tickets) {
    for (const t of tickets) {
      if (t.assignedTeam) return t.assignedTeam;
    }
    return null;
  }

  async function resolveTeamInfo(teamId) {
    try {
      if (allTeams.length === 0) {
        const data = await AgentAPI.listTeams();
        allTeams = data.teams || [];
      }
      agentTeam = allTeams.find(t => t.teamId === teamId) || null;
    } catch (_e) {
      agentTeam = null;
    }
  }

  function bindTicketCardClicks(container) {
    container.querySelectorAll('.ticket-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't navigate if clicking the claim button
        if (e.target.classList.contains('btn-claim')) return;
        const ticketId = card.dataset.ticketId;
        if (ticketId) location.hash = `#/ticket/${ticketId}`;
      });
    });
  }

  function bindClaimButtons(container) {
    container.querySelectorAll('.btn-claim').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ticketId = btn.dataset.claimId;
        btn.disabled = true;
        btn.textContent = 'Claiming...';
        try {
          await AgentAPI.updateTicketStatus(ticketId, 'in_progress', AgentAuth.getEmail());
          toast('Ticket claimed!', 'success');
          await loadDashboard();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Claim';
          // Refresh team tickets in case someone else claimed it
          await loadDashboard();
        }
      });
    });
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshInterval = setInterval(async () => {
      try {
        const data = await AgentAPI.listTickets();
        const newTickets = data.tickets || [];
        const oldJson = JSON.stringify(allTickets.map(t => t.ticketId + t.status + t.updatedAt));
        const newJson = JSON.stringify(newTickets.map(t => t.ticketId + t.status + t.updatedAt));
        if (oldJson === newJson) return;

        allTickets = newTickets;
        const email = AgentAuth.getEmail();
        myTickets = allTickets.filter(t => isMyTicket(t));
        if (agentTeam) {
          teamTickets = allTickets.filter(t =>
            t.assignedTeam === agentTeam.teamId && (!t.assignedTo || t.assignedTo === '')
          );
        }

        const statusFilter = document.getElementById('filter-status').value;
        const priorityFilter = document.getElementById('filter-priority').value;
        document.getElementById('stats-panel').innerHTML = AgentViews.renderDashboardStats(myTickets);
        document.getElementById('my-tickets').innerHTML = AgentViews.renderMyTickets(myTickets, statusFilter, priorityFilter);
        document.getElementById('team-tickets').innerHTML = AgentViews.renderTeamTickets(teamTickets);
        bindTicketCardClicks(document.getElementById('my-tickets'));
        bindTicketCardClicks(document.getElementById('team-tickets'));
        bindClaimButtons(document.getElementById('team-tickets'));
      } catch (_e) { /* silent refresh failure */ }
    }, 60000);
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
  }

  /* ── Ticket Workspace Controller (Task 7.4) ── */

  async function loadTicketWorkspace(ticketId) {
    const container = document.getElementById('ticket-workspace-content');
    container.innerHTML = '<p class="loading">Loading ticket...</p>';

    try {
      showLoading();
      const ticket = await AgentAPI.getTicket(ticketId);
      let messages = [];
      try {
        const msgData = await AgentAPI.getTicketMessages(ticketId);
        messages = msgData.messages || [];
      } catch (_e) { /* ignore message fetch errors */ }

      container.innerHTML = AgentViews.renderTicketWorkspace(ticket, messages);
      bindWorkspaceActions(ticketId);
    } catch (err) {
      if (err.message === 'Ticket not found') {
        container.innerHTML = '<div class="not-found"><h3>Ticket not found</h3><p>The ticket does not exist or you do not have access.</p><a href="#/">Back to Dashboard</a></div>';
      } else {
        container.innerHTML = `<p class="empty-state">${AgentViews.esc(err.message)}</p>`;
      }
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function bindWorkspaceActions(ticketId) {
    // Send message
    const sendBtn = document.getElementById('send-message-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const textarea = document.getElementById('message-content');
        const content = textarea.value.trim();
        hideEl('message-error');
        if (!content) {
          showEl('message-error', 'Message cannot be empty.');
          return;
        }
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
        try {
          await AgentAPI.sendMessage(ticketId, { content, userId: AgentAuth.getEmail() });
          toast('Message sent!', 'success');
          textarea.value = '';
          await loadTicketWorkspace(ticketId);
        } catch (err) {
          showEl('message-error', err.message);
          toast(err.message, 'error');
          // Preserve message content on error
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
      });
    }

    // Update status
    const updateBtn = document.getElementById('update-status-btn');
    if (updateBtn) {
      updateBtn.addEventListener('click', async () => {
        const select = document.getElementById('status-select');
        const newStatus = select.value;
        updateBtn.disabled = true;
        updateBtn.textContent = 'Updating...';
        try {
          await AgentAPI.updateTicketStatus(ticketId, newStatus);
          toast('Status updated!', 'success');
          await loadTicketWorkspace(ticketId);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          updateBtn.disabled = false;
          updateBtn.textContent = 'Update';
        }
      });
    }

    // Resolve button — show form
    const resolveBtn = document.getElementById('resolve-btn');
    const resolveContainer = document.getElementById('resolve-form-container');
    if (resolveBtn && resolveContainer) {
      resolveBtn.addEventListener('click', () => {
        resolveContainer.classList.remove('hidden');
        resolveBtn.classList.add('hidden');
      });
    }

    // Cancel resolve
    const cancelResolve = document.getElementById('cancel-resolve-btn');
    if (cancelResolve) {
      cancelResolve.addEventListener('click', () => {
        resolveContainer.classList.add('hidden');
        if (resolveBtn) resolveBtn.classList.remove('hidden');
      });
    }

    // Submit resolve
    const submitResolve = document.getElementById('submit-resolve-btn');
    if (submitResolve) {
      submitResolve.addEventListener('click', async () => {
        const resolution = document.getElementById('resolution-text').value.trim();
        const rootCause = document.getElementById('root-cause-text').value.trim();
        hideEl('resolve-error');

        if (!resolution) {
          showEl('resolve-error', 'Resolution summary is required.');
          return;
        }

        submitResolve.disabled = true;
        submitResolve.textContent = 'Resolving...';
        try {
          await AgentAPI.resolveTicket(ticketId, resolution, rootCause || undefined);
          toast('Ticket resolved!', 'success');
          await loadTicketWorkspace(ticketId);
        } catch (err) {
          showEl('resolve-error', err.message);
          toast(err.message, 'error');
          // Preserve form data on error
        } finally {
          submitResolve.disabled = false;
          submitResolve.textContent = 'Submit Resolution';
        }
      });
    }

    // Bind resolve translate button
    const resolveTransBtn = document.getElementById('resolve-translate-btn');
    if (resolveTransBtn) {
      resolveTransBtn.addEventListener('click', async () => {
        const langSelect = document.getElementById('resolve-translate-lang');
        const targetLang = langSelect.value;
        const textarea = document.getElementById('resolution-text');
        const text = textarea.value.trim();
        if (!targetLang) { toast('Select a language first', 'error'); return; }
        if (!text) { toast('Type a resolution first', 'error'); return; }
        resolveTransBtn.disabled = true;
        resolveTransBtn.textContent = 'Translating...';
        try {
          const res = await AgentAPI.translateText(text, targetLang);
          textarea.value = res.translatedText;
        } catch (err) {
          toast('Translation failed: ' + err.message, 'error');
        } finally {
          resolveTransBtn.disabled = false;
          resolveTransBtn.textContent = 'Translate';
        }
      });
    }

    // Translate ticket
    const translateBtn = document.getElementById('translate-ticket-btn');
    if (translateBtn) {
      translateBtn.addEventListener('click', async () => {
        const langSelect = document.getElementById('translate-lang-select');
        const targetLang = langSelect.value;
        if (!targetLang) { toast('Please select a language', 'error'); return; }

        const resultDiv = document.getElementById('translate-result');
        const errorDiv = document.getElementById('translate-error');
        hideEl('translate-error');
        translateBtn.disabled = true;
        translateBtn.textContent = 'Translating...';

        try {
          const ticket = await AgentAPI.getTicket(ticketId);
          const [subjectRes, descRes] = await Promise.all([
            AgentAPI.translateText(ticket.subject, targetLang),
            AgentAPI.translateText(ticket.description, targetLang),
          ]);

          const langName = langSelect.options[langSelect.selectedIndex].text;
          document.getElementById('translate-result-lang').textContent = '📝 Translated to ' + langName;
          document.getElementById('translate-result-subject').textContent = subjectRes.translatedText;
          document.getElementById('translate-result-description').textContent = descRes.translatedText;
          resultDiv.classList.remove('hidden');
        } catch (err) {
          showEl('translate-error', 'Translation failed: ' + err.message);
        } finally {
          translateBtn.disabled = false;
          translateBtn.textContent = 'Translate';
        }
      });
    }

    // Bind reply translate button
    const replyTransBtn = document.getElementById('reply-translate-btn');
    if (replyTransBtn) {
      replyTransBtn.addEventListener('click', async () => {
        const langSelect = document.getElementById('reply-translate-lang');
        const targetLang = langSelect.value;
        const textarea = document.getElementById('message-content');
        const text = textarea.value.trim();
        if (!targetLang) { toast('Select a language first', 'error'); return; }
        if (!text) { toast('Type a message first', 'error'); return; }
        replyTransBtn.disabled = true;
        replyTransBtn.textContent = 'Translating...';
        try {
          const res = await AgentAPI.translateText(text, targetLang);
          textarea.value = res.translatedText;
        } catch (err) {
          toast('Translation failed: ' + err.message, 'error');
        } finally {
          replyTransBtn.disabled = false;
          replyTransBtn.textContent = 'Translate';
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
        resolvedTransBtn.disabled = true;
        resolvedTransBtn.textContent = 'Translating...';
        try {
          const ticket = await AgentAPI.getTicket(ticketId);
          const res = await AgentAPI.translateText(ticket.resolution, targetLang);
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
  }

  /* ── Live Chat Controller ── */

  async function loadChats() {
    const container = document.getElementById('chats-content');
    container.innerHTML = '<p class="loading">Loading chat requests...</p>';
    try {
      showLoading();
      const data = await AgentAPI.listTickets();
      const allChatTickets = (data.tickets || []).filter(t => {
        const tags = Array.isArray(t.tags) ? t.tags : [];
        if (!tags.includes('chat-escalation')) return false;
        // Only show chats assigned to me or unassigned
        const isUnassigned = !t.assignedTo || t.assignedTo === '';
        return isMyTicket(t) || isUnassigned;
      });
      // Split into active and ended chats
      const endedIds = getEndedChatIds();
      const activeChats = allChatTickets.filter(t => t.status !== 'resolved' && t.status !== 'closed' && !endedIds.has(t.ticketId));
      const endedChats = allChatTickets.filter(t => t.status === 'resolved' || t.status === 'closed' || endedIds.has(t.ticketId));
      // Sort newest first
      activeChats.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      endedChats.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      let html = '<div class="view-header"><h2>💬 Live Chats</h2></div>';
      html += AgentViews.renderChatList(activeChats);
      if (endedChats.length) {
        html += '<div class="view-header" style="margin-top:24px;"><h3 style="font-size:1rem;color:var(--text2);">✅ Ended Chats</h3></div>';
        html += endedChats.map(t => {
          const id = AgentViews.esc((t.ticketId || '').substring(0, 8));
          const subject = AgentViews.esc(t.subject || 'Chat Escalation');
          const user = AgentViews.esc(t.userId || 'Unknown');
          return `<div class="chat-request-card" data-ticket-id="${AgentViews.esc(t.ticketId)}" style="opacity:0.7;">
  <div class="chat-request-header">
    <span class="chat-request-user">👤 ${user}</span>
    <span class="chat-request-time">✅ Resolved</span>
  </div>
  <div class="chat-request-subject">${subject}</div>
  <div class="chat-request-id">#${id}</div>
  <div class="chat-request-actions">
    <button class="btn btn-sm btn-open-chat" data-ticket-id="${AgentViews.esc(t.ticketId)}">View Chat</button>
  </div>
</div>`;
        }).join('\n');
      }
      container.innerHTML = html;
      bindChatActions(container);
      updateChatBadge();
    } catch (err) {
      container.innerHTML = '<p class="empty-state">' + AgentViews.esc(err.message) + '</p>';
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function bindChatActions(container) {
    container.querySelectorAll('.btn-accept-chat').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ticketId = btn.dataset.ticketId;
        btn.disabled = true;
        btn.textContent = 'Accepting...';
        try {
          await AgentAPI.updateTicketStatus(ticketId, 'in_progress', AgentAuth.getEmail());
          toast('Chat accepted!', 'success');
          updateChatBadge();
          location.hash = '#/chatroom/' + ticketId;
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Accept Chat';
        }
      });
    });
    container.querySelectorAll('.btn-open-chat').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        location.hash = '#/chatroom/' + btn.dataset.ticketId;
      });
    });
  }

  async function loadChatRoom(ticketId) {
    const container = document.getElementById('chatroom-content');
    container.innerHTML = '<p class="loading">Loading chat...</p>';
    try {
      showLoading();
      const ticket = await AgentAPI.getTicket(ticketId);
      let messages = [];
      try {
        const msgData = await AgentAPI.getTicketMessages(ticketId);
        messages = msgData.messages || [];
      } catch (_e) { /* ignore */ }
      container.innerHTML = AgentViews.renderChatRoom(ticket, messages);
      scrollChatToBottom();
      bindChatRoomActions(ticketId, ticket);
      startChatPoll(ticketId, ticket);
    } catch (err) {
      container.innerHTML = '<p class="empty-state">' + AgentViews.esc(err.message) + '</p>';
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function bindChatRoomActions(ticketId, ticket) {
    const sendBtn = document.getElementById('chatroom-send-btn');
    const input = document.getElementById('chatroom-input-text');
    if (!sendBtn || !input) return;

    async function doSend() {
      const content = input.value.trim();
      if (!content) return;
      sendBtn.disabled = true;
      input.disabled = true;
      try {
        await AgentAPI.sendMessage(ticketId, { content: content, userId: AgentAuth.getEmail() });
        input.value = '';
        // Refresh messages immediately
        const msgData = await AgentAPI.getTicketMessages(ticketId);
        const msgList = document.getElementById('chatroom-messages');
        if (msgList) {
          msgList.innerHTML = renderChatMessages(msgData.messages || [], ticket);
          scrollChatToBottom();
        }
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    }

    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    // End Chat button
    const endBtn = document.getElementById('chatroom-end-btn');
    if (endBtn) {
      endBtn.addEventListener('click', async () => {
        if (!confirm('End this chat and resolve the ticket?')) return;
        endBtn.disabled = true;
        endBtn.textContent = 'Ending...';
        try {
          // Track ended chat locally FIRST so it never shows as active again even if API fails
          markChatEnded(ticketId);
          try {
            await AgentAPI.resolveTicket(ticketId, 'Chat resolved by agent.');
          } catch (resolveErr) {
            // If resolve fails (e.g. solution storage error), fall back to status update
            console.warn('resolveTicket failed, falling back to status update:', resolveErr);
            await AgentAPI.updateTicketStatus(ticketId, 'resolved');
          }
          toast('Chat ended and ticket resolved.', 'success');
          stopChatPoll();
          location.hash = '#/chats';
        } catch (err) {
          // Even if both API calls fail, localStorage tracking keeps it ended locally
          toast('Chat ended locally. Server update may be delayed.', 'info');
          stopChatPoll();
          location.hash = '#/chats';
        }
      });
    }
  }

  // ── Ended Chats localStorage tracking ──
  const ENDED_CHATS_KEY = 'agent_ended_chats';
  function getEndedChatIds() {
    try { return new Set(JSON.parse(localStorage.getItem(ENDED_CHATS_KEY) || '[]')); } catch (_e) { return new Set(); }
  }
  function markChatEnded(ticketId) {
    const ids = getEndedChatIds();
    ids.add(ticketId);
    try { localStorage.setItem(ENDED_CHATS_KEY, JSON.stringify([...ids])); } catch (_e) {}
  }

  function renderChatMessages(messages, ticket) {
    if (!messages || messages.length === 0) {
      return '<p class="empty-state">No messages yet. Start the conversation.</p>';
    }
    return messages.map(m => {
      const isAgent = m.userId !== ticket.userId;
      const sender = isAgent ? 'You' : AgentViews.esc(m.userId);
      return '<div class="chat-msg ' + (isAgent ? 'chat-msg-agent' : 'chat-msg-user') + '">' +
        '<div class="chat-msg-content">' + AgentViews.esc(m.content) + '</div>' +
        '<div class="chat-msg-meta">' + sender + ' · ' + AgentViews.timeAgo(m.createdAt) + '</div>' +
        '</div>';
    }).join('');
  }

  function scrollChatToBottom() {
    const el = document.getElementById('chatroom-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function startChatPoll(ticketId, ticket) {
    stopChatPoll();
    chatPollInterval = setInterval(async () => {
      try {
        const msgData = await AgentAPI.getTicketMessages(ticketId);
        const msgList = document.getElementById('chatroom-messages');
        if (msgList) {
          msgList.innerHTML = renderChatMessages(msgData.messages || [], ticket);
          scrollChatToBottom();
        }
      } catch (_e) { /* silent */ }
    }, 8000);
  }

  function stopChatPoll() {
    if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
  }

  function startChatBadgePoll() {
    stopChatBadgePoll();
    updateChatBadge();
    chatBadgePollInterval = setInterval(updateChatBadge, 30000);
  }

  function stopChatBadgePoll() {
    if (chatBadgePollInterval) { clearInterval(chatBadgePollInterval); chatBadgePollInterval = null; }
  }

  async function updateChatBadge() {
    try {
      const data = await AgentAPI.listTickets();
      const endedIds = getEndedChatIds();
      const chatCount = (data.tickets || []).filter(t => {
        const tags = Array.isArray(t.tags) ? t.tags : [];
        if (!tags.includes('chat-escalation')) return false;
        if (endedIds.has(t.ticketId)) return false;
        if (t.status === 'resolved' || t.status === 'closed') return false;
        const isNew = t.status === 'new' || t.status === 'assigned' || t.status === 'analyzing';
        const isUnassigned = !t.assignedTo || t.assignedTo === '';
        return isNew && (isMyTicket(t) || isUnassigned);
      }).length;
      const badge = document.getElementById('chat-badge');
      if (badge) {
        badge.textContent = chatCount;
        badge.classList.toggle('hidden', chatCount === 0);
      }
    } catch (_e) { /* silent */ }
  }

  /* ── Profile Controller (Task 7.5) ── */

  async function loadProfile() {
    const container = document.getElementById('profile-content');
    container.innerHTML = '<p class="loading">Loading profile...</p>';

    try {
      showLoading();
      const email = AgentAuth.getEmail();

      // Fetch teams if not cached
      if (allTeams.length === 0) {
        try {
          const data = await AgentAPI.listTeams();
          allTeams = data.teams || [];
        } catch (_e) { allTeams = []; }
      }

      // Fetch all tickets to compute stats
      const data = await AgentAPI.listTickets();
      allTickets = data.tickets || [];

      // Find agent's team from their tickets
      const myTeamId = findAgentTeam(allTickets.filter(t => isMyTicket(t)));
      if (myTeamId) {
        agentTeam = allTeams.find(t => t.teamId === myTeamId) || null;
      }

      // Compute stats
      const stats = AgentViews.computeStats(allTickets, email);

      container.innerHTML = AgentViews.renderAgentProfile(email, agentTeam, stats);
      bindProfileActions();
    } catch (err) {
      container.innerHTML = `<p class="empty-state">${AgentViews.esc(err.message)}</p>`;
      toast(err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  /* ── Profile Name Edit ── */

  function bindProfileActions() {
    const editBtn = document.getElementById('edit-name-btn');
    const editForm = document.getElementById('name-edit-form');
    const nameDisplay = document.getElementById('profile-display-name');
    const nameInput = document.getElementById('name-edit-input');
    const saveBtn = document.getElementById('name-save-btn');
    const cancelBtn = document.getElementById('name-cancel-btn');
    if (!editBtn) return;

    editBtn.addEventListener('click', () => {
      editForm.classList.remove('hidden');
      editBtn.classList.add('hidden');
      nameDisplay.classList.add('hidden');
      nameInput.focus();
      nameInput.select();
    });

    cancelBtn.addEventListener('click', () => {
      editForm.classList.add('hidden');
      editBtn.classList.remove('hidden');
      nameDisplay.classList.remove('hidden');
    });

    saveBtn.addEventListener('click', () => {
      const newName = nameInput.value.trim();
      if (!newName) return;
      localStorage.setItem('agent_display_name', newName);
      toast('Name updated!', 'success');
      loadProfile();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
  }

  /* ── App UI Binding ── */

  function bindAppUI() {
    if (appUIBound) return;
    appUIBound = true;

    // Sign out
    document.getElementById('sign-out-btn').addEventListener('click', () => {
      stopAutoRefresh();
      stopChatPoll();
      stopChatBadgePoll();
      AgentAuth.signOut();
      agentTeam = null;
      allTeams = [];
      allTickets = [];
      showAuth();
    });

    // Hash change
    window.addEventListener('hashchange', () => navigate(location.hash));

    // Filters
    document.getElementById('filter-status').addEventListener('change', () => refreshDashboardFilters());
    document.getElementById('filter-priority').addEventListener('change', () => refreshDashboardFilters());
  }

  function refreshDashboardFilters() {
    const statusFilter = document.getElementById('filter-status').value;
    const priorityFilter = document.getElementById('filter-priority').value;
    const myContainer = document.getElementById('my-tickets');
    myContainer.innerHTML = AgentViews.renderMyTickets(myTickets, statusFilter, priorityFilter);
    bindTicketCardClicks(myContainer);
  }

  /* ── Init ── */

  function init() {
    bindAuthUI();
    if (AgentAuth.isAuthenticated()) {
      showApp();
      bindAppUI();
      navigate(location.hash || '#/');
    } else {
      showAuth();
    }
  }

  return { init };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => AgentApp.init());
