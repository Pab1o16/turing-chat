// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { nanoid } from 'nanoid';

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- CORS (Netlify -> Render) ----------
// Usa tu dominio público de Netlify en CORS_ORIGIN, p.ej. https://tuapp.netlify.app
const ORIGIN = process.env.CORS_ORIGIN || 'https://tuapp.netlify.app';

// Importante: si no usas cookies ni auth de navegador en el frontend, deja credentials:false
app.use(
  cors({
    origin: ORIGIN === '*' ? true : ORIGIN,        // refleja el origin si es "*"
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,                             // si lo pones true, NO uses "*"
  })
);

// Respuestas al preflight (OPTIONS) para todas las rutas
app.options(
  '*',
  cors({
    origin: ORIGIN === '*' ? true : ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  })
);

// Body + logs
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// ---------- Basic Auth (opcional) ----------
const BASIC_USER = process.env.BASIC_AUTH_USER || null;
const BASIC_PASS = process.env.BASIC_AUTH_PASS || null;
function requireBasicAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();
  const header = req.headers.authorization || '';
  const [type, b64] = header.split(' ');
  if (type !== 'Basic' || !b64)
    return res.status(401).set('WWW-Authenticate', 'Basic').send('Auth requerida');
  const [u, p] = Buffer.from(b64, 'base64').toString().split(':');
  if (u === BASIC_USER && p === BASIC_PASS) return next();
  return res.status(401).set('WWW-Authenticate', 'Basic').send('Credenciales inválidas');
}

// ---------- Memoria en RAM ----------
/**
 * sessions Map: id -> {
 *   id, condition: 'AI'|'human', createdAt, messages: [{i,role:'user'|'ai'|'human',text,t}],
 *   awaitingOperator: boolean
 * }
 */
const sessions = new Map();
let globalIndex = 0;

function createSession(mode = process.env.SESSION_MODE || 'mixed') {
  const id = nanoid(10);
  const pick =
    mode.toUpperCase() === 'AI'
      ? 'AI'
      : mode.toUpperCase() === 'HUMAN'
      ? 'human'
      : Math.random() < 0.5
      ? 'AI'
      : 'human';

  const s = {
    id,
    condition: pick,
    createdAt: new Date().toISOString(),
    messages: [],
    awaitingOperator: false,
  };
  sessions.set(id, s);
  return s;
}

function pushMessage(session, role, text) {
  const msg = { i: ++globalIndex, role, text, t: new Date().toISOString() };
  session.messages.push(msg);
  return msg;
}

function isAwaitingOperator(session) {
  if (session.condition !== 'human') return false;
  const last = session.messages[session.messages.length - 1];
  return !!last && last.role === 'user';
}

// ---------- IA (Gemini) ----------
async function askGemini(prompt, history = []) {
  if (!process.env.GEMINI_API_KEY) {
    return `🧪 (Stub IA) Me pediste: "${prompt}". Configura GEMINI_API_KEY para usar Gemini.`;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' +
    apiKey;

  const contents = [
    ...history.map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini HTTP ${r.status}: ${txt}`);
  }
  const data = await r.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No obtuve respuesta del modelo.';
  return text;
}

// ---------- Helpers ----------
const getSid = (req) =>
  req.query.sessionId ||
  req.query.session ||
  (req.body && (req.body.sessionId || req.body.session));

// ---------- Rutas públicas ----------
app.get('/', (req, res) => res.send('pong'));

// Crear sesión (permite ?mode=AI|HUMAN para pruebas)
app.post('/api/session', (req, res) => {
  const mode = (req.query.mode || process.env.SESSION_MODE || 'mixed').toString();
  const s = createSession(mode);
  res.json({ sessionId: s.id, condition: s.condition });
});

// Enviar mensaje desde el cliente
app.post('/api/chat', async (req, res) => {
  try {
    const sessionId = getSid(req);
    const { text } = req.body || {};
    if (!sessionId || !text)
      return res.status(400).json({ error: 'sessionId y text son requeridos' });

    const s = sessions.get(sessionId);
    if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });

    pushMessage(s, 'user', String(text).slice(0, 2000));

    if (s.condition === 'AI') {
      const history = s.messages.filter((m) => m.role !== 'ai');
      const reply = await askGemini(text, history);
      pushMessage(s, 'ai', reply);
      return res.json({ reply, queued: false });
    } else {
      s.awaitingOperator = true;
      return res.json({ queued: true });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error procesando el mensaje' });
  }
});

// Poll de mensajes nuevos
app.get('/api/messages', (req, res) => {
  const sessionId = getSid(req);
  const a = Number(req.query.after || 0);
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  const news = s.messages.filter((m) => m.i > a);
  res.json({
    items: news,
    awaitingOperator: isAwaitingOperator(s),
  });
});

// Debrief
app.get('/debrief/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({
    sessionId: s.id,
    condition: s.condition,
    createdAt: s.createdAt,
    transcript: s.messages,
  });
});

// Export
app.get('/export', requireBasicAuth, (req, res) => {
  const all = [...sessions.values()];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="sessions.json"`);
  res.send(JSON.stringify(all, null, 2));
});

// ---------- Panel de operador ----------
app.use(
  '/operator',
  requireBasicAuth,
  express.static(path.join(process.cwd(), 'public'), { index: 'operator.html' })
);
app.use('/api/operator', requireBasicAuth);

// Inbox
app.get('/api/operator/inbox', (req, res) => {
  const items = [];
  for (const s of sessions.values()) {
    if (s.condition !== 'human') continue;
    if (isAwaitingOperator(s)) {
      const lastUser = [...s.messages].reverse().find((m) => m.role === 'user');
      items.push({
        sessionId: s.id,
        lastUserText: lastUser?.text || '',
        lastAt: lastUser?.t || s.createdAt,
      });
    }
  }
  items.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  res.json({ items });
});

// Ver transcript
app.get('/api/operator/messages', (req, res) => {
  const { sessionId } = req.query;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  res.json({ sessionId: s.id, messages: s.messages, condition: s.condition });
});

// Respuesta del operador
app.post('/api/operator/reply', (req, res) => {
  const { sessionId, text } = req.body || {};
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada' });
  if (s.condition !== 'human') return res.status(400).json({ error: 'La sesión no es humana' });
  if (!text) return res.status(400).json({ error: 'Texto requerido' });
  pushMessage(s, 'human', String(text).slice(0, 2000));
  s.awaitingOperator = false;
  res.json({ ok: true });
});

// ---------- Debug opcional ----------
app.get('/api/_debug/sessions', (req, res) => {
  res.json(
    Array.from(sessions.values()).map((s) => ({
      id: s.id,
      condition: s.condition,
      msgs: s.messages.length,
      awaitingOperator: s.awaitingOperator,
    }))
  );
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log(`Backend on http://localhost:${PORT}`);
});
