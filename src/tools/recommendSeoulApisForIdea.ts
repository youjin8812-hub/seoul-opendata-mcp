/**
 * recommend_seoul_apis_for_idea 핵심 로직.
 * 키워드 추출 → 서울 열린데이터광장 카탈로그(SearchCatalogService) 검색 → 정규화 → 점수화 → 상위 N개 반환.
 */

import type {
  RecommendInput,
  RecommendOutput,
  NormalizedDataset,
} from "../types/index.js";
import { extractKeywords } from "../parsers/extractKeywords.js";
import { searchSeoulCatalog, getServiceKey } from "../services/seoulCatalogService.js";
import { normalizeDatasets, deduplicateDatasets } from "../parsers/normalizeDataset.js";
import { scoreAndRank } from "../ranking/scoreDataset.js";
import { MemoryCache, normalizeCacheKey, isRealtimeQuery, TTL } from "../cache/memoryCache.js";
import { matchesDivision } from "../utils/divisionMatch.js";
import { logger } from "../utils/logger.js";

const resultCache = new MemoryCache<RecommendOutput>(5 * 60 * 1000);

/**
 * 카탈로그를 병렬 검색할 키워드 개수 상한.
 * "그늘맵"처럼 원문 키워드 자체로는 카탈로그에 걸리지 않는 신조어가 많아,
 * 확장 유사어까지 검색해야 후보군이 확보된다 (기존 5 → 8).
 */
const MAX_SEARCH_QUERIES = 8;

/** 키워드 1개당 가져올 카탈로그 건수 */
const PER_QUERY_SIZE = 20;

/** 아이디어 요약 — 첫 30자 + 말줄임표 */
function summarize(text: string): string {
  return text.length > 30 ? text.slice(0, 30) + "..." : text;
}

// ─── 서울시 산하기관 별칭 → 공식명 매핑 ───────────────────────────────────────
// 사용자가 약칭으로 언급한 서울시 산하기관을 공식 이름으로 변환해 제공기관명 필터에 활용

const ORG_ALIASES: Record<string, string> = {
  교통공사: "서울교통공사",
  지하철공사: "서울교통공사",
  시설공단: "서울시설공단",
  SH공사: "서울주택도시공사",
  sh공사: "서울주택도시공사",
  주택도시공사: "서울주택도시공사",
  에너지공사: "서울에너지공사",
  농수산식품공사: "서울농수산식품공사",
  가락시장: "서울농수산식품공사",
  신용보증재단: "서울신용보증재단",
  관광재단: "서울관광재단",
  디지털재단: "서울디지털재단",
  시립대: "서울시립대학교",
  의료원: "서울의료원",
};

/** 아이디어 텍스트에서 감지된 서울시 산하기관 공식명 반환 */
function detectOrganizations(text: string): string[] {
  const found = new Set<string>();
  for (const [alias, official] of Object.entries(ORG_ALIASES)) {
    if (text.includes(alias)) {
      found.add(official);
    }
  }
  return [...found];
}

