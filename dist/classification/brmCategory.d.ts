/**
 * 정책분야(BRM 1차 분류) 판별.
 *
 * 실측 확인(2026-08-28, 전체 8,255건 조회): 서울 열린데이터광장 카탈로그의
 * MAP_CATE_NM(소분류) 필드는 아래 12개 정책분야 값과 전 건이 1:1로 일치한다.
 * 따라서 공식 필드를 그대로 신뢰도 high로 채택하고, 표기가 다른 변형만 정규화한다.
 * 공식 BRM 코드(2·3·4차)는 카탈로그 응답에 없으므로 임의로 생성하지 않고 항상 null로 둔다.
 */
import type { BrmClassification, RawSeoulCatalogItem } from "../types/index.js";
export declare function classifyBrm(raw: RawSeoulCatalogItem): BrmClassification;
//# sourceMappingURL=brmCategory.d.ts.map