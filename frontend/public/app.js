// ⚠️ Cambia esto por tu URL pública del backend en Render:
const API_BASE = "https://turing-mini-ggup.onrender.com";

const chatEl = document.getElementById('chat');
const form = document.getElementById('form');
const input = document.getElementById('input');
const typingEl = document.getElementById('typing');
const btnDebrief = document.getElementById('btnDebrief');

let sessionId = null;
let lastIndex = 0; // último i recibido

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setTyping(v) {
  typingEl.classList.toggle('hidden', !v);
}

async function startSession() {
  const r = await fetch(`${API_BASE}/api/session`, { method: 'POST' });
  const data = await r.json();
  sessionId = data.sessionId;
}

async function poll() {
  if (!sessionId) return;
  const r = await fetch(`${API_BASE}/api/messages?sessionId=${encodeURIComponent(sessionId)}&after=${lastIndex}`);
  const data = await r.json();
  const items = data.items || [];
  if (data.awaitingOperator) {
    setTyping(true);
  } else {
    setTyping(false);
  }
  items.forEach(m => {
    lastIndex = Math.max(lastIndex, m.i);
    if (m.role === 'user') return;
    addMsg('bot', m.text);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMsg('user', text);
  input.value = '';
  setTyping(true);

  const r = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text })
  });
  const data = await r.json();

  if (data.queued) {
  } else if (data.reply) {
    addMsg('bot', data.reply);
  } else if (data.error) {
    addMsg('bot', '⚠️ Error: ' + data.error);
  }
  setTyping(false);
});

btnDebrief.addEventListener('click', async () => {
  if (!sessionId) return;
  const r = await fetch(`${API_BASE}/debrief/${encodeURIComponent(sessionId)}`);
  const data = await r.json();
  if (data.error) return alert(data.error);
  const who = data.condition === 'AI' ? '🤖 IA' : '👤 Humano';
  alert(`Debrief:\nCondición: ${who}\nMensajes: ${data.transcript.length}`);
});

startSession().then(() => {
  poll();
  setInterval(poll, 2000);
});
