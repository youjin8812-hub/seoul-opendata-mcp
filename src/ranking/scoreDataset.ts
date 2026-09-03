/**
 * NormalizedDataset에 점수를 부여한다.
 *
 * 점수 구성 (총 95점 기준):
 *   도메인 적합도   40점  - 제목/태그(정책분야)에 검색 키워드 포함 여부
 *                          (원문 키워드 > 확장 유사어 가중, 키워드 수에 희석되지 않음)
 *   데이터 형태     20점  - API(20) > FILE(8) > UNKNOWN(3) — SRV_TYPE 기준
 *   업데이트 주기   10점  - 실시간/일별 데이터 우대
 *   최신성          10점  - 최근 수정일 우대 (최근 1년 만점)
 *   지역성          10점  - 지역 관련 요청 시 지역 데이터 우대
 *   설명 품질        5점  - 설명 길이/풍부도 (서울시 카탈로그는 설명 필드가 없어 대부분 0점)
 *
 * apiOnly=true 시 API 외 타입은 결과에서 제거된다.
 * 키워드가 주어진 질의에서 도메인 적합도가 0점인 데이터셋은 후보에서 제외된다.
 */

import type { NormalizedDataset, Recommendation, ScoreBreakdown, ScoreContext } from "../types/index.js";
import { RELEVANCE_WEIGHTS, QUALITY_WEIGHTS } from "../config/scoringConfig.js";

// ─── 업데이트 주기 점수 (0~10) ────────────────────────────────────────────────

function cycleScore(cycle: string): number {
  const c = cycle.toLowerCase();
  if (c.includes("실시간") || c.includes("매일") || c.includes("daily")) return 10;
  if (c.includes("주") || c.includes("weekly")) return 7;
  if (c.includes("월") || c.includes("monthly")) return 5;
  if (c.includes("분기") || c.includes("반기")) return 3;
  if (c.includes("연") || c.includes("yearly") || c.includes("annual")) return 1;
  return 3; // 미확인
}

// ─── 최신성 점수 (0~10) — 최근 1년이면 만점 ──────────────────────────────────

function recencyScore(lastUpdated: string): number {
  if (!lastUpdated) return 3;
  const updated = new Date(lastUpdated).getTime();
  if (isNaN(updated)) return 3;
  const ageMs = Date.now() - updated;
  const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
  if (ageMonths <= 3) return 10;
  if (ageMonths <= 6) return 8;
  if (ageMonths <= 12) return 6;
  if (ageMonths <= 24) return 4;
  if (ageMonths <= 36) return 2;
  return 1;
}

// ─── 도메인 적합도 점수 (0~40) ────────────────────────────────────────────────

/**
 * 매칭 위치별 배점. 유사어 확장으로 키워드 수가 늘어나도 점수가 희석되지 않도록,
 * "매칭 비율(matches / keywords.length)"이 아니라 "매칭 건별 가산 후 상한"으로 계산한다.
 *
 * 기존 비율 방식에서는 유사어를 늘릴수록 분모가 커져서 정작 관련 있는 데이터의
 * 점수가 떨어지는 역효과가 있었다 (유사어 2개 49점 → 7개 28점).
 */
const MATCH_POINTS = {
  /** 사용자가 실제로 입력한 키워드 */
  core: { title: 12, tag: 5, body: 3 },
  /** 사전에서 파생된 확장 유사어 — 원문 키워드보다 낮게 본다 */
  expanded: { title: 7, tag: 3, body: 2 },
} as const;

/** 키워드가 없을 때(필터 전용 질의)의 중립 점수 */
const NEUTRAL_DOMAIN_SCORE = 20;

function domainScore(
  dataset: NormalizedDataset,
  keywords: string[],
  coreKeywords?: string[]
): number {
  if (keywords.length === 0) return NEUTRAL_DOMAIN_SCORE;

  const titleText = dataset.title.toLowerCase();
  const bodyText = `${dataset.description} ${dataset.provider}`.toLowerCase();
  const tagText = dataset.tags.join(" ").toLowerCase();

  // coreKeywords가 전달되지 않으면(레거시 호출) 모든 키워드를 원문 키워드로 본다
  const coreSet = new Set(
    (coreKeywords ?? keywords).map((k) => k.toLowerCase())
  );

  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    const points = coreSet.has(k) ? MATCH_POINTS.core : MATCH_POINTS.expanded;

    // 한 키워드는 가장 강한 매칭 위치 하나만 인정한다 (제목 > 태그 > 본문)
    if (titleText.includes(k)) score += points.title;
    else if (tagText.includes(k)) score += points.tag;
    else if (bodyText.includes(k)) score += points.body;
  }

  return Math.min(40, score);
}

// ─── 지역성 점수 (0~10) ───────────────────────────────────────────────────────

const REGION_TERMS = ["지역", "전국", "시", "군", "구", "도", "특별시", "광역시"];

