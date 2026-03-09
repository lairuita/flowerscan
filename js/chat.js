(function () {
  'use strict';

  if (window.__flowerscanChat) return;
  window.__flowerscanChat = true;

  var history = [];

  function createWidget() {
    var style = document.createElement('style');
    style.textContent = [
      '.fc-toggle{position:fixed;bottom:24px;right:24px;z-index:9999;',
      'background:var(--color-bg,#F5F0EA);border:1px solid var(--color-border,#DDD8CF);',
      'color:var(--color-text,#2C2C2C);font-family:var(--font-body,"Inter",sans-serif);',
      'font-size:11px;letter-spacing:.12em;padding:8px 16px;cursor:pointer;',
      'text-transform:lowercase;transition:background .15s;}',

      '.fc-toggle:hover{background:var(--color-border,#DDD8CF);}',

      '.fc-panel{position:fixed;bottom:68px;right:24px;z-index:9999;width:300px;height:420px;',
      'background:var(--color-bg,#F5F0EA);border:1px solid var(--color-border,#DDD8CF);',
      'display:flex;flex-direction:column;',
      'opacity:0;pointer-events:none;transform:translateY(8px);',
      'transition:opacity .2s ease,transform .2s ease;}',

      '.fc-panel.is-open{opacity:1;pointer-events:auto;transform:translateY(0);}',

      '.fc-header{display:flex;align-items:center;justify-content:space-between;',
      'padding:12px 16px;border-bottom:1px solid var(--color-border,#DDD8CF);flex-shrink:0;}',

      '.fc-header-name{font-family:var(--font-heading,"Cormorant Garamond",serif);',
      'font-size:17px;font-weight:300;letter-spacing:.06em;color:var(--color-text,#2C2C2C);}',

      '.fc-close{background:none;border:none;cursor:pointer;padding:0 2px;font-size:18px;',
      'line-height:1;color:var(--color-muted,#9E9E8F);}',
      '.fc-close:hover{color:var(--color-text,#2C2C2C);}',

      '.fc-messages{flex:1;overflow-y:auto;padding:16px;',
      'display:flex;flex-direction:column;gap:12px;}',

      '.fc-msg{display:flex;flex-direction:column;gap:3px;max-width:92%;}',
      '.fc-msg--bot{align-self:flex-start;}',
      '.fc-msg--user{align-self:flex-end;}',

      '.fc-msg__label{font-size:10px;letter-spacing:.08em;',
      'color:var(--color-muted,#9E9E8F);text-transform:lowercase;}',

      '.fc-msg--bot .fc-msg__text{font-size:13px;line-height:1.6;color:var(--color-text,#2C2C2C);}',
      '.fc-msg--user .fc-msg__text{font-size:13px;line-height:1.6;color:var(--color-muted,#9E9E8F);}',

      '.fc-typing{font-size:20px;color:var(--color-muted,#9E9E8F);align-self:flex-start;',
      'letter-spacing:.2em;line-height:1;}',

      '.fc-input-row{display:flex;border-top:1px solid var(--color-border,#DDD8CF);flex-shrink:0;}',

      '.fc-input{flex:1;border:none;background:transparent;padding:12px 14px;',
      'font-family:var(--font-body,"Inter",sans-serif);font-size:13px;',
      'color:var(--color-text,#2C2C2C);outline:none;}',
      '.fc-input::placeholder{color:var(--color-muted,#9E9E8F);}',

      '.fc-send{background:none;border:none;border-left:1px solid var(--color-border,#DDD8CF);',
      'padding:0 14px;cursor:pointer;color:var(--color-muted,#9E9E8F);font-size:12px;',
      'font-family:var(--font-body,"Inter",sans-serif);letter-spacing:.08em;}',
      '.fc-send:hover{color:var(--color-text,#2C2C2C);}',
      '.fc-send:disabled{opacity:.35;cursor:default;}',

      '@media(max-width:640px){',
      '.fc-panel{width:calc(100vw - 32px);right:16px;bottom:64px;}',
      '.fc-toggle{right:16px;bottom:16px;}}'
    ].join('');
    document.head.appendChild(style);

    // Toggle button
    var toggle = document.createElement('button');
    toggle.className = 'fc-toggle';
    toggle.textContent = 'ask';
    toggle.setAttribute('aria-label', 'Open chat assistant');
    toggle.setAttribute('aria-expanded', 'false');

    // Panel
    var panel = document.createElement('div');
    panel.className = 'fc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with flowerscan');
    panel.innerHTML =
      '<div class="fc-header">' +
        '<span class="fc-header-name">flowerscan</span>' +
        '<button class="fc-close" aria-label="Close chat">&times;</button>' +
      '</div>' +
      '<div class="fc-messages" id="fc-messages" aria-live="polite"></div>' +
      '<div class="fc-input-row">' +
        '<input class="fc-input" id="fc-input" type="text" placeholder="ask anything\u2026" autocomplete="off" />' +
        '<button class="fc-send" id="fc-send">send</button>' +
      '</div>';

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    var messagesEl = panel.querySelector('#fc-messages');
    var input      = panel.querySelector('#fc-input');
    var sendBtn    = panel.querySelector('#fc-send');
    var closeBtn   = panel.querySelector('.fc-close');

    var isOpen    = false;
    var isLoading = false;

    addMessage('bot', 'Hello \u2014 I can help with workshops, the Ikebana Box, or anything else about flowerscan.');

    function togglePanel() {
      isOpen = !isOpen;
      panel.classList.toggle('is-open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) input.focus();
    }

    toggle.addEventListener('click', togglePanel);
    closeBtn.addEventListener('click', togglePanel);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
    sendBtn.addEventListener('click', send);

    function addMessage(role, text) {
      var msg   = document.createElement('div');
      msg.className = 'fc-msg fc-msg--' + role;
      var label = role === 'bot' ? 'flowerscan' : 'you';
      var labelEl = document.createElement('span');
      labelEl.className = 'fc-msg__label';
      labelEl.textContent = label;
      var textEl = document.createElement('span');
      textEl.className = 'fc-msg__text';
      textEl.textContent = text;
      msg.appendChild(labelEl);
      msg.appendChild(textEl);
      messagesEl.appendChild(msg);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      var el = document.createElement('div');
      el.className = 'fc-typing';
      el.id = 'fc-typing';
      el.textContent = '\u00b7\u00b7\u00b7';
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      var el = messagesEl.querySelector('#fc-typing');
      if (el) el.remove();
    }

    function send() {
      var text = input.value.trim();
      if (!text || isLoading) return;
      input.value = '';
      isLoading = true;
      sendBtn.disabled = true;

      addMessage('user', text);
      history.push({ role: 'user', content: text });
      showTyping();

      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          removeTyping();
          var reply = data.reply || data.error || 'Something went wrong. Please email flowerscan.ca@gmail.com.';
          addMessage('bot', reply);
          if (data.reply) history.push({ role: 'assistant', content: data.reply });
        })
        .catch(function () {
          removeTyping();
          addMessage('bot', 'Something went wrong. Please email flowerscan.ca@gmail.com.');
        })
        .finally(function () {
          isLoading = false;
          sendBtn.disabled = false;
          input.focus();
        });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
