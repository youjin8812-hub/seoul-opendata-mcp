/**
 * list_seoul_recent_updates — 최근 갱신된 서울시 데이터셋 조회.
 *
 * data.go.kr 미러 기반 프로젝트에서는 어려웠던 기능이다: 서울 열린데이터광장
 * SearchCatalogService가 데이터셋마다 최종갱신일(DATA_LT_NM)을 직접 제공하므로,
 * 특정 키워드/제공기관/제공주체(본청·산하기관·자치구) 범위에서 "요즘 활발히
 * 갱신되는 API"를 바로 뽑아낼 수 있다.
 */
import type { RecentUpdatesInput, RecentUpdatesOutput } from "../types/index.js";
export declare function listSeoulRecentUpdates(input: RecentUpdatesInput): Promise<RecentUpdatesOutput>;
//# sourceMappingURL=listSeoulRecentUpdates.d.ts.map