function regionScore(dataset: NormalizedDataset, keywords: string[]): number {
  const hasRegionKw = keywords.some((kw) => REGION_TERMS.some((r) => kw.includes(r)));
  if (!hasRegionKw) return 5; // 지역성 무관 요청이면 중립
  const text = `${dataset.title} ${dataset.description}`.toLowerCase();
  const matches = REGION_TERMS.filter((r) => text.includes(r)).length;
  return Math.min(10, matches * 3);
}

// ─── 설명 품질 점수 (0~5) ─────────────────────────────────────────────────────

function descriptionScore(dataset: NormalizedDataset): number {
  const len = dataset.description.length;
  if (len > 100) return 5;
  if (len > 50) return 4;
  if (len > 20) return 2;
  return 0;
}

// ─── 추천 이유 텍스트 생성 ────────────────────────────────────────────────────

function buildReason(dataset: NormalizedDataset, keywords: string[]): string {
  const matchedKws = keywords
    .filter((kw) =>
      `${dataset.title} ${dataset.description} ${dataset.tags.join(" ")}`
        .toLowerCase()
        .includes(kw.toLowerCase())
    )
    .slice(0, 3);

  const parts: string[] = [];

  if (matchedKws.length > 0) {
    parts.push(`'${matchedKws.join("', '")}'와(과) 관련됩니다`);
  }
  if (dataset.type === "API") {
    parts.push("OpenAPI 형태로 직접 호출 가능합니다");
  }
  if (dataset.tags.length > 0) {
    parts.push(`태그: ${dataset.tags.slice(0, 3).join(", ")}`);
  }
  if (dataset.provider && dataset.provider !== "미상") {
    parts.push(`${dataset.provider} 제공`);
  }

  if (parts.length === 0) parts.push("검색 결과에서 상위 매칭됩니다");
  return parts.join(". ") + ".";
}

// ─── 관련도·활용도 분리 점수 ──────────────────────────────────────────────────
// legacy score(위 서브함수들)를 재사용하되, 별도 배점(scoringConfig.ts)으로
// "질문 관련도"와 "데이터 활용도"를 분리해 계산한다. legacy 점수·정렬에는 영향 없음.

function relevanceBreakdown(
  dataset: NormalizedDataset,
  keywords: string[],
  realtimePreferred: boolean,
  hasOrgFilter: boolean,
  coreKeywords?: string[]
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 데이터명·키워드·동의어 일치 — 기존 도메인 점수(0~40)를 그대로 재사용
  const keywordScore = Math.min(
    RELEVANCE_WEIGHTS.keywordMatch,
    domainScore(dataset, keywords, coreKeywords)
  );
  if (keywordScore > 0) {
    score += keywordScore;
    reasons.push(`데이터명/태그가 검색 키워드와 일치 (+${keywordScore})`);
  }

  // 정책분야(BRM) 일치 — 키워드가 분류된 정책분야명을 포함하는지 확인
  const primary = dataset.brm.primary;
  if (primary && keywords.some((kw) => primary.includes(kw) || kw.includes(primary))) {
    score += RELEVANCE_WEIGHTS.policyFieldMatch;
    reasons.push(`정책분야 '${primary}'가 질문과 일치 (+${RELEVANCE_WEIGHTS.policyFieldMatch})`);
  }

  // 지역조건 일치 — 기존 지역 점수(0~10) 재사용
  const region = regionScore(dataset, keywords);
  if (region > 5) {
    const bonus = Math.min(RELEVANCE_WEIGHTS.regionMatch, region);
    score += bonus;
    reasons.push(`지역조건 일치 (+${bonus})`);
  }

  // 실시간성 요구 일치
  if (realtimePreferred && cycleScore(dataset.updateCycle) >= 8) {
    score += RELEVANCE_WEIGHTS.realtimeMatch;
    reasons.push(`실시간성 요구와 일치하는 갱신주기 (+${RELEVANCE_WEIGHTS.realtimeMatch})`);
  }

  // 제공기관 조건 일치 — orgName 필터가 지정된 경우, 검색 단계에서 이미 필터링되어 항상 매칭됨
  if (hasOrgFilter) {
    score += RELEVANCE_WEIGHTS.organizationMatch;
    reasons.push(`지정한 제공기관 조건과 일치 (+${RELEVANCE_WEIGHTS.organizationMatch})`);
  }

  return { score, reasons };
}

