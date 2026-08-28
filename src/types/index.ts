// ─── 외부 API 응답 원시 타입 ───────────────────────────────────────────────────

/** 서울 열린데이터광장 SearchCatalogService 응답 단건 (row) */
export interface RawSeoulCatalogItem {
  /** 서비스 ID (예: "OA-15529") */
  infId: string;
  /** 서비스명(제목) */
  infNm: string;
  /** 대분류 (예: "공공데이터", "통계") */
  cateNm: string;
  /** 중분류 — 제공 주체 구분 (예: "서울시(본청)", "서울시(산하기관)", "자치구 및 자치구산하") */
  ditcNm: string;
  /** 소분류 — 정책분야 (예: "교통", "환경", "일반행정") */
  mapCateNm: string;
  /** 제공기관명 */
  mngOrganName: string;
  /** 제공부서명 */
  mngStationName: string;
  /** 시스템명 */
  linkDesc: string;
  /** 제공사이트 */
  linkInfo: string;
  managerName: string;
  managerPhone: string;
  /** 갱신주기 (예: "일간", "수시", "주기없음") */
  chngLoadNm: string;
  /** 최종갱신일자 (YYYY-MM-DD) */
  dataLtNm: string;
  /** 제공형식 콤마 구분 (예: "File,Sheet,Api") — "Api" 포함 여부로 실제 OpenAPI 존재를 판별 */
  srvType: string;
  /** 데이터셋 상세페이지 URL */
  shortUrl: string;
}

// ─── 정책분야(BRM) 분류 ────────────────────────────────────────────────────────

export type BrmPrimaryCategory =
  | "보건"
  | "일반행정"
  | "문화/관광"
  | "산업/경제"
  | "복지"
  | "환경"
  | "교통"
  | "도시관리"
  | "교육"
  | "안전"
  | "인구/가구"
  | "주택/건설";

export interface BrmClassification {
  primary: BrmPrimaryCategory | null;
  secondary?: string | null;
  code?: string | null;
  source:
    | "catalog_map_category"
    | "official_brm_code"
    | "official_mapping"
    | "keyword_inference"
    | "unclassified";
  confidence: "high" | "medium" | "low";
}

// ─── 제공기관 유형 분류 ────────────────────────────────────────────────────────

export type OrganizationType =
  | "headquarters"
  | "district"
  | "business_office"
  | "invested_funded"
  | "other";

export interface OrganizationClassification {
  type: OrganizationType;
  label: string;
  organizationName: string;
  source:
    | "official_registry"
    | "raw_division"
    | "official_mapping"
    | "verified_name_rule"
    | "unclassified";
  confidence: "high" | "medium" | "low";
}

// ─── 정규화된 내부 타입 ────────────────────────────────────────────────────────

export type DatasetType = "API" | "FILE" | "UNKNOWN";

/** 내부에서 사용하는 정규화된 데이터셋 */
export interface NormalizedDataset {
  id: string;
  title: string;
  provider: string;
  type: DatasetType;
  description: string;
  updateCycle: string;
  /** 최종갱신일자 (YYYY-MM-DD, 점수화 최신성 계산용) */
  lastUpdated: string;
  detailUrl: string;
  /** 소분류 등에서 파생된 태그 */
  tags: string[];
  /** 제공 주체 구분 (예: "서울시(본청)", "서울시(산하기관)", "자치구 및 자치구산하") */
  division: string;
  /** 정책분야(BRM) 분류결과 */
  brm: BrmClassification;
  /** 제공기관 유형 분류결과 */
  organization: OrganizationClassification;
  /** 점수화에 활용될 raw 원본 보존 */
  _raw: RawSeoulCatalogItem;
}

// ─── 추천 타입 ────────────────────────────────────────────────────────────────

export interface Recommendation {
  title: string;
  provider: string;
  type: DatasetType;
  updateCycle: string;
  reason: string;
  score: number;
  detailUrl: string;
  /** 정책분야(BRM) 분류결과 — 신규 필드, 기존 소비자에는 영향 없음 */
  brm?: BrmClassification;
  /** 제공기관 유형 분류결과 — 신규 필드 */
  organization?: OrganizationClassification;
  /** 질문 관련도·데이터 활용도 분리 점수 — 신규 필드 (기존 legacy score는 그대로 유지) */
  scoreBreakdown?: ScoreBreakdown;
  /** 최종갱신일자 (YYYY-MM-DD) — 신규 필드 */
  lastUpdated?: string;
  /** 제공부서명 — 신규 필드 */
  department?: string;
}

