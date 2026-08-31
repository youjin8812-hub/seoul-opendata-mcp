/**
 * 제공기관 유형 판별.
 *
 * 실측 확인(2026-08-28, 전체 8,255건 조회): DITC_NM(제공 주체 구분) 필드는
 * 아래 6개 값만 존재한다. 별도의 공식 기관 레지스트리 없이도 이 필드를 직접
 * 매핑하면 고신뢰로 분류할 수 있다.
 *   서울시(본청) 5276 · 자치구 및 자치구산하 2134 · 공공기관(외부) 467 ·
 *   서울시(산하기관) 364 · 서울시(사업소) 12 · 민간(기업) 2
 */
import type { OrganizationClassification, RawSeoulCatalogItem } from "../types/index.js";
export declare function classifyOrganization(raw: RawSeoulCatalogItem): OrganizationClassification;
//# sourceMappingURL=organizationType.d.ts.map