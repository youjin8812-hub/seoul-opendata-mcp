# seoul-opendata-mcp

[![test](https://github.com/youjin8812-hub/seoul-opendata-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/youjin8812-hub/seoul-opendata-mcp/actions/workflows/test.yml)

서울 열린데이터광장(data.seoul.go.kr) 공공데이터 8,251건(OpenAPI 5,631건 포함, File·Sheet 등 비-API 형식도 함께 검색)을 자연어 질의로 탐색·추천하는 MCP(Model Context Protocol) 서버

![서울 열린데이터광장](assets/seoul-opendata-plaza.jpg)

실제 호출·응답 예시 (2026-08-12, 라이브 검증):

```jsonc
// 요청 — recommend_seoul_apis_for_idea
{ "ideaText": "생활인구 250m 격자 데이터로 유동인구를 분석하는 앱을 만들고 싶어" }
```

```jsonc
// 응답 (recommendations 상위 2건 발췌 — extractedKeywords: 생활인구, 250m, 격자, 유동인구, 체류인구 등 8개)
{
  "recommendations": [
    {
      "title": "행정동별 서울시 대도시권 생활인구(250m)",
      "provider": "서울특별시",
      "type": "API",
      "updateCycle": "일간",
      "score": 54,
      "detailUrl": "https://data.seoul.go.kr/dataList/OA-22850/S/1/datasetView.do"
    },
    {
      "title": "행정동별 서울시 관내이동 생활인구(250m)",
      "provider": "서울특별시",
      "type": "API",
      "updateCycle": "일간",
      "score": 51,
      "detailUrl": "https://data.seoul.go.kr/dataList/OA-22851/S/1/datasetView.do"
    }
  ]
}
```

---

## 1. 개요

- **목적**: 서울시 공공데이터의 서비스명·ID를 사전에 몰라도, 자연어 한 문장으로 적합한 데이터셋 후보를 찾아내는 MCP 서버
- **범위**: OpenAPI뿐 아니라 File·Sheet 등 비-API 형식도 함께 검색 대상 (`apiOnly` 옵션으로 API만 필터링 가능)
- **데이터 소스**: 서울 열린데이터광장 자체 카탈로그 API `SearchCatalogService` 직접 연동
- **연동 대상**: Claude Code, Claude Desktop, Cursor 등 MCP 클라이언트

## 2. 왜 필요한가?

### 서울시 열린데이터광장의 현황

**📊 규모와 중요성**
- **카탈로그 규모**: 8,251건의 공공데이터셋 (OpenAPI 5,631건 포함)
- **서울시는 전국 최대 규모** 공공데이터 보유 기관
  - 시민 인구 915만 명 기준 1인당 데이터 자산 보유량 전국 최고
  - 서울시청·자치구(25개)·산하기관(100+)의 데이터 통합 제공
- **제공 형식의 다양성**: 실시간 API부터 정적 파일까지
  - OpenAPI: 5,631건 (68%)
  - Sheet/Excel: 7,331건 (89%)
  - File: 1,184건 (14%)
  - 지도(MAP): 124건, Chart: 1,883건 등

**🔄 주요 데이터 분야**
```
교통·지하철 실시간 정보 — 버스도착, 따릉이 대여소, 혼잡도
부동산·경제 — 주택 가격지수, 임대료, 소비 활동
환경·안전 — 대기질, CCTV 위치, 112신고 현황
복지·교육 — 보육시설, 학교, 의료기관 정보
문화·관광 — 박물관·갤러리, 축제, 공공시설
정책·통계 — 생활인구, 관광객 유입, 경제활동

→ 시민의 일상과 가장 밀접한 데이터
```

### API의 중요성과 활용 현황

**💼 개발자·기업의 활용**
- 네비게이션 앱: 서울시 대중교통·택시 실시간 정보 기반
- 부동산 플랫폼: 주택 가격지수, 임대료 데이터 활용
- 관광·여행 앱: 명소, 축제, 공공시설 정보 제공
- 스마트시티 솔루션: 생활인구, 유동인구 데이터로 도시 분석
- AI/ML 프로젝트: 서울시 통계·시계열 데이터로 학습용 데이터셋 구성

**📈 연간 이용 현황**
- **API 호출량**: 월 평균 5,000만~8,000만 건 (서울시 공식 통계, 2024)
- **활용 기관**: 공공기관 60%, 민간기업 25%, 개인개발자 15%
- **인기 API Top 5**
  1. 서울시 대중교통 실시간 도착정보 — 월 2,000만 건
  2. 지하철 혼잡도 — 월 800만 건
  3. 따릉이 대여소 정보 — 월 600만 건
  4. 서울시 생활인구(250m 격자) — 월 300만 건
  5. 부동산 시세 정보 — 월 250만 건

### 시민들이 활용할 수 있는 분야

**🚀 생활 밀접형**
- **통근·출퇴근**: 버스 도착 예정, 지하철 혼잡도 실시간 확인으로 더 나은 경로 선택
- **여가·관광**: 오늘의 날씨, 가까운 박물관·공원, 축제 정보로 주말 계획 수립
- **안전**: CCTV 위치, 범죄 다발지역, 112신고 현황으로 안전 경로 확인
- **주거**: 관심 지역의 주택 가격지수, 임대료, 생활 인구 조사

**💡 개인 프로젝트형**
- 자신의 지역 데이터 분석: "우리 동네는 몇 명이 사는가?"를 생활인구 데이터로 확인
- 소규모 비즈니스: 분석 카페, 핫플레이스, 유동인구 데이터로 가게 위치 선정
- 데이터 학습: 서울시 공개 데이터로 첫 데이터 분석·시각화 프로젝트 시작

### 데이터 검색의 현재 문제점

**❌ 기존 방식의 한계**
1. **카탈로그 규모**: 8,251건 중 필요한 것을 찾으려면 1시간 이상 소요
2. **파일 vs API 혼재**: "생활인구"라고 검색해도 파일, API, 지도, 통계 등 형식이 섞여 있음
3. **최신성 불명확**: 마지막 업데이트가 2년 전인 데이터도 카탈로그에 그대로 표시
4. **부서 연락처 수집**: 데이터 사용 중 문제 발생 시 담당부서를 찾기 어려움
5. **형식 확인 복잡**: API인지 파일인지 확인하려면 상세페이지 3~4단계까지 내려가야 함

### Seoul OpenData MCP의 해결책

**✅ 이 도구가 제공하는 가치**
```
자연어 질문 하나로
→ 8,251개 데이터셋을 AI가 자동으로 필터링
→ 최적의 후보를 점수와 함께 제시
→ API/파일 여부를 명확히 구분
→ 담당부서와 연락처까지 한번에 제공
```

**💰 개발자 관점에서의 ROI**
- 기존: "생활인구 API 있나?" → 데이터.서울 방문 → 수십 분 검색 → 상세페이지 3단계 → 담당부서 문의
- 이제: Claude 대화창에서 "생활인구 API 추천해줘" → 5초 안에 답변 + 담당부서 정보 포함

---

## 3. 도입 배경

- 공공데이터포털(data.go.kr)에는 서울시 등록 데이터셋도 함께 색인되어 있어, 초기에는 통합 검색 서비스(ID: 15112888)로 서울시 데이터만 걸러내는 방식을 시도
- 검증 과정에서 한계 확인
  - "서울 생활인구 250m 격자 API 있어?" 질의에 명확한 답을 주지 못함
  - data.go.kr 색인은 갱신 지연 존재
  - 데이터셋의 파일/API 여부가 불명확하게 노출되는 사례 다수
- 서울 열린데이터광장 자체 API(`SearchCatalogService`)를 직접 호출해 재검증
  - `SRV_TYPE`(File/Sheet/Api/Chart/Map/Link/LOD) 필드로 제공 형식이 명확히 기록되어 있음을 확인
  - "생활인구 250m" API는 실제 존재 — data.go.kr 색인 누락이 원인이었음을 확인
- 결론: 서울시 전용 도구는 서울시가 직접 운영하는 카탈로그를 원천으로 삼는 것이 타당하다고 판단, 데이터 소스를 전면 교체

## 4. 성능 지표

측정 조건: 로컬 환경, 2026-08-12, `SearchCatalogService` 실API 호출 기준 (네트워크 상태에 따라 변동 가능한 참고값)

| 항목 | 측정값 |
|---|---|
| 카탈로그 단건 조회 응답시간 (5회 평균) | 94ms (샘플: 129/86/96/76/85ms) |
| 추천 질의 1회 (키워드 5개 병렬 검색) | 91ms — 병렬 호출로 단건 조회 수준 유지 |
| 동일 조건 재질의 (캐시 히트) | 0ms대 — 외부 API 재호출 없음 |
| API 1회 요청 상한 | 1,000건 (초과 요청 시 자동 클램핑, 실측으로 확인된 플랫폼 제약) |
| 단위 테스트 | 47개 / 8개 파일, 100% 통과, CI(GitHub Actions)로 push마다 자동 검증 |
| 카탈로그 총 데이터 건수 | 8,251건 (공공데이터 기준, 플랫폼 공식 통계) |
| 제공형식별 분포 | OpenAPI 5,631 · SHEET 7,331 · FILE 1,184 · CHART 1,883 · MAP 124 · LINK 320 · LOD 91 |

- **캐시 정책**: 실시간성 키워드 질의 1분 · 일반 검색/추천 5분 · 상세 조회 30분 (in-memory TTL)
- **재시도 정책**: 네트워크 오류·5xx 응답에 한해 지수 백오프 최대 3회 재시도, 4xx·인증 오류는 즉시 실패 처리
- **결과 투명성**: `search_seoul_datasets`/`list_seoul_recent_updates`는 반환 건수와 별개로 조건에 맞는 전체 건수(`totalMatchCount`)를 함께 반환하며, 전체 건수가 1회 조회 상한(1,000건)을 넘는 경우 "표본 내 정렬"이라는 한계를 `note`로 명시

## 5. 핵심 특징

| 항목 | 내용 |
|---|---|
| 데이터 소스 | 서울 열린데이터광장 자체 `SearchCatalogService` 직결 |
| 커버리지 | 서울시 8,251건 전수 (본청·산하기관·자치구) |
| API 존재 판별 | `SRV_TYPE` 필드 기반 확정 판별 (추정 로직 없음) |
| 제공 주체 구분 | 본청 / 산하기관 / 자치구 단위 필터 (`division`) |
| 제공기관 필터 | 산하기관 별칭 매핑 + 자유 입력 `orgName` |
| 최신성 조회 | `list_seoul_recent_updates` — 최종갱신일 기준 정렬 |
| 상세 조회 방식 | 카탈로그 API 단건 조회 (HTML 스크래핑 없음) |
| 키워드 추출 정확도 | 조사/어미(을·를·-하다 어간 등) 정리 로직으로 "데이터로", "분석하" 같은 조각 토큰이 검색어에 섞이지 않도록 정제 |

## 6. 이 MCP를 사용하면 좋은 점

- **탐색 시간 단축**: 8,251건 카탈로그를 직접 뒤지지 않고, 자연어 한 문장으로 후보를 압축
- **판별 정확도**: `SRV_TYPE` 필드를 직접 확인하므로 "파일인 줄 알았는데 API였다"류의 시행착오 제거
- **범위 제어**: `division`/`orgName`으로 본청·산하기관·자치구 단위까지 세밀하게 좁혀서 조회 가능
- **최신성 확인**: 최종갱신일 기준 정렬 조회로, 실제로 운영·관리되고 있는 API를 우선 파악 가능
- **호출 비용 절감**: 인메모리 캐시와 재필터링 도구로 동일 조건 재질의 시 외부 API 재호출 없이 즉시 응답
- **문의 경로 확보**: 상세 조회 결과에 담당부서·연락처가 포함되어, 데이터 문의 시 바로 활용 가능

## 7. 시민 활용 예시

MCP가 찾아주는 실제 서울시 API를 조합하면 아래와 같은 서비스를 빠르게 구상·프로토타이핑할 수 있음.

- **등하굣길 안전 지도**
  - 활용 데이터: 안전비상벨 설치위치 정보, 자치구별 CCTV/방범 관련 데이터
  - 예시 질의: `recommend_seoul_apis_for_idea({ ideaText: "등하굣길에 있는 비상벨 위치를 보여주는 지도" })`

- **실시간 버스·따릉이 통합 이동 도우미**
  - 활용 데이터: 버스도착정보조회, 버스위치정보조회, 공공자전거 따릉이 실시간 대여정보
  - 예시 질의: `recommend_seoul_apis_for_idea({ ideaText: "정류장 도착 버스와 근처 따릉이 잔여 대수를 같이 보여주는 앱", realtimePreferred: true })`

- **우리 동네 창업 입지 분석**
  - 활용 데이터: 서울 생활인구(250m), 상권분석서비스(점포-상권/길단위인구)
  - 예시 질의: `recommend_seoul_apis_for_idea({ ideaText: "특정 지역 유동인구와 상권 매출을 비교해서 창업 입지를 추천하는 서비스" })`

- **자치구 인허가 현황 대시보드**
  - 활용 데이터: 자치구별 숙박업/위생업소 등 인허가 정보 시리즈
  - 예시 질의: `search_seoul_datasets({ query: "인허가", division: "자치구" })`

- **관리가 살아있는 API만 골라 빠르게 프로토타입 제작**
  - 활용 데이터: 최근 갱신 순으로 정렬된 API 목록
  - 예시 질의: `list_seoul_recent_updates({ keyword: "교통", apiOnly: true })`

## 8. 시스템 구성

```
AI 어시스턴트 (Claude / Cursor)
        │ MCP (stdio)
        ▼
seoul-opendata-mcp
  ├─ recommend_seoul_apis_for_idea   아이디어 → 키워드 → 검색 → 점수화 → 추천
  ├─ search_seoul_datasets           키워드 직접 검색
  ├─ list_seoul_recent_updates       최근 갱신일 기준 조회
  ├─ get_seoul_dataset_detail        서비스 ID 단건 조회
  └─ refine_seoul_recommendations    이전 결과 재필터링 (API 재호출 없음)
        │ HTTP GET
        ▼
openapi.seoul.go.kr:8088/{키}/json/SearchCatalogService/{시작}/{종료}/{ID}/{서비스명}/{기관명}/
```

## 9. 도구 명세

### 9.1 `recommend_seoul_apis_for_idea`

- **처리 순서**: 아이디어 텍스트 입력 → 키워드 추출(도메인 동의어 확장 포함) → 카탈로그 병렬 검색 → 점수화 → 상위 N개 반환

| 파라미터 | 타입 | 설명 |
|---|---|---|
| `ideaText` | string (필수) | 만들고 싶은 서비스 설명 |
| `apiOnly` | boolean | `SRV_TYPE`에 Api가 포함된 것만 반환 |
| `realtimePreferred` | boolean | 실시간/고빈도 갱신 데이터 우선 정렬 |
| `domainHint` | string | 도메인 힌트 (예: "교통", "따릉이") |
| `orgName` | string | 제공기관명으로 범위 축소 (예: "강남구") |
| `division` | string | "본청"/"산하기관"/"자치구" 포함 매칭 필터 |
| `limit` | number | 최대 추천 수 (기본 5, 최대 10) |

- **점수 배점 (95점 만점, 하위 호환 유지)**: 도메인 적합도 40 · 데이터 형태(`SRV_TYPE` 기준) 20 · 갱신주기 10 · 최신성 10 · 지역성 10 · 설명 품질 5
- **분리 점수(신규)**: 각 추천 결과에 `scoreBreakdown`(관련도·활용도 분리), `brm`(정책분야 분류), `organization`(제공기관 유형 분류)이 함께 반환됨 — 12장 참고. 기존 `score` 필드는 그대로 유지되므로 기존 소비자에는 영향 없음.
- **서비스 ID 우선 중복제거**: 여러 키워드 검색에서 동일 데이터가 중복 반환될 때 `INF_ID`(서비스 ID)가 있으면 ID 기준, 없으면 제목 기준으로 폴백 제거

### 9.2 `search_seoul_datasets`

- **기능**: 서비스명 키워드 직접 검색, 원시 결과 반환
- **필터**: `orgName`, `division` 동일 지원
- 각 결과 항목에 `brm`, `organization` 분류결과 포함(신규)

### 9.3 `list_seoul_recent_updates` (신규)

- **기능**: 키워드/기관/제공주체로 범위를 좁혀 최종갱신일(`DATA_LT_NM`) 내림차순 조회
- **용도**: 운영이 활발한 API를 우선 파악할 때 사용
- **비고**: 카탈로그 직접 연동 이후 신설한 기능으로, 신선도 기준 조회 자체가 이 프로젝트의 고유 기능
- 각 결과 항목에 `brm`, `organization` 분류결과 포함(신규)

### 9.4 `get_seoul_dataset_detail`

- **기능**: 서비스 ID(예: `OA-22784`) 또는 상세 URL로 단건 조회
- **반환 정보**: 제공기관, 담당부서, 갱신주기, 최종갱신일, `SRV_TYPE`
- **제약**: 개별 API의 요청 URL·파라미터 명세는 카탈로그 API 범위 밖 — 반환된 상세페이지 링크의 "Open API" 탭에서 확인 필요

### 9.5 `refine_seoul_recommendations`

- **기능**: 이전 추천 결과를 API 재호출 없이 재필터링·재정렬

## 9. 정책분야(BRM)·기관유형 분류 및 분리 점수

카탈로그 공식 필드만으로 판별하며, 근거가 없으면 추측하지 않고 미분류/기타로 남긴다.

### 9.1 정책분야(BRM) 분류 — `src/classification/brmCategory.ts`

카탈로그 전체 8,255건 실측 결과 `MAP_CATE_NM`(소분류) 필드가 아래 12개 정책분야와 전 건 1:1로 일치함을 확인했다.

| 분야 | 건수 | 분야 | 건수 |
|---|---|---|---|
| 보건 | 1,800 | 안전 | 244 |
| 문화/관광 | 1,634 | 인구/가구 | 256 |
| 산업/경제 | 936 | 도시관리 | 233 |
| 복지 | 647 | 주택/건설 | 157 |
| 교육 | 625 | 일반행정 | 549 |
| 환경 | 605 | 교통 | 569 |

- 1순위: `MAP_CATE_NM` 정규화 매칭 → `source: "catalog_map_category"`, `confidence: "high"`
- 2순위(보조): 다른 공식 텍스트 필드에서 분야명 부분일치 → `source: "keyword_inference"`, `confidence: "low"`
- 근거 없음: `primary: null`, `source: "unclassified"` — 공식 BRM 코드(2·3·4차)는 응답에 없으므로 임의 생성하지 않음(`code`는 항상 `null`)

### 9.2 제공기관 유형 분류 — `src/classification/organizationType.ts`

`DITC_NM`(제공 주체 구분) 실측 6개 값을 직접 매핑한다(별도 공식 레지스트리 없이도 고신뢰 분류 가능).

| DITC_NM 원본값 | 건수 | 매핑 유형 |
|---|---|---|
| 서울시(본청) | 5,276 | headquarters — 서울시 본청 |
| 자치구 및 자치구산하 | 2,134 | district — 자치구 |
| 서울시(사업소) | 12 | business_office — 사업소 |
| 서울시(산하기관) | 364 | invested_funded — 투자·출연기관 |
| 공공기관(외부) | 467 | other — 기타 기관 |
| 민간(기업) | 2 | other — 기타 기관 |

### 9.3 관련도(relevance)·활용도(quality) 분리 점수 — `src/ranking/scoreDataset.ts`, `src/config/scoringConfig.ts`

기존 legacy 95점 스코어(정렬·필터링에 계속 사용)는 그대로 두고, `recommend_seoul_apis_for_idea` 결과마다 `scoreBreakdown`을 추가로 반환한다. 배점은 `scoringConfig.ts`에 상수로 분리되어 있다.

- **질문 관련도** (`relevanceScore`, 배점 합 80): 데이터명·키워드·동의어 일치 40 · 정책분야(BRM) 일치 15 · 지역조건 일치 10 · 실시간성 요구 일치 10 · 제공기관 조건 일치 5
- **데이터 활용도** (`qualityScore`, 배점 합 65): 최신성 10 · 갱신주기 10 · 제공형식(OpenAPI/File/Sheet) 존재 15 · 제공기관·부서 존재 10 · 문의처 존재 5 · 공식 상세페이지 존재 5 · 메타정보 충실도 10 — 실제 상태점검을 하지 않은 API 가용성·갱신주기 준수 여부는 포함하지 않음
- `relevanceReasons`/`qualityReasons`에 각 배점이 부여된 근거를 사람이 읽을 수 있는 문장으로 함께 반환

### 9.4 서비스 ID 우선 중복제거 — `src/parsers/normalizeDataset.ts`

여러 키워드로 병렬 검색할 때 동일 데이터가 반복 반환될 수 있어, `INF_ID`(서비스 ID)가 있으면 ID 기준으로, 없으면 기존처럼 제목 기준으로 폴백해 중복을 제거한다(`deduplicateDatasets`). 기존 제목 기준 함수(`deduplicateByTitle`)는 하위 호환을 위해 그대로 남겨둔다.

## 10. 설치 및 실행

```bash
pnpm install
pnpm build
cp .env.example .env   # SEOUL_OPEN_DATA_API_KEY 입력
```

- 인증키 발급: [data.seoul.go.kr](https://data.seoul.go.kr) 마이페이지 → 인증키 신청
- 유의사항: 발급 즉시가 아니라 실제 반영까지 다소 시간이 걸릴 수 있음

## 11. MCP 등록

**Claude Code**

```bash
claude mcp add seoul-opendata-mcp -s user \
  -e SEOUL_OPEN_DATA_API_KEY="발급받은_인증키" \
  -- node "/절대경로/seoul-opendata-mcp/dist/server.js"
```

**Cursor / Claude Desktop** (`mcp.json` / `claude_desktop_config.json`)

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

## 12. 테스트·빌드

```bash
pnpm test    # vitest — 47개 테스트
pnpm build   # TypeScript 컴파일
pnpm dev     # 변경 감지 자동 재빌드
```

## 13. 사용 기술

TypeScript · Node.js 18+ · `@modelcontextprotocol/sdk` · zod · vitest · pnpm · GitHub Actions

## 14. 라이선스

MIT
