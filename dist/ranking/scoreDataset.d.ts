/**
 * NormalizedDataset에 점수를 부여한다.
 *
 * 점수 구성 (총 95점 기준):
 *   도메인 적합도   40점  - 제목/태그(정책분야)에 검색 키워드 포함 여부
 *   데이터 형태     20점  - API(20) > FILE(8) > UNKNOWN(3) — SRV_TYPE 기준
 *   업데이트 주기   10점  - 실시간/일별 데이터 우대
 *   최신성          10점  - 최근 수정일 우대 (최근 1년 만점)
 *   지역성          10점  - 지역 관련 요청 시 지역 데이터 우대
 *   설명 품질        5점  - 설명 길이/풍부도 (서울시 카탈로그는 설명 필드가 없어 대부분 0점)
 *
 * apiOnly=true 시 API 외 타입은 결과에서 제거된다.
 */
import type { NormalizedDataset, Recommendation, ScoreBreakdown, ScoreContext } from "../types/index.js";
export declare function computeScoreBreakdown(dataset: NormalizedDataset, legacyScore: number, ctx: ScoreContext): ScoreBreakdown;
export declare function scoreAndRank(datasets: NormalizedDataset[], ctx: ScoreContext): Recommendation[];
//# sourceMappingURL=scoreDataset.d.ts.map