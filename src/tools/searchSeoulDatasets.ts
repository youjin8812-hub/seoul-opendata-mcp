/**
 * search_seoul_datasets tool — 서울시 카탈로그 키워드(서비스명) 검색.
 * 디버깅 및 직접 검색 용도. 제공기관명/제공 주체 구분 필터를 지원한다.
 */

import type { SearchInput, SearchOutput } from "../types/index.js";
import { searchSeoulCatalog, getServiceKey } from "../services/seoulCatalogService.js";
import { MemoryCache, normalizeCacheKey, TTL } from "../cache/memoryCache.js";
import { matchesDivision } from "../utils/divisionMatch.js";
import { classifyBrm } from "../classification/brmCategory.js";
import { classifyOrganization } from "../classification/organizationType.js";

const searchCache = new MemoryCache<SearchOutput>(TTL.DEFAULT);

export async function searchSeoulDatasetsForTool(
  input: SearchInput
): Promise<SearchOutput> {
  const { query, page = 1, limit = 10, orgName, division } = input;
  const cacheKey = normalizeCacheKey(
    `search|${query}|${page}|${limit}|${orgName ?? ""}|${division ?? ""}`
  );

  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const serviceKey = getServiceKey();
  const start = (page - 1) * limit + 1;
  // division 필터는 후처리라 결과가 줄어들 수 있으므로 여유 있게 요청한다
  const end = start + (division ? limit * 3 : limit) - 1;

  const { items: rawItems, totalCount } = await searchSeoulCatalog(
    { keyword: query, orgName, start, end },
    serviceKey
  );

  const filtered = rawItems
    .filter((item) => matchesDivision(item.ditcNm, division))
    .slice(0, limit);

  const output: SearchOutput = {
    query,
    items: filtered.map((item) => ({
      title: item.infNm || "제목 없음",
      summary: [item.mapCateNm, item.mngStationName, item.srvType]
        .filter(Boolean)
        .join(" · "),
      provider: item.mngOrganName,
      detailUrl: item.shortUrl,
      brm: classifyBrm(item),
      organization: classifyOrganization(item),
    })),
    totalMatchCount: totalCount,
  };

  searchCache.set(cacheKey, output);
  return output;
}
