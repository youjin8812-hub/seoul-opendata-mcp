/**
 * 제공기관 유형 판별.
 *
 * 실측 확인(2026-08-28, 전체 8,255건 조회): DITC_NM(제공 주체 구분) 필드는
 * 아래 6개 값만 존재한다. 별도의 공식 기관 레지스트리 없이도 이 필드를 직접
 * 매핑하면 고신뢰로 분류할 수 있다.
 *   서울시(본청) 5276 · 자치구 및 자치구산하 2134 · 공공기관(외부) 467 ·
 *   서울시(산하기관) 364 · 서울시(사업소) 12 · 민간(기업) 2
 */
const DIVISION_MAP = {
    "서울시(본청)": { type: "headquarters", label: "서울시 본청" },
    "자치구 및 자치구산하": { type: "district", label: "자치구" },
    "서울시(사업소)": { type: "business_office", label: "사업소" },
    "서울시(산하기관)": { type: "invested_funded", label: "투자·출연기관" },
    "공공기관(외부)": { type: "other", label: "기타 기관" },
    "민간(기업)": { type: "other", label: "기타 기관" },
};
export function classifyOrganization(raw) {
    const division = raw.ditcNm.trim();
    const organizationName = raw.mngOrganName.trim() || "미상";
    const matched = DIVISION_MAP[division];
    if (matched) {
        return {
            type: matched.type,
            label: matched.label,
            organizationName,
            source: "raw_division",
            confidence: "high",
        };
    }
    // 알려지지 않은 값이면 추측하지 않고 기타/미분류로 둔다
    return {
        type: "other",
        label: "기타 기관",
        organizationName,
        source: "unclassified",
        confidence: "low",
    };
}
//# sourceMappingURL=organizationType.js.map