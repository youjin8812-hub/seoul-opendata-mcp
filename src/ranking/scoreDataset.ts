/**
 * NormalizedDataset 점수화 — 총 95점.
 *
 *   관련도 65점 : 키워드 47 · 정책분야 6 · 지역 5 · 실시간 4 · 제공기관 3
 *   활용도 30점 : 제공형식 10 · 갱신주기 8 · 최신성 8 · 메타충실도 4
 *
 * 설계 원칙
 *
 *   1) 점수는 한 곳에서만 계산한다.
 *      score === relevanceScore + qualityScore 가 항상 성립하므로,
 *      표에 찍힌 점수와 근거(관련도/활용도)가 어긋나지 않는다.
 *
 *   2) 관련도가 순위를 지배한다.
 *      관련도(65) > 활용도(30)이므로, 주제가 안 맞는 데이터가 OpenAPI·실시간·
 *      최신이라는 이유만으로 유관 데이터를 밀어내는 일이 구조적으로 불가능하다.
 *
 *   3) 조건부 항목은 "요구가 있을 때만" 배점에 들어간다.
 *      자치구를 지목하지 않은 질의에서 지역 5점은 전 건 0점이라 무의미하고,
 *      만점 대비 비율만 왜곡한다. 그래서 적용 가능한 항목의 배점 합을 분모로
 *      정규화한다 — 질의 조건을 온전히 충족한 데이터는 어떤 질의에서든
 *      관련도 65점(총점 95점)에 도달할 수 있다.
 *
 *   4) 유관하지 않은 데이터는 아예 내보내지 않는다.
 *      키워드 커버리지 게이트(MIN_KEYWORD_RATIO)와 총점 하한(MIN_TOTAL_SCORE)을
 *      모두 통과해야 결과에 남는다. 다만 전부 탈락하면 빈손으로 돌려주는 대신
 *      제목·태그에 걸린 후보만 완화 기준으로 되살린다.
 */

import type {
  NormalizedDataset,
  Recommendation,
  ScoreBreakdown,
  ScoreContext,
} from "../types/index.js";
import {
  MIN_KEYWORD_RATIO,
  MIN_TOTAL_SCORE,
  RELATIVE_KEYWORD_RATIO,
  NEUTRAL_RELEVANCE_RATIO,
  QUALITY_WEIGHTS,
  RELEVANCE_MAX,
  RELEVANCE_WEIGHTS,
} from "../config/scoringConfig.js";
import {
  buildKeywordStats,
  matchKeywords,
  type KeywordMatchResult,
  type KeywordStat,
} from "./keywordMatch.js";
import { detectQueryDistricts, matchesDistricts } from "./regionMatch.js";
import { inferQueryPolicyFields } from "./policyFieldMatch.js";

// ─── 활용도 세부 점수 ─────────────────────────────────────────────────────────

/**
 * 갱신주기 점수 (0~8).
 * 카탈로그 실제 값: "일간"·"수시"·"주간"·"월간"·"분기별"·"반기별"·"연간"·"주기없음".
 * "주기없음"을 먼저 걸러야 한다 — 이전 구현은 includes("주")에 걸려
 * 갱신을 안 하는 데이터가 주간 갱신과 같은 7점을 받고 있었다.
 */
/** 일 단위 갱신 점수 — 실시간(만점) 바로 아래 */
const DAILY_CYCLE_SCORE = QUALITY_WEIGHTS.updateCycle - 1;

/** 실시간 요구를 온전히 충족한다고 보는 갱신주기 점수 (실시간·일간) */
const REALTIME_FULL_CYCLE = DAILY_CYCLE_SCORE;

/** 실시간 요구를 절반쯤 충족한다고 보는 갱신주기 점수 (수시·주간) */
const REALTIME_PARTIAL_CYCLE = Math.round(QUALITY_WEIGHTS.updateCycle * 0.75);

