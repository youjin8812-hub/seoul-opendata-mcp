/**
 * 관련도(relevance)·활용도(quality) 분리 점수의 배점 설정.
 * 기존 legacy 95점 스코어(src/ranking/scoreDataset.ts)와는 별개이며,
 * 이 값을 조정해도 legacy 점수·정렬 결과에는 영향을 주지 않는다.
 */
export declare const RELEVANCE_WEIGHTS: {
    /** 데이터명·키워드·동의어 일치 (도메인 점수 재사용) */
    readonly keywordMatch: 40;
    /** 정책분야(BRM) 일치 */
    readonly policyFieldMatch: 15;
    /** 지역조건 일치 */
    readonly regionMatch: 10;
    /** 실시간성 요구 일치 */
    readonly realtimeMatch: 10;
    /** 제공기관 조건 일치 */
    readonly organizationMatch: 5;
};
export declare const QUALITY_WEIGHTS: {
    /** 최신성 (최근 갱신일) */
    readonly recency: 10;
    /** 갱신주기 */
    readonly updateCycle: 10;
    /** 제공형식(OpenAPI/File/Sheet) 존재 여부 */
    readonly formatAvailability: 15;
    /** 제공기관·제공부서 존재 여부 */
    readonly organizationPresence: 10;
    /** 담당부서·문의처 존재 여부 */
    readonly contactPresence: 5;
    /** 공식 상세페이지 존재 여부 */
    readonly detailPagePresence: 5;
    /** 메타정보 충실도 (핵심 필드 채움 비율) */
    readonly metadataCompleteness: 10;
};
export declare const RELEVANCE_MAX: number;
export declare const QUALITY_MAX: number;
//# sourceMappingURL=scoringConfig.d.ts.map