export async function recommendSeoulApisForIdea(
  input: RecommendInput
): Promise<RecommendOutput> {
  const {
    ideaText,
    apiOnly = false,
    realtimePreferred = false,
    domainHint,
    limit = 5,
    orgName,
    division,
  } = input;

  const cacheKey = normalizeCacheKey(
    `${ideaText}|${apiOnly}|${realtimePreferred}|${domainHint ?? ""}|${limit}|${orgName ?? ""}|${division ?? ""}`
  );

  const cached = resultCache.get(cacheKey);
  if (cached) {
    logger.info("캐시 히트", { cacheKey });
    return cached;
  }

  // 1. 키워드 추출
  const { keywords, coreKeywords, isRealtimeHinted } = extractKeywords(ideaText, domainHint);
  const effectiveRealtime = realtimePreferred || isRealtimeHinted;

  logger.info("추출된 키워드", { keywords, coreKeywords, effectiveRealtime });

  const searchQueries = keywords.slice(0, MAX_SEARCH_QUERIES);
  if (searchQueries.length === 0) {
    searchQueries.push(ideaText.slice(0, 20));
  }

  const detectedOrgs = detectOrganizations(ideaText + " " + (domainHint ?? ""));
  const explicitOrg = orgName?.trim() || undefined;
  logger.info("제공기관 필터", { explicitOrg, detectedOrgs });

  // 2. 카탈로그 API 병렬 호출
  const serviceKey = getServiceKey();

  const searches = [
    // 키워드별 서비스명 검색 — orgName이 명시되면 모든 키워드 검색에 함께 적용
    ...searchQueries.map((kw) =>
      searchSeoulCatalog(
        { keyword: kw, orgName: explicitOrg, start: 1, end: PER_QUERY_SIZE },
        serviceKey
      )
    ),
    // 텍스트에서 감지된 산하기관 필터 검색 추가 (명시적 orgName과 별개로 보조 검색)
    ...detectedOrgs
      .filter((org) => org !== explicitOrg)
      .map((org) =>
        searchSeoulCatalog(
          { keyword: keywords[0] ?? "", orgName: org, start: 1, end: PER_QUERY_SIZE },
          serviceKey
        )
      ),
  ];

  const fetchResults = await Promise.allSettled(searches);

  const errors = fetchResults
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  const rawItems = fetchResults
    .filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof searchSeoulCatalog>>> =>
        r.status === "fulfilled"
    )
    .flatMap((r) => r.value.items);

  logger.info("검색 결과 수집", { count: rawItems.length, errors });

  // 모든 검색이 실패한 경우 — 빈 결과 대신 명확한 오류를 throw
  if (rawItems.length === 0 && errors.length > 0) {
    const firstError = errors[0] ?? "알 수 없는 오류";
    const isAvailability =
      firstError.includes("타임아웃") ||
      firstError.includes("네트워크") ||
      firstError.includes("HTTP 5");

    throw new Error(
      isAvailability
        ? `서울 열린데이터광장 API 일시 불가: ${firstError}. 잠시 후 다시 시도해 주세요.`
        : firstError
    );
  }

  // 3. 정규화 + 중복 제거(서비스 ID 우선) + 제공 주체 구분 필터
  const normalized: NormalizedDataset[] = deduplicateDatasets(
    normalizeDatasets(rawItems)
  ).filter((d) => matchesDivision(d.division, division));

  // 4. 점수화 + 정렬 + 상위 N개
  const ranked = scoreAndRank(normalized, {
    keywords,
    coreKeywords,
    apiOnly,
    realtimePreferred: effectiveRealtime,
    orgFilterApplied: Boolean(explicitOrg),
  }).slice(0, limit);

  const output: RecommendOutput = {
    ideaSummary: summarize(ideaText),
    extractedKeywords: keywords,
    recommendations: ranked,
    ...(errors.length > 0 && {
      warning: `일부 키워드 검색 실패: ${errors.join("; ")}`,
    }),
    ...(rawItems.length === 0 &&
      errors.length === 0 && {
        warning:
          "일치하는 서울시 데이터셋을 찾지 못했습니다. 다른 표현이나 domainHint를 시도해 보세요.",
      }),
    // 검색 결과는 있었지만 관련도 게이트를 통과한 데이터가 없는 경우 —
    // 형태·최신성만 높은 무관한 데이터를 억지로 추천하지 않고 명시적으로 알린다.
    ...(rawItems.length > 0 &&
      ranked.length === 0 && {
        warning: `검색된 ${normalized.length}건 중 '${keywords.slice(0, 3).join("', '")}'와(과) 실제로 관련된 데이터가 없었습니다. domainHint로 정책분야를 지정하거나 더 일반적인 용어를 써 보세요.`,
      }),
  };

  const ttl = isRealtimeQuery(ideaText) ? TTL.REALTIME : TTL.DEFAULT;
  resultCache.set(cacheKey, output, ttl);
  return output;
}
