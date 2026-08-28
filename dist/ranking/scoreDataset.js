/**
 * NormalizedDataset에 점수를 부여한다.
 *
 * 점수 구성 (총 95점 기준):
 *   도메인 적합도   40점  - 제목/태그(정책분야)에 검색 키워드 포함 여부
 *   데이터 형태     20점  - API(20) > FILE(8) > UNKNOWN(3) — SRV_TYPE 기준
 *   업데이트 주기   10점  - 실시간/일별 데이터 우대
 *   최신성          10점  - 최근 수정일 우대 (최근 1년 만점)
 *   지역성          10점  - 지역 관련 요청 시 지역 데이터 우대
 *   설명 품질        5점  - 설명 길이/풍부도 (서울시 카탈로그는 설명 필드가 없어 대부분 0점)
 *
 * apiOnly=true 시 API 외 타입은 결과에서 제거된다.
 */
import { RELEVANCE_WEIGHTS, QUALITY_WEIGHTS } from "../config/scoringConfig.js";
// ─── 업데이트 주기 점수 (0~10) ────────────────────────────────────────────────
function cycleScore(cycle) {
    const c = cycle.toLowerCase();
    if (c.includes("실시간") || c.includes("매일") || c.includes("daily"))
        return 10;
    if (c.includes("주") || c.includes("weekly"))
        return 7;
    if (c.includes("월") || c.includes("monthly"))
        return 5;
    if (c.includes("분기") || c.includes("반기"))
        return 3;
    if (c.includes("연") || c.includes("yearly") || c.includes("annual"))
        return 1;
    return 3; // 미확인
}
// ─── 최신성 점수 (0~10) — 최근 1년이면 만점 ──────────────────────────────────
function recencyScore(lastUpdated) {
    if (!lastUpdated)
        return 3;
    const updated = new Date(lastUpdated).getTime();
    if (isNaN(updated))
        return 3;
    const ageMs = Date.now() - updated;
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
    if (ageMonths <= 3)
        return 10;
    if (ageMonths <= 6)
        return 8;
    if (ageMonths <= 12)
        return 6;
    if (ageMonths <= 24)
        return 4;
    if (ageMonths <= 36)
        return 2;
    return 1;
}
// ─── 도메인 적합도 점수 (0~40) ────────────────────────────────────────────────
function domainScore(dataset, keywords) {
    if (keywords.length === 0)
        return 20;
    const titleText = dataset.title.toLowerCase();
    const bodyText = `${dataset.description} ${dataset.provider}`.toLowerCase();
    const tagText = dataset.tags.join(" ").toLowerCase();
    let matches = 0;
    let titleBonus = 0;
    let tagBonus = 0;
    for (const kw of keywords) {
        const k = kw.toLowerCase();
        if (titleText.includes(k)) {
            matches++;
            titleBonus += 2; // 제목 매칭은 추가 가중치
        }
        else if (bodyText.includes(k)) {
            matches++;
        }
        if (tagText.includes(k)) {
            tagBonus += 1; // 포털 태그 매칭 보너스
        }
    }
    const base = Math.round((matches / keywords.length) * 30);
    return Math.min(40, base + Math.min(6, titleBonus) + Math.min(4, tagBonus));
}
// ─── 지역성 점수 (0~10) ───────────────────────────────────────────────────────
const REGION_TERMS = ["지역", "전국", "시", "군", "구", "도", "특별시", "광역시"];
function regionScore(dataset, keywords) {
    const hasRegionKw = keywords.some((kw) => REGION_TERMS.some((r) => kw.includes(r)));
    if (!hasRegionKw)
        return 5; // 지역성 무관 요청이면 중립
    const text = `${dataset.title} ${dataset.description}`.toLowerCase();
    const matches = REGION_TERMS.filter((r) => text.includes(r)).length;
    return Math.min(10, matches * 3);
}
// ─── 설명 품질 점수 (0~5) ─────────────────────────────────────────────────────
function descriptionScore(dataset) {
    const len = dataset.description.length;
    if (len > 100)
        return 5;
    if (len > 50)
        return 4;
    if (len > 20)
        return 2;
    return 0;
}
// ─── 추천 이유 텍스트 생성 ────────────────────────────────────────────────────
function buildReason(dataset, keywords) {
    const matchedKws = keywords
        .filter((kw) => `${dataset.title} ${dataset.description} ${dataset.tags.join(" ")}`
        .toLowerCase()
        .includes(kw.toLowerCase()))
        .slice(0, 3);
    const parts = [];
    if (matchedKws.length > 0) {
        parts.push(`'${matchedKws.join("', '")}'와(과) 관련됩니다`);
    }
    if (dataset.type === "API") {
        parts.push("OpenAPI 형태로 직접 호출 가능합니다");
    }
    if (dataset.tags.length > 0) {
        parts.push(`태그: ${dataset.tags.slice(0, 3).join(", ")}`);
    }
    if (dataset.provider && dataset.provider !== "미상") {
        parts.push(`${dataset.provider} 제공`);
    }
    if (parts.length === 0)
        parts.push("검색 결과에서 상위 매칭됩니다");
    return parts.join(". ") + ".";
}
// ─── 관련도·활용도 분리 점수 ──────────────────────────────────────────────────
// legacy score(위 서브함수들)를 재사용하되, 별도 배점(scoringConfig.ts)으로
// "질문 관련도"와 "데이터 활용도"를 분리해 계산한다. legacy 점수·정렬에는 영향 없음.
function relevanceBreakdown(dataset, keywords, realtimePreferred, hasOrgFilter) {
    const reasons = [];
    let score = 0;
    // 데이터명·키워드·동의어 일치 — 기존 도메인 점수(0~40)를 그대로 재사용
    const keywordScore = Math.min(RELEVANCE_WEIGHTS.keywordMatch, domainScore(dataset, keywords));
    if (keywordScore > 0) {
        score += keywordScore;
        reasons.push(`데이터명/태그가 검색 키워드와 일치 (+${keywordScore})`);
    }
    // 정책분야(BRM) 일치 — 키워드가 분류된 정책분야명을 포함하는지 확인
    const primary = dataset.brm.primary;
    if (primary && keywords.some((kw) => primary.includes(kw) || kw.includes(primary))) {
        score += RELEVANCE_WEIGHTS.policyFieldMatch;
        reasons.push(`정책분야 '${primary}'가 질문과 일치 (+${RELEVANCE_WEIGHTS.policyFieldMatch})`);
    }
    // 지역조건 일치 — 기존 지역 점수(0~10) 재사용
    const region = regionScore(dataset, keywords);
    if (region > 5) {
        const bonus = Math.min(RELEVANCE_WEIGHTS.regionMatch, region);
        score += bonus;
        reasons.push(`지역조건 일치 (+${bonus})`);
    }
    // 실시간성 요구 일치
    if (realtimePreferred && cycleScore(dataset.updateCycle) >= 8) {
        score += RELEVANCE_WEIGHTS.realtimeMatch;
        reasons.push(`실시간성 요구와 일치하는 갱신주기 (+${RELEVANCE_WEIGHTS.realtimeMatch})`);
    }
    // 제공기관 조건 일치 — orgName 필터가 지정된 경우, 검색 단계에서 이미 필터링되어 항상 매칭됨
    if (hasOrgFilter) {
        score += RELEVANCE_WEIGHTS.organizationMatch;
        reasons.push(`지정한 제공기관 조건과 일치 (+${RELEVANCE_WEIGHTS.organizationMatch})`);
    }
    return { score, reasons };
}
function qualityBreakdown(dataset) {
    const reasons = [];
    let score = 0;
    const raw = dataset._raw;
    // 최신성 — 기존 최신성 점수(0~10) 재사용
    const recency = recencyScore(dataset.lastUpdated);
    score += recency;
    if (recency >= 8)
        reasons.push(`최근에 갱신된 데이터 (+${recency})`);
    // 갱신주기 — 기존 주기 점수(0~10) 재사용
    const cycle = cycleScore(dataset.updateCycle);
    score += cycle;
    if (cycle >= 7)
        reasons.push(`갱신주기가 양호함 (+${cycle})`);
    // 제공형식(OpenAPI/File/Sheet) 존재 여부
    const format = dataset.type === "API"
        ? QUALITY_WEIGHTS.formatAvailability
        : dataset.type === "FILE"
            ? Math.round(QUALITY_WEIGHTS.formatAvailability * 0.5)
            : Math.round(QUALITY_WEIGHTS.formatAvailability * 0.2);
    score += format;
    if (dataset.type === "API")
        reasons.push(`OpenAPI 형태로 제공 (+${format})`);
    // 제공기관·제공부서 존재 여부
    let orgPresence = 0;
    if (dataset.provider && dataset.provider !== "미상")
        orgPresence += QUALITY_WEIGHTS.organizationPresence / 2;
    if (raw.mngStationName?.trim())
        orgPresence += QUALITY_WEIGHTS.organizationPresence / 2;
    score += orgPresence;
    if (orgPresence > 0)
        reasons.push(`제공기관/부서 정보 확인됨 (+${orgPresence})`);
    // 담당부서·문의처 존재 여부
    if (raw.managerPhone?.trim() || raw.managerName?.trim()) {
        score += QUALITY_WEIGHTS.contactPresence;
        reasons.push(`문의처 정보 확인됨 (+${QUALITY_WEIGHTS.contactPresence})`);
    }
    // 공식 상세페이지 존재 여부
    if (raw.shortUrl?.trim()) {
        score += QUALITY_WEIGHTS.detailPagePresence;
        reasons.push(`공식 상세페이지 확인됨 (+${QUALITY_WEIGHTS.detailPagePresence})`);
    }
    // 메타정보 충실도 — 핵심 필드 채움 비율
    const fields = [
        raw.mngOrganName,
        raw.mngStationName,
        raw.managerPhone,
        raw.chngLoadNm,
        raw.dataLtNm,
        raw.srvType,
        raw.shortUrl,
    ];
    const filled = fields.filter((f) => f?.trim()).length;
    const completeness = Math.round((filled / fields.length) * QUALITY_WEIGHTS.metadataCompleteness);
    score += completeness;
    return { score, reasons };
}
export function computeScoreBreakdown(dataset, legacyScore, ctx) {
    const relevance = relevanceBreakdown(dataset, ctx.keywords, ctx.realtimePreferred, Boolean(ctx.orgFilterApplied));
    const quality = qualityBreakdown(dataset);
    return {
        legacyScore,
        relevanceScore: relevance.score,
        qualityScore: quality.score,
        relevanceReasons: relevance.reasons,
        qualityReasons: quality.reasons,
    };
}
// ─── 메인 점수화 함수 ─────────────────────────────────────────────────────────
export function scoreAndRank(datasets, ctx) {
    const { keywords, apiOnly, realtimePreferred } = ctx;
    // 최소 점수 임계값: 키워드와 전혀 관련 없는 결과를 제거 (95점 만점 기준)
    const MIN_SCORE = 15;
    return datasets
        .filter((d) => {
        if (apiOnly && d.type !== "API")
            return false;
        return true;
    })
        .map((d) => {
        let score = 0;
        score += domainScore(d, keywords); // 최대 40
        // API(20) > FILE(8) > UNKNOWN(3) — SRV_TYPE 기준 타입별 우대
        score += d.type === "API" ? 20 : d.type === "FILE" ? 8 : 3;
        score += cycleScore(d.updateCycle); // 최대 10
        score += recencyScore(d.lastUpdated); // 최대 10
        score += regionScore(d, keywords); // 최대 10
        score += descriptionScore(d); // 최대 5
        // 실시간 우선 요청 시 추가 boost
        if (realtimePreferred && cycleScore(d.updateCycle) >= 8) {
            score += 8;
        }
        return {
            title: d.title,
            provider: d.provider,
            type: d.type,
            updateCycle: d.updateCycle,
            reason: buildReason(d, keywords),
            score,
            detailUrl: d.detailUrl,
            brm: d.brm,
            organization: d.organization,
            scoreBreakdown: computeScoreBreakdown(d, score, ctx),
            lastUpdated: d.lastUpdated || undefined,
            department: d._raw.mngStationName?.trim() || undefined,
        };
    })
        .filter((rec) => rec.score >= MIN_SCORE) // 관련 없는 결과 제거
        .sort((a, b) => b.score - a.score);
}
//# sourceMappingURL=scoreDataset.js.map
