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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const mode = accessMode(context.env);
  return new Response(JSON.stringify({
    ok: true,
    accessMode: mode,
    status: mode === 1 ? 'maintenance' : mode === 2 ? 'disabled' : 'normal',
  }), { status: 200, headers: JSON_HEADERS });
}

export async function onRequest(context) {
  return new Response(JSON.stringify({ ok: false, error: 'GET 요청만 허용됩니다.' }), {
    status: 405,
    headers: JSON_HEADERS,
  });
}
