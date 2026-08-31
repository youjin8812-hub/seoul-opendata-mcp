/**
 * 정책분야(BRM 1차 분류) 판별.
 *
 * 실측 확인(2026-08-28, 전체 8,255건 조회): 서울 열린데이터광장 카탈로그의
 * MAP_CATE_NM(소분류) 필드는 아래 12개 정책분야 값과 전 건이 1:1로 일치한다.
 * 따라서 공식 필드를 그대로 신뢰도 high로 채택하고, 표기가 다른 변형만 정규화한다.
 * 공식 BRM 코드(2·3·4차)는 카탈로그 응답에 없으므로 임의로 생성하지 않고 항상 null로 둔다.
 */
const BRM_CATEGORIES = [
    "보건",
    "일반행정",
    "문화/관광",
    "산업/경제",
    "복지",
    "환경",
    "교통",
    "도시관리",
    "교육",
    "안전",
    "인구/가구",
    "주택/건설",
];
/** 표기 변형 → 표준 12개 분야 정규화 (문서 6장) */
const NORMALIZATION_MAP = {
    문화관광: "문화/관광",
    산업경제: "산업/경제",
    인구가구: "인구/가구",
    주택건설: "주택/건설",
    주택: "주택/건설",
    건설: "주택/건설",
};
function normalize(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    if (BRM_CATEGORIES.includes(trimmed)) {
        return trimmed;
    }
    return NORMALIZATION_MAP[trimmed] ?? null;
}
export function classifyBrm(raw) {
    // 1순위: 공식 카탈로그 소분류(MAP_CATE_NM) 필드
    const fromCatalog = normalize(raw.mapCateNm);
    if (fromCatalog) {
        return {
            primary: fromCatalog,
            secondary: null,
            code: null,
            source: "catalog_map_category",
            confidence: "high",
        };
    }
    // 2순위: 대분류(CATE_NM) 등 다른 공식 텍스트 필드에서 키워드 부분일치 (보조수단)
    const fallbackText = `${raw.cateNm} ${raw.mapCateNm}`;
    const inferred = BRM_CATEGORIES.find((cat) => fallbackText.includes(cat));
    if (inferred) {
        return {
            primary: inferred,
            secondary: null,
            code: null,
            source: "keyword_inference",
            confidence: "low",
        };
    }
    // 근거 없으면 미분류 — 추측으로 채우지 않음
    return {
        primary: null,
        secondary: null,
        code: null,
        source: "unclassified",
        confidence: "low",
    };
}
//# sourceMappingURL=brmCategory.js.map