export function cycleScore(cycle: string): number {
  const c = (cycle ?? "").toLowerCase().replace(/\s/g, "");
  const max = QUALITY_WEIGHTS.updateCycle;

  if (!c) return 1;
  if (["주기없음", "해당없음", "없음", "미정", "미확인", "비정기"].some((t) => c.includes(t))) {
    return 1;
  }
  if (c.includes("실시간") || c.includes("realtime")) return max;
  if (c.includes("일간") || c.includes("매일") || c.includes("daily") || c.includes("일1회")) {
    return DAILY_CYCLE_SCORE;
  }
  if (c.includes("수시")) return Math.round(max * 0.75); // 갱신 이벤트마다 반영 — 주간급으로 본다
  if (c.includes("주간") || c.includes("weekly") || c.includes("주1회")) return Math.round(max * 0.75);
  if (c.includes("월간") || c.includes("monthly") || c.includes("월1회") || c.includes("월")) {
    return Math.round(max * 0.5);
  }
  if (c.includes("분기") || c.includes("반기")) return Math.round(max * 0.25);
  if (c.includes("연간") || c.includes("yearly") || c.includes("annual") || c.includes("연")) {
    return 1;
  }
  return 2;
}

/** 최신성 점수 (0~8) — 최종갱신일 기준 */
export function recencyScore(lastUpdated: string): number {
  const max = QUALITY_WEIGHTS.recency;
  if (!lastUpdated) return 1;

  const updated = new Date(lastUpdated).getTime();
  if (Number.isNaN(updated)) return 1;

  const ageMonths = (Date.now() - updated) / (1000 * 60 * 60 * 24 * 30);
  if (ageMonths <= 3) return max;
  if (ageMonths <= 6) return Math.round(max * 0.875);
  if (ageMonths <= 12) return Math.round(max * 0.75);
  if (ageMonths <= 24) return Math.round(max * 0.5);
  if (ageMonths <= 36) return Math.round(max * 0.25);
  return 1;
}

/** 제공형식 점수 (0~10) — SRV_TYPE 기준 */
function formatScore(dataset: NormalizedDataset): number {
  const max = QUALITY_WEIGHTS.formatAvailability;
  if (dataset.type === "API") return max;
  if (dataset.type === "FILE") return Math.round(max * 0.5);
  return 1;
}

/** 메타정보 충실도 (0~4) — 실무에서 바로 쓸 수 있는 정보가 채워져 있는지 */
function metadataScore(dataset: NormalizedDataset): number {
  const raw = dataset._raw;
  const fields = [
    raw.mngOrganName,
    raw.mngStationName,
    raw.managerPhone || raw.managerName,
    raw.chngLoadNm,
    raw.dataLtNm,
    raw.srvType,
    raw.shortUrl,
  ];
  const filled = fields.filter((f) => f?.trim()).length;
  return Math.round((filled / fields.length) * QUALITY_WEIGHTS.metadataCompleteness);
}

function qualityBreakdown(dataset: NormalizedDataset): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];

  const format = formatScore(dataset);
  const cycle = cycleScore(dataset.updateCycle);
  const recency = recencyScore(dataset.lastUpdated);
  const metadata = metadataScore(dataset);

  if (dataset.type === "API") reasons.push(`OpenAPI로 바로 호출 가능 (+${format})`);
  else if (dataset.type === "FILE") reasons.push(`파일 데이터 (+${format})`);

  if (cycle >= REALTIME_PARTIAL_CYCLE) {
    reasons.push(`갱신주기 '${dataset.updateCycle}' (+${cycle})`);
  } else if (cycle <= 1) {
    reasons.push(`갱신주기 '${dataset.updateCycle || "미확인"}' — 갱신이 드묾 (+${cycle})`);
  }

  if (recency >= QUALITY_WEIGHTS.recency * 0.75) {
    reasons.push(`최근 갱신됨 (${dataset.lastUpdated}) (+${recency})`);
  } else if (recency <= 2 && dataset.lastUpdated) {
    reasons.push(`최종갱신 ${dataset.lastUpdated} — 오래됨 (+${recency})`);
  }

  reasons.push(`메타정보 충실도 (+${metadata})`);

  return { score: format + cycle + recency + metadata, reasons };
}

