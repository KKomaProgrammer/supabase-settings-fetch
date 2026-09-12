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
  if (!configured) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
  }
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean);
  const matched = allowed.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': matched,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) },
  });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request, context.env),
  });
}

export async function onRequestPost(context) {
  return json(context.request, context.env, {
    ok: false,
    accessMode: 2,
    status: 'disabled',
    error: '이 버전은 더 이상 사용할 수 없습니다. 최신 버전으로 업데이트해 주세요.',
  }, 403);
}

export async function onRequest(context) {
  return json(context.request, context.env, {
    ok: false,
    accessMode: 2,
    status: 'disabled',
    error: '이 버전은 더 이상 사용할 수 없습니다.',
  }, 405);
}
