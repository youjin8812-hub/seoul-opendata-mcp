/**
 * IP 단위 호출 제한 (고정 윈도우 카운터).
 *
 * 이 서버는 서울시 인증키 하나를 여러 사용자가 공유하는 구조라, 인증 없이
 * 공개하면 한 명이 일일 호출 한도를 소진시켜 나머지 사용자가 막힐 수 있다.
 * 추천 1회는 카탈로그 API를 최대 8회 호출하므로 요청 수 제한이 그대로
 * 인증키 보호가 된다.
 *
 * 분당(순간 폭주)·시간당(누적 남용) 두 창을 함께 본다. 슬라이딩 윈도우 로그
 * 대신 고정 윈도우를 쓰는 이유는 클라이언트당 메모리가 상수로 묶이기 때문이다
 * (창 경계에서 최대 2배까지 통과할 수 있으나, 남용 차단 목적에는 충분하다).
 */

export interface RateLimitRule {
  /** 창(window) 하나에서 허용할 요청 수 */
  limit: number;
  /** 창 길이 (ms) */
  windowMs: number;
  /** 로그·헤더에 쓸 이름 (예: "minute") */
  name: string;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 한도에 걸린(또는 가장 빠듯한) 규칙의 한도 */
  limit: number;
  /** 남은 허용 횟수 */
  remaining: number;
  /** 현재 창이 끝나는 시각 (epoch ms) */
  resetAt: number;
  /** 429일 때 재시도까지 남은 초 */
  retryAfterSec: number;
  /** 한도를 초과한 규칙 이름 (통과 시 undefined) */
  exceededRule?: string;
}

interface Window {
  start: number;
  count: number;
}

/** 추적 클라이언트 수 상한 — 메모리 무한 증가를 막는다 */
const DEFAULT_MAX_CLIENTS = 10_000;

export class RateLimiter {
  private clients = new Map<string, Window[]>();

  constructor(
    private readonly rules: RateLimitRule[],
    private readonly maxClients: number = DEFAULT_MAX_CLIENTS
  ) {}

  /** 제한 규칙이 하나도 없으면 비활성 상태다 */
  get enabled(): boolean {
    return this.rules.length > 0;
  }

  /**
   * 요청 1건을 기록하고 허용 여부를 반환한다.
   * 거부된 요청은 카운트에 반영하지 않는다 — 차단된 클라이언트가 계속
   * 두드려도 창이 끝나면 정상 복귀할 수 있어야 하기 때문이다.
   */
  check(key: string, now: number = Date.now()): RateLimitResult {
    if (!this.enabled) {
      return { allowed: true, limit: Infinity, remaining: Infinity, resetAt: now, retryAfterSec: 0 };
    }

    let windows = this.clients.get(key);
    if (!windows) {
      this.evictIfNeeded(now);
      windows = this.rules.map(() => ({ start: now, count: 0 }));
      this.clients.set(key, windows);
    }

    // 만료된 창을 먼저 굴린다
    this.rules.forEach((rule, i) => {
      const w = windows![i]!;
      if (now - w.start >= rule.windowMs) {
        w.start = now;
        w.count = 0;
      }
    });

    // 한도를 초과한 규칙이 있으면 어떤 창도 증가시키지 않고 거부한다
    for (const [i, rule] of this.rules.entries()) {
      const w = windows[i]!;
      if (w.count >= rule.limit) {
        const resetAt = w.start + rule.windowMs;
        return {
          allowed: false,
          limit: rule.limit,
          remaining: 0,
          resetAt,
          retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
          exceededRule: rule.name,
        };
      }
    }

    for (const w of windows) w.count++;

    // 남은 여유가 가장 적은 규칙을 응답 헤더 기준으로 삼는다
    let tightest = { rule: this.rules[0]!, window: windows[0]! };
    let minRemaining = Infinity;
    this.rules.forEach((rule, i) => {
      const remaining = rule.limit - windows![i]!.count;
      if (remaining < minRemaining) {
        minRemaining = remaining;
        tightest = { rule, window: windows![i]! };
      }
    });

    return {
      allowed: true,
      limit: tightest.rule.limit,
      remaining: Math.max(0, minRemaining),
      resetAt: tightest.window.start + tightest.rule.windowMs,
      retryAfterSec: 0,
    };
  }

  /** 클라이언트 수가 상한에 닿으면 만료된 항목을 정리한다 */
  private evictIfNeeded(now: number): void {
    if (this.clients.size < this.maxClients) return;

    const longestWindow = Math.max(...this.rules.map((r) => r.windowMs));
    for (const [key, windows] of this.clients) {
      const idle = windows.every((w) => now - w.start >= longestWindow);
      if (idle) this.clients.delete(key);
    }

    // 정리 후에도 가득 차 있으면 가장 오래된 항목부터 버린다 (Map은 삽입 순서 보존)
    while (this.clients.size >= this.maxClients) {
      const oldest = this.clients.keys().next();
      if (oldest.done) break;
      this.clients.delete(oldest.value);
    }
  }

  reset(): void {
    this.clients.clear();
  }

  size(): number {
    return this.clients.size;
  }
}

// ─── 클라이언트 IP 판별 ───────────────────────────────────────────────────────

/**
 * 프록시 뒤에서 실제 클라이언트 IP를 고른다.
 *
 * Fly.io는 Fly-Client-IP를 자신이 덮어쓰므로 클라이언트가 위조할 수 없다.
 * X-Forwarded-For는 클라이언트가 임의로 붙여 보낼 수 있어, 프록시를 신뢰한다고
 * 명시(trustProxy)한 경우에만 쓴다. 위조 가능한 헤더로 제한을 우회당하면
 * 호출 제한 자체가 무의미해진다.
 */
export function resolveClientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | undefined,
  trustProxy: boolean
): string {
  const first = (value: string | string[] | undefined): string | undefined => {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(",")[0]?.trim() || undefined;
  };

  const flyClientIp = first(headers["fly-client-ip"]);
  if (flyClientIp) return flyClientIp;

  if (trustProxy) {
    const forwarded = first(headers["x-forwarded-for"]);
    if (forwarded) return forwarded;
  }

  return socketAddress ?? "unknown";
}