// ─── 관련도 ───────────────────────────────────────────────────────────────────

/** 질의 한 건에 대해 후보군 전체에서 한 번만 계산하는 값 */
export interface RelevanceContext {
  keywordStats: KeywordStat[];
  districts: string[];
  policyFields: ReturnType<typeof inferQueryPolicyFields>;
  hasKeywords: boolean;
  orgFilter: string;
  realtimePreferred: boolean;
}

export function buildRelevanceContext(
  datasets: NormalizedDataset[],
  ctx: ScoreContext
): RelevanceContext {
  const keywords = ctx.keywords ?? [];
  const coreKeywords = ctx.coreKeywords;

  return {
    keywordStats: buildKeywordStats(datasets, keywords, coreKeywords),
    districts: detectQueryDistricts(coreKeywords?.length ? coreKeywords : keywords),
    policyFields: inferQueryPolicyFields(keywords, coreKeywords),
    hasKeywords: keywords.length > 0,
    orgFilter: (ctx.orgFilter ?? "").trim(),
    realtimePreferred: Boolean(ctx.realtimePreferred),
  };
}

interface RelevanceResult {
  /** 0~65 */
  score: number;
  /** 적용 가능한 배점 대비 충족 비율 (0~1) */
  ratio: number;
  keywordMatch: KeywordMatchResult;
  reasons: string[];
}

/** 배점 항목 하나 — weight는 적용 가능할 때만 분모에 들어간다 */
interface Criterion {
  weight: number;
  earned: number;
  reason?: string;
}

