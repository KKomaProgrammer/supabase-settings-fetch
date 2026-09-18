const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGINS || '').trim();
  if (!configured) return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...corsHeaders(request, env) } });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch (_) { return null; }
}

function validateSupabaseConfig(url, key) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { return 'SUPABASE_URL이 올바른 URL이 아닙니다.'; }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) return 'SUPABASE_URL은 https://*.supabase.co 형식이어야 합니다.';
  if (!key) return 'SUPABASE_ANON_KEY가 비어 있습니다.';
  if (key.startsWith('sb_secret_')) return 'Secret key는 반환할 수 없습니다. Publishable key 또는 anon key를 사용하세요.';
  if (key.startsWith('sb_publishable_')) return null;
  const payload = decodeJwtPayload(key);
  if (!payload) return 'SUPABASE_ANON_KEY 형식을 확인하세요.';
  if (payload.role && payload.role !== 'anon') return `브라우저용 anon key가 아닙니다(role=${payload.role}).`;
  return null;
}

function accessMode(env) {
  const raw = String(env.EXTENSION_ACCESS_MODE ?? '0').trim();
  if (raw === '1') return 1;
  if (raw === '2') return 2;
  return 0;
}

function passwordHash(env) {
  const raw = String(env.ACCESS_PASSWORD_SHA256 ?? '').trim();
  return raw && raw !== '*' ? raw : '';
}

function mandatoryUpdate(env) {
  return String(env.MANDATORY_UPDATE ?? '0').trim() === '1';
}

function notice(env) {
  const raw = String(env.CHAT_NOTICE ?? '').trim();
  if (!raw) return null;
  const index = raw.indexOf('|');
  const title = (index >= 0 ? raw.slice(0, index) : '공지').trim().slice(0, 80) || '공지';
  const body = (index >= 0 ? raw.slice(index + 1) : raw).trim().slice(0, 2000);
  return body ? { title, body } : null;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request, context.env) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const mode = accessMode(env);
  const mandatory = mandatoryUpdate(env);
  const legacyUpdate = { requiredUpdateVersion: mandatory ? '*' : '', mandatoryUpdateAll: mandatory };
  if (mode === 1) return json(request, env, { ok: false, accessMode: 1, status: 'maintenance', error: '점검중', mandatoryUpdate: mandatory, ...legacyUpdate }, 503);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json(request, env, { ok: false, accessMode: 0, error: '서버 환경변수 설정이 완료되지 않았습니다.' }, 503);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json(request, env, { ok: false, accessMode: 0, error: 'JSON 요청만 허용됩니다.' }, 400); }

  const requiredHash = passwordHash(env);
  if (requiredHash) {
    const password = typeof payload?.password === 'string' ? payload.password.toLowerCase() : '';
    if (!password || password.length > 256) return json(request, env, { ok: false, accessMode: 0, error: '비밀번호를 입력하세요.' }, 400);
    const actualHash = await sha256Hex(password);
    if (!constantTimeEqual(actualHash, requiredHash)) return json(request, env, { ok: false, accessMode: 0, error: '비밀번호가 올바르지 않습니다.' }, 401);
  }

  const configError = validateSupabaseConfig(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  if (configError) return json(request, env, { ok: false, accessMode: 0, error: configError }, 500);

  return json(request, env, {
    ok: true,
    accessMode: 0,
    serverUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    passwordRequired: Boolean(requiredHash),
    mandatoryUpdate: mandatory,
    ...legacyUpdate,
    notice: notice(env),
  });
}

export async function onRequest(context) {
  return json(context.request, context.env, { ok: false, error: 'POST 요청만 허용됩니다.' }, 405);
}
