const PortalChat = (() => {
  // State
  let isOpen = false;
  let sessionId = null;
  let messages = [];
  let isTyping = false;

  // Live agent mode state
  let liveAgentMode = false;
  let escalatedTicketId = null;
  let liveAgentPollInterval = null;
  let knownMessageIds = new Set();

  // Generate a unique session ID (client-side)
  function generateSessionId() {
    try {
      if (crypto && crypto.randomUUID) return 'CHAT-' + crypto.randomUUID();
    } catch (e) { /* fallback below */ }
    // Fallback for non-secure contexts (HTTP)
    return 'CHAT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // init(): Create DOM elements — floating chat button + chat window
  function init() {
    // Create floating chat button (bottom-right)
    const btn = document.createElement('button');
    btn.id = 'chat-fab';
    btn.className = 'chat-fab';
    btn.innerHTML = '💬';
    btn.title = 'Chat with AI Assistant';
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);

    // Create chat window container
    const win = document.createElement('div');
    win.id = 'chat-window';
    win.className = 'chat-window';
    win.innerHTML = `
      <div class="chat-header">
        <span class="chat-header-title">🤖 NovaSupport AI</span>
        <button class="chat-close-btn" id="chat-close-btn">✕</button>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-bar" id="chat-input-bar">
        <input type="text" id="chat-input" class="chat-input" placeholder="Type your message..." autocomplete="off">
        <button id="chat-mic-btn" class="chat-mic-btn" title="Voice to Text">🎤</button>
        <button id="chat-send-btn" class="chat-send-btn">Send</button>
      </div>
    `;
    document.body.appendChild(win);

    // Bind events
    document.getElementById('chat-close-btn').addEventListener('click', toggle);
    document.getElementById('chat-send-btn').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    bindChatMic();
  }

  // ── Chat Mic (Speech-to-Text via Transcribe API) ──
  let chatMediaRecorder = null;
  let chatAudioChunks = [];
  let chatRecActive = false;
  let chatRecStartTime = null;

  function bindChatMic() {
    const btn = document.getElementById('chat-mic-btn');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      btn.disabled = true;
      btn.title = 'Microphone not available';
      return;
    }
    btn.addEventListener('click', () => {
      if (chatRecActive) { stopChatMic(); } else { startChatMic(); }
    });
  }

  async function startChatMic() {
    const btn = document.getElementById('chat-mic-btn');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chatAudioChunks = [];
      chatRecStartTime = Date.now();
      chatMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      chatMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chatAudioChunks.push(e.data);
      };

      chatMediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        btn.classList.remove('recording');
        btn.textContent = '🎤';

        if (chatAudioChunks.length === 0) return;
        btn.disabled = true;
        btn.textContent = '⏳';

        try {
          const blob = new Blob(chatAudioChunks, { type: 'audio/webm' });
          const base64 = await chatWebmToPcmBase64(blob);
          const duration = Math.round((Date.now() - chatRecStartTime) / 1000) || 1;
          const data = await PortalAPI.transcribeAudio({
            audioData: base64,
            format: 'pcm',
            language: 'en',
            duration: duration,
          });
          if (data.text) {
            document.getElementById('chat-input').value = data.text;
          }
        } catch (err) {
          console.error('Chat transcription error:', err);
        } finally {
          btn.disabled = false;
          btn.textContent = '🎤';
        }
      };

      chatMediaRecorder.start();
      chatRecActive = true;
      btn.classList.add('recording');
      btn.textContent = '⏹';
    } catch (err) {
      console.error('Chat mic error:', err);
    }
  }

  function stopChatMic() {
    chatRecActive = false;
    if (chatMediaRecorder && chatMediaRecorder.state !== 'inactive') {
      chatMediaRecorder.stop();
    } else {
      const btn = document.getElementById('chat-mic-btn');
      if (btn) { btn.classList.remove('recording'); btn.textContent = '🎤'; }
    }
  }

  function chatBlobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function chatWebmToPcmBase64(blob) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuf = await blob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    const float32 = decoded.getChannelData(0);
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    audioCtx.close();
    return btoa(binary);
  }

  // toggle(): Open/close chat window
  function toggle() {
    isOpen = !isOpen;
    const win = document.getElementById('chat-window');
    const fab = document.getElementById('chat-fab');
    
    if (isOpen) {
      win.classList.add('open');
      fab.classList.add('hidden');
      
      // First open — show greeting and generate session
      if (!sessionId) {
        sessionId = generateSessionId();
        messages = [];
        addAssistantMessage("Hi! I'm NovaSupport AI. How can I help you today?");
      }

      // Resume polling if in live agent mode
      if (liveAgentMode && !liveAgentPollInterval) {
        startLiveAgentPoll();
      }
      
      // Focus input
      setTimeout(() => document.getElementById('chat-input').focus(), 100);
    } else {
      win.classList.remove('open');
      fab.classList.remove('hidden');
      // Pause polling while closed
      stopLiveAgentPoll();
    }
  }

  // sendMessage(): Send user message to API
  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || isTyping) return;

    input.value = '';
    addUserMessage(text);

    // Live agent mode — send via ticket messages API
    if (liveAgentMode && escalatedTicketId) {
      try {
        const email = PortalAuth.getEmail();
        await PortalAPI.addMessage(escalatedTicketId, { content: text, userId: email });
      } catch (err) {
        console.error('Live chat send error:', err);
        addAssistantMessage('Failed to send message. Please try again.');
      }
      return;
    }

    // AI chat mode
    showTyping();

    try {
      const email = PortalAuth.getEmail();
      if (!email) {
        hideTyping();
        addAssistantMessage('You need to be signed in to use the chat. Please refresh and sign in again.');
        return;
      }
      // Ensure sessionId exists
      if (!sessionId) {
        sessionId = generateSessionId();
      }
      const data = await PortalAPI.sendChatMessage({
        message: text,
        sessionId: sessionId,
        userId: email,
        conversationHistory: messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.data)).map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
        action: 'message',
      });
      hideTyping();
      handleResponse(data);
    } catch (err) {
      hideTyping();
      console.error('Chat error:', err);
      const msg = (err && err.message) ? err.message : 'Something went wrong';
      addAssistantMessage('Sorry, ' + msg + '. Please try again or create a ticket manually.');
    }
  }

  // handleResponse(): Display AI response with escalation button and feedback
  function handleResponse(data) {
    const content = data.response || 'No response received.';
    addAssistantMessage(content, data);
  }

  // escalate(): Trigger escalation flow
  async function escalate() {
    // Show confirmation
    if (!confirm('Would you like to connect with a human support agent? A ticket will be created with your chat history.')) {
      return;
    }

    showTyping();

    try {
      const data = await PortalAPI.sendChatMessage({
        message: messages.filter(m => m.role === 'user').pop()?.content || 'Escalation requested',
        sessionId: sessionId,
        userId: PortalAuth.getEmail(),
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
        action: 'escalate',
      });
      hideTyping();

      if (data.escalation) {
        // Switch to live agent mode
        escalatedTicketId = data.escalation.ticketId;
        liveAgentMode = true;

        // Update header
        const headerTitle = document.querySelector('.chat-header-title');
        if (headerTitle) headerTitle.textContent = '👤 Live Agent';

        addAssistantMessage(
          `You're now connected to the ${data.escalation.assignedTeam} team! 🎫\nTicket: ${data.escalation.ticketId}\n\nAn agent will join shortly. You can keep chatting here.`
        );

        // Start polling for agent messages
        startLiveAgentPoll();
      } else {
        addAssistantMessage('Escalation completed. A support agent will follow up with you soon.');
      }
    } catch (err) {
      hideTyping();
      console.error('Escalation error:', err);
      const msg = (err && err.message) ? err.message : 'Escalation failed';
      addAssistantMessage('Sorry, ' + msg + '. Please try creating a ticket manually.');
    }
  }

  // addUserMessage(): Add user message to state and render
  function addUserMessage(content) {
    messages.push({ role: 'user', content, timestamp: new Date().toISOString() });
    renderMessages();
  }

  // addAssistantMessage(): Add assistant message to state and render
  function addAssistantMessage(content, data) {
    messages.push({ role: 'assistant', content, timestamp: new Date().toISOString(), data });
    renderMessages();
  }

  // renderMessages(): Render full message history
  function renderMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    container.innerHTML = messages.map((m, i) => {
      if (m.role === 'user') {
        return `<div class="chat-bubble chat-bubble-user">${esc(m.content)}</div>`;
      } else if (m.role === 'agent') {
        // Live agent message
        return `<div class="chat-bubble chat-bubble-assistant chat-bubble-agent">
          <div class="chat-agent-label">👤 Agent</div>
          <div class="chat-bubble-text">${esc(m.content).replace(/\n/g, '<br>')}</div>
        </div>`;
      } else {
        // Assistant message with optional escalation button and feedback
        let html = `<div class="chat-bubble chat-bubble-assistant">
          <div class="chat-bubble-text">${esc(m.content).replace(/\n/g, '<br>')}<button class="tts-play-btn" data-text="${esc(m.content)}" title="Listen">🔊 Listen</button></div>`;
        
        // Only show escalation and feedback in AI mode, not in live agent mode
        if (!liveAgentMode && i > 0 && !m.data?.escalation) {
          html += `<div class="chat-actions">
            <button class="chat-escalate-btn" data-index="${i}">Not helpful? Connect to team</button>
            <span class="chat-feedback">
              <button class="chat-feedback-btn" data-type="up" data-index="${i}" title="Helpful">👍</button>
              <button class="chat-feedback-btn" data-type="down" data-index="${i}" title="Not helpful">👎</button>
            </span>
          </div>`;
        }
        
        html += `</div>`;
        return html;
      }
    }).join('');

    // Bind escalation buttons
    container.querySelectorAll('.chat-escalate-btn').forEach(btn => {
      btn.addEventListener('click', escalate);
    });

    // Bind feedback buttons
    container.querySelectorAll('.chat-feedback-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        sendFeedback(type);
        // Visual feedback
        e.target.style.opacity = '1';
        e.target.parentElement.querySelectorAll('.chat-feedback-btn').forEach(b => {
          if (b !== e.target) b.style.opacity = '0.3';
        });
      });
    });

    // Bind TTS play buttons
    container.querySelectorAll('.tts-play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = e.currentTarget.dataset.text;
        if (text && typeof PortalApp.playTTS === 'function') {
          PortalApp.playTTS(text, e.currentTarget);
        }
      });
    });

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // showTyping(): Show typing indicator
  function showTyping() {
    isTyping = true;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    // Remove existing typing indicator
    const existing = container.querySelector('.chat-typing');
    if (existing) existing.remove();
    
    const typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  }

  // hideTyping(): Remove typing indicator
  function hideTyping() {
    isTyping = false;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const typing = container.querySelector('.chat-typing');
    if (typing) typing.remove();
  }

  // sendFeedback(): Handle thumbs up/down (log for now)
  function sendFeedback(type) {
    console.log('Chat feedback:', type);
  }

  // startLiveAgentPoll(): Poll for new agent messages on the escalated ticket
  function startLiveAgentPoll() {
    if (liveAgentPollInterval) return;
    liveAgentPollInterval = setInterval(async () => {
      if (!escalatedTicketId) return;
      try {
        const data = await PortalAPI.getMessages(escalatedTicketId);
        const msgs = data.messages || [];
        const myEmail = PortalAuth.getEmail();
        let hasNew = false;
        for (const msg of msgs) {
          if (knownMessageIds.has(msg.messageId)) continue;
          knownMessageIds.add(msg.messageId);
          // Only show messages from the agent (not from the user themselves)
          if (msg.userId && msg.userId !== myEmail) {
            messages.push({ role: 'agent', content: msg.content, timestamp: msg.createdAt });
            hasNew = true;
          }
        }
        if (hasNew) renderMessages();
      } catch (err) {
        console.error('Live agent poll error:', err);
      }
    }, 5000);
  }

  // stopLiveAgentPoll(): Stop polling
  function stopLiveAgentPoll() {
    if (liveAgentPollInterval) {
      clearInterval(liveAgentPollInterval);
      liveAgentPollInterval = null;
    }
  }

  return { init, toggle, sendMessage, escalate, renderMessages, showTyping, hideTyping, sendFeedback };
})();
