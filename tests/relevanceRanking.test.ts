/**
 * 실제 질의 시나리오로 순위를 검증한다.
 *
 * 단위 함수가 맞게 계산하는지가 아니라, "그 질의를 던진 사람이 1등으로 보고 싶은
 * 데이터가 실제로 1등인가"를 본다. 점수 배점을 바꿀 때 회귀를 잡는 기준선이다.
 */

import { describe, it, expect } from "vitest";
import { scoreAndRank } from "../src/ranking/scoreDataset.js";
import { RELEVANCE_MAX, TOTAL_MAX } from "../src/config/scoringConfig.js";
import { makeDataset } from "./helpers/makeDataset.js";
import type { ScoreContext } from "../src/types/index.js";

function ctx(overrides: Partial<ScoreContext> & { keywords: string[] }): ScoreContext {
  return { apiOnly: false, realtimePreferred: false, ...overrides };
}

describe("관련도가 활용도를 이긴다", () => {
  it("주제가 맞는 오래된 파일 데이터가, 주제가 다른 최신 실시간 API보다 위에 온다", () => {
    const ranked = scoreAndRank(
      [
        makeDataset({
          id: "OA-noise",
          title: "서울시 지하철 실시간 열차 위치정보",
          type: "API",
          updateCycle: "실시간",
          lastUpdated: "2026-09-01",
          field: "교통",
        }),
        makeDataset({
          id: "OA-target",
          title: "서울시 그늘막 설치 위치 정보",
          type: "FILE",
          updateCycle: "연간",
          lastUpdated: "2023-05-01",
          field: "안전",
        }),
      ],
      ctx({ keywords: ["그늘막", "위치"], coreKeywords: ["그늘막"] })
    );

    expect(ranked[0]!.title).toBe("서울시 그늘막 설치 위치 정보");
  });

  it("활용도만으로는 관련도 격차를 뒤집을 수 없다 (활용도 30 < 관련도 70)", () => {
    const ranked = scoreAndRank(
      [
        // 활용도 만점에 가까운 후보 — 유사어 하나에만 걸린다
        makeDataset({
          id: "OA-quality",
          title: "서울시 대중교통 이용 현황",
          type: "API",
          updateCycle: "실시간",
          lastUpdated: "2026-09-01",
          field: "교통",
        }),
        // 활용도는 바닥이지만 질의를 그대로 충족하는 후보
        makeDataset({
          id: "OA-relevant",
          title: "서울시 따릉이 대여소 정보",
          type: "UNKNOWN",
          updateCycle: "주기없음",
          lastUpdated: "2019-01-01",
          field: "교통",
        }),
      ],
      ctx({
        keywords: ["따릉이", "대여소", "대중교통"],
        coreKeywords: ["따릉이", "대여소"],
      })
    );

    expect(ranked[0]!.title).toBe("서울시 따릉이 대여소 정보");
  });
});

describe("키워드 커버리지 — 몇 개를 맞췄는지가 점수를 가른다", () => {
  const datasets = [
    makeDataset({ id: "OA-both", title: "서울시 따릉이 대여소 정보", field: "교통" }),
    makeDataset({ id: "OA-one", title: "서울시 공공자전거 대여소 이용 현황", field: "교통" }),
    makeDataset({ id: "OA-other", title: "서울시 따릉이 이용권 판매 내역", field: "교통" }),
  ];

  it("두 키워드를 모두 맞춘 데이터가 하나만 맞춘 데이터보다 높다", () => {
    const ranked = scoreAndRank(
      datasets,
      ctx({ keywords: ["따릉이", "대여소"], coreKeywords: ["따릉이", "대여소"] })
    );

    expect(ranked[0]!.title).toBe("서울시 따릉이 대여소 정보");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[0]!.scoreBreakdown!.relevanceScore).toBe(RELEVANCE_MAX);
    expect(ranked[0]!.score).toBeLessThanOrEqual(TOTAL_MAX);
  });

  it("매칭된 키워드가 근거로 그대로 노출된다", () => {
    const [top] = scoreAndRank(
      datasets,
      ctx({ keywords: ["따릉이", "대여소"], coreKeywords: ["따릉이", "대여소"] })
    );

    expect(top!.scoreBreakdown!.matchedKeywords).toEqual(
      expect.arrayContaining(["따릉이", "대여소"])
    );
    expect(top!.scoreBreakdown!.relevanceReasons.join(" ")).toContain("충족률");
  });
});