function relevanceBreakdown(
  dataset: NormalizedDataset,
  rc: RelevanceContext
): RelevanceResult {
  const criteria: Criterion[] = [];
  const keywordMatch = matchKeywords(dataset, rc.keywordStats);

  // 1. 키워드 일치 (47) — IDF 가중 커버리지
  if (keywordMatch.applicable) {
    const earned = RELEVANCE_WEIGHTS.keyword * keywordMatch.ratio;
    criteria.push({
      weight: RELEVANCE_WEIGHTS.keyword,
      earned,
      reason:
        keywordMatch.matched.length > 0
          ? `'${keywordMatch.matched.slice(0, 4).join("', '")}' 일치 — 질의 충족률 ${Math.round(
              keywordMatch.ratio * 100
            )}% (+${Math.round(earned)})`
          : `질의 키워드와 일치하는 부분이 없음 (+0)`,
    });
  }

  // 2. 정책분야(BRM) 일치 (6) — 질의에서 분야가 추론될 때만.
  // 분야가 미분류인 데이터는 판정 근거가 없으므로 항목 자체를 적용하지 않는다
  // (없는 정보를 이유로 감점하지 않는다).
  const primaryField = dataset.brm?.primary ?? null;
  if (rc.policyFields.length > 0 && primaryField !== null) {
    const hit = rc.policyFields.includes(primaryField);
    criteria.push({
      weight: RELEVANCE_WEIGHTS.policyField,
      earned: hit ? RELEVANCE_WEIGHTS.policyField : 0,
      reason: hit
        ? `정책분야 '${primaryField}'가 질의 분야(${rc.policyFields.join("·")})와 일치 (+${RELEVANCE_WEIGHTS.policyField})`
        : `정책분야 '${primaryField}' — 질의 분야(${rc.policyFields.join("·")})와 다름 (+0)`,
    });
  }

  // 3. 지역(자치구) 일치 (5) — 질의가 자치구를 지목했을 때만
  if (rc.districts.length > 0) {
    const hit = matchesDistricts(dataset, rc.districts);
    criteria.push({
      weight: RELEVANCE_WEIGHTS.region,
      earned: hit ? RELEVANCE_WEIGHTS.region : 0,
      reason: hit
        ? `지목한 자치구(${rc.districts.join("·")}) 데이터 (+${RELEVANCE_WEIGHTS.region})`
        : undefined,
    });
  }

  // 4. 실시간성 요구 일치 (4) — 실시간을 요청했을 때만
  if (rc.realtimePreferred) {
    const cycle = cycleScore(dataset.updateCycle);
    const full = cycle >= REALTIME_FULL_CYCLE;
    const partial = cycle >= REALTIME_PARTIAL_CYCLE;
    const earned = full
      ? RELEVANCE_WEIGHTS.realtime
      : partial
        ? RELEVANCE_WEIGHTS.realtime / 2
        : 0;
    criteria.push({
      weight: RELEVANCE_WEIGHTS.realtime,
      earned,
      reason:
        earned > 0
          ? `실시간 요구에 맞는 갱신주기 '${dataset.updateCycle}' (+${earned})`
          : undefined,
    });
  }

  // 5. 제공기관 조건 일치 (3) — 제공기관을 지정했을 때만
  if (rc.orgFilter) {
    const hit = `${dataset.provider} ${dataset._raw?.mngStationName ?? ""}`.includes(
      rc.orgFilter
    );
    criteria.push({
      weight: RELEVANCE_WEIGHTS.organization,
      earned: hit ? RELEVANCE_WEIGHTS.organization : 0,
      reason: hit
        ? `지정한 제공기관 '${rc.orgFilter}' 데이터 (+${RELEVANCE_WEIGHTS.organization})`
        : undefined,
    });
  }

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const totalEarned = criteria.reduce((sum, c) => sum + c.earned, 0);

  // 적용 가능한 항목이 하나도 없는 질의(키워드·필터 없음)는 중립 처리한다
  const ratio =
    totalWeight > 0 ? Math.min(1, totalEarned / totalWeight) : NEUTRAL_RELEVANCE_RATIO;

  return {
    score: Math.round(RELEVANCE_MAX * ratio),
    ratio,
    keywordMatch,
    reasons: criteria
      .map((c) => c.reason)
      .filter((r): r is string => Boolean(r)),
  };
}

// ─── 추천 이유 ────────────────────────────────────────────────────────────────

