const inboxEl = document.getElementById('inbox');
const chatEl = document.getElementById('chat');
const replyForm = document.getElementById('replyForm');
const replyText = document.getElementById('replyText');

let currentSessionId = null;

async function loadInbox() {
  try {
    const r = await fetch('/api/operator/inbox');
    const { items } = await r.json();
    inboxEl.innerHTML = '';
    if (!items.length) {
      inboxEl.innerHTML = '<p>Sin pendientes por ahora…</p>';
      return;
    }
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = `(${new Date(item.lastAt).toLocaleTimeString()}) ${item.sessionId} → ${item.lastUserText}`;
      btn.onclick = () => openSession(item.sessionId);
      inboxEl.appendChild(btn);
    });
  } catch (e) {
    console.error(e);
  }
}

async function openSession(sessionId) {
  currentSessionId = sessionId;
  await renderChat();
}

async function renderChat() {
  if (!currentSessionId) return;
  const r = await fetch(`/api/operator/messages?sessionId=${encodeURIComponent(currentSessionId)}`);
  const data = await r.json();
  chatEl.innerHTML = '';
  data.messages.forEach(m => {
    const div = document.createElement('div');
    div.className = `msg ${m.role}`;
    div.textContent = `${m.role.toUpperCase()}: ${m.text}`;
    chatEl.appendChild(div);
  });
  chatEl.scrollTop = chatEl.scrollHeight;
}

replyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSessionId) return alert('Elige una sesión en la bandeja');
  const text = replyText.value.trim();
  if (!text) return;
  await fetch('/api/operator/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: currentSessionId, text })
  });
  replyText.value = '';
  await renderChat();
  loadInbox();
});

loadInbox();
setInterval(loadInbox, 2000);
setInterval(renderChat, 1500);
