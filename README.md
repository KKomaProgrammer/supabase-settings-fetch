# supabase-settings-fetch

Entry Live Studio의 서버 설정, 사용 상태, 업데이트 패키지 전달, 공지 및 단기 암호화 백업을 제공하는 Cloudflare Pages Functions 프로젝트입니다.

## Cloudflare Pages 배포

- Production branch: `main`
- Framework preset: 없음
- Build command: `exit 0`
- Build output directory: `.`

현재 확장은 다음 경로를 사용합니다.

- `GET /api/current/status`
- `POST /api/current/settings`
- `GET /api/current/update-package?version=x.y.z`
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
| `MANDATORY_UPDATE` | Variable | `1`=발견된 최신 버전을 필수 업데이트, `0` 또는 미설정=선택 업데이트 |
| `CHAT_NOTICE` | Variable | 공지. `제목|내용` 형식 |
| `CHAT_BACKUP_ENCRYPTION_KEY` | **Secret** | 48시간 단기 채팅 백업 AES-GCM 암호화 키 재료. 24자 이상 권장 |
| `ALLOWED_ORIGINS` | 선택 Variable | 쉼표로 구분한 허용 Origin. 비워 두면 `*` |

`ACCESS_PASSWORD_SHA256`을 사용하는 경우 확장은 비밀번호를 소문자로 정규화하므로, 환경변수에는 **소문자 비밀번호의 SHA-256**을 등록하세요.

## 업데이트 전달

필수 업데이트 여부는 버전 번호를 Cloudflare에 입력하지 않습니다.

- `MANDATORY_UPDATE=1`: 확장 프로그램이 새로고침 시 발견한 최신 버전을 필수 업데이트로 처리
- `MANDATORY_UPDATE=0` 또는 미설정: 같은 최신 버전을 선택 업데이트로 처리

확장 프로그램은 페이지 새로고침 때 GitHub의 `message_Vx.x.x.zip` 파일 목록만 확인하여 현재 버전보다 높은 최신 버전이 있는지 판단합니다. 이 과정에서는 ZIP 본문을 다운로드하지 않습니다.

사용자가 업데이트를 시작하면 확장 프로그램이 `GET /api/current/update-package?version=x.y.z`를 호출합니다. Pages Function은 **`UPDATE_PACKAGE_KV`**를 먼저 확인하고, 해당 버전이 없을 때만 공식 `KKomaProgrammer/codingdongari` 저장소에서 `message_Vx.x.x.zip`을 한 번 가져옵니다. 받은 ZIP은 SHA-256과 함께 KV에 버전별로 저장합니다.

따라서 한 사용자가 특정 버전을 한 번 요청해 KV에 저장하면, 이후 같은 버전 요청은 GitHub에서 ZIP을 다시 조회하지 않고 KV에서 응답합니다. 새 버전은 버전 번호가 달라 별도의 KV 키로 처음 한 번만 가져옵니다.

확장 프로그램도 Pages에서 받은 ZIP을 `chrome.storage.local`에 버전과 SHA-256을 함께 저장합니다. 동일한 업데이트 버전으로 updater를 다시 열면 로컬 캐시를 먼저 검증해 재사용하므로 Pages에도 다시 요청하지 않습니다.

### 업데이트 패키지 KV 바인딩

Cloudflare Pages 프로젝트의 **Bindings**에 별도 KV Namespace를 다음 이름으로 연결하세요.

- Binding name: **`UPDATE_PACKAGE_KV`**
- Type: KV Namespace

버전별 업데이트 ZIP은 동일 버전에서 변경하지 않는 것을 전제로 만료 없이 캐시합니다. 같은 버전의 ZIP 내용을 바꿔야 하는 경우 기존 버전을 덮어쓰지 말고 새 버전 번호로 배포하세요.

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

- 설정·업데이트·백업 요청은 HTTPS만 사용합니다.
- 업데이트 프록시는 임의 URL을 받지 않고 공식 저장소의 `message_Vx.x.x.zip`만 가져옵니다.
- 확장 프로그램은 받은 ZIP의 SHA-256과 내부 manifest/build 정보를 다시 검증합니다.
- `SUPABASE_ANON_KEY`에는 `sb_secret_...` 또는 service_role 키를 사용하지 마세요.
- 네트워크 요청을 절대 가로챌 수 없다고 보장할 수는 없으므로, Cloudflare의 TLS와 필요 시 WAF/Rate Limiting을 함께 사용하세요.
