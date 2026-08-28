/**
 * get_seoul_dataset_detail — 서울시 데이터셋 상세 메타데이터 조회 도구.
 *
 * SearchCatalogService를 서비스 ID(INF_ID) 단건 조회로 호출해 제공기관/갱신주기/
 * 최종갱신일/제공형식(SRV_TYPE)을 직접 가져온다. 단, 개별 API의 요청 URL·파라미터
 * 명세까지는 이 카탈로그 API로 제공되지 않으므로, 상세페이지(SHORT_URL)의
 * "Open API" 탭을 확인하라는 안내를 함께 반환한다.
 */
import type { DatasetDetailOutput } from "../types/index.js";
export declare function getSeoulDatasetDetail(detailUrl: string): Promise<DatasetDetailOutput>;
//# sourceMappingURL=getSeoulDatasetDetail.d.ts.map
