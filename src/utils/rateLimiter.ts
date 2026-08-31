/**
 * IP 단위 요청 제한 — 토큰버킷(분당) + 하루 누적 캡.
 *
 * 공개 서버는 접속 토큰 없이 열려 있으므로, 한 클라이언트가 상위 API 예산을
 * 독식하지 못하도록 여기서 1차로 걸러낸다. 실제 서울 열린데이터광장 호출 수
 * 자체는 dailyQuota.ts의 전역 예산이 따로 지킨다.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** 거부 사유 (allowed=false일 때만) */
  reason?: "per_minute" | "per_day";
  /** 재시도까지 남은 초 — Retry-After 헤더용 */
  retryAfterSec?: number;
}

export interface RateLimiterOptions {
  /** 분당 리필되는 토큰 수 */
  perMinute: number;
  /** 버킷 최대 용량 — 순간 버스트 허용치 (기본: perMinute의 2배) */
  burst?: number;
  /** IP당 하루 최대 요청 수 */
  perDay: number;
  /** 테스트용 시계 주입 */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  dayCount: number;
  dayKey: string;
}

/** KST(UTC+9) 기준 날짜 키 — 자정마다 하루 카운터가 리셋된다. */
export function kstDayKey(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly perMinute: number;
  private readonly burst: number;
  private readonly perDay: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.perMinute = options.perMinute;
    this.burst = options.burst ?? options.perMinute * 2;
    this.perDay = options.perDay;
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitDecision {
    const nowMs = this.now();
    const dayKey = kstDayKey(nowMs);
    const bucket = this.buckets.get(key) ?? {
      tokens: this.burst,
      lastRefillMs: nowMs,
      dayCount: 0,
      dayKey,
    };

    // 날짜가 바뀌면 하루 카운터만 초기화
    if (bucket.dayKey !== dayKey) {
      bucket.dayKey = dayKey;
      bucket.dayCount = 0;
    }

    // 경과 시간만큼 토큰 리필
    const elapsedMs = Math.max(0, nowMs - bucket.lastRefillMs);
    bucket.tokens = Math.min(
      this.burst,
      bucket.tokens + (elapsedMs / 60_000) * this.perMinute
    );
    bucket.lastRefillMs = nowMs;

    if (bucket.dayCount >= this.perDay) {
      this.buckets.set(key, bucket);
      return { allowed: false, reason: "per_day", retryAfterSec: secondsUntilKstMidnight(nowMs) };
    }

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      const needSec = Math.ceil(((1 - bucket.tokens) / this.perMinute) * 60);
      return { allowed: false, reason: "per_minute", retryAfterSec: Math.max(1, needSec) };
    }

    bucket.tokens -= 1;
    bucket.dayCount += 1;
    this.buckets.set(key, bucket);
    return { allowed: true };
  }

  /** 오랫동안 안 쓰인 버킷 정리 — 메모리 누수 방지 */
  prune(idleMs = 60 * 60 * 1000): void {
    const cutoff = this.now() - idleMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefillMs < cutoff) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

export function secondsUntilKstMidnight(nowMs: number): number {
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const msIntoDay = kstMs % 86_400_000;
  return Math.ceil((86_400_000 - msIntoDay) / 1000);
}
