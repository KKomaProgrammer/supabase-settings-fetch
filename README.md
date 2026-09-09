# supabase-settings-fetch

Entry Live Studio가 Supabase URL/브라우저 공개용 키를 직접 입력받지 않고, 사용자가 입력한 비밀번호를 확인한 뒤 Cloudflare Pages Functions에서 설정을 받아오도록 하는 작은 API입니다.

## Cloudflare Pages 배포

이 저장소를 Cloudflare Pages에 연결하고 프로젝트 이름을 **`supabase-settings-fetch`** 로 지정하세요.

- Production branch: `main`
- Framework preset: 없음
- Build command: `exit 0` 권장
- Build output directory: `.`

`/functions/api/settings.js` 때문에 `POST /api/settings`가 자동으로 Pages Function이 됩니다. `wrangler.toml`은 필요하지 않으며 이 저장소에는 비밀값을 넣지 않습니다.

## Cloudflare Variables and Secrets

Cloudflare Dashboard → Workers & Pages → 해당 Pages 프로젝트 → Settings → Variables and Secrets에서 아래 값을 등록하세요.

| 이름 | 권장 형식 | 용도 |
| --- | --- | --- |
| `ACCESS_PASSWORD_SHA256` | **Secret** | 사용자가 입력할 접속 비밀번호의 SHA-256(64자리 hex) |
| `SUPABASE_URL` | Variable | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | **Secret** | Supabase Publishable key(`sb_publishable_...`) 또는 기존 anon JWT |
| `ALLOWED_ORIGINS` | 선택 Variable | 쉼표로 구분한 허용 Origin. 비워 두면 `*` |

> `sb_secret_...` 또는 `service_role` 키는 절대로 등록하지 마세요. API도 이를 거부합니다.

배포된 루트 페이지에서 비밀번호를 입력하면 브라우저 내부에서 SHA-256을 계산할 수 있습니다. **루트 페이지의 해시 계산 과정에서는** 비밀번호 원문이 서버로 전송되지 않습니다. Entry Live Studio가 `/api/settings`를 호출할 때는 사용자가 입력한 비밀번호가 HTTPS 요청 본문으로 전송되고, 서버에서 SHA-256으로 검증된 뒤 저장되지 않습니다.

## API

`POST https://supabase-settings-fetch.pages.dev/api/settings`

요청:

```json
{"password":"사용자가 입력한 비밀번호"}
```

비밀번호가 맞으면:

```json
{
  "ok": true,
  "serverUrl": "https://xxxx.supabase.co",
  "anonKey": "sb_publishable_..."
}
```

틀리면 HTTP 401과 함께 `ok: false`가 반환됩니다. 응답은 `Cache-Control: no-store`로 캐시하지 않습니다.
