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
  /** 소분류에서 파생된 태그 — brm.primary의 사본이며 점수화에는 쓰지 않는다 */
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
  /** 점수 내역 — 관련도(65)·활용도(30) 분해와 매칭 근거. 합계는 score와 같다 */
  scoreBreakdown?: ScoreBreakdown;
  /** 최종갱신일자 (YYYY-MM-DD) — 신규 필드 */
  lastUpdated?: string;
  /** 제공부서명 — 신규 필드 */
  department?: string;
}

/**
 * 점수 내역 — 총점 100점 = 관련도 70 + 활용도 30.
 * totalScore === relevanceScore + qualityScore === Recommendation.score 가 항상 성립한다.
 */
export interface ScoreBreakdown {
  /** 총점 (0~100) — Recommendation.score와 같은 값 */
  totalScore: number;
  /** 질문 관련도 (0~70) */
  relevanceScore: number;
  /** 데이터 활용도 (0~30) */
  qualityScore: number;
  /** 적용된 관련도 항목 대비 충족 비율 (0~1) */
  relevanceRatio: number;
  /** 실제로 일치한 키워드 (제목 일치 우선) */
  matchedKeywords: string[];
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
  /**
   * 호출하는 AI 어시스턴트가 제공하는 동의어·유의어 목록.
   * 서버 내장 사전이 모르는 신조어·정책용어를 보완한다
   * (예: "그늘맵" → ["그늘막", "무더위쉼터", "폭염저감시설", "쿨링포그"]).
   */
  synonyms?: string[];
}

/** 검색 키워드가 어디서 왔는지 — 유사어 확장 품질을 점검할 때 쓴다 */
export interface KeywordSources {
  /** 사용자 입력에서 직접 추출 */
  core: string[];
  /** 호출한 AI 어시스턴트가 넘긴 동의어 */
  client: string[];
  /** 카탈로그 실제 등재명에서 자동 확장 */
  catalog: string[];
  /** 서버 내장 사전에서 확장 */
  dictionary: string[];
}

export interface RecommendOutput {
  ideaSummary: string;
  extractedKeywords: string[];
  /** 키워드 출처별 내역 */
  keywordSources?: KeywordSources;
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
  /**
   * 사용자 입력에 실제로 등장한 키워드(확장 유사어 제외).
   * 키워드 일치 계산에서 확장 유사어보다 높은 가중을 받는다.
   * 생략하면 keywords 전체를 원문 키워드로 취급한다.
   */
  coreKeywords?: string[];
  apiOnly: boolean;
  realtimePreferred: boolean;
  /**
   * 제공기관명(orgName) 필터 값 — 관련도의 제공기관 항목 판정에 쓴다.
   * 산하기관 보조검색으로 다른 기관 데이터도 후보에 섞이므로,
   * "필터가 걸렸는가"가 아니라 "이 데이터가 그 기관 것인가"를 건별로 확인한다.
   */
  orgFilter?: string;
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
