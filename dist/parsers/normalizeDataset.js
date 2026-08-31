/**
 * SearchCatalogService 응답의 RawSeoulCatalogItem을 내부 NormalizedDataset으로 변환한다.
 */
import { classifyBrm } from "../classification/brmCategory.js";
import { classifyOrganization } from "../classification/organizationType.js";
/** SRV_TYPE(콤마 구분 문자열)에 "Api"가 포함되면 API형으로 판정 — 가장 신뢰도 높은 판별 기준 */
function resolveType(raw) {
    const types = raw.srvType
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    if (types.includes("api"))
        return "API";
    if (types.includes("file"))
        return "FILE";
    return "UNKNOWN";
}
let idCounter = 0;
export function normalizeDataset(raw) {
    return {
        id: raw.infId || `gen-${++idCounter}`,
        title: raw.infNm.trim() || "제목 없음",
        provider: raw.mngOrganName.trim() || "미상",
        type: resolveType(raw),
        description: "",
        updateCycle: raw.chngLoadNm || "미확인",
        lastUpdated: raw.dataLtNm || "",
        detailUrl: raw.shortUrl || "https://data.seoul.go.kr",
        // 소분류(정책분야)를 태그처럼 활용해 도메인 매칭 점수에 반영
        tags: raw.mapCateNm ? [raw.mapCateNm] : [],
        division: raw.ditcNm || "",
        brm: classifyBrm(raw),
        organization: classifyOrganization(raw),
        _raw: raw,
    };
}
export function normalizeDatasets(items) {
    return items.map(normalizeDataset);
}
/** 중복 제목 제거 (같은 제목 중 첫 번째만 유지) */
export function deduplicateByTitle(datasets) {
    const seen = new Set();
    return datasets.filter((d) => {
        const key = d.title.toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
/**
 * 서비스 ID(infId) 우선 중복제거 — 동일 데이터가 여러 키워드 검색에서
 * 반복 반환될 때, 서비스 ID가 있으면 ID 기준으로, 없으면(생성된 gen-N id)
 * 기존처럼 제목 기준으로 폴백해 제거한다.
 */
export function deduplicateDatasets(datasets) {
    const seen = new Set();
    return datasets.filter((d) => {
        const infId = d._raw.infId?.trim();
        const key = infId ? `id:${infId}` : `title:${d.title.trim().toLowerCase()}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
//# sourceMappingURL=normalizeDataset.js.map