function buildReason(
  dataset: NormalizedDataset,
  relevance: RelevanceResult
): string {
  const parts: string[] = [];

  const matched = relevance.keywordMatch.matched.slice(0, 3);
  if (matched.length > 0) {
    parts.push(`'${matched.join("', '")}'와(과) 직접 관련됩니다`);
  }
  if (dataset.brm?.primary) {
    parts.push(`정책분야는 ${dataset.brm.primary}입니다`);
  }
  if (dataset.type === "API") {
    parts.push("OpenAPI로 바로 호출할 수 있습니다");
  } else if (dataset.type === "FILE") {
    parts.push("파일(CSV/XLS) 내려받기로 제공됩니다");
  }
  if (dataset.provider && dataset.provider !== "미상") {
    parts.push(`${dataset.provider} 제공`);
  }

  if (parts.length === 0) parts.push("검색 결과에서 상위 매칭됩니다");
  return parts.join(". ") + ".";
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 데이터셋 하나의 점수 내역을 계산한다.
 * @param pool 이 데이터셋이 속한 후보군 — IDF 가중 계산의 기준이 된다.
 *             생략하면 자기 자신만으로 계산하므로, 여러 건을 비교할 때는
 *             scoreAndRank를 쓰거나 후보군 전체를 넘겨야 한다.
 */
export function computeScoreBreakdown(
  dataset: NormalizedDataset,
  ctx: ScoreContext,
  pool?: NormalizedDataset[]
): ScoreBreakdown {
  const rc = buildRelevanceContext(pool ?? [dataset], ctx);
  return evaluate(dataset, rc).breakdown;
}

/** 데이터셋 하나를 채점한다 — 점수·근거·정렬 키를 한 번에 만든다 */
function evaluate(dataset: NormalizedDataset, rc: RelevanceContext) {
  const relevance = relevanceBreakdown(dataset, rc);
  const quality = qualityBreakdown(dataset);
  const score = relevance.score + quality.score;

  const breakdown: ScoreBreakdown = {
    totalScore: score,
    relevanceScore: relevance.score,
    qualityScore: quality.score,
    relevanceRatio: Number(relevance.ratio.toFixed(3)),
    matchedKeywords: relevance.keywordMatch.matched,
    relevanceReasons: relevance.reasons,
    qualityReasons: quality.reasons,
  };

  return { relevance, score, breakdown };
}

/** 정렬 안정화용 — 점수가 같으면 관련도 > 형태 > 최신성 순으로 가른다 */
function typeRank(type: NormalizedDataset["type"]): number {
  return type === "API" ? 2 : type === "FILE" ? 1 : 0;
}

export function scoreAndRank(
  datasets: NormalizedDataset[],
  ctx: ScoreContext
): Recommendation[] {
  const candidates = ctx.apiOnly ? datasets.filter((d) => d.type === "API") : datasets;
  if (candidates.length === 0) return [];

  // IDF 가중은 실제로 비교 대상이 되는 후보군 전체를 기준으로 한 번만 계산한다
  const rc = buildRelevanceContext(candidates, ctx);

  const scored = candidates.map((dataset) => {
    const { relevance, score, breakdown } = evaluate(dataset, rc);

    const recommendation: Recommendation = {
      title: dataset.title,
      provider: dataset.provider,
      type: dataset.type,
      updateCycle: dataset.updateCycle,
      reason: buildReason(dataset, relevance),
      score,
      detailUrl: dataset.detailUrl,
      brm: dataset.brm,
      organization: dataset.organization,
      scoreBreakdown: breakdown,
      lastUpdated: dataset.lastUpdated || undefined,
      department: dataset._raw.mngStationName?.trim() || undefined,
    };

    return { dataset, recommendation, relevance };
  });

  const sortByScore = (
    a: (typeof scored)[number],
    b: (typeof scored)[number]
  ): number =>
    b.recommendation.score - a.recommendation.score ||
    b.relevance.score - a.relevance.score ||
    typeRank(b.dataset.type) - typeRank(a.dataset.type) ||
    (b.dataset.lastUpdated || "").localeCompare(a.dataset.lastUpdated || "");

  // 키워드가 없는 질의(필터 전용)에는 관련도 게이트를 적용하지 않는다
  if (!rc.hasKeywords) {
    return scored.sort(sortByScore).map((s) => s.recommendation);
  }

  // 1차: 주제어 매칭·커버리지·총점 기준을 모두 통과한 데이터만 남긴다.
  // 커버리지 기준은 그 질의에서 실제로 도달 가능한 최고치를 함께 본다.
  const bestRatio = Math.max(0, ...scored.map((s) => s.relevance.keywordMatch.ratio));
  const ratioThreshold = Math.max(MIN_KEYWORD_RATIO, bestRatio * RELATIVE_KEYWORD_RATIO);

  const strict = scored.filter(
    (s) =>
      s.relevance.keywordMatch.primaryHit &&
      s.relevance.keywordMatch.ratio >= ratioThreshold &&
      s.recommendation.score >= MIN_TOTAL_SCORE
  );
  if (strict.length > 0) return strict.sort(sortByScore).map((s) => s.recommendation);

  // 2차(완화): 1차가 전멸하면 제목·태그에 걸린 후보만이라도 돌려준다.
  // 본문(제공기관·부서명)에만 걸린 건 우연 일치일 확률이 높아 끝까지 제외한다.
  return scored
    .filter((s) => s.relevance.keywordMatch.strongHits > 0)
    .sort(sortByScore)
    .map((s) => s.recommendation);
}
