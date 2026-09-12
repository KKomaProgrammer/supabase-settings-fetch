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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: false,
    accessMode: 2,
    status: 'disabled',
    error: '이 버전은 더 이상 사용할 수 없습니다. 최신 버전으로 업데이트해 주세요.',
  }), { status: 403, headers: JSON_HEADERS });
}

export async function onRequest() {
  return new Response(JSON.stringify({ ok: false, accessMode: 2, status: 'disabled', error: '이 버전은 더 이상 사용할 수 없습니다.' }), {
    status: 405,
    headers: JSON_HEADERS,
  });
}