describe("범용어 자동 억제 (IDF 가중)", () => {
  it("후보 전부에 있는 단어는 순위를 흔들지 못한다", () => {
    // "정보"·"현황"은 후보 전 건에 등장한다 — 변별력이 0이므로 가중이 0에 수렴한다
    const ranked = scoreAndRank(
      [
        makeDataset({ id: "OA-a", title: "서울시 상수도 요금 현황 정보", field: "도시관리" }),
        makeDataset({ id: "OA-b", title: "서울시 도서관 운영 현황 정보", field: "문화/관광" }),
        makeDataset({ id: "OA-c", title: "서울시 공공도서관 장서 현황 정보", field: "문화/관광" }),
      ],
      ctx({ keywords: ["도서관", "현황", "정보"], coreKeywords: ["도서관", "현황", "정보"] })
    );

    // 도서관을 맞춘 두 건만 남고, 상수도는 "현황·정보"만 걸려 탈락한다
    expect(ranked.map((r) => r.title)).not.toContain("서울시 상수도 요금 현황 정보");
    expect(ranked).toHaveLength(2);
  });
});

describe("자치구 지역 조건", () => {
  const datasets = [
    makeDataset({
      id: "OA-gangnam",
      title: "강남구 공영주차장 정보",
      provider: "강남구",
      division: "자치구 및 자치구산하",
      field: "교통",
    }),
    makeDataset({
      id: "OA-nowon",
      title: "노원구 공영주차장 정보",
      provider: "노원구",
      division: "자치구 및 자치구산하",
      field: "교통",
    }),
  ];

  it("질의가 자치구를 지목하면 다른 자치구 데이터는 결과에서 빠진다", () => {
    const ranked = scoreAndRank(
      datasets,
      ctx({ keywords: ["강남구", "주차장"], coreKeywords: ["강남구", "주차장"] })
    );

    expect(ranked.map((r) => r.title)).toEqual(["강남구 공영주차장 정보"]);
  });

  it("지목한 자치구 데이터가 없으면 나머지 자치구 데이터라도 돌려준다", () => {
    // 후보에 아예 없는 키워드는 분모에서 빠지므로, 주차장 조건만으로 정상 평가된다
    const ranked = scoreAndRank(
      datasets,
      ctx({ keywords: ["서초구", "주차장"], coreKeywords: ["서초구", "주차장"] })
    );

    expect(ranked).toHaveLength(2);
  });

  it("'구'를 뗀 줄임말도 자치구로 인식한다", () => {
    const ranked = scoreAndRank(
      datasets,
      ctx({ keywords: ["강남", "주차장"], coreKeywords: ["강남", "주차장"] })
    );

    expect(ranked[0]!.title).toBe("강남구 공영주차장 정보");
  });

  it("자치구를 지목하지 않으면 서울시 전체 데이터를 자치구 데이터보다 우대한다", () => {
    const ranked = scoreAndRank(
      [...datasets, makeDataset({ id: "OA-city", title: "서울시 공영주차장 정보", field: "교통" })],
      ctx({ keywords: ["주차장"], coreKeywords: ["주차장"] })
    );

    // 한 구만 담은 데이터보다 시 전체를 포괄하는 데이터가 먼저다
    expect(ranked[0]!.title).toBe("서울시 공영주차장 정보");
  });

  it("같은 주제를 여러 자치구가 등재하면 뒤쪽을 체감시켜 목록을 낭비하지 않는다", () => {
    // 25개 자치구가 같은 데이터를 각자 올리는 이 카탈로그 특유의 상황
    const ranked = scoreAndRank(
      [
        ...datasets,
        makeDataset({
          id: "OA-mapo",
          title: "마포구 공영주차장 정보",
          provider: "마포구",
          division: "자치구 및 자치구산하",
          field: "교통",
        }),
      ],
      ctx({ keywords: ["주차장"], coreKeywords: ["주차장"] })
    );

    expect(ranked).toHaveLength(3);
    // 감추지는 않는다 — 특정 자치구를 찾는 사용자에게는 그 구의 데이터가 답이다
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[1]!.score).toBeGreaterThan(ranked[2]!.score);
    expect(ranked[2]!.scoreBreakdown!.relevanceReasons.join(" ")).toContain("중복 체감");
  });

  it("자치구를 지목하면 자치구별 비교를 원한 것이므로 중복 체감을 적용하지 않는다", () => {
    const ranked = scoreAndRank(
      datasets,
      ctx({ keywords: ["강남구", "주차장"], coreKeywords: ["강남구", "주차장"] })
    );

    expect(ranked.every((r) => !r.scoreBreakdown!.relevanceReasons.join(" ").includes("중복 체감"))).toBe(
      true
    );
  });
});

