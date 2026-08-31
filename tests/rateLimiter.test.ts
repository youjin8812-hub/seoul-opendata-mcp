import { describe, it, expect } from "vitest";

import { RateLimiter, kstDayKey, secondsUntilKstMidnight } from "../src/utils/rateLimiter.js";
import { DailyQuota } from "../src/utils/dailyQuota.js";

/** 테스트용 조작 가능한 시계 */
function fakeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("RateLimiter", () => {
  it("버스트 용량까지는 통과시키고 그 다음을 막는다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const limiter = new RateLimiter({ perMinute: 20, perDay: 200, now: clock.now });

    // 버스트 = perMinute * 2 = 40
    for (let i = 0; i < 40; i++) {
      expect(limiter.check("1.1.1.1").allowed).toBe(true);
    }

    const blocked = limiter.check("1.1.1.1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("per_minute");
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("시간이 지나면 토큰이 리필된다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const limiter = new RateLimiter({ perMinute: 20, perDay: 200, now: clock.now });

    for (let i = 0; i < 40; i++) limiter.check("1.1.1.1");
    expect(limiter.check("1.1.1.1").allowed).toBe(false);

    clock.advance(60_000); // 1분 → 20개 리필
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
  });

  it("IP마다 예산이 분리된다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const limiter = new RateLimiter({ perMinute: 2, perDay: 200, now: clock.now });

    // 버스트 = 4
    for (let i = 0; i < 4; i++) {
      expect(limiter.check("1.1.1.1").allowed).toBe(true);
    }
    expect(limiter.check("1.1.1.1").allowed).toBe(false);

    expect(limiter.check("2.2.2.2").allowed).toBe(true);
  });

  it("하루 캡을 넘기면 분당 토큰이 남아 있어도 막는다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const limiter = new RateLimiter({ perMinute: 60, perDay: 5, now: clock.now });

    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.1.1.1").allowed).toBe(true);
      clock.advance(60_000); // 토큰은 계속 가득 차 있게
    }

    const blocked = limiter.check("1.1.1.1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("per_day");
  });

  it("KST 자정이 지나면 하루 캡이 초기화된다", () => {
    // 2026-08-31 14:50 UTC = 2026-08-31 23:50 KST
    const clock = fakeClock(Date.parse("2026-08-31T14:50:00Z"));
    const limiter = new RateLimiter({ perMinute: 60, perDay: 2, now: clock.now });

    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
    expect(limiter.check("1.1.1.1").allowed).toBe(false);

    clock.advance(20 * 60 * 1000); // KST 00:10 → 다음 날
    expect(limiter.check("1.1.1.1").allowed).toBe(true);
  });

  it("오래 안 쓴 버킷을 정리한다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const limiter = new RateLimiter({ perMinute: 20, perDay: 200, now: clock.now });

    limiter.check("1.1.1.1");
    expect(limiter.size).toBe(1);

    clock.advance(2 * 60 * 60 * 1000);
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

describe("kstDayKey / secondsUntilKstMidnight", () => {
  it("UTC 15:00 이후는 KST 기준 다음 날이다", () => {
    expect(kstDayKey(Date.parse("2026-08-31T14:59:00Z"))).toBe("2026-08-31");
    expect(kstDayKey(Date.parse("2026-08-31T15:00:00Z"))).toBe("2026-09-01");
  });

  it("KST 자정까지 남은 초를 계산한다", () => {
    // 2026-08-31 14:00 UTC = 23:00 KST → 1시간 남음
    expect(secondsUntilKstMidnight(Date.parse("2026-08-31T14:00:00Z"))).toBe(3600);
  });
});

describe("DailyQuota", () => {
  it("예산만큼만 차감을 허용한다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const quota = new DailyQuota(3, clock.now);

    expect(quota.consume()).toBe(true);
    expect(quota.consume()).toBe(true);
    expect(quota.consume()).toBe(true);
    expect(quota.consume()).toBe(false);

    expect(quota.status()).toMatchObject({ used: 3, budget: 3, remaining: 0 });
  });

  it("예산을 넘는 묶음 차감은 부분 차감 없이 거절한다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const quota = new DailyQuota(5, clock.now);

    expect(quota.consume(3)).toBe(true);
    expect(quota.consume(3)).toBe(false);
    expect(quota.status().used).toBe(3);
  });

  it("예산이 0 이하면 비활성화된다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T03:00:00Z"));
    const quota = new DailyQuota(0, clock.now);

    for (let i = 0; i < 1000; i++) {
      expect(quota.consume()).toBe(true);
    }
  });

  it("KST 자정에 예산이 초기화된다", () => {
    const clock = fakeClock(Date.parse("2026-08-31T14:50:00Z"));
    const quota = new DailyQuota(1, clock.now);

    expect(quota.consume()).toBe(true);
    expect(quota.consume()).toBe(false);

    clock.advance(20 * 60 * 1000);
    expect(quota.consume()).toBe(true);
  });
});
