/**
 * 서울 열린데이터광장(data.seoul.go.kr) 자체 카탈로그 API — SearchCatalogService
 *
 * 요청 URL 패턴 (GET):
 *   http://openapi.seoul.go.kr:8088/{인증키}/{xml|json}/SearchCatalogService/{시작}/{종료}/{서비스ID}/{서비스명 키워드}/{제공기관명}/
 *
 * - 시작/종료: 1-base 인덱스 범위 (예: 1/5 → 5건)
 * - 서비스ID/서비스명/제공기관명: 비워둘 땐 공백(" ")을 그대로 보낸다 (빈 문자열이면 404)
 * - 응답: 정상 시 { SearchCatalogService: { list_total_count, RESULT, row: [...] } }
 *         결과 없음/오류 시 { RESULT: { CODE, MESSAGE } } (오류는 json 요청에도 XML로 오기도 함)
 */
import type { RawSeoulCatalogItem } from "../types/index.js";
export interface CatalogSearchOptions {
    /** 1-base 시작 인덱스 (기본 1) */
    start?: number;
    /** 1-base 종료 인덱스 (기본 20) */
    end?: number;
    /** 서비스 ID로 단건 조회 (예: "OA-15529") */
    infId?: string;
    /** 서비스명(제목) 키워드 검색 */
    keyword?: string;
    /** 제공기관명 필터 (예: "서울교통공사") */
    orgName?: string;
}
export interface CatalogSearchResult {
    items: RawSeoulCatalogItem[];
    totalCount: number;
}
export type FetchFn = typeof fetch;
export declare function searchSeoulCatalog(options: CatalogSearchOptions, apiKey: string, fetchFn?: FetchFn): Promise<CatalogSearchResult>;
export declare function getServiceKey(): string;
//# sourceMappingURL=seoulCatalogService.d.ts.map