describe("정책분야(BRM) 조건", () => {
  it("제목 글자는 겹치지만 정책분야가 다른 데이터를 아래로 내린다", () => {
    const ranked = scoreAndRank(
      [
        makeDataset({
          id: "OA-fine",
          title: "서울시 주차위반 과태료 부과 현황",
          field: "일반행정",
        }),
        makeDataset({
          id: "OA-lot",
          title: "서울시 공영주차장 주차 현황",
          field: "교통",
        }),
      ],
      ctx({
        keywords: ["주차장", "주차", "교통", "대중교통"],
        coreKeywords: ["주차장"],
      })
    );

    expect(ranked[0]!.title).toBe("서울시 공영주차장 주차 현황");
  });

  it("정책분야가 미분류인 데이터는 '분류가 없다'는 이유로 감점되지 않는다", () => {
    // 제목·활용도가 모두 같고 정책분야만 다른 세 건 — 분야 판정 외의 변수를 없앤다
    const ranked = scoreAndRank(
      [
        makeDataset({ id: "OA-match", title: "서울시 버스 노선 정보", field: "교통" }),
        makeDataset({ id: "OA-none", title: "서울시 버스 노선 정보" }),
        makeDataset({ id: "OA-mismatch", title: "서울시 버스 노선 정보", field: "복지" }),
      ],
      ctx({ keywords: ["버스", "노선"], coreKeywords: ["버스", "노선"] })
    );

    const scoreOf = (id: string) => ranked.find((r) => r.detailUrl.includes(id))!.score;

    // 분야가 일치하는 쪽과 동점 — 없는 정보로 깎지 않는다
    expect(scoreOf("OA-none")).toBe(scoreOf("OA-match"));
    // 분야가 어긋나는 쪽보다는 높다 — 어긋남은 실제 근거이므로 감점 대상이다
    expect(scoreOf("OA-none")).toBeGreaterThan(scoreOf("OA-mismatch"));
  });
});

