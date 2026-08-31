# 외부 배포 가이드 (원격 MCP 서버)

이 저장소는 두 가지 전송(transport)을 지원한다.

| 전송 | 진입점 | 용도 |
|---|---|---|
| stdio | `src/server.ts` → `dist/server.js` | 로컬 Claude Desktop / Claude Code / Cursor |
| Streamable HTTP | `src/httpServer.ts` → `dist/httpServer.js` | **원격 배포** (Fly.io, Render, Cloud Run 등) |

두 진입점 모두 `src/createServer.ts`의 동일한 도구 정의를 사용하므로, 도구를 추가·수정하면 양쪽에 함께 반영된다.

---

## 1. HTTP 서버 사양

```
POST /mcp       MCP JSON-RPC (Streamable HTTP, 무상태 모드)
GET  /healthz   헬스체크 → {"status":"ok","apiKeyConfigured":true,...}
GET  /          서버 소개 JSON
```

- **무상태(stateless) 모드**: 요청마다 MCP 서버·전송 인스턴스를 새로 만들고 응답 후 정리한다. 세션이 특정 머신에 묶이지 않으므로 머신을 여러 대로 늘려도 sticky session 설정이 필요 없다.
- 무상태 모드이므로 서버→클라이언트 SSE 스트림(`GET /mcp`)과 세션 종료(`DELETE /mcp`)는 405로 거절한다. 현재 도구는 모두 요청-응답형이라 필요하지 않다.

### 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `SEOUL_OPEN_DATA_API_KEY` | ✅ | 서울 열린데이터광장 인증키 (https://data.seoul.go.kr 발급) |
| `PORT` | | 리스닝 포트 (기본 `8080`) |
| `HOST` | | 바인딩 주소 (기본 `0.0.0.0`) |
| `MCP_AUTH_TOKEN` | | 설정 시 `Authorization: Bearer <토큰>` 필수. 공개 서버는 비워두고 아래 요청 제한으로 보호한다. 설정 시 인증된 요청은 IP 제한을 면제받는다 |
| `MCP_RATE_LIMIT_PER_MIN` | | IP당 분당 요청 수 (기본 `20`, 순간 버스트는 2배) |
| `MCP_RATE_LIMIT_PER_DAY` | | IP당 하루 요청 수 (기본 `200`) |
| `SEOUL_API_DAILY_BUDGET` | | 서울시 API 전역 일일 호출 예산 (기본 `900`, 한국시간 자정 리셋) |
| `MCP_PATH` | | MCP 엔드포인트 경로 (기본 `/mcp`) |
| `MCP_ALLOWED_HOSTS` | | DNS 리바인딩 방지 Host 허용 목록 (쉼표 구분) |
| `MCP_ALLOWED_ORIGINS` | | 허용 Origin 목록 (쉼표 구분) |

> 인증키는 이미지에 굽지 말고 반드시 플랫폼의 시크릿 기능으로 주입한다.

### 로컬에서 HTTP 모드 실행·검증

```bash
pnpm install
SEOUL_OPEN_DATA_API_KEY=... pnpm dev:http     # http://localhost:8080/mcp

curl -s localhost:8080/healthz

curl -s -X POST localhost:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 2. Fly.io 배포

`fly.toml`과 `Dockerfile`이 저장소에 포함되어 있다.

```bash
# 0) flyctl 설치 & 로그인
curl -L https://fly.io/install.sh | sh
fly auth login

# 1) 앱 생성 (배포는 아직 하지 않음 / 기존 fly.toml 유지)
fly launch --no-deploy --copy-config
#    앱 이름을 바꿨다면 fly.toml의 app = "..." 도 같이 수정한다

# 2) 시크릿 주입
fly secrets set \
  SEOUL_OPEN_DATA_API_KEY=발급받은키 \
  MCP_AUTH_TOKEN=$(openssl rand -hex 32)

# 3) 배포
fly deploy

