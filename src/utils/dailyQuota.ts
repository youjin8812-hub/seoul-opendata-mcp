/**
 * 상위 API(서울 열린데이터광장) 호출 수의 전역 일일 상한 — 폭주 방지용 안전장치.
 *
 * 주의: 서울 열린데이터광장의 일반 오픈API에는 호출 "횟수" 제한이 없다
 * (1,000건은 1회 호출당 최대 응답 건수이고, 1일 1,000회 제한은 실시간 지하철
 * 오픈API에만 적용된다). 이 서버가 쓰는 SearchCatalogService는 해당되지 않는다.
 *
 * 따라서 이 카운터는 인증키 한도를 지키려는 것이 아니라, 무한 루프에 빠진
 * 클라이언트나 크롤러가 상위 API를 하루 종일 두드리는 사고를 막는 차단기다.
 * 넉넉하게 잡고, SEOUL_API_DAILY_BUDGET=0 으로 끌 수 있다.
 */

import { kstDayKey, secondsUntilKstMidnight } from "./rateLimiter.js";
import { logger } from "./logger.js";

export class DailyQuota {
  private used = 0;
  private dayKey: string;

  constructor(
    private readonly budget: number,
    private readonly now: () => number = Date.now
  ) {
    this.dayKey = kstDayKey(this.now());
  }

  private rollover(): void {
    const today = kstDayKey(this.now());
    if (today !== this.dayKey) {
      logger.info("일일 예산 리셋", { previousDay: this.dayKey, used: this.used });
      this.dayKey = today;
      this.used = 0;
    }
  }

  /** 상위 API를 1회 호출하기 전에 예산을 차감한다. 소진 시 false. */
  consume(count = 1): boolean {
    if (this.budget <= 0) return true; // 0 이하 = 비활성
    this.rollover();
    if (this.used + count > this.budget) return false;
    this.used += count;
    return true;
  }

  status(): { used: number; budget: number; remaining: number; resetsInSec: number } {
    this.rollover();
    return {
      used: this.used,
      budget: this.budget,
      remaining: Math.max(0, this.budget - this.used),
      resetsInSec: secondsUntilKstMidnight(this.now()),
    };
  }
}

/** 예산 소진 시 도구가 던지는 오류 — 사용자에게 그대로 노출되는 문구 */
export class QuotaExhaustedError extends Error {
  constructor(resetsInSec: number) {
    const hours = Math.floor(resetsInSec / 3600);
    const minutes = Math.ceil((resetsInSec % 3600) / 60);
    super(
      `이 공개 서버의 오늘 상위 API 호출 상한에 도달했습니다(비정상 트래픽 차단기). ` +
        `약 ${hours}시간 ${minutes}분 뒤(한국시간 자정) 초기화됩니다. ` +
        `바로 쓰려면 data.seoul.go.kr에서 본인 인증키를 발급받아 서버를 직접 띄우세요 (README 참고).`
    );
    this.name = "QuotaExhaustedError";
  }
}

const DEFAULT_BUDGET = 50_000;

function readBudget(): number {
  const raw = Number(process.env["SEOUL_API_DAILY_BUDGET"]);
  // 명시적으로 0 이하를 주면 비활성, 값이 없거나 이상하면 기본값
  if (Number.isFinite(raw)) return raw;
  return DEFAULT_BUDGET;
}

/** 프로세스 전역 예산 인스턴스 (상위 API 호출부에서 사용) */
export const seoulApiQuota = new DailyQuota(readBudget());