function qualityBreakdown(dataset: NormalizedDataset): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const raw = dataset._raw;

  // 최신성 — 기존 최신성 점수(0~10) 재사용
  const recency = recencyScore(dataset.lastUpdated);
  score += recency;
  if (recency >= 8) reasons.push(`최근에 갱신된 데이터 (+${recency})`);

  // 갱신주기 — 기존 주기 점수(0~10) 재사용
  const cycle = cycleScore(dataset.updateCycle);
  score += cycle;
  if (cycle >= 7) reasons.push(`갱신주기가 양호함 (+${cycle})`);

  // 제공형식(OpenAPI/File/Sheet) 존재 여부
  const format =
    dataset.type === "API"
      ? QUALITY_WEIGHTS.formatAvailability
      : dataset.type === "FILE"
        ? Math.round(QUALITY_WEIGHTS.formatAvailability * 0.5)
        : Math.round(QUALITY_WEIGHTS.formatAvailability * 0.2);
  score += format;
  if (dataset.type === "API") reasons.push(`OpenAPI 형태로 제공 (+${format})`);

  // 제공기관·제공부서 존재 여부
  let orgPresence = 0;
  if (dataset.provider && dataset.provider !== "미상") orgPresence += QUALITY_WEIGHTS.organizationPresence / 2;
  if (raw.mngStationName?.trim()) orgPresence += QUALITY_WEIGHTS.organizationPresence / 2;
  score += orgPresence;
  if (orgPresence > 0) reasons.push(`제공기관/부서 정보 확인됨 (+${orgPresence})`);

  // 담당부서·문의처 존재 여부
  if (raw.managerPhone?.trim() || raw.managerName?.trim()) {
    score += QUALITY_WEIGHTS.contactPresence;
    reasons.push(`문의처 정보 확인됨 (+${QUALITY_WEIGHTS.contactPresence})`);
  }

  // 공식 상세페이지 존재 여부
  if (raw.shortUrl?.trim()) {
    score += QUALITY_WEIGHTS.detailPagePresence;
    reasons.push(`공식 상세페이지 확인됨 (+${QUALITY_WEIGHTS.detailPagePresence})`);
  }

  // 메타정보 충실도 — 핵심 필드 채움 비율
  const fields = [
    raw.mngOrganName,
    raw.mngStationName,
    raw.managerPhone,
    raw.chngLoadNm,
    raw.dataLtNm,
    raw.srvType,
    raw.shortUrl,
  ];
  const filled = fields.filter((f) => f?.trim()).length;
  const completeness = Math.round((filled / fields.length) * QUALITY_WEIGHTS.metadataCompleteness);
  score += completeness;

  return { score, reasons };
}

export function computeScoreBreakdown(
  dataset: NormalizedDataset,
  legacyScore: number,
  ctx: ScoreContext
): ScoreBreakdown {
  const relevance = relevanceBreakdown(
    dataset,
    ctx.keywords,
    ctx.realtimePreferred,
    Boolean(ctx.orgFilterApplied),
    ctx.coreKeywords
  );
  const quality = qualityBreakdown(dataset);

  return {
    legacyScore,
    relevanceScore: relevance.score,
    qualityScore: quality.score,
    relevanceReasons: relevance.reasons,
    qualityReasons: quality.reasons,
  };
}

// ─── 메인 점수화 함수 ─────────────────────────────────────────────────────────

export function scoreAndRank(
  datasets: NormalizedDataset[],
  ctx: ScoreContext
): Recommendation[] {
  const { keywords, coreKeywords, apiOnly, realtimePreferred } = ctx;

  // 최소 점수 임계값: 키워드와 전혀 관련 없는 결과를 제거 (95점 만점 기준)
  const MIN_SCORE = 15;

  return datasets
    .filter((d) => {
      if (apiOnly && d.type !== "API") return false;
      // 관련도 게이트: 키워드가 있는 질의인데 어떤 키워드에도 걸리지 않는 데이터는
      // 후보에서 제외한다. 이 가드가 없으면 도메인 0점짜리도 형태(20)+주기(10)+
      // 최신성(10)+지역(5) = 45점을 그대로 받아 MIN_SCORE를 항상 통과했다.
      if (keywords.length > 0 && domainScore(d, keywords, coreKeywords) === 0) return false;
      return true;
    })
    .map((d) => {
      let score = 0;

      score += domainScore(d, keywords, coreKeywords);          // 최대 40
      // API(20) > FILE(8) > UNKNOWN(3) — SRV_TYPE 기준 타입별 우대
      score += d.type === "API" ? 20 : d.type === "FILE" ? 8 : 3;
      score += cycleScore(d.updateCycle);          // 최대 10
      score += recencyScore(d.lastUpdated);        // 최대 10
      score += regionScore(d, keywords);           // 최대 10
      score += descriptionScore(d);               // 최대 5

      // 실시간 우선 요청 시 추가 boost
      if (realtimePreferred && cycleScore(d.updateCycle) >= 8) {
        score += 8;
      }

      return {
        title: d.title,
        provider: d.provider,
        type: d.type,
        updateCycle: d.updateCycle,
        reason: buildReason(d, keywords),
        score,
        detailUrl: d.detailUrl,
        brm: d.brm,
        organization: d.organization,
        scoreBreakdown: computeScoreBreakdown(d, score, ctx),
        lastUpdated: d.lastUpdated || undefined,
        department: d._raw.mngStationName?.trim() || undefined,
      } satisfies Recommendation;
    })
    .filter((rec) => rec.score >= MIN_SCORE) // 관련 없는 결과 제거
    .sort((a, b) => b.score - a.score);
}
