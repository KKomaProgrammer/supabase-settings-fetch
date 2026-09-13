const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const REPO_RAW = 'https://raw.githubusercontent.com/KKomaProgrammer/codingdongari/main/';
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;

function json(body, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': cacheControl },
  });
}

function validVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.UPDATE_PACKAGE_KV) {
    return json({ ok: false, error: 'UPDATE_PACKAGE_KV 바인딩이 없습니다.' }, 503);
  }

  const url = new URL(request.url);
  const version = validVersion(url.searchParams.get('version'));
  if (!version) return json({ ok: false, error: 'version은 x.y.z 형식이어야 합니다.' }, 400);

  const filename = `message_V${version}.zip`;
  const cacheKey = `update-package:v1:${version}`;
  const cached = await env.UPDATE_PACKAGE_KV.get(cacheKey, 'json');
  if (cached?.version === version && cached?.filename === filename && cached?.packageBase64 && cached?.sha256) {
    return json({ ok: true, cached: true, ...cached }, 200, 'public, max-age=31536000, immutable');
  }

  const sourceUrl = `${REPO_RAW}${encodeURIComponent(filename)}`;
  let response;
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/zip,application/octet-stream;q=0.9,*/*;q=0.1' },
    });
  } catch (_) {
    return json({ ok: false, error: 'GitHub 업데이트 패키지에 연결할 수 없습니다.' }, 502);
  }
  if (!response.ok) return json({ ok: false, error: `업데이트 패키지를 찾을 수 없습니다. (${response.status})` }, 404);

  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_PACKAGE_BYTES) {
    return json({ ok: false, error: '업데이트 패키지 크기가 올바르지 않습니다.' }, 502);
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return json({ ok: false, error: '업데이트 패키지가 ZIP 형식이 아닙니다.' }, 502);
  }

  const packageBase64 = bytesToBase64(bytes);
  const sha256 = await sha256Hex(buffer);
  const payload = {
    version,
    filename,
    sha256,
    size: bytes.byteLength,
    packageBase64,
    fetchedAt: Date.now(),
  };
  await env.UPDATE_PACKAGE_KV.put(cacheKey, JSON.stringify(payload));

  return json({ ok: true, cached: false, ...payload }, 200, 'public, max-age=31536000, immutable');
}

export async function onRequest(context) {
  return json({ ok: false, error: 'GET 요청만 허용됩니다.' }, 405);
}
