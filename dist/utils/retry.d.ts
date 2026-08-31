/**
 * 지수 백오프 재시도 유틸리티.
 *
 * [수정] 네트워크 오류뿐 아니라 HTTP 5xx 응답도 재시도한다.
 *       각 시도마다 AbortController로 타임아웃을 걸어 무한 대기를 방지한다.
 *
 * 재시도 전략:
 *   - 시도 1: 즉시
 *   - 시도 2: baseDelayMs (기본 500ms) 후
 *   - 시도 3: baseDelayMs * 2 후
 *   ...
 *
 * 영구 오류(인증 키 문제 등)는 즉시 throw한다.
 */
export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    /** 요청당 타임아웃 (ms). 기본 8000ms */
    timeoutMs?: number;
    /** 재시도해야 할 오류인지 판별. false 반환 시 즉시 throw */
    retryOn?: (err: unknown, response?: Response) => boolean;
}
/**
 * fetch 호출을 타임아웃 + 재시도로 감싼다.
 * HTTP 5xx 응답도 재시도 대상으로 처리한다.
 *
 * fetchFn을 주입하면 테스트에서 mock fetch를 사용할 수 있다.
 */
export declare function fetchWithRetry(url: string, init: RequestInit, options?: RetryOptions & {
    fetchFn?: typeof fetch;
}): Promise<Response>;
/** 일반 비동기 함수 재시도 래퍼 (fetch 외 용도) */
export declare function withRetry<T>(fn: () => Promise<T>, options?: Omit<RetryOptions, "timeoutMs">): Promise<T>;
//# sourceMappingURL=retry.d.ts.map