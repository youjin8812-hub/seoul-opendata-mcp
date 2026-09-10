/**
 * 질의 표현 불변성 — 같은 뜻을 다르게 물어도 같은 답이 나와야 한다.
 *
 * 이 도구는 추출한 키워드로 카탈로그를 검색해 후보군을 만들고, 그 후보군을 기준으로
 * IDF 가중을 계산한다. 그래서 키워드가 하나만 달라져도 후보군 → 가중 → 점수가
 * 연쇄적으로 흔들린다. 어순만 바꿔 물었는데 추천 결과가 달라지면 이 도구는
 * 업무에 쓸 수 없다 — 컨설팅 근거로 제시한 점수를 재현할 수 없기 때문이다.
 *
 * 그래서 표현 차이를 흡수하는 지점을 두 곳에 뒀고, 여기서 둘 다 검증한다.
 *   1) 키워드 추출 — 조사·어미·의문사·요청 동사를 걷어내고 정규 순서로 정렬
 *   2) 점수화 — 동점까지 확정적으로 정렬, 입력 순서에 좌우되지 않음
 */

import { describe, it, expect } from "vitest";
import { extractKeywords, canonicalizeKeywords } from "../src/parsers/extractKeywords.js";
import { scoreAndRank } from "../src/ranking/scoreDataset.js";
import { makeDataset } from "./helpers/makeDataset.js";

/** 같은 뜻의 여러 표현이 같은 원문 키워드로 수렴하는지 확인한다 */
function coreKeywordsOf(text: string): string[] {
  return extractKeywords(text).coreKeywords;
}

describe("키워드 추출 — 표현이 달라도 같은 키워드", () => {
  it("어순·조사·요청 말투가 달라도 같은 원문 키워드가 나온다", () => {
    const phrasings = [
      "따릉이 대여소 현황",
      "대여소 따릉이 현황",
      "따릉이 대여소 현황을 알려줘",
      "대여소별 따릉이 현황이 궁금해",
      "따릉이 대여소가 어떤지 데이터 찾아줘",
      "따릉이 대여소 현황 데이터 추천해줘",
    ];

    const results = phrasings.map(coreKeywordsOf);
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0]).toEqual(["대여소", "따릉이"]);
  });

  it("실시간 요구를 여러 말로 표현해도 똑같이 인식한다", () => {
    const realtimePhrasings = [
      "실시간 따릉이 대여 현황",
      "지금 따릉이가 몇 대 있는지",
      "현재 따릉이 대여 상황",
      "오늘 따릉이 현황",
    ];

    for (const phrasing of realtimePhrasings) {
      expect(extractKeywords(phrasing).isRealtimeHinted).toBe(true);
    }
    expect(extractKeywords("따릉이 연간 이용 통계").isRealtimeHinted).toBe(false);
  });

  it("의문사가 키워드로 새어 나오지 않는다", () => {
    const keywords = coreKeywordsOf("무더위쉼터가 어디에 몇 개나 있는지 알려줘");
    expect(keywords).toEqual(["무더위쉼터"]);
  });

  it("짧은 말의 접미사는 건드리지 않는다 — '성별'을 '성'으로 자르지 않는다", () => {
    expect(coreKeywordsOf("연령별 성별 인구 통계")).toContain("성별");
  });

  it("주격조사 '이'를 낱말 일부와 구분한다 — '따릉이'는 자르지 않는다", () => {
    expect(coreKeywordsOf("따릉이 대여소")).toContain("따릉이");
    // "현황이"는 사전이 아는 말('현황') + 조사이므로 정리되고, 범용어라 키워드에서 빠진다
    expect(coreKeywordsOf("무더위쉼터 현황이")).toEqual(["무더위쉼터"]);
  });

  it("'현황'은 실시간 요구로 읽지 않는다", () => {
    // 서울 열린데이터광장은 서비스명 상당수가 "○○ 현황"이고 사용자도 그냥 '자료'라는
    // 뜻으로 쓴다. 실시간 요구로 읽으면 "따릉이 대여소 현황"과 "따릉이 대여소 데이터"가
    // 서로 다른 질의가 되어 추천이 갈린다.
    expect(extractKeywords("따릉이 대여소 현황").isRealtimeHinted).toBe(false);
    expect(extractKeywords("따릉이 대여소 실시간 현황").isRealtimeHinted).toBe(true);
  });

  it("범용어는 키워드에 남지 않는다", () => {
    // 표현마다 붙었다 떨어졌다 하는 말들이라, 남겨 두면 같은 질의가 갈라진다
    const { keywords } = extractKeywords("따릉이 대여소 위치 정보 현황 자료");
    expect(keywords).toContain("따릉이");
    for (const generic of ["위치", "정보", "현황", "자료"]) {
      expect(keywords).not.toContain(generic);
    }
  });

  it("정규 순서는 구체적인 말을 앞에 둔다", () => {
    // 검색 쿼리는 앞쪽 몇 개만 쓰이므로, 변별력 있는 긴 말이 먼저 가야 한다
    expect(canonicalizeKeywords(["그늘", "무더위쉼터", "그늘막"])).toEqual([
      "무더위쉼터",
      "그늘막",
      "그늘",
    ]);
    // 같은 길이는 가나다순으로 확정한다
    expect(canonicalizeKeywords(["따릉이", "대여소"])).toEqual(["대여소", "따릉이"]);
  });
});

