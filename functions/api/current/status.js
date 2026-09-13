const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '300',
};

function accessMode(env) {
  const raw = String(env.EXTENSION_ACCESS_MODE ?? '0').trim();
  if (raw === '1') return 1;
  if (raw === '2') return 2;
  return 0;
}

function requiredUpdate(env) {
  const raw = String(env.REQUIRED_UPDATE_VERSION ?? '').trim();
  if (!raw || raw === '*') return { requiredUpdateVersion: '*', mandatoryUpdateAll: true };
  return /^\d+\.\d+\.\d+$/.test(raw)
    ? { requiredUpdateVersion: raw, mandatoryUpdateAll: false }
    : { requiredUpdateVersion: '*', mandatoryUpdateAll: true };
}

function notice(env) {
  const raw = String(env.CHAT_NOTICE ?? '').trim();
  if (!raw) return null;
  const index = raw.indexOf('|');
  const title = (index >= 0 ? raw.slice(0, index) : '공지').trim().slice(0, 80) || '공지';
  const body = (index >= 0 ? raw.slice(index + 1) : raw).trim().slice(0, 2000);
  return body ? { title, body } : null;
}

function passwordRequired(env) {
  const raw = String(env.ACCESS_PASSWORD_SHA256 ?? '').trim();
  return Boolean(raw && raw !== '*');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const mode = accessMode(context.env);
  const update = requiredUpdate(context.env);
  return new Response(JSON.stringify({
    ok: true,
    accessMode: mode,
    status: mode === 1 ? 'maintenance' : mode === 2 ? 'disabled' : 'normal',
    ...update,
    passwordRequired: passwordRequired(context.env),
    notice: notice(context.env),
  }), { status: 200, headers: JSON_HEADERS });
}

export async function onRequest(context) {
  return new Response(JSON.stringify({ ok: false, error: 'GET 요청만 허용됩니다.' }), {
    status: 405,
    headers: JSON_HEADERS,
  });
}
