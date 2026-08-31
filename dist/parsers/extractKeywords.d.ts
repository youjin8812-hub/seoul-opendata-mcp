/**
 * 자연어 아이디어 텍스트에서 검색에 유용한 핵심 키워드를 추출한다.
 * LLM 호출 없이 규칙 기반으로 동작하여 토큰을 절약한다.
 */
export interface ExtractedKeywords {
    keywords: string[];
    isRealtimeHinted: boolean;
}
/**
 * 아이디어 텍스트에서 핵심 키워드를 추출한다.
 * @param ideaText 사용자 자연어 입력
 * @param domainHint 사용자가 명시한 도메인 힌트 (선택)
 */
export declare function extractKeywords(ideaText: string, domainHint?: string): ExtractedKeywords;
//# sourceMappingURL=extractKeywords.d.ts.map