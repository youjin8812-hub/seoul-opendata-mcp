/**
 * search_seoul_datasets tool — 서울시 카탈로그 키워드(서비스명) 검색.
 * 디버깅 및 직접 검색 용도. 제공기관명/제공 주체 구분 필터를 지원한다.
 */

import type { SearchInput, SearchOutput } from "../types/index.js";
import { searchSeoulCatalog, getServiceKey } from "../services/seoulCatalogService.js";
import { MemoryCache, normalizeCacheKey } from "../cache/memoryCache.js";
import { matchesDivision } from "../utils/divisionMatch.js";
import { classifyBrm } from "../classification/brmCategory.js";
import { classifyOrganization } from "../classification/organizationType.js";

const searchCache = new MemoryCache<SearchOutput>(3 * 60 * 1000);

/**
 * 카탈로그 API는 검색어 관련도가 아니라 자체 순서로 결과를 돌려준다.
 * 그래서 "따릉이"를 검색해도 제목에 따릉이가 들어간 데이터가 페이지 아래쪽에
 * 묻히는 일이 생긴다. 반환된 페이지 안에서 제목 일치도가 높은 순으로 다시 세운다
 * (페이지 구성 자체는 바꾸지 않으므로 page 파라미터 의미는 그대로다).
 */
function titleRelevance(title: string, query: string): number {
  const t = (title ?? "").toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  // 띄어쓰기가 다른 경우까지 본다 ("서울시 따릉이" vs "서울시따릉이")
  if (t.replace(/\s/g, "").includes(q.replace(/\s/g, ""))) return 1;
  return 0;
}

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

  const pageItems = rawItems
    .filter((item) => matchesDivision(item.ditcNm, division))
    .slice(0, limit);

  // 페이지 안에서만 관련도 재정렬 — 동점이면 카탈로그 원래 순서를 유지한다
  const filtered = pageItems
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        titleRelevance(b.item.infNm, query) - titleRelevance(a.item.infNm, query) ||
        a.index - b.index
    )
    .map((entry) => entry.item);

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