describe("점수화 — 입력 순서가 결과를 바꾸지 않는다", () => {
  const pool = [
    makeDataset({ id: "OA-1", title: "서울시 따릉이 대여소 정보", field: "교통" }),
    makeDataset({ id: "OA-2", title: "서울시 따릉이 대여이력 정보", field: "교통" }),
    makeDataset({ id: "OA-3", title: "서울시 공공자전거 대여소 이용현황", field: "교통" }),
    makeDataset({ id: "OA-4", title: "서울시 자전거 도로 현황", field: "교통" }),
  ];

  it("후보군 순서를 뒤집어도 순위와 점수가 같다", () => {
    const context = {
      keywords: ["대여소", "따릉이", "자전거", "공공자전거"],
      coreKeywords: ["대여소", "따릉이"],
      apiOnly: false,
      realtimePreferred: false,
    };

    const forward = scoreAndRank(pool, context);
    const reversed = scoreAndRank([...pool].reverse(), context);

    expect(reversed.map((r) => [r.title, r.score])).toEqual(
      forward.map((r) => [r.title, r.score])
    );
  });

  it("키워드 순서를 바꿔도 순위와 점수가 같다", () => {
    const base = {
      coreKeywords: ["대여소", "따릉이"],
      apiOnly: false,
      realtimePreferred: false,
    };

    const a = scoreAndRank(pool, { ...base, keywords: ["대여소", "따릉이", "자전거"] });
    const b = scoreAndRank(pool, { ...base, keywords: ["자전거", "따릉이", "대여소"] });

    expect(b.map((r) => [r.title, r.score])).toEqual(a.map((r) => [r.title, r.score]));
  });
});

describe("추출부터 점수화까지 — 표현이 달라도 같은 추천", () => {
  const pool = [
    makeDataset({ id: "OA-1", title: "서울시 따릉이 대여소 정보", field: "교통" }),
    makeDataset({ id: "OA-2", title: "서울시 따릉이 대여이력 정보", field: "교통" }),
    makeDataset({ id: "OA-3", title: "서울시 지하철 역사 정보", field: "교통" }),
    makeDataset({ id: "OA-4", title: "서울시 공영주차장 안내", field: "교통" }),
  ];

  const phrasings = [
    "따릉이 대여소 현황",
    "대여소별 따릉이 현황 알려줘",
    "따릉이 대여소가 어떤지 데이터 찾아줘",
    "따릉이 대여소 관련 데이터 추천해줘",
    "따릉이 대여소 위치 정보가 궁금해",
  ];

  it("다섯 가지 표현이 모두 같은 순위·같은 점수를 낸다", () => {
    const outcomes = phrasings.map((phrasing) => {
      const { keywords, coreKeywords, isRealtimeHinted } = extractKeywords(phrasing);
      return scoreAndRank(pool, {
        keywords,
        coreKeywords,
        apiOnly: false,
        realtimePreferred: isRealtimeHinted,
      }).map((r) => [r.title, r.score]);
    });

    for (const outcome of outcomes) {
      expect(outcome).toEqual(outcomes[0]);
    }
    expect(outcomes[0]![0]![0]).toBe("서울시 따릉이 대여소 정보");
  });
});

describe("자치구를 지목한 질의 — 표현이 달라도 같은 답", () => {
  const pool = [
    makeDataset({ id: "OA-city", title: "서울시 공영주차장 안내 정보", field: "교통" }),
    makeDataset({
      id: "OA-gangnam",
      title: "강남구 공영주차장 현황",
      provider: "강남구",
      division: "자치구 및 자치구산하",
      field: "교통",
    }),
    makeDataset({
      id: "OA-nowon",
      title: "노원구 공영주차장 현황",
      provider: "노원구",
      division: "자치구 및 자치구산하",
      field: "교통",
    }),
  ];

  it("'강남구 주차장'·'주차장 강남구'·'강남 지역 주차장'이 같은 결과를 낸다", () => {
    const outcomes = [
      "강남구 주차장 데이터",
      "주차장 데이터 강남구",
      "강남 지역 주차장 현황이 궁금해",
    ].map((phrasing) => {
      const { keywords, coreKeywords, isRealtimeHinted } = extractKeywords(phrasing);
      return scoreAndRank(pool, {
        keywords,
        coreKeywords,
        apiOnly: false,
        realtimePreferred: isRealtimeHinted,
      }).map((r) => [r.title, r.score]);
    });

    for (const outcome of outcomes) {
      expect(outcome).toEqual(outcomes[0]);
    }
    // 지목하지 않은 자치구 데이터는 답이 아니다
    expect(outcomes[0]!.map(([title]) => title)).not.toContain("노원구 공영주차장 현황");
  });
});
