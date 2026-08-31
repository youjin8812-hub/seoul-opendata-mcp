/**
 * 서울 열린데이터광장 인증키의 일일 호출 예산을 지키는 전역 카운터.
 *
 * 공개 서버는 인증키 하나를 모든 사용자가 공유한다. 개발계정 기준 하루 1,000건,
 * 운영계정은 최대 100,000건이므로 기본값은 900(개발계정 + 여유분)으로 잡고
 * SEOUL_API_DAILY_BUDGET 환경변수로 올릴 수 있게 한다.
 *
 * 추천 도구 1회 호출이 상위 API를 5~8번 부르므로, "요청 수" 제한과 별개로
 * 실제 상위 호출 수를 여기서 직접 센다.
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
      `오늘 이 공개 서버의 서울 열린데이터광장 호출 예산을 모두 사용했습니다. ` +
        `약 ${hours}시간 ${minutes}분 뒤(한국시간 자정) 초기화됩니다. ` +
        `바로 쓰려면 data.seoul.go.kr에서 본인 인증키를 발급받아 서버를 직접 띄우세요 (README의 "직접 실행" 참고).`
    );
    this.name = "QuotaExhaustedError";
  }
}

const DEFAULT_BUDGET = 900;

function readBudget(): number {
  const raw = Number(process.env["SEOUL_API_DAILY_BUDGET"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET;
}

/** 프로세스 전역 예산 인스턴스 (상위 API 호출부에서 사용) */
export const seoulApiQuota = new DailyQuota(readBudget());
