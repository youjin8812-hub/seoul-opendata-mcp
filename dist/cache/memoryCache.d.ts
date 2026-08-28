/**
 * in-memory Map 기반 TTL 캐시.
 *
 * - 일반 쿼리: 5분 TTL
 * - 실시간 키워드 포함 쿼리: 1분 TTL (최신 데이터 중요)
 * - 데이터셋 상세 정보: 30분 TTL (변경 빈도 낮음)
 */
export declare class MemoryCache<T> {
    private defaultTtlMs;
    private store;
    constructor(defaultTtlMs?: number);
    get(key: string): T | undefined;
    /** ttlMs를 지정하면 해당 항목에만 개별 TTL 적용 */
    set(key: string, value: T, ttlMs?: number): void;
    has(key: string): boolean;
    delete(key: string): void;
    clear(): void;
    size(): number;
}
export declare const TTL: {
    readonly REALTIME: number;
    readonly DEFAULT: number;
    readonly DETAIL: number;
};
export declare function isRealtimeQuery(text: string): boolean;
/**
 * 질의 텍스트를 정규화해 캐시 키를 만든다.
 * 공백 정리 + 소문자 변환 + 정렬로 "축제 앱"과 "앱 축제"를 같은 키로 처리한다.
 */
export declare function normalizeCacheKey(text: string): string;
//# sourceMappingURL=memoryCache.d.ts.map
