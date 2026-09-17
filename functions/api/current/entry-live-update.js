const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function compareVersions(a, b) {
  const left = String(a || '').split('.').map((value) => Number(value) || 0);
  const right = String(b || '').split('.').map((value) => Number(value) || 0);
  const count = Math.max(left.length, right.length, 3);
  for (let index = 0; index < count; index += 1) {
    const l = left[index] || 0;
    const r = right[index] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

function getUpdateConfig(env, currentVersion) {
  const version = String(env.ENTRY_LIVE_UPDATE_VERSION || '').trim();
  const packageUrl = String(env.ENTRY_LIVE_UPDATE_URL || '').trim();
  const sha256 = String(env.ENTRY_LIVE_UPDATE_SHA256 || '').trim().toLowerCase();

  if (!version || !packageUrl || !sha256) {
    return { ok: true, updateAvailable: false };
  }
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) {
    throw new Error('ENTRY_LIVE_UPDATE_VERSION 형식이 올바르지 않습니다.');
  }
  let parsed;
  try { parsed = new URL(packageUrl); }
  catch (_) { throw new Error('ENTRY_LIVE_UPDATE_URL이 올바른 URL이 아닙니다.'); }
  if (parsed.protocol !== 'https:') {
    throw new Error('ENTRY_LIVE_UPDATE_URL은 https URL이어야 합니다.');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('ENTRY_LIVE_UPDATE_SHA256은 64자리 SHA-256이어야 합니다.');
  }

  return {
    ok: true,
    updateAvailable: compareVersions(currentVersion, version) < 0,
    version,
    packageUrl,
    sha256,
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  const current = new URL(context.request.url).searchParams.get('current') || '0.0.0';
  try {
    return json(getUpdateConfig(context.env, current));
  } catch (error) {
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
}

export async function onRequest(context) {
  return json({ ok: false, error: 'GET 요청만 허용됩니다.' }, 405);
}
