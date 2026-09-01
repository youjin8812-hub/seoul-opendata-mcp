/**
 * list_seoul_recent_updates — 최근 갱신된 서울시 데이터셋 조회.
 *
 * data.go.kr 미러 기반 프로젝트에서는 어려웠던 기능이다: 서울 열린데이터광장
 * SearchCatalogService가 데이터셋마다 최종갱신일(DATA_LT_NM)을 직접 제공하므로,
 * 특정 키워드/제공기관/제공주체(본청·산하기관·자치구) 범위에서 "요즘 활발히
 * 갱신되는 API"를 바로 뽑아낼 수 있다.
 */

import type { RecentUpdatesInput, RecentUpdatesOutput } from "../types/index.js";
import { searchSeoulCatalog, getServiceKey } from "../services/seoulCatalogService.js";
import { normalizeDatasets } from "../parsers/normalizeDataset.js";
import { matchesDivision } from "../utils/divisionMatch.js";
import { MemoryCache, normalizeCacheKey } from "../cache/memoryCache.js";

// 최신 업데이트 목록은 하루 단위로 바뀌므로 30분이면 충분하다.
const recentUpdatesCache = new MemoryCache<RecentUpdatesOutput>(30 * 60 * 1000);

/** SearchCatalogService 1회 호출 최대 허용치 — 정렬 대상 표본을 최대한 넓게 확보 */
const FETCH_SIZE = 1000;

export async function listSeoulRecentUpdates(
  input: RecentUpdatesInput
): Promise<RecentUpdatesOutput> {
  const { keyword, orgName, division, apiOnly = false, limit = 10 } = input;

  const cacheKey = normalizeCacheKey(
    `recent|${keyword ?? ""}|${orgName ?? ""}|${division ?? ""}|${apiOnly}|${limit}`
  );
  const cached = recentUpdatesCache.get(cacheKey);
  if (cached) return cached;

  const serviceKey = getServiceKey();
  const { items: rawItems, totalCount } = await searchSeoulCatalog(
    { keyword, orgName, start: 1, end: FETCH_SIZE },
    serviceKey
  );

  const normalized = normalizeDatasets(rawItems)
    .filter((d) => matchesDivision(d.division, division))
    .filter((d) => !apiOnly || d.type === "API")
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.lastUpdated))
    .sort((a, b) => (a.lastUpdated < b.lastUpdated ? 1 : a.lastUpdated > b.lastUpdated ? -1 : 0))
    .slice(0, limit);

  // SearchCatalogService는 정렬(sort) 파라미터를 지원하지 않으므로, 조건에 맞는 전체
  // 건수가 조회 범위(FETCH_SIZE)를 넘으면 "표본 내 최신순"이라는 한계를 명시한다.
  const isPartialSample = totalCount > FETCH_SIZE;

  const output: RecentUpdatesOutput = {
    items: normalized.map((d) => ({
      title: d.title,
      provider: d.provider,
      division: d.division,
      type: d.type,
      updateCycle: d.updateCycle,
      lastUpdated: d.lastUpdated,
      detailUrl: d.detailUrl,
      brm: d.brm,
      organization: d.organization,
    })),
    totalMatchCount: totalCount,
    ...(isPartialSample && {
      note: `조건에 맞는 전체 ${totalCount}건 중 상위 ${FETCH_SIZE}건 표본 내에서 최신순 정렬한 결과입니다. keyword/orgName으로 범위를 좁히면 전수 기준 결과를 얻을 수 있습니다.`,
    }),
  };

  recentUpdatesCache.set(cacheKey, output);
  return output;
}
