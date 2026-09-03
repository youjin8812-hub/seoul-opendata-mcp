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
| `MCP_AUTH_TOKEN` | | 설정 시 `Authorization: Bearer <토큰>` 필수. **공개 배포 시 반드시 설정** |
| `MCP_PATH` | | MCP 엔드포인트 경로 (기본 `/mcp`) |
| `MCP_ALLOWED_HOSTS` | | DNS 리바인딩 방지 Host 허용 목록 (쉼표 구분) |
| `MCP_ALLOWED_ORIGINS` | | 허용 Origin 목록 (쉼표 구분) |
| `MCP_RATE_LIMIT_PER_MINUTE` | `20` | IP당 분당 요청 수. `0`이면 해제 |
| `MCP_RATE_LIMIT_PER_HOUR` | `200` | IP당 시간당 요청 수. `0`이면 해제 |
| `MCP_TRUST_PROXY` | `false` | `true`면 `X-Forwarded-For`를 클라이언트 IP로 신뢰 |

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
claude mcp add --transport http seoul-opendata https://<app>.fly.dev/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

### Claude Desktop / Cursor (원격 HTTP)

```jsonc
{
  "mcpServers": {
    "seoul-opendata": {
      "type": "http",
      "url": "https://<app>.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
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
        "https://<app>.fly.dev/mcp",
        "--header", "Authorization: Bearer <MCP_AUTH_TOKEN>"
      ]
    }
  }
}
```

---

## 5. 운영 시 주의점

- **토큰 없이 공개한다면 호출 제한을 반드시 켜 둘 것.** `MCP_AUTH_TOKEN`을 비우면 누구나 호출할 수 있어, 서울 열린데이터광장 인증키의 일일 호출 한도를 남이 소진시킬 수 있다. 기본값(분당 20 / 시간당 200)이 켜져 있으므로 `MCP_RATE_LIMIT_*`를 `0`으로 끄지 않는 한 보호된다. 추천 1회가 카탈로그 API를 최대 8회 호출한다는 점을 감안해 한도를 정한다.
- **호출 제한은 프로세스 메모리 기준이다.** 여러 머신으로 수평 확장하면 인스턴스마다 따로 집계되므로, 실질 한도는 `설정값 × 인스턴스 수`가 된다. 엄밀한 전역 한도가 필요하면 Redis 등 공유 저장소가 필요하다.
- **한도 초과 시** `429`와 함께 `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` 헤더를 반환한다.
- **브라우저에서 호출할 계획이라면** `MCP_ALLOWED_HOSTS`·`MCP_ALLOWED_ORIGINS`를 배포 도메인으로 지정해 DNS 리바인딩을 막는다.
- **캐시는 인메모리**(`src/cache/memoryCache.ts`)다. 머신이 재우거나 재시작되면 비워지고, 머신마다 따로 유지된다. 정확성에는 영향이 없고 첫 호출이 조금 느려질 뿐이다.
- 로그는 stderr로 나가므로 `fly logs`로 바로 확인할 수 있다.