/** 관련도·활용도 분리 점수 */
export interface ScoreBreakdown {
  legacyScore: number;
  relevanceScore: number;
  qualityScore: number;
  relevanceReasons: string[];
  qualityReasons: string[];
}

// ─── MCP Tool 입출력 타입 ──────────────────────────────────────────────────────

export interface RecommendInput {
  ideaText: string;
  apiOnly?: boolean;
  realtimePreferred?: boolean;
  domainHint?: string;
  limit?: number;
  /** 제공기관명 필터 (예: "강남구", "서울교통공사") */
  orgName?: string;
  /** 제공 주체 구분 필터 — "본청"/"산하기관"/"자치구" 중 포함 매칭 (예: "자치구") */
  division?: string;
}

export interface RecommendOutput {
  ideaSummary: string;
  extractedKeywords: string[];
  recommendations: Recommendation[];
  /** 일부 키워드 검색 실패 시 경고 메시지 */
  warning?: string;
}

export interface SearchInput {
  query: string;
  page?: number;
  limit?: number;
  /** 제공기관명 필터 (예: "강남구", "서울교통공사") */
  orgName?: string;
  /** 제공 주체 구분 필터 — "본청"/"산하기관"/"자치구" 중 포함 매칭 (예: "자치구") */
  division?: string;
}

export interface DatasetDetailInput {
  /** data.seoul.go.kr 데이터셋 상세 URL 또는 서비스 ID (예: "OA-15529") */
  detailUrl: string;
}

export interface SearchOutput {
  query: string;
  items: {
    title: string;
    summary?: string;
    provider?: string;
    detailUrl?: string;
    brm?: BrmClassification;
    organization?: OrganizationClassification;
  }[];
  /** 조건에 해당하는 카탈로그 전체 건수 (반환된 items 수보다 클 수 있음) */
  totalMatchCount: number;
}

export interface RefineInput {
  previousResults: Recommendation[];
  apiOnly?: boolean;
  realtimePreferred?: boolean;
  providerIncludes?: string;
}

export interface RefineOutput {
  recommendations: Recommendation[];
}

/** 스코어링에 사용되는 context */
export interface ScoreContext {
  keywords: string[];
  apiOnly: boolean;
  realtimePreferred: boolean;
  /** 제공기관명(orgName) 필터가 적용된 검색인지 여부 — 관련도 분리점수 계산에 사용 */
  orgFilterApplied?: boolean;
}

export interface ApiParameter {
  name: string;
  in: "query" | "body" | "path" | "header";
  required: boolean;
  type: string;
  description: string;
}

export interface DatasetDetailOutput {
  title: string;
  provider: string;
  baseUrl: string;
  endpoints: {
    method: string;
    path: string;
    summary: string;
    parameters: ApiParameter[];
  }[];
  authMethod: string;
  swaggerUrl: string;
  detailPageUrl: string;
  /** 추가 메타데이터, 안내 메시지 등 (응답 형식/주기/라이선스/수정일 등) */
  note?: string;
}

// ─── 최근 갱신 API 조회 ────────────────────────────────────────────────────────

export interface RecentUpdatesInput {
  /** 검색 키워드 (선택 — 비우면 전체 범위에서 조회) */
  keyword?: string;
  /** 제공기관명 필터 (예: "강남구") */
  orgName?: string;
  /** 제공 주체 구분 필터 — "본청"/"산하기관"/"자치구" 중 포함 매칭 */
  division?: string;
  /** true면 SRV_TYPE에 Api가 포함된 데이터만 반환 */
  apiOnly?: boolean;
  /** 최대 반환 수 (기본 10, 최대 30) */
  limit?: number;
}

export interface RecentUpdateItem {
  title: string;
  provider: string;
  division: string;
  type: DatasetType;
  updateCycle: string;
  lastUpdated: string;
  detailUrl: string;
  brm?: BrmClassification;
  organization?: OrganizationClassification;
}

export interface RecentUpdatesOutput {
  items: RecentUpdateItem[];
  /** 검색 조건에 해당하는 카탈로그 전체 건수 (SearchCatalogService list_total_count) */
  totalMatchCount: number;
  /** totalMatchCount가 조회 범위(최대 1,000건)를 넘어 일부 표본만으로 정렬했을 때의 안내 */
  note?: string;
}