# 4) 확인
fly status
curl -s https://<app>.fly.dev/healthz
```

`fly.toml` 기본값 요약

- `primary_region = "nrt"` — 도쿄. 서울 열린데이터광장 API와 지연이 가장 짧다.
- `auto_stop_machines = "suspend"` / `min_machines_running = 0` — 트래픽이 없으면 머신을 재워 비용을 0에 가깝게 유지하고, 요청이 오면 자동 기동한다.
- `force_https = true` — HTTP 요청은 HTTPS로 리다이렉트.
- `/healthz` 헬스체크 30초 간격.

호출량이 늘면 `fly scale count 2` 로 머신을 늘리면 된다(무상태라 그대로 동작).

---

## 3. 다른 플랫폼

Dockerfile 하나로 동일하게 배포된다. 어느 쪽이든 **포트는 `PORT` 환경변수를 따르고, 헬스체크 경로는 `/healthz`** 다.

- **Render / Railway**: 저장소 연결 → Docker 런타임 선택 → 환경변수에 `SEOUL_OPEN_DATA_API_KEY`, `MCP_AUTH_TOKEN` 등록.
- **Google Cloud Run**: `gcloud run deploy seoul-opendata-mcp --source . --port 8080 --set-secrets SEOUL_OPEN_DATA_API_KEY=seoul-key:latest`
- **직접 운영(VM/쿠버네티스)**: `docker build -t seoul-opendata-mcp . && docker run -p 8080:8080 -e SEOUL_OPEN_DATA_API_KEY=... seoul-opendata-mcp`

---

## 4. MCP 클라이언트 연결

### Claude Code

```bash
claude mcp add --transport http seoul-opendata https://<app>.fly.dev/mcp
```

> `MCP_AUTH_TOKEN`을 설정한 서버라면 뒤에 `--header "Authorization: Bearer <MCP_AUTH_TOKEN>"`을 붙인다.

### Claude Desktop / Cursor (원격 HTTP)

```jsonc
{
  "mcpServers": {
    "seoul-opendata": {
      "type": "http",
      "url": "https://<app>.fly.dev/mcp"
    }
  }
}
```

HTTP 전송을 지원하지 않는 구버전 클라이언트라면 `mcp-remote` 브리지를 쓴다.

```jsonc
{
  "mcpServers": {
    "seoul-opendata": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://<app>.fly.dev/mcp"
      ]
    }
  }
}
```

---

## 5. 운영 시 주의점

- **토큰 없이 공개해도 되지만, 요청 제한은 반드시 켜 둘 것.** 인증키 하나를 모든 사용자가 공유하므로 남용 시 일일 한도가 소진된다. 기본값(IP당 20/분·200/일, 전역 900콜/일)이 이미 적용돼 있고, 전역 예산은 상위 API 호출 직전에 차감된다(`src/services/seoulCatalogService.ts`). 예산 소진 시 도구는 리셋 시각을 안내하는 오류를 반환한다.
- **한도 산정 기준.** 서울 열린데이터광장은 개발계정 하루 약 1,000건, 운영계정 최대 100,000건이다. 추천 도구 1회가 상위 API를 5~8번 부르므로 개발계정 기준 하루 추천 125~200회에 해당한다. 운영계정 승인을 받았다면 `SEOUL_API_DAILY_BUDGET`을 올린다.
- **잔여량 확인.** `GET /healthz`와 `GET /`가 `quota`(used/budget/remaining/resetsInSec)를 반환한다.
- **브라우저에서 호출할 계획이라면** `MCP_ALLOWED_HOSTS`·`MCP_ALLOWED_ORIGINS`를 배포 도메인으로 지정해 DNS 리바인딩을 막는다.
- **캐시는 인메모리**(`src/cache/memoryCache.ts`)다. 머신이 재우거나 재시작되면 비워지고, 머신마다 따로 유지된다. 정확성에는 영향이 없고 첫 호출이 조금 느려질 뿐이다.
- 로그는 stderr로 나가므로 `fly logs`로 바로 확인할 수 있다.
