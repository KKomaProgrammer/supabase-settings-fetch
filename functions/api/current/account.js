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
  const allowed = configured.split(',').map((v) => v.trim()).filter(Boolean);
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

function cleanText(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function nickname(value) {
  return cleanText(value, 24).replace(/\s+/g, ' ');
}

function nicknameNormalized(value) {
  return nickname(value).normalize('NFKC').toLocaleLowerCase('ko-KR');
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function validHash(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function validRoomCode(value) {
  return /^\d{4}$/.test(String(value || ''));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomAccountCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  const body = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `ELS-${body}`;
}

function requestIp(request) {
  return cleanText(request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0] || '', 80);
}

async function ipHash(request, env) {
  const ip = requestIp(request);
  if (!ip) return null;
  const salt = String(env.DEVICE_IP_HASH_SALT || '').trim();
  return sha256Hex(`entry-live-studio:${salt}:${ip}`);
}

function config(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error('SUPABASE_URL 설정이 올바르지 않습니다.');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  return { url, serviceKey };
}

async function supabase(env, path, { method = 'GET', body, prefer = '' } = {}) {
  const { url, serviceKey } = config(env);
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try { parsed = await response.json(); } catch (_) { parsed = null; }
  if (!response.ok) {
    const error = new Error(parsed?.message || parsed?.hint || `Supabase 요청 실패(HTTP ${response.status})`);
    error.status = response.status;
    error.code = parsed?.code || '';
    throw error;
  }
  return parsed;
}

async function findDevice(env, fingerprintHash) {
  const rows = await supabase(env, `entry_chat_account_devices?select=fingerprint_hash,account_id&fingerprint_hash=eq.${encodeURIComponent(fingerprintHash)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function requireDeviceAccount(env, fingerprintHash, accountId) {
  if (!validHash(fingerprintHash) || !validUuid(accountId)) throw Object.assign(new Error('계정 확인 정보가 올바르지 않습니다.'), { httpStatus: 400 });
  const row = await findDevice(env, fingerprintHash);
  if (!row || row.account_id !== accountId) throw Object.assign(new Error('현재 기기와 계정 정보가 일치하지 않습니다.'), { httpStatus: 403 });
  return row;
}

async function findAccountById(env, accountId) {
  const rows = await supabase(env, `entry_chat_accounts?select=id,nickname,nickname_normalized,avatar_data_url,created_at&id=eq.${encodeURIComponent(accountId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function nicknameOwner(env, normalized) {
  const rows = await supabase(env, `entry_chat_accounts?select=id,nickname&nickname_normalized=eq.${encodeURIComponent(normalized)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function bindDevice(env, request, fingerprintHash, accountId) {
  const existing = await findDevice(env, fingerprintHash);
  if (existing && existing.account_id !== accountId) {
    throw Object.assign(new Error('이 기기에는 이미 다른 계정이 등록되어 있습니다. 기존 계정을 사용하거나 먼저 계정을 탈퇴하세요.'), { httpStatus: 409, code: 'DEVICE_ALREADY_BOUND' });
  }
  const now = new Date().toISOString();
  const payload = { fingerprint_hash: fingerprintHash, account_id: accountId, ip_hash: await ipHash(request, env), last_seen_at: now };
  if (existing) {
    await supabase(env, `entry_chat_account_devices?fingerprint_hash=eq.${encodeURIComponent(fingerprintHash)}`, { method: 'PATCH', body: payload, prefer: 'return=minimal' });
  } else {
    await supabase(env, 'entry_chat_account_devices', { method: 'POST', body: payload, prefer: 'return=minimal' });
  }
}

async function registerAccount(request, env, payload) {
  const accountId = cleanText(payload.accountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  const displayName = nickname(payload.nickname);
  const normalized = nicknameNormalized(displayName);
  if (!validUuid(accountId) || !validHash(fingerprintHash) || !displayName || !normalized) throw Object.assign(new Error('계정 생성 정보가 올바르지 않습니다.'), { httpStatus: 400 });

  const device = await findDevice(env, fingerprintHash);
  if (device && device.account_id !== accountId) throw Object.assign(new Error('이 기기에는 이미 다른 계정이 등록되어 있습니다.'), { httpStatus: 409, code: 'DEVICE_ALREADY_BOUND' });

  const owner = await nicknameOwner(env, normalized);
  if (owner && owner.id !== accountId) throw Object.assign(new Error('이미 사용 중인 닉네임입니다.'), { httpStatus: 409, code: 'NICKNAME_TAKEN' });

  let account = await findAccountById(env, accountId);
  let accountCode = '';
  if (!account) {
    accountCode = randomAccountCode();
    const codeHash = await sha256Hex(accountCode);
    const rows = await supabase(env, 'entry_chat_accounts?select=id,nickname,nickname_normalized,avatar_data_url,created_at', {
      method: 'POST',
      body: {
        id: accountId,
        nickname: displayName,
        nickname_normalized: normalized,
        account_code_hash: codeHash,
        avatar_data_url: cleanText(payload.avatarDataUrl || '', 70000),
      },
      prefer: 'return=representation',
    });
    account = Array.isArray(rows) ? rows[0] : null;
  } else if (account.nickname_normalized !== normalized || account.nickname !== displayName) {
    const rows = await supabase(env, `entry_chat_accounts?id=eq.${encodeURIComponent(accountId)}&select=id,nickname,nickname_normalized,avatar_data_url,created_at`, {
      method: 'PATCH', body: { nickname: displayName, nickname_normalized: normalized, updated_at: new Date().toISOString() }, prefer: 'return=representation',
    });
    account = Array.isArray(rows) ? rows[0] : account;
  }
  await bindDevice(env, request, fingerprintHash, accountId);
  return { account, accountCode };
}

async function updateName(request, env, payload) {
  const accountId = cleanText(payload.accountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  const displayName = nickname(payload.nickname);
  const normalized = nicknameNormalized(displayName);
  await requireDeviceAccount(env, fingerprintHash, accountId);
  if (!displayName) throw Object.assign(new Error('닉네임을 입력하세요.'), { httpStatus: 400 });
  const owner = await nicknameOwner(env, normalized);
  if (owner && owner.id !== accountId) throw Object.assign(new Error('이미 사용 중인 닉네임입니다.'), { httpStatus: 409, code: 'NICKNAME_TAKEN' });
  const rows = await supabase(env, `entry_chat_accounts?id=eq.${encodeURIComponent(accountId)}&select=id,nickname,nickname_normalized,avatar_data_url,created_at`, {
    method: 'PATCH', body: { nickname: displayName, nickname_normalized: normalized, updated_at: new Date().toISOString() }, prefer: 'return=representation',
  });
  return { account: Array.isArray(rows) ? rows[0] || null : null };
}

async function updateProfile(env, payload) {
  const accountId = cleanText(payload.accountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  await requireDeviceAccount(env, fingerprintHash, accountId);
  const avatarDataUrl = cleanText(payload.avatarDataUrl || '', 70000);
  await supabase(env, `entry_chat_accounts?id=eq.${encodeURIComponent(accountId)}`, {
    method: 'PATCH', body: { avatar_data_url: avatarDataUrl, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
  });
  return { updated: true };
}

async function searchUsers(env, payload) {
  const query = nickname(payload.query).replace(/[*,%_]/g, '').trim();
  const requesterId = cleanText(payload.requesterId, 80);
  if (!query) return { users: [] };
  const filter = `*${query}*`;
  const parts = ['select=id,nickname', `nickname=ilike.${encodeURIComponent(filter)}`, 'order=nickname.asc', 'limit=12'];
  if (validUuid(requesterId)) parts.push(`id=neq.${encodeURIComponent(requesterId)}`);
  const rows = await supabase(env, `entry_chat_accounts?${parts.join('&')}`);
  return { users: (Array.isArray(rows) ? rows : []).map((row) => ({ id: row.id, nickname: row.nickname })) };
}

async function recommend(env, payload) {
  const roomCode = cleanText(payload.roomCode, 4);
  const senderAccountId = cleanText(payload.senderAccountId, 80);
  const targetAccountId = cleanText(payload.targetAccountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  if (!validRoomCode(roomCode) || !validUuid(senderAccountId) || !validUuid(targetAccountId) || senderAccountId === targetAccountId)
    throw Object.assign(new Error('방 추천 정보가 올바르지 않습니다.'), { httpStatus: 400 });
  await requireDeviceAccount(env, fingerprintHash, senderAccountId);
  const target = await findAccountById(env, targetAccountId);
  if (!target) throw Object.assign(new Error('추천할 사용자를 찾을 수 없습니다.'), { httpStatus: 404 });
  const blocks = await supabase(env, `entry_chat_room_recommendation_blocks?select=room_code&room_code=eq.${encodeURIComponent(roomCode)}&account_id=eq.${encodeURIComponent(targetAccountId)}&limit=1`);
  if (Array.isArray(blocks) && blocks.length) throw Object.assign(new Error('해당 사용자가 이 방의 추천 알림을 차단했습니다.'), { httpStatus: 409, code: 'ROOM_BLOCKED' });
  const sent = await supabase(env, `entry_chat_room_recommendations?select=room_code&room_code=eq.${encodeURIComponent(roomCode)}&target_account_id=eq.${encodeURIComponent(targetAccountId)}&limit=1`);
  if (Array.isArray(sent) && sent.length) throw Object.assign(new Error('이미 이 사용자에게 해당 방 추천이 전송되었습니다.'), { httpStatus: 409, code: 'ALREADY_RECOMMENDED' });
  try {
    await supabase(env, 'entry_chat_room_recommendations', {
      method: 'POST', body: { room_code: roomCode, target_account_id: targetAccountId, sender_account_id: senderAccountId }, prefer: 'return=minimal',
    });
  } catch (error) {
    if (error.code === '23505') throw Object.assign(new Error('이미 이 사용자에게 해당 방 추천이 전송되었습니다.'), { httpStatus: 409, code: 'ALREADY_RECOMMENDED' });
    throw error;
  }
  return { target: { id: target.id, nickname: target.nickname } };
}

async function blockRoom(request, env, payload) {
  const roomCode = cleanText(payload.roomCode, 4);
  const accountId = cleanText(payload.accountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  if (!validRoomCode(roomCode)) throw Object.assign(new Error('방 번호가 올바르지 않습니다.'), { httpStatus: 400 });
  await requireDeviceAccount(env, fingerprintHash, accountId);
  await supabase(env, 'entry_chat_room_recommendation_blocks?on_conflict=room_code,account_id', {
    method: 'POST', body: { room_code: roomCode, account_id: accountId }, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return { roomCode };
}

async function importAccount(request, env, payload) {
  const accountCode = cleanText(payload.accountCode, 180);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  if (!accountCode || !validHash(fingerprintHash)) throw Object.assign(new Error('계정 코드 또는 기기 정보가 올바르지 않습니다.'), { httpStatus: 400 });
  const codeHash = await sha256Hex(accountCode);
  const rows = await supabase(env, `entry_chat_accounts?select=id,nickname,nickname_normalized,avatar_data_url,created_at&account_code_hash=eq.${encodeURIComponent(codeHash)}&limit=1`);
  const account = Array.isArray(rows) ? rows[0] || null : null;
  if (!account) throw Object.assign(new Error('계정 코드가 올바르지 않습니다.'), { httpStatus: 404, code: 'ACCOUNT_CODE_NOT_FOUND' });
  await bindDevice(env, request, fingerprintHash, account.id);
  return { account };
}

async function rotateCode(env, payload) {
  const accountId = cleanText(payload.accountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  await requireDeviceAccount(env, fingerprintHash, accountId);
  const accountCode = randomAccountCode();
  const codeHash = await sha256Hex(accountCode);
  await supabase(env, `entry_chat_accounts?id=eq.${encodeURIComponent(accountId)}`, {
    method: 'PATCH', body: { account_code_hash: codeHash, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
  });
  return { accountCode };
}

async function deleteAccount(env, payload) {
  const accountId = cleanText(payload.accountId, 80);
  const fingerprintHash = String(payload.fingerprintHash || '').toLowerCase();
  await requireDeviceAccount(env, fingerprintHash, accountId);
  await supabase(env, `entry_chat_accounts?id=eq.${encodeURIComponent(accountId)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return { deleted: true };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request, context.env) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let payload;
  try { payload = await request.json(); } catch (_) { return json(request, env, { ok: false, error: 'JSON 요청만 허용됩니다.' }, 400); }
  const action = cleanText(payload?.action, 40);
  try {
    let result;
    switch (action) {
      case 'register': result = await registerAccount(request, env, payload); break;
      case 'update-name': result = await updateName(request, env, payload); break;
      case 'update-profile': result = await updateProfile(env, payload); break;
      case 'search-users': result = await searchUsers(env, payload); break;
      case 'recommend': result = await recommend(env, payload); break;
      case 'block-room': result = await blockRoom(request, env, payload); break;
      case 'import-account': result = await importAccount(request, env, payload); break;
      case 'rotate-code': result = await rotateCode(env, payload); break;
      case 'delete-account': result = await deleteAccount(env, payload); break;
      default: return json(request, env, { ok: false, error: '지원하지 않는 계정 요청입니다.' }, 400);
    }
    return json(request, env, { ok: true, ...result });
  } catch (error) {
    const status = Number(error?.httpStatus || 0) || (error?.status === 409 ? 409 : 500);
    return json(request, env, { ok: false, error: error?.message || String(error), code: error?.code || '' }, Math.max(400, Math.min(599, status)));
  }
}

export async function onRequest(context) {
  return json(context.request, context.env, { ok: false, error: 'POST 요청만 허용됩니다.' }, 405);
}
