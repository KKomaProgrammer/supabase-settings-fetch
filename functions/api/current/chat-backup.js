const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const TTL_SECONDS = 48 * 60 * 60;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGINS || '').trim();
  const base = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (!configured) return { ...base, 'Access-Control-Allow-Origin': '*' };
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean);
  return { ...base, 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null', 'Vary': 'Origin' };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...corsHeaders(request, env) } });
}

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))));
}

async function sha256Hex(value) {
  return [...await sha256Bytes(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function encryptionKey(secret) {
  const raw = await sha256Bytes(secret);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
}

async function encryptJson(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { v: 1, alg: 'AES-256-GCM', iv: bytesToBase64(iv), data: bytesToBase64(encrypted) };
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const text = String(message.text || '').slice(0, 2000);
  const imageName = String(message.imageName || '').slice(0, 120);
  return {
    id: String(message.id || '').slice(0, 180),
    scope: String(message.scope || '').slice(0, 16),
    roomCode: String(message.roomCode || '').slice(0, 64),
    from: String(message.from || '').slice(0, 180),
    fromName: String(message.fromName || '').slice(0, 48),
    to: message.to == null ? null : String(message.to).slice(0, 180),
    text,
    imageName,
    deleted: Boolean(message.deleted),
    deletedAt: Number(message.deletedAt || 0),
    at: Number(message.at || Date.now()),
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request, context.env) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.CHAT_BACKUP_KV) return json(request, env, { ok: false, error: 'CHAT_BACKUP_KV 바인딩이 없습니다.' }, 503);
  const secret = String(env.CHAT_BACKUP_ENCRYPTION_KEY || '').trim();
  if (!secret || secret.length < 24) return json(request, env, { ok: false, error: 'CHAT_BACKUP_ENCRYPTION_KEY를 24자 이상으로 설정하세요.' }, 503);

  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) return json(request, env, { ok: false, error: 'JSON 요청만 허용됩니다.' }, 415);

  let body;
  try { body = await request.json(); } catch (_) { return json(request, env, { ok: false, error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const clientId = String(body?.clientId || '').slice(0, 180);
  const messages = (Array.isArray(body?.messages) ? body.messages : []).slice(0, 40).map(sanitizeMessage).filter(Boolean);
  if (!clientId || !messages.length) return json(request, env, { ok: false, error: '백업할 메시지가 없습니다.' }, 400);

  const now = Date.now();
  const clientHash = (await sha256Hex(clientId)).slice(0, 32);
  const payload = await encryptJson({ version: 1, clientHash, savedAt: now, expiresAt: now + TTL_SECONDS * 1000, messages }, secret);
  const key = `chat-backup/${clientHash}/${now}-${crypto.randomUUID()}.json`;
  await env.CHAT_BACKUP_KV.put(key, JSON.stringify(payload), { expirationTtl: TTL_SECONDS });
  return json(request, env, { ok: true, saved: messages.length, expiresInSeconds: TTL_SECONDS });
}

export async function onRequest(context) {
  return json(context.request, context.env, { ok: false, error: 'POST 요청만 허용됩니다.' }, 405);
}
