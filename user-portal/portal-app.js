/**
 * Portal Application Controller — wires routing, auth, views, and user interactions.
 * Depends on: PortalAuth, PortalAPI, PortalValidation, PortalFileUpload, PortalViews
 */
const PortalApp = (() => {
  let allTickets = [];
  let pendingEmail = '';
  let autoRefreshInterval = null;
  let appUIBound = false;
  let submitting = false;

  /* ── Helpers ── */

  function val(id) { return document.getElementById(id).value.trim(); }

  function showEl(id, text) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function hideEl(id) {
    const el = document.getElementById(id);
    el.textContent = '';
    el.classList.add('hidden');
  }

  function showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('user-email').textContent = PortalAuth.getEmail() || '';
    startAutoRefresh();
  }

  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(async () => {
      try {
        const data = await PortalAPI.listMyTickets(PortalAuth.getEmail());
        const newTickets = data.tickets || [];
        
        // Only update the UI if the data actually changed
        const oldJson = JSON.stringify(allTickets.map(t => t.ticketId + t.status + t.updatedAt));
        const newJson = JSON.stringify(newTickets.map(t => t.ticketId + t.status + t.updatedAt));
        
        if (oldJson === newJson) return; // No changes, skip re-render
        
        // For ticket detail, check if status changed and reload if needed (before updating allTickets)
        const detailView = document.getElementById('view-ticket-detail');
        if (detailView && detailView.classList.contains('active')) {
          const match = location.hash.match(/^#\/tickets\/(.+)$/);
          if (match) {
            const ticketId = match[1];
            const updated = newTickets.find(t => t.ticketId === ticketId);
            const old = allTickets.find(t => t.ticketId === ticketId);
            if (updated && old && updated.status !== old.status) {
              // Status changed — reload the full detail view to show resolution section
              allTickets = newTickets; // Update before reload
              showToast('Ticket status updated: ' + PortalViews.statusLabel(updated.status), 'info');
              loadTicketDetail(ticketId);
              return; // Skip the rest since we're reloading
            }
          }
        }
        
        allTickets = newTickets;
        
        // Silently update ticket list if currently viewing it
        const listView = document.getElementById('view-ticket-list');
        if (listView && listView.classList.contains('active')) {
          const filterStatus = document.getElementById('filter-status').value;
          document.getElementById('ticket-list').innerHTML = PortalViews.renderTicketList(allTickets, filterStatus);
        }
      } catch (e) { console.warn('Auto-refresh failed:', e); }
    }, 15000);
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderFileList() {
    const container = document.getElementById('file-list');
    const files = PortalFileUpload.getFiles();
    if (files.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = files.map((entry, i) =>
      `<div class="file-item">
        <span class="file-name">${PortalViews.esc(entry.file.name)}</span>
        <span class="file-size">${formatSize(entry.file.size)}</span>
        <button type="button" class="btn btn-ghost btn-sm file-remove" data-index="${i}">✕</button>
      </div>`
    ).join('');
    container.querySelectorAll('.file-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        PortalFileUpload.removeFile(Number(e.target.dataset.index));
        renderFileList();
      });
    });
  }

  /* ── Toast Notifications ── */

  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /* ── Auth UI Wiring ── */

  function bindAuthUI() {
    // Tab switching
    document.querySelectorAll('#auth-tabs .auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    // Forgot password link
    document.getElementById('forgot-password-link').addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('forgot');
    });

    // Password visibility toggle
    document.querySelectorAll('.toggle-password').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🙈';
        } else {
          input.type = 'password';
          btn.textContent = '👁';
        }
      });
    });

    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('login-error');
      try {
        await PortalAuth.signIn(val('login-email'), val('login-password'));
        showApp();
        bindAppUI();
        PortalChat.init();
        navigate(location.hash || '#/');
      } catch (err) {
        showEl('login-error', err.message);
      }
    });

    // Register
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('register-error');
      const email = val('reg-email');
      const password = val('reg-password');
      const confirm = val('reg-confirm');
      if (password !== confirm) {
        showEl('register-error', 'Passwords do not match');
        return;
      }
      try {
        await PortalAuth.signUp(email, password);
        pendingEmail = email;
        switchAuthTab('confirm');
      } catch (err) {
        showEl('register-error', err.message);
      }
    });

    // Confirm
    document.getElementById('confirm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('confirm-error');
      try {
        await PortalAuth.confirmSignUp(pendingEmail, val('confirm-code'));
        switchAuthTab('login');
        showToast('Account verified! You can now sign in.', 'success');
      } catch (err) {
        showEl('confirm-error', err.message);
      }
    });

    // Forgot password - request code
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('forgot-error');
      const email = val('forgot-email');
      try {
        await PortalAuth.forgotPassword(email);
        pendingEmail = email;
        switchAuthTab('reset');
        showToast('Reset code sent to your email.', 'success');
      } catch (err) {
        showEl('forgot-error', err.message);
      }
    });

    // Reset password - confirm new password
    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('reset-error');
      const code = val('reset-code');
      const password = val('reset-password');
      const confirm = val('reset-confirm');
      if (password !== confirm) {
        showEl('reset-error', 'Passwords do not match');
        return;
      }
      try {
        await PortalAuth.confirmForgotPassword(pendingEmail, code, password);
        switchAuthTab('login');
        showToast('Password reset successful! You can now sign in.', 'success');
      } catch (err) {
        showEl('reset-error', err.message);
      }
    });
  }

  function switchAuthTab(tab) {
    document.querySelectorAll('#auth-tabs .auth-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('confirm-form').classList.toggle('hidden', tab !== 'confirm');
    document.getElementById('forgot-form').classList.toggle('hidden', tab !== 'forgot');
    document.getElementById('reset-form').classList.toggle('hidden', tab !== 'reset');
    hideEl('login-error');
    hideEl('register-error');
    hideEl('confirm-error');
    hideEl('forgot-error');
    hideEl('reset-error');
  }

  /* ── Router ── */

  function navigate(hash) {
    if (!hash || hash === '#' || hash === '#/') {
      showView('ticket-list');
      loadTicketList();
      return;
    }
    if (hash === '#/new') {
      showView('new-ticket');
      return;
    }
    const detailMatch = hash.match(/^#\/tickets\/(.+)$/);
    if (detailMatch) {
      showView('ticket-detail');
      loadTicketDetail(detailMatch[1]);
      return;
    }
    // Fallback to ticket list for unknown routes
    showView('ticket-list');
    loadTicketList();
  }

  function showView(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const viewId = viewName === 'ticket-list' ? 'view-ticket-list'
      : viewName === 'new-ticket' ? 'view-new-ticket'
      : 'view-ticket-detail';
    document.getElementById(viewId).classList.add('active');

    // Update nav active state
    document.querySelectorAll('.nav-link').forEach((link) => {
      const linkView = link.dataset.view;
      link.classList.toggle('active', linkView === viewName);
    });
  }

  /* ── Ticket List ── */

  async function loadTicketList() {
    const container = document.getElementById('ticket-list');
    container.innerHTML = '<p class="loading">Loading tickets...</p>';
    try {
      const data = await PortalAPI.listMyTickets(PortalAuth.getEmail());
      allTickets = data.tickets || [];
      const filterStatus = document.getElementById('filter-status').value;
      container.innerHTML = PortalViews.renderTicketList(allTickets, filterStatus);
    } catch (err) {
      container.innerHTML = `<p class="empty-state">${PortalViews.esc(err.message)}</p>`;
    }
  }

  /* ── Ticket Detail ── */

  async function loadTicketDetail(ticketId) {
    const container = document.getElementById('ticket-detail-content');
    container.innerHTML = '<p class="loading">Loading ticket...</p>';
    try {
      const ticket = await PortalAPI.getTicket(ticketId);

      // Show merged ticket notice
      if (ticket.mergedInto) {
        container.innerHTML = `<div class="merged-notice">
          <span class="merged-notice-icon">🔀</span>
          <span>This ticket has been merged into ticket <a href="#/ticket/${ticket.mergedInto}" class="merged-link">#${ticket.mergedInto.slice(0, 8)}</a>. Please follow the primary ticket for updates.</span>
        </div>`;
        return;
      }
      
      if (PortalViews.isEditableStatus(ticket.status)) {
        // Editable ticket — show edit form
        container.innerHTML = PortalViews.renderEditableTicketDetail(ticket);
        bindEditForm(ticket.ticketId);
      } else {
        // Assigned ticket — show messages + message form
        let messages = [];
        try {
          const data = await PortalAPI.getMessages(ticketId);
          messages = data.messages || [];
        } catch (_err) { /* ignore message fetch errors */ }
        container.innerHTML = PortalViews.renderAssignedTicketDetail(ticket, messages);
        bindMessageForm(ticket.ticketId);
        bindTTSButtons(container);
        bindViewOriginalToggles(container);

        // Show satisfaction rating widget for resolved/closed tickets
        if (ticket.status === 'resolved' || ticket.status === 'closed') {
          container.insertAdjacentHTML('beforeend', renderRatingWidget(ticket));
          bindRatingWidget(ticket.ticketId);
        }

        // Show ticket timeline
        container.insertAdjacentHTML('beforeend', '<div class="timeline-section" id="ticket-timeline"><h4>Activity Timeline</h4><p class="loading">Loading timeline...</p></div>');
        loadUserTicketTimeline(ticket.ticketId);
      }
    } catch (err) {
      if (err.message === 'Ticket not found') {
        container.innerHTML = PortalViews.renderNotFound();
      } else {
        container.innerHTML = `<p class="empty-state">${PortalViews.esc(err.message)}</p>`;
      }
    }
  }

  function bindEditForm(ticketId) {
    const form = document.querySelector('.edit-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('edit-error');
      
      const subject = val('edit-subject');
      const description = val('edit-description');
      const priority = Number(document.getElementById('edit-priority').value);
      
      const result = PortalValidation.validateEditForm(subject, description, priority);
      if (!result.valid) {
        const msgs = Object.values(result.errors);
        showEl('edit-error', msgs.join('. '));
        return;
      }
      
      const btn = document.getElementById('edit-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      
      try {
        await PortalAPI.editTicket(ticketId, { subject, description, priority });
        showToast('Ticket updated successfully!', 'success');
        loadTicketDetail(ticketId); // Refresh the view
      } catch (err) {
        showEl('edit-error', err.message);
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });
  }

  function bindMessageForm(ticketId) {
    const form = document.querySelector('.message-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideEl('message-error');
      
      const content = val('message-content');
      const result = PortalValidation.validateMessage(content);
      if (!result.valid) {
        showEl('message-error', result.error);
        return;
      }
      
      const btn = document.getElementById('message-submit-btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      
      try {
        await PortalAPI.addMessage(ticketId, { content, userId: PortalAuth.getEmail() });
        showToast('Message sent!', 'success');
        document.getElementById('message-content').value = '';
        loadTicketDetail(ticketId); // Refresh to show new message
      } catch (err) {
        showEl('message-error', err.message);
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Message';
      }
    });
  }

  /* ── Ticket Submission ── */

  function bindSubmissionForm() {
    document.getElementById('create-ticket-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      // Prevent duplicate submissions
      if (submitting) return;

      hideEl('subject-error');
      hideEl('description-error');

      const subject = val('ticket-subject');
      const description = val('ticket-description');
      const priority = Number(val('ticket-priority'));
      const category = val('ticket-category');

      const result = PortalValidation.validateForm(subject, description);
      if (!result.valid) {
        if (result.errors.subject) {
          showEl('subject-error', result.errors.subject);
          document.getElementById('ticket-subject').classList.add('input-error');
        } else {
          document.getElementById('ticket-subject').classList.remove('input-error');
        }
        if (result.errors.description) {
          showEl('description-error', result.errors.description);
          document.getElementById('ticket-description').classList.add('input-error');
        } else {
          document.getElementById('ticket-description').classList.remove('input-error');
        }
        return;
      }

      document.getElementById('ticket-subject').classList.remove('input-error');
      document.getElementById('ticket-description').classList.remove('input-error');

      const submitBtn = document.getElementById('submit-ticket-btn');
      const originalText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      submitting = true;

      try {
        const ticket = await PortalAPI.createTicket({
          userId: PortalAuth.getEmail(),
          subject,
          description,
          priority,
          metadata: category ? { category } : undefined,
        });

        // Upload attachments if any
        const files = PortalFileUpload.getFiles();
        if (files.length > 0) {
          const uploadResults = await PortalFileUpload.uploadAll(ticket.ticketId);
          const failed = uploadResults.filter((r) => !r.success);
          if (failed.length > 0) {
            showToast(`${failed.length} attachment(s) failed to upload`, 'error');
          }
        }

        // Reset form
        document.getElementById('create-ticket-form').reset();
        document.getElementById('ticket-priority').value = '5';
        document.getElementById('ticket-category').value = '';
        PortalFileUpload.reset();
        renderFileList();

        showToast('Ticket created successfully!', 'success');
        location.hash = `#/tickets/${ticket.ticketId}`;
      } catch (err) {
        console.error('Ticket creation failed:', err);
        showToast(err.message || 'Failed to create ticket', 'error');
      } finally {
        submitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    });
  }

  /* ── Voice Recording (Amazon Transcribe via Backend API) ── */

  let mediaRecorder = null;
  let audioChunks = [];
  let recognitionActive = false;
  let recordingStartTime = null;
  let durationInterval = null;

  function bindVoiceRecord() {
    const btn = document.getElementById('voice-record-btn');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      btn.disabled = true;
      btn.title = 'Microphone access not available';
      btn.textContent = '🎤 Voice (unsupported browser)';
      return;
    }
    btn.addEventListener('click', () => {
      if (recognitionActive) { stopRecording(); } else { startRecording(); }
    });
  }

  async function startRecording() {
    const btn = document.getElementById('voice-record-btn');
    const indicator = document.getElementById('recording-indicator');
    const durationEl = document.getElementById('recording-duration');
    const statusEl = document.getElementById('transcription-status');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        await processRecordedAudio('ticket-description', statusEl);
      };

      mediaRecorder.start();
      recognitionActive = true;
      recordingStartTime = Date.now();
      btn.classList.add('recording');
      btn.textContent = '⏹ Stop Recording';
      indicator.classList.remove('hidden');
      const helperText = document.querySelector('.voice-helper-text');
      if (helperText) helperText.classList.add('hidden');
      statusEl.textContent = '🎙️ Recording... speak now';
      statusEl.className = 'transcription-status status-transcribing';
      statusEl.classList.remove('hidden');
      document.getElementById('tech-terms').classList.add('hidden');
      durationInterval = setInterval(() => {
        const secs = Math.round((Date.now() - recordingStartTime) / 1000);
        const m = Math.floor(secs / 60);
        const s = String(secs % 60).padStart(2, '0');
        durationEl.textContent = `${m}:${s}`;
      }, 500);
    } catch (err) {
      statusEl.textContent = '🚫 Microphone access denied — allow it in browser settings';
      statusEl.className = 'transcription-status status-error';
      statusEl.classList.remove('hidden');
      showToast('Microphone access denied. Click the lock icon in the address bar to allow.', 'error');
    }
  }

  function stopRecording() {
    recognitionActive = false;
    clearInterval(durationInterval);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    const btn = document.getElementById('voice-record-btn');
    btn.classList.remove('recording');
    btn.textContent = '🎤 Voice to Text';
    document.getElementById('recording-indicator').classList.add('hidden');
  }

  async function processRecordedAudio(targetFieldId, statusEl) {
    if (audioChunks.length === 0) {
      if (statusEl) {
        statusEl.textContent = '⚠️ No audio recorded — please try again';
        statusEl.className = 'transcription-status status-error';
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = '⏳ Transcribing with Amazon Transcribe...';
      statusEl.className = 'transcription-status status-transcribing';
    }

    try {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const base64 = await webmToPcmBase64(blob);
      const duration = Math.round((Date.now() - recordingStartTime) / 1000) || 1;

      const data = await PortalAPI.transcribeAudio({
        audioData: base64,
        format: 'pcm',
        language: 'en',
        duration: duration,
      });

      const text = data.text || '';
      if (text) {
        document.getElementById(targetFieldId).value = text;
        if (statusEl) {
          statusEl.textContent = '✅ Transcription complete — text added';
          statusEl.className = 'transcription-status status-done';
        }
        // Show tech terms if detected
        if (data.detectedTechnicalTerms && data.detectedTechnicalTerms.length > 0) {
          const termsEl = document.getElementById('tech-terms');
          if (termsEl) {
            termsEl.innerHTML = data.detectedTechnicalTerms.map(t =>
              `<span class="tech-term-tag">${PortalViews.esc(t)}</span>`
            ).join('');
            termsEl.classList.remove('hidden');
          }
        }
      } else {
        if (statusEl) {
          statusEl.textContent = '⚠️ No speech detected — please try again';
          statusEl.className = 'transcription-status status-error';
        }
      }
    } catch (err) {
      console.error('Transcription error:', err);
      if (statusEl) {
        statusEl.textContent = '❌ Transcription failed — ' + (err.message || 'try again');
        statusEl.className = 'transcription-status status-error';
      }
      showToast('Transcription failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Convert a webm audio Blob to 16-bit PCM (16 kHz mono) base64 string.
   * Transcribe Streaming requires raw PCM — this avoids the slow batch API.
   */
  async function webmToPcmBase64(blob) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuf = await blob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    // Take first channel, resample to 16 kHz
    const float32 = decoded.getChannelData(0);
    // Convert float32 [-1,1] to int16
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    // Convert to base64
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    audioCtx.close();
    return btoa(binary);
  }

  function finishRecording() {
    // No-op — handled by processRecordedAudio now
  }

  /* ── Subject Mic (Voice to Subject via Transcribe) ── */

  let subjectMediaRecorder = null;
  let subjectAudioChunks = [];
  let subjectRecActive = false;
  let subjectRecStartTime = null;

  function bindSubjectMic() {
    const btn = document.getElementById('subject-mic-btn');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      btn.disabled = true;
      btn.title = 'Microphone not available';
      return;
    }
    btn.addEventListener('click', () => {
      if (subjectRecActive) { stopSubjectMic(); } else { startSubjectMic(); }
    });
  }

  async function startSubjectMic() {
    const btn = document.getElementById('subject-mic-btn');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      subjectAudioChunks = [];
      subjectRecStartTime = Date.now();
      subjectMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      subjectMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) subjectAudioChunks.push(e.data);
      };

      subjectMediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        btn.classList.remove('recording');
        btn.textContent = '🎤 Voice to Text';

        if (subjectAudioChunks.length === 0) return;
        btn.disabled = true;
        btn.textContent = '⏳ Transcribing...';

        try {
          const blob = new Blob(subjectAudioChunks, { type: 'audio/webm' });
          const base64 = await webmToPcmBase64(blob);
          const duration = Math.round((Date.now() - subjectRecStartTime) / 1000) || 1;
          const data = await PortalAPI.transcribeAudio({
            audioData: base64,
            format: 'pcm',
            language: 'en',
            duration: duration,
          });
          if (data.text) {
            document.getElementById('ticket-subject').value = data.text;
          }
        } catch (err) {
          console.error('Subject transcription error:', err);
          showToast('Transcription failed: ' + (err.message || 'Unknown error'), 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '🎤 Voice to Text';
        }
      };

      subjectMediaRecorder.start();
      subjectRecActive = true;
      btn.classList.add('recording');
      btn.textContent = '⏹ Stop';
    } catch (err) {
      showToast('Microphone access denied', 'error');
    }
  }

  function stopSubjectMic() {
    subjectRecActive = false;
    if (subjectMediaRecorder && subjectMediaRecorder.state !== 'inactive') {
      subjectMediaRecorder.stop();
    }
  }

  /* ── File Upload Wiring ── */

  function bindFileUpload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    PortalFileUpload.onChange(function (result) {
      if (!result.valid) {
        showToast(result.error, 'error');
      }
      renderFileList();
    });

    PortalFileUpload.initDropZone(dropZone, fileInput);
  }

  /* ── Sign Out ── */

  function bindSignOut() {
    document.getElementById('sign-out-btn').addEventListener('click', () => {
      stopAutoRefresh();
      disconnectWebSocket();
      PortalAuth.signOut();
      showAuth();
    });
  }

  /* ── App UI Wiring ── */

  function bindAppUI() {
    // Prevent duplicate binding (e.g., logout → login stacks listeners)
    if (appUIBound) return;
    appUIBound = true;

    // Nav links — active state is handled by showView, but we also listen for clicks
    document.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        // hashchange will handle navigation
      });
    });

    // Status filter
    document.getElementById('filter-status').addEventListener('change', () => {
      const filterStatus = document.getElementById('filter-status').value;
      const container = document.getElementById('ticket-list');
      container.innerHTML = PortalViews.renderTicketList(allTickets, filterStatus);
    });

    // Hash change
    window.addEventListener('hashchange', () => {
      navigate(location.hash);
    });

    bindSignOut();
    bindSubmissionForm();
    bindFileUpload();
    bindVoiceRecord();
    bindSubjectMic();
  }

  /* ── Ticket Timeline (User Portal) ── */

  const USER_ACTIVITY_ICONS = {
    status_change: '🔄',
    message: '💬',
    resolution: '✅',
  };

  const USER_VISIBLE_TYPES = ['status_change', 'message', 'resolution'];

  async function loadUserTicketTimeline(ticketId, lastKey) {
    const container = document.getElementById('ticket-timeline');
    if (!container) return;
    if (!lastKey) {
      container.innerHTML = '<h4>Activity Timeline</h4><p class="loading">Loading timeline...</p>';
    }
    try {
      const data = await PortalAPI.getTicketActivities(ticketId, lastKey);
      const allActivities = data.activities || [];
      // Filter to user-visible types only
      const activities = allActivities.filter(a => USER_VISIBLE_TYPES.includes(a.type));
      if (!activities.length && !lastKey) {
        container.innerHTML = '<h4>Activity Timeline</h4><p class="empty-state">No activity recorded yet.</p>';
        return;
      }
      const html = activities.map(a => {
        const icon = USER_ACTIVITY_ICONS[a.type] || '📌';
        const time = a.createdAt ? new Date(a.createdAt).toLocaleString() : '—';
        const detail = formatUserActivityDetail(a);
        return `<div class="timeline-item">
          <div class="timeline-node">${icon}</div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-type">${a.type.replace(/_/g, ' ')}</span>
              <span class="timeline-time">${time}</span>
            </div>
            <div class="timeline-detail">${detail}</div>
          </div>
        </div>`;
      }).join('');

      if (lastKey) {
        const loadMoreBtn = container.querySelector('.timeline-load-more');
        if (loadMoreBtn) loadMoreBtn.remove();
        container.insertAdjacentHTML('beforeend', html);
      } else {
        container.innerHTML = `<h4>Activity Timeline</h4><div class="timeline-list">${html}</div>`;
      }

      if (data.nextKey) {
        const loadMoreHtml = `<button class="btn btn-outline btn-sm timeline-load-more" style="margin-top:12px;">Load More</button>`;
        container.insertAdjacentHTML('beforeend', loadMoreHtml);
        container.querySelector('.timeline-load-more').addEventListener('click', () => {
          loadUserTicketTimeline(ticketId, data.nextKey);
        });
      }
    } catch (err) {
      if (!lastKey) {
        container.innerHTML = `<h4>Activity Timeline</h4><p class="empty-state">Could not load timeline: ${PortalViews.esc(err.message)}</p>`;
      }
    }
  }

  function formatUserActivityDetail(activity) {
    const d = activity.details || {};
    switch (activity.type) {
      case 'status_change':
        return `Status changed from <strong>${PortalViews.esc(d.oldStatus || '—')}</strong> to <strong>${PortalViews.esc(d.newStatus || '—')}</strong>`;
      case 'message':
        return PortalViews.esc(d.contentPreview || d.content || 'New message');
      case 'resolution':
        return 'Ticket resolved';
      default:
        return '';
    }
  }

  /* ── Satisfaction Rating Widget ── */

  function renderRatingWidget(ticket) {
    const existingRating = ticket.satisfactionRating || 0;
    const existingFeedback = ticket.satisfactionFeedback || '';
    const stars = [1, 2, 3, 4, 5].map(i => {
      const cls = i <= existingRating ? 'rating-star selected' : 'rating-star';
      return `<button type="button" class="${cls}" data-value="${i}" aria-label="Rate ${i} star${i > 1 ? 's' : ''}">⭐</button>`;
    }).join('');

    return `<div class="rating-widget" id="rating-widget">
  <h4>Rate Your Experience</h4>
  <div class="rating-stars" id="rating-stars">${stars}</div>
  <div class="rating-feedback-group">
    <label for="rating-feedback">Feedback (optional)</label>
    <textarea class="rating-feedback" id="rating-feedback" maxlength="500" placeholder="Tell us about your experience...">${PortalViews.esc(existingFeedback)}</textarea>
    <span class="rating-char-counter" id="rating-char-counter">${existingFeedback.length}/500</span>
  </div>
  <div class="rating-actions">
    <button type="button" class="btn btn-primary" id="rating-submit-btn">Submit Rating</button>
  </div>
  <div id="rating-status"></div>
</div>`;
  }

  function bindRatingWidget(ticketId) {
    const starsContainer = document.getElementById('rating-stars');
    const feedbackEl = document.getElementById('rating-feedback');
    const counterEl = document.getElementById('rating-char-counter');
    const submitBtn = document.getElementById('rating-submit-btn');
    const statusEl = document.getElementById('rating-status');
    if (!starsContainer || !submitBtn) return;

    let selectedRating = 0;
    // Read initial rating from already-selected stars
    const initialSelected = starsContainer.querySelectorAll('.rating-star.selected');
    if (initialSelected.length > 0) {
      selectedRating = initialSelected.length;
    }

    // Star click
    starsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.rating-star');
      if (!btn) return;
      selectedRating = Number(btn.dataset.value);
      starsContainer.querySelectorAll('.rating-star').forEach((s) => {
        const v = Number(s.dataset.value);
        s.classList.toggle('selected', v <= selectedRating);
      });
    });

    // Star hover
    starsContainer.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.rating-star');
      if (!btn) return;
      const hoverVal = Number(btn.dataset.value);
      starsContainer.querySelectorAll('.rating-star').forEach((s) => {
        const v = Number(s.dataset.value);
        s.classList.toggle('hovered', v <= hoverVal && !s.classList.contains('selected'));
      });
    });

    starsContainer.addEventListener('mouseleave', () => {
      starsContainer.querySelectorAll('.rating-star').forEach((s) => {
        s.classList.remove('hovered');
      });
    });

    // Feedback character counter
    if (feedbackEl && counterEl) {
      feedbackEl.addEventListener('input', () => {
        const len = feedbackEl.value.length;
        counterEl.textContent = `${len}/500`;
        counterEl.classList.toggle('limit-near', len >= 400 && len < 500);
        counterEl.classList.toggle('limit-reached', len >= 500);
      });
    }

    // Submit
    submitBtn.addEventListener('click', async () => {
      if (selectedRating < 1) {
        statusEl.innerHTML = '<p class="rating-error">Please select a star rating.</p>';
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      statusEl.innerHTML = '';
      try {
        const feedback = feedbackEl ? feedbackEl.value.trim() : '';
        await PortalAPI.rateTicket(ticketId, selectedRating, feedback || undefined);
        statusEl.innerHTML = '<p class="rating-submitted">Thank you for your feedback!</p>';
        showToast('Rating submitted!', 'success');
      } catch (err) {
        statusEl.innerHTML = `<p class="rating-error">${PortalViews.esc(err.message)}</p>`;
        showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Rating';
      }
    });
  }

  /* ── TTS Playback (Amazon Polly via Backend API) ── */

  let currentAudio = null;

  async function playTTS(text, btn) {
    if (!text || !btn) return;
    if (btn.classList.contains('playing') || btn.classList.contains('loading')) return;

    btn.classList.remove('error');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const data = await PortalAPI.textToSpeech({ text, language: 'en' });

      if (!data.url) {
        throw new Error('No audio URL returned');
      }

      // Stop any currently playing audio
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }

      const audio = new Audio(data.url);
      currentAudio = audio;

      btn.classList.remove('loading');
      btn.classList.add('playing');

      audio.onended = () => {
        btn.classList.remove('playing');
        btn.disabled = false;
        currentAudio = null;
      };
      audio.onerror = () => {
        btn.classList.remove('playing');
        btn.classList.add('error');
        btn.disabled = false;
        currentAudio = null;
        showToast('Audio playback failed', 'error');
      };

      audio.play();
    } catch (err) {
      console.error('TTS error:', err);
      btn.classList.remove('loading');
      btn.classList.add('error');
      btn.disabled = false;
      showToast('Text-to-speech failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }

  function bindTTSButtons(container) {
    if (!container) return;
    container.querySelectorAll('.tts-play-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = e.currentTarget.dataset.text;
        if (text) playTTS(text, e.currentTarget);
      });
    });
  }

  /* ── View Original Toggle for Translated Messages ── */

  function bindViewOriginalToggles(container) {
    if (!container) return;
    container.querySelectorAll('.view-original-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const messageItem = btn.closest('.message-item');
        if (!messageItem) return;
        const contentEl = messageItem.querySelector('.message-content');
        if (!contentEl) return;
        const showing = btn.dataset.showing;
        if (showing === 'translated') {
          // Show original English
          const original = contentEl.dataset.original;
          if (original) contentEl.textContent = original;
          btn.textContent = 'View translated';
          btn.dataset.showing = 'original';
        } else {
          // Show translated version
          const translated = contentEl.dataset.translated;
          if (translated) contentEl.textContent = translated;
          btn.textContent = 'View original';
          btn.dataset.showing = 'translated';
        }
      });
    });
  }

  /* ── Init ── */

  function init() {
    bindAuthUI();

    if (PortalAuth.isAuthenticated()) {
      showApp();
      bindAppUI();
      PortalChat.init();
      navigate(location.hash || '#/');
      connectWebSocket();
    } else {
      showAuth();
    }
  }

  /* ── WebSocket Real-time Notifications ── */
  let ws = null, wsReconnectDelay = 1000, wsReconnectTimer = null;

  function connectWebSocket() {
    if (!CONFIG.WS_URL) return;
    const token = PortalAuth.getIdToken();
    if (!token) return;
    try {
      ws = new WebSocket(`${CONFIG.WS_URL}?token=${encodeURIComponent(token)}`);
    } catch (e) { console.warn('[WS] Failed:', e); return; }

    ws.onopen = () => { wsReconnectDelay = 1000; console.log('[WS] Connected'); };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ticket_update') {
          showToast(`Ticket #${(msg.ticketId || '').slice(0, 8)} status: ${msg.status || 'updated'}`, 'info');
          // Refresh ticket list if on list view
          if (location.hash === '#/' || location.hash === '') navigate('#/');
          // Refresh detail if viewing this ticket
          if (location.hash.includes(msg.ticketId)) navigate(location.hash);
        }
        if (msg.type === 'new_message') {
          showToast(`New message on ticket #${(msg.ticketId || '').slice(0, 8)}`, 'info');
          if (location.hash.includes(msg.ticketId)) navigate(location.hash);
        }
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in', wsReconnectDelay, 'ms');
      wsReconnectTimer = setTimeout(() => {
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
        if (PortalAuth.isAuthenticated()) connectWebSocket();
      }, wsReconnectDelay);
    };

    ws.onerror = () => {};
  }

  function disconnectWebSocket() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  return { init, navigate, showToast, playTTS };
})();

document.addEventListener('DOMContentLoaded', () => PortalApp.init());
