# supabase-settings-fetch

Entry Live Studio의 서버 설정, 사용 상태, 필수 업데이트, 공지 및 단기 암호화 백업을 제공하는 Cloudflare Pages Functions 프로젝트입니다.

## Cloudflare Pages 배포

- Production branch: `main`
- Framework preset: 없음
- Build command: `exit 0`
- Build output directory: `.`

현재 확장은 다음 경로를 사용합니다.

- `GET /api/current/status`
- `POST /api/current/settings`
- `POST /api/current/chat-backup`

기존 `/api/status`, `/api/settings`는 구버전 차단용으로 유지됩니다.

## Variables and Secrets

Cloudflare Dashboard → Workers & Pages → 해당 Pages 프로젝트 → Settings → Variables and Secrets에서 설정합니다.

| 이름 | 권장 형식 | 용도 |
| --- | --- | --- |
| `ACCESS_PASSWORD_SHA256` | Secret | 연결 비밀번호의 SHA-256. **미설정, 빈 값, `*`이면 비밀번호 입력을 사용하지 않음** |
| `SUPABASE_URL` | Variable | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Secret | Supabase Publishable key 또는 anon key |
| `EXTENSION_ACCESS_MODE` | Variable | `0` 또는 미설정=정상, `1`=점검중, `2`=사용 불가 |
| `REQUIRED_UPDATE_VERSION` | Variable | 필수 업데이트 기준 버전. 예: `2.2.1`. `*`, 빈 값, 미설정은 새 버전이 있을 때 모든 구버전을 필수 업데이트 대상으로 처리 |
| `CHAT_NOTICE` | Variable | 공지. `제목|내용` 형식 |
| `CHAT_BACKUP_ENCRYPTION_KEY` | **Secret** | 48시간 단기 채팅 백업 AES-GCM 암호화 키 재료. 24자 이상 권장 |
| `ALLOWED_ORIGINS` | 선택 Variable | 쉼표로 구분한 허용 Origin. 비워 두면 `*` |

`ACCESS_PASSWORD_SHA256`을 사용하는 경우 확장은 비밀번호를 소문자로 정규화하므로, 환경변수에는 **소문자 비밀번호의 SHA-256**을 등록하세요.

## 필수 업데이트

`REQUIRED_UPDATE_VERSION=2.2.1`이면 2.2.1보다 낮은 버전은 필수 업데이트 화면으로 전환됩니다. 정상 기능과 동의/로그인 화면보다 필수 업데이트 화면이 우선합니다.

`REQUIRED_UPDATE_VERSION=*`, 빈 값 또는 미설정일 때는 GitHub에 현재 버전보다 높은 `message_Vx.x.x.zip`이 존재하는 사용자에게 필수 업데이트가 적용됩니다. 최신 버전까지 영구 잠금되지 않도록 실제 새 버전 존재 여부를 함께 확인합니다.

## 공지

`CHAT_NOTICE`에 다음처럼 입력합니다.

```text
점검 안내|오늘 오후 6시에 짧은 점검이 있습니다.
```

확장 프로그램 채팅 박스를 열면 공지가 표시됩니다.

## 비밀번호 없는 접속

`ACCESS_PASSWORD_SHA256`을 다음 중 하나로 두면 비밀번호 입력란을 표시하지 않습니다.

- 환경변수 미설정
- 빈 값
- `*`

이 경우 이름만 입력해 연결합니다.

## 48시간 암호화 백업

Cloudflare Pages 프로젝트의 **Bindings**에 KV Namespace를 다음 이름으로 연결하세요.

- Binding name: `CHAT_BACKUP_KV`
- Type: KV Namespace

그리고 `CHAT_BACKUP_ENCRYPTION_KEY`를 Secret으로 등록하세요. 메시지 백업은 HTTPS로 전송된 후 서버에서 AES-256-GCM으로 암호화되어 KV에 저장됩니다. KV 객체는 `expirationTtl=172800`으로 생성되어 최대 48시간 뒤 자동 만료됩니다.

확장 프로그램은 메시지가 오가는 속도에 따라 전송 묶음 크기와 주기를 조정해 요청 수를 줄입니다. `chrome.storage.sync` 백업은 별도로 계속 유지됩니다.

서버 백업은 복구/분쟁 대응을 위한 단기 보조 사본이며, 일반 사용자용 전체 채팅 조회 API는 제공하지 않습니다.

## 보안 참고

- 설정 및 백업 요청은 HTTPS만 사용합니다.
- `SUPABASE_ANON_KEY`에는 `sb_secret_...` 또는 service_role 키를 사용하지 마세요.
- 네트워크 요청을 절대 가로챌 수 없다고 보장할 수는 없으므로, Cloudflare의 TLS와 필요 시 WAF/Rate Limiting을 함께 사용하세요.