describe("관련도 게이트", () => {
  it("제공기관·부서명에만 우연히 걸린 데이터는 끝까지 제외된다", () => {
    const ranked = scoreAndRank(
      [
        makeDataset({
          id: "OA-dept",
          title: "서울시 청사 회의실 예약 현황",
          department: "환경정책과",
          field: "일반행정",
        }),
        makeDataset({
          id: "OA-real",
          title: "서울시 대기환경 측정 정보",
          department: "대기정책과",
          field: "환경",
        }),
      ],
      ctx({ keywords: ["대기환경", "환경정책"], coreKeywords: ["대기환경"] })
    );

    expect(ranked.map((r) => r.title)).toEqual(["서울시 대기환경 측정 정보"]);
  });

  it("유사어가 여러 갈래로 흩어져도 각 갈래의 정답을 버리지 않는다", () => {
    // 유사어가 5개로 흩어져 어떤 후보도 커버리지 25%를 못 넘기는 상황.
    // 여기서 빈손으로 돌려주면 사용자는 '데이터가 없다'고 오해한다.
    const ranked = scoreAndRank(
      [
        makeDataset({ id: "OA-1", title: "서울시 무더위쉼터 운영 현황", field: "복지" }),
        makeDataset({ id: "OA-2", title: "서울시 폭염 특보 발효 내역", field: "안전" }),
        makeDataset({ id: "OA-3", title: "서울시 가로수 식재 현황", field: "환경" }),
        makeDataset({ id: "OA-4", title: "서울시 녹지 면적 통계", field: "환경" }),
        makeDataset({ id: "OA-5", title: "서울시 도시공원 지정 현황", field: "환경" }),
      ],
      ctx({
        // 원문 '그늘맵'은 카탈로그에 없는 신조어 — 후보에 한 건도 없다
        keywords: ["그늘맵", "무더위쉼터", "폭염", "가로수", "녹지", "도시공원"],
        coreKeywords: ["그늘맵"],
      })
    );

    expect(ranked).toHaveLength(5);
    expect(ranked.every((r) => r.scoreBreakdown!.matchedKeywords.length > 0)).toBe(true);
  });

  it("총점 하한을 아무도 못 넘기면 빈손 대신 제목·태그에 걸린 후보를 돌려준다", () => {
    // 키워드가 5갈래로 흩어진 데다 후보 품질도 바닥이라 1차 기준(총점 35)을
    // 통과하는 데이터가 하나도 없는 상황 — 여기서 빈손으로 돌려주면
    // 사용자는 '서울시에 그런 데이터가 없다'고 잘못 판단하게 된다.
    const poor = {
      type: "UNKNOWN" as const,
      updateCycle: "주기없음",
      lastUpdated: "2015-01-01",
    };
    const ranked = scoreAndRank(
      [
        makeDataset({ id: "OA-1", title: "서울시 아동 급식카드 가맹점", ...poor }),
        makeDataset({ id: "OA-2", title: "서울시 경로당 운영 정보", ...poor }),
        makeDataset({ id: "OA-3", title: "서울시 어린이집 수용 현황", ...poor }),
        makeDataset({ id: "OA-4", title: "서울시 자활사업 참여 인원", ...poor }),
        makeDataset({ id: "OA-5", title: "서울시 장애인 편의시설 목록", ...poor }),
      ],
      ctx({
        keywords: ["아동", "경로당", "어린이집", "자활", "장애인"],
        coreKeywords: ["아동", "경로당", "어린이집", "자활", "장애인"],
      })
    );

    expect(ranked).toHaveLength(5);
    // 되살린 후보임을 확인 — 1차 기준(총점 35)을 넘겼다면 이 테스트는 의미가 없다
    expect(ranked.every((r) => r.score < 35)).toBe(true);
  });
});

describe("실시간 요구", () => {
  it("실시간을 요구하면 갱신주기가 빠른 데이터가 앞선다", () => {
    const ranked = scoreAndRank(
      [
        makeDataset({ id: "OA-year", title: "서울시 버스 노선 연간 통계", updateCycle: "연간", field: "교통" }),
        makeDataset({ id: "OA-live", title: "서울시 버스 노선 실시간 정보", updateCycle: "실시간", field: "교통" }),
      ],
      ctx({ keywords: ["버스", "노선"], coreKeywords: ["버스", "노선"], realtimePreferred: true })
    );

    expect(ranked[0]!.title).toBe("서울시 버스 노선 실시간 정보");
  });
});
