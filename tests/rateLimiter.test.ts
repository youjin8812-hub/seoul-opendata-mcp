import { describe, it, expect } from "vitest";
import { RateLimiter, resolveClientIp, type RateLimitRule } from "../src/utils/rateLimiter.js";

const MINUTE: RateLimitRule = { name: "minute", limit: 3, windowMs: 60_000 };
const HOUR: RateLimitRule = { name: "hour", limit: 5, windowMs: 3_600_000 };

describe("RateLimiter", () => {
  it("한도 안에서는 통과시킨다", () => {
    const limiter = new RateLimiter([MINUTE]);
    const now = 1_000_000;

    for (let i = 0; i < 3; i++) {
      expect(limiter.check("1.1.1.1", now).allowed).toBe(true);
    }
  });

  it("한도를 넘으면 429 정보와 함께 거부한다", () => {
    const limiter = new RateLimiter([MINUTE]);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check("1.1.1.1", now);

    const verdict = limiter.check("1.1.1.1", now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.exceededRule).toBe("minute");
    expect(verdict.remaining).toBe(0);
    expect(verdict.retryAfterSec).toBeGreaterThan(0);
    expect(verdict.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("창이 지나면 다시 허용한다", () => {
    const limiter = new RateLimiter([MINUTE]);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check("1.1.1.1", now);
    expect(limiter.check("1.1.1.1", now).allowed).toBe(false);

    expect(limiter.check("1.1.1.1", now + 60_000).allowed).toBe(true);
  });

  // 차단된 클라이언트가 계속 두드려도 창이 끝나면 정상 복귀해야 한다
  it("거부된 요청은 카운트를 늘리지 않아 대기 시간이 연장되지 않는다", () => {
    const limiter = new RateLimiter([MINUTE]);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check("1.1.1.1", now);

    for (let i = 0; i < 50; i++) limiter.check("1.1.1.1", now + 1000);

    expect(limiter.check("1.1.1.1", now + 60_000).allowed).toBe(true);
  });

  it("IP마다 독립적으로 집계한다", () => {
    const limiter = new RateLimiter([MINUTE]);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) limiter.check("1.1.1.1", now);

    expect(limiter.check("1.1.1.1", now).allowed).toBe(false);
    expect(limiter.check("2.2.2.2", now).allowed).toBe(true);
  });

  it("분당·시간당 규칙이 함께 적용된다", () => {
    const limiter = new RateLimiter([MINUTE, HOUR]);
    let now = 1_000_000;

    // 분당 3회씩 두 번 — 시간당 한도 5회에 걸린다
    for (let i = 0; i < 3; i++) expect(limiter.check("1.1.1.1", now).allowed).toBe(true);
    now += 60_000;
    for (let i = 0; i < 2; i++) expect(limiter.check("1.1.1.1", now).allowed).toBe(true);

    const verdict = limiter.check("1.1.1.1", now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.exceededRule).toBe("hour");
  });

  it("규칙이 없으면 비활성 상태로 모두 통과시킨다", () => {
    const limiter = new RateLimiter([]);
    expect(limiter.enabled).toBe(false);
    for (let i = 0; i < 100; i++) expect(limiter.check("1.1.1.1").allowed).toBe(true);
  });

  it("추적 클라이언트 수가 상한을 넘지 않는다", () => {
    const limiter = new RateLimiter([MINUTE], 10);
    const now = 1_000_000;
    for (let i = 0; i < 100; i++) limiter.check(`ip-${i}`, now);

    expect(limiter.size()).toBeLessThanOrEqual(10);
  });

  it("remaining이 가장 빠듯한 규칙 기준으로 계산된다", () => {
    const limiter = new RateLimiter([MINUTE, HOUR]);
    const now = 1_000_000;
    limiter.check("1.1.1.1", now);

    // 분당 3회 중 1회 사용 → 남은 2 (시간당은 4 남음)
    expect(limiter.check("1.1.1.1", now).remaining).toBe(1);
  });
});

describe("resolveClientIp", () => {
  it("Fly-Client-IP를 최우선으로 쓴다", () => {
    const ip = resolveClientIp(
      { "fly-client-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" },
      "10.0.0.1",
      true
    );
    expect(ip).toBe("203.0.113.9");
  });

  // X-Forwarded-For는 클라이언트가 위조할 수 있어, 신뢰 설정 없이는 무시해야 한다.
  // 위조 가능한 헤더를 그대로 믿으면 IP를 바꿔가며 제한을 우회할 수 있다.
  it("trustProxy가 아니면 X-Forwarded-For를 무시하고 소켓 주소를 쓴다", () => {
    const ip = resolveClientIp({ "x-forwarded-for": "6.6.6.6" }, "10.0.0.1", false);
    expect(ip).toBe("10.0.0.1");
  });

  it("trustProxy면 X-Forwarded-For의 첫 항목을 쓴다", () => {
    const ip = resolveClientIp(
      { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
      "10.0.0.1",
      true
    );
    expect(ip).toBe("203.0.113.9");
  });

  it("헤더도 소켓 주소도 없으면 unknown으로 묶는다", () => {
    expect(resolveClientIp({}, undefined, true)).toBe("unknown");
  });
});
