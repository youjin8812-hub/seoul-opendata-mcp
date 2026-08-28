/**
 * SearchCatalogService 응답의 RawSeoulCatalogItem을 내부 NormalizedDataset으로 변환한다.
 */
import type { NormalizedDataset, RawSeoulCatalogItem } from "../types/index.js";
export declare function normalizeDataset(raw: RawSeoulCatalogItem): NormalizedDataset;
export declare function normalizeDatasets(items: RawSeoulCatalogItem[]): NormalizedDataset[];
/** 중복 제목 제거 (같은 제목 중 첫 번째만 유지) */
export declare function deduplicateByTitle(datasets: NormalizedDataset[]): NormalizedDataset[];
/**
 * 서비스 ID(infId) 우선 중복제거 — 동일 데이터가 여러 키워드 검색에서
 * 반복 반환될 때, 서비스 ID가 있으면 ID 기준으로, 없으면(생성된 gen-N id)
 * 기존처럼 제목 기준으로 폴백해 제거한다.
 */
export declare function deduplicateDatasets(datasets: NormalizedDataset[]): NormalizedDataset[];
//# sourceMappingURL=normalizeDataset.d.ts.map
