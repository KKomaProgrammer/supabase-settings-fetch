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
  const base = {
    'Access-Control-Allow-Methods': 'PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Backup-Token',
    'Access-Control-Max-Age': '86400',
  };
  if (!configured) return { ...base, 'Access-Control-Allow-Origin': '*' };
  const allowed = configured.split(',').map((value) => value.trim()).filter(Boolean);
  return { ...base, 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null', 'Vary': 'Origin' };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) },
  });
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

const validBackupId = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));
const validRecordId = (value) => /^[A-Za-z0-9._:-]{1,180}$/.test(String(value || ''));
const validEnvelope = (value) =>
  value && value.v === 1 &&
  typeof value.iv === 'string' && value.iv.length >= 12 && value.iv.length <= 64 &&
  typeof value.data === 'string' && value.data.length > 0 && value.data.length <= 1600000;

const metaKey = (id) => `chat-backups/${id}/meta.json`;
const recordsPrefix = (id) => `chat-backups/${id}/records/`;
const recordKey = (id, recordId) => `${recordsPrefix(id)}${recordId}.json`;

async function readJsonObject(bucket, key) {
  const object = await bucket.get(key);
  if (!object) return null;
  try { return await object.json(); } catch (_) { return null; }
}

async function requireAuthorizedMeta(request, env, backupId) {
  const meta = await readJsonObject(env.CHAT_BACKUP_BUCKET, metaKey(backupId));
  if (!meta?.tokenHash) return { error: json(request, env, { ok: false, error: '클라우드 백업을 찾을 수 없습니다.' }, 404) };
  const token = request.headers.get('X-Backup-Token') || '';
  const actual = await sha256Hex(token);
  if (!constantTimeEqual(actual, meta.tokenHash)) {
    return { error: json(request, env, { ok: false, error: '복구 코드 인증에 실패했습니다.' }, 401) };
  }
  return { meta };
}

async function listAll(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
    if (objects.length > 20000) throw new Error('백업 항목이 너무 많습니다.');
  } while (cursor);
  return objects;
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request, context.env) });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.CHAT_BACKUP_BUCKET) return json(request, env, { ok: false, error: 'CHAT_BACKUP_BUCKET R2 바인딩이 없습니다.' }, 503);

  let body;
  try { body = await request.json(); } catch (_) { return json(request, env, { ok: false, error: 'JSON 요청만 허용됩니다.' }, 400); }
  const backupId = String(body?.backupId || '');
  if (!validBackupId(backupId)) return json(request, env, { ok: false, error: 'backupId 형식이 올바르지 않습니다.' }, 400);
  if (!validEnvelope(body?.payload)) return json(request, env, { ok: false, error: '암호화 백업 데이터 형식이 올바르지 않습니다.' }, 400);

  const token = request.headers.get('X-Backup-Token') || '';
  if (!/^[a-f0-9]{64}$/i.test(token)) return json(request, env, { ok: false, error: '백업 인증 토큰이 없습니다.' }, 401);
  const tokenHash = await sha256Hex(token);

  if (body.action === 'meta') {
    const existing = await readJsonObject(env.CHAT_BACKUP_BUCKET, metaKey(backupId));
    if (existing?.tokenHash && !constantTimeEqual(existing.tokenHash, tokenHash)) {
      return json(request, env, { ok: false, error: '복구 코드 인증에 실패했습니다.' }, 401);
    }
    await env.CHAT_BACKUP_BUCKET.put(metaKey(backupId), JSON.stringify({
      version: 1,
      tokenHash,
      payload: body.payload,
      updatedAt: Date.now(),
    }), { httpMetadata: { contentType: 'application/json' } });
    return json(request, env, { ok: true });
  }

  if (body.action === 'record') {
    const auth = await requireAuthorizedMeta(request, env, backupId);
    if (auth.error) return auth.error;
    const recordId = String(body.recordId || '');
    if (!validRecordId(recordId)) return json(request, env, { ok: false, error: 'recordId 형식이 올바르지 않습니다.' }, 400);
    await env.CHAT_BACKUP_BUCKET.put(recordKey(backupId, recordId), JSON.stringify({
      version: 1,
      payload: body.payload,
      updatedAt: Date.now(),
    }), { httpMetadata: { contentType: 'application/json' } });
    return json(request, env, { ok: true });
  }

  return json(request, env, { ok: false, error: '지원하지 않는 백업 저장 작업입니다.' }, 400);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.CHAT_BACKUP_BUCKET) return json(request, env, { ok: false, error: 'CHAT_BACKUP_BUCKET R2 바인딩이 없습니다.' }, 503);
  let body;
  try { body = await request.json(); } catch (_) { return json(request, env, { ok: false, error: 'JSON 요청만 허용됩니다.' }, 400); }
  const backupId = String(body?.backupId || '');
  if (body?.action !== 'read' || !validBackupId(backupId)) {
    return json(request, env, { ok: false, error: '백업 읽기 요청 형식이 올바르지 않습니다.' }, 400);
  }
  const auth = await requireAuthorizedMeta(request, env, backupId);
  if (auth.error) return auth.error;

  const objects = await listAll(env.CHAT_BACKUP_BUCKET, recordsPrefix(backupId));
  const records = [];
  for (const object of objects) {
    const item = await readJsonObject(env.CHAT_BACKUP_BUCKET, object.key);
    if (item?.payload) records.push({ key: object.key, payload: item.payload, updatedAt: item.updatedAt || 0 });
  }

  return json(request, env, {
    ok: true,
    meta: auth.meta.payload,
    records,
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.CHAT_BACKUP_BUCKET) return json(request, env, { ok: false, error: 'CHAT_BACKUP_BUCKET R2 바인딩이 없습니다.' }, 503);
  let body;
  try { body = await request.json(); } catch (_) { return json(request, env, { ok: false, error: 'JSON 요청만 허용됩니다.' }, 400); }
  const backupId = String(body?.backupId || '');
  if (!validBackupId(backupId)) return json(request, env, { ok: false, error: 'backupId 형식이 올바르지 않습니다.' }, 400);
  const auth = await requireAuthorizedMeta(request, env, backupId);
  if (auth.error) return auth.error;

  const objects = await listAll(env.CHAT_BACKUP_BUCKET, `chat-backups/${backupId}/`);
  const keys = objects.map((item) => item.key);
  for (let i = 0; i < keys.length; i += 500) await env.CHAT_BACKUP_BUCKET.delete(keys.slice(i, i + 500));
  return json(request, env, { ok: true, deleted: keys.length });
}

export async function onRequest(context) {
  return json(context.request, context.env, { ok: false, error: '지원하지 않는 요청입니다.' }, 405);
}
