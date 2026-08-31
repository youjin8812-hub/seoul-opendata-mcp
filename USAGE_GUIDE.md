# 사용 가이드 (Usage Guide)

이 문서는 `seoul-opendata-mcp`를 처음 설치·연동하는 사용자를 위한 실전 가이드다. 프로젝트 개요·설계 배경·도구 명세는 [README.md](README.md)를 참고하고, 이 문서는 "실제로 어떻게 쓰는가"에 집중한다.

## 1. 시작 전 체크리스트

| 항목 | 확인 방법 | 비고 |
|---|---|---|
| Node.js 18 이상 | `node -v` | 18 미만이면 [nodejs.org](https://nodejs.org)에서 LTS 버전 설치 |
| pnpm | `pnpm -v` | 없으면 `npm install -g pnpm` |
| 서울 열린데이터광장 인증키 | 발급 여부 확인 | 2장 참고 |
| MCP 클라이언트 | Claude Desktop / Claude Code / Cursor 중 하나 설치 | 4장 참고 |

## 2. 인증키 발급 (상세)

1. [data.seoul.go.kr](https://data.seoul.go.kr) 접속 후 회원가입·로그인
2. 우측 상단 **마이페이지 → 인증키 신청** 이동
3. 활용 목적을 간단히 작성하고 신청 (예: "MCP 기반 데이터 검색 도구 개발")
4. 발급된 키를 복사해 안전한 곳에 보관

**주의**: 신청 직후 바로 키가 활성화되지 않는 경우가 있다. 첫 호출에서 인증 오류가 나면 몇 분~수십 분 후 다시 시도한다. (7장 "인증키 오류" 참고)

## 3. 설치

```bash
git clone https://github.com/youjin8812-hub/seoul-opendata-mcp.git
cd seoul-opendata-mcp
pnpm install
pnpm build
cp .env.example .env
```

`.env` 파일을 열어 발급받은 키를 입력한다.

```bash
SEOUL_OPEN_DATA_API_KEY=발급받은_인증키
```

동작 확인(선택):

```bash
pnpm test    # 47개 단위 테스트 통과 확인
pnpm dev     # 실제 서버를 stdio로 띄워 수동 점검 (Ctrl+C로 종료)
```

## 4. MCP 클라이언트 연동

### 4.1 Claude Code

```bash
claude mcp add seoul-opendata-mcp -s user \
  -e SEOUL_OPEN_DATA_API_KEY="발급받은_인증키" \
  -- node "/절대경로/seoul-opendata-mcp/dist/server.js"
```

등록 확인: `claude mcp list` 에 `seoul-opendata-mcp`가 나타나는지 확인한다.

### 4.2 Claude Desktop

1. 설정 파일 위치를 연다.
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. `mcpServers`에 아래 항목을 추가한다.

```json
{
  "mcpServers": {
    "seoul-opendata-mcp": {
      "command": "node",
      "args": ["/절대경로/seoul-opendata-mcp/dist/server.js"],
      "env": { "SEOUL_OPEN_DATA_API_KEY": "발급받은_인증키" }
    }
  }
}
```

3. Claude Desktop을 완전히 종료 후 재시작한다.
4. 새 대화창 하단(또는 도구 아이콘)에 `seoul-opendata-mcp`의 5개 도구가 보이면 연동 성공이다.

### 4.3 Cursor

`.cursor/mcp.json`(또는 전역 `mcp.json`)에 4.2와 동일한 형식으로 추가한다.

**공통 주의사항**: `args`의 경로는 반드시 절대경로여야 한다. `dist/server.js`가 없다면 `pnpm build`를 먼저 실행한다.

## 5. 실전 사용 시나리오

아래는 연동 후 Claude(또는 Cursor)의 대화창에 그대로 입력할 수 있는 질문 예시다. MCP 클라이언트가 자동으로 적절한 도구를 선택해 호출한다 — 도구 이름을 직접 알 필요는 없다.

### 시나리오 1 — 아이디어만 있고 어떤 데이터가 있는지 모를 때

> "서울 생활인구 250m 격자 데이터로 유동인구를 분석하는 앱을 만들고 싶어. 관련 API 추천해줘."

→ 내부적으로 `recommend_seoul_apis_for_idea`가 호출되어 관련도·활용도 점수가 매겨진 상위 후보를 반환한다.

### 시나리오 2 — 실시간 데이터만, 특정 자치구로 좁히고 싶을 때

> "정류장 도착 버스와 근처 따릉이 잔여 대수를 같이 보여주는 앱을 만들 거야. 실시간 데이터 위주로, API 형식만 추천해줘."

→ `apiOnly: true`, `realtimePreferred: true` 조건이 자동으로 적용된다.

### 시나리오 3 — 키워드로 직접 찾고 싶을 때

> "'인허가'라는 단어가 들어간 자치구 데이터셋 목록 보여줘."

→ `search_seoul_datasets`가 호출되며, 조건에 맞는 전체 건수(`totalMatchCount`)도 함께 알려준다.

### 시나리오 4 — 특정 데이터의 상세 정보(담당부서·연락처)가 필요할 때

> "OA-22850 데이터셋 담당 부서랑 연락처 알려줘."

→ `get_seoul_dataset_detail`이 서비스 ID 또는 상세페이지 URL로 단건 조회한다. 단, 개별 API의 요청 파라미터 명세까지는 제공하지 않으므로, 반환된 상세페이지 링크의 "Open API" 탭을 브라우저에서 직접 확인해야 한다.

### 시나리오 5 — 요즘 활발히 관리되는 API만 보고 싶을 때

> "교통 관련 데이터 중에 최근에 갱신된 API만 순서대로 보여줘."

→ `list_seoul_recent_updates`가 최종갱신일(`DATA_LT_NM`) 내림차순으로 반환한다.

### 시나리오 6 — 이미 받은 추천 결과를 다시 검색하지 않고 좁히고 싶을 때

> "방금 결과 중에서 서울교통공사가 제공하는 것만 다시 보여줘."

→ `refine_seoul_recommendations`가 API를 재호출하지 않고 직전 결과를 재필터링한다(토큰·호출 비용 절감).

## 6. 결과 해석 팁

- `score`(95점 만점)는 기존 정렬·필터링에 쓰이는 종합 점수이고, `scoreBreakdown`은 "왜 이 순위인지"를 관련도(`relevanceScore`)/활용도(`qualityScore`)로 나눠 사람이 읽을 수 있는 근거(`relevanceReasons`, `qualityReasons`)와 함께 보여준다. 추천 이유를 보고서나 회의자료에 인용할 때는 `scoreBreakdown` 쪽 근거 문장을 활용하는 편이 설명하기 쉽다.
- `brm`(정책분야)과 `organization`(제공기관 유형)은 카탈로그 공식 필드 기반으로만 분류되며, 근거가 없으면 `null`/미분류로 남는다 — 추측성 분류가 섞이지 않는다는 뜻이므로 `null`이 나와도 오류가 아니다.
- `totalMatchCount`가 1,000건을 넘는 조회는 `note`에 "표본 내 정렬" 안내가 함께 오는데, 이는 API 1회 요청 상한(1,000건) 때문이며 실제 서비스 이용 전 반드시 확인한다.

## 7. 문제 해결 (Troubleshooting)

| 증상 | 원인 추정 | 조치 |
|---|---|---|
| 도구 목록에 seoul-opendata-mcp가 안 보임 | 설정 파일 경로/문법 오류, 또는 클라이언트 미재시작 | `dist/server.js` 절대경로 확인 → 설정 파일 JSON 문법 확인 → 클라이언트 완전 재시작 |
| "인증키" 관련 오류 메시지 | `.env` 또는 클라이언트 설정의 `SEOUL_OPEN_DATA_API_KEY` 누락/오타, 또는 발급 직후 미반영 | 키 값 재확인 → 몇 분~수십 분 후 재시도 |
| "일시 불가" 관련 오류 메시지 | 서울 열린데이터광장 API 서버 일시 장애 | 30초~1분 후 재시도 (서버가 자동으로 최대 3회 재시도 후에도 실패한 경우) |
| 같은 질문인데 결과가 안 바뀜 | 인메모리 캐시 적중 (실시간 질의 1분, 일반 검색/추천 5분, 상세 조회 30분) | 의도된 동작. 즉시 최신 결과가 필요하면 조건(키워드 등)을 살짝 바꿔 질의 |
| `pnpm build` 실패 | Node.js 버전 낮음, 의존성 미설치 | `node -v`로 18+ 확인 → `pnpm install` 재실행 |
| `pnpm test` 일부 실패 | 로컬 환경 문제 또는 코드 변경 중 | GitHub Actions CI 배지가 초록색이면 원본 코드는 정상 — 로컬 환경(Node 버전, 캐시) 점검 |

## 8. 자주 묻는 질문 (FAQ)

**Q. 서울시 데이터가 아닌 다른 지자체/전국 단위 데이터도 찾아주나요?**
A. 아니다. 이 MCP는 서울 열린데이터광장(`data.seoul.go.kr`) 카탈로그만을 원천으로 하며, 공공데이터포털(data.go.kr) 등 타 플랫폼은 연동하지 않는다(README 2장 "도입 배경" 참고).

**Q. 파일(File)·시트(Sheet) 형식도 검색되나요?**
A. 된다. 기본값은 OpenAPI 외 File·Sheet 등 비-API 형식도 함께 검색한다. API만 원하면 `apiOnly: true` 조건을 요청 문장에 포함시키면 된다.

**Q. 개별 API를 실제로 호출하는 요청 URL·파라미터도 알려주나요?**
A. 아니다. 이 도구는 카탈로그 메타데이터(어떤 데이터가 있는지, 어디서 관리하는지)까지만 제공한다. 실제 API 호출 파라미터는 상세페이지의 "Open API" 탭에서 직접 확인해야 한다.

**Q. 여러 명이 같이 쓰려면 서버를 띄워둬야 하나요?**
A. 아니다. MCP는 각 사용자의 로컬 MCP 클라이언트(Claude Desktop 등)가 필요할 때마다 `node dist/server.js`를 stdio로 직접 실행하는 구조라, 사용자별로 각자 설치·등록하면 된다.

## 9. 관련 문서

- [README.md](README.md) — 프로젝트 개요, 도입 배경, 성능 지표, 도구 상세 명세, BRM/기관유형 분류 로직
