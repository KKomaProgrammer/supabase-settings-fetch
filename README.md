# supabase-settings-fetch

Entry Live Studio가 Supabase URL/브라우저 공개용 키를 직접 입력받지 않고, 사용자가 입력한 비밀번호를 확인한 뒤 Cloudflare Pages Functions에서 설정을 받아오도록 하는 API입니다. v2.0.9부터 확장 사용 상태 제어와 사용자별 암호화 클라우드 백업 API도 포함합니다.

## Cloudflare Pages 배포

이 저장소를 Cloudflare Pages에 연결하고 프로젝트 이름을 **`supabase-settings-fetch`** 로 지정하세요.

- Production branch: `main`
- Framework preset: 없음
- Build command: `exit 0`
- Build output directory: `.`

`/functions/api/settings.js` → `POST /api/settings`

`/functions/api/status.js` → `GET /api/status`

`/functions/api/backup.js` → `/api/backup`

`wrangler.toml`은 필요하지 않습니다.

## Variables and Secrets

Cloudflare Dashboard → Workers & Pages → 해당 Pages 프로젝트 → Settings → Variables and Secrets에서 아래 값을 등록하세요.

| 이름 | 권장 형식 | 용도 |
| --- | --- | --- |
| `ACCESS_PASSWORD_SHA256` | **Secret** | 사용자가 입력할 접속 비밀번호의 SHA-256(64자리 hex) |
| `SUPABASE_URL` | Variable | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | **Secret** | Supabase Publishable key(`sb_publishable_...`) 또는 기존 anon JWT |
| `EXTENSION_ACCESS_MODE` | Variable | `0` 또는 미설정=정상, `1`=`점검중`, `2`=`사용 불가` |
| `ALLOWED_ORIGINS` | 선택 Variable | 쉼표로 구분한 허용 Origin. 비워 두면 `*` |

> `sb_secret_...` 또는 `service_role` 키는 절대로 등록하지 마세요. API도 이를 거부합니다.

## R2 백업 바인딩

확장 삭제 뒤에도 암호화 백업을 서버에 남기려면 Cloudflare R2 버킷을 하나 만든 다음 Pages 프로젝트의 **Bindings**에서 다음 이름으로 연결하세요.

- Binding name: **`CHAT_BACKUP_BUCKET`**
- Type: R2 bucket

확장 프로그램은 설치별 복구 코드를 생성합니다. 채팅 메시지/사진/프로필/방 메타데이터는 브라우저에서 AES-GCM으로 암호화된 뒤 `/api/backup`으로 전송됩니다. 서버에는 복호화 키인 복구 코드가 전송되지 않으며, 서버는 인증용 파생값과 암호문만 보관합니다.

따라서 서버 운영자는 저장된 객체만으로 채팅 평문을 볼 수 없습니다. 사용자가 확장을 삭제한 뒤 복구하려면 확장 프로그램에서 미리 확인해 둔 **복구 코드**가 필요합니다.

## 확장 사용 상태

`EXTENSION_ACCESS_MODE` 값은 다음과 같습니다.

- `0` 또는 미설정: 정상 접속
- `1`: `점검중`
- `2`: `사용 불가`

다른 값은 정상(`0`)으로 처리합니다. `/api/settings`는 로그인 시 이 값을 검사하고, `/api/status`는 현재 상태만 공개합니다. v2.0.9 확장 프로그램은 `/api/status`를 약 30초마다 확인하므로 이미 연결된 사용자도 점검/사용 불가 상태로 전환됩니다. 다시 `0`으로 변경하면 저장된 세션 설정으로 자동 재연결합니다.

## 비밀번호 확인 API

`POST https://supabase-settings-fetch.pages.dev/api/settings`

요청:

```json
{"password":"사용자가 입력한 비밀번호"}
```

정상 응답:

```json
{
  "ok": true,
  "accessMode": 0,
  "serverUrl": "https://xxxx.supabase.co",
  "anonKey": "sb_publishable_..."
}
```

루트 페이지에서 SHA-256을 계산할 때는 비밀번호 원문이 서버로 전송되지 않습니다. 확장 프로그램이 `/api/settings`를 호출할 때는 사용자가 입력한 평문 비밀번호가 HTTPS 요청 본문으로 전송되고 서버에서 SHA-256으로 비교된 뒤 저장되지 않습니다.

## 암호화 백업 API

`/api/backup`은 사용자의 복구 코드 자체를 받지 않습니다. 확장 프로그램이 복구 코드에서 다음을 각각 파생합니다.

- 백업 식별자
- 인증 토큰
- AES-GCM 암호화 키

서버는 인증 토큰의 해시와 암호문만 보관합니다. 백업은 메타데이터와 메시지 레코드 단위로 저장되어 메시지를 보내거나 받을 때 즉시 추가됩니다.

관리자용 전체 사용자 채팅 조회 엔드포인트나 마스터 복호화 키는 구현하지 않습니다. 조사나 분쟁 대응이 필요한 경우에는 해당 사용자가 보관한 복구 코드 또는 사용자가 내보낸 백업 파일을 이용해 복구하는 구조입니다.
