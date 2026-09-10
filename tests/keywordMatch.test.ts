/**
 * 키워드 가중·커버리지 계산 단위 검증.
 * 순위 결과가 아니라 "왜 그 순위가 나오는지"의 근거를 고정한다.
 */

import { describe, it, expect } from "vitest";
import { buildKeywordStats, matchKeywords, findMatchPosition, datasetText } from "../src/ranking/keywordMatch.js";
import { makeDataset } from "./helpers/makeDataset.js";

const pool = [
  makeDataset({ id: "OA-1", title: "서울시 도서관 운영 현황 정보", field: "문화/관광" }),
  makeDataset({ id: "OA-2", title: "서울시 공공도서관 장서 현황 정보", field: "문화/관광" }),
  makeDataset({ id: "OA-3", title: "서울시 상수도 요금 현황 정보", field: "도시관리" }),
  makeDataset({ id: "OA-4", title: "서울시 도로 포장 현황 정보", field: "교통" }),
];

describe("buildKeywordStats", () => {
  const keywords = ["도서관", "현황", "정보"];

  it("후보 전부에 등장하는 범용어는 가중이 바닥으로 내려간다", () => {
    const stats = buildKeywordStats(pool, keywords, keywords);
    const byKeyword = Object.fromEntries(stats.map((s) => [s.keyword, s]));

    expect(byKeyword["현황"]!.df).toBe(pool.length);
    expect(byKeyword["도서관"]!.weight).toBeGreaterThan(byKeyword["현황"]!.weight * 3);
  });

  it("후보에 한 번도 없는 키워드는 df=0으로 표시되어 분모에서 빠진다", () => {
    const stats = buildKeywordStats(pool, ["그늘맵", "도서관"], ["그늘맵", "도서관"]);
    expect(stats.find((s) => s.keyword === "그늘맵")!.df).toBe(0);

    // 분모에서 빠지므로, 나머지를 맞춘 데이터의 커버리지가 깎이지 않는다
    const match = matchKeywords(pool[0]!, stats);
    expect(match.ratio).toBe(1);
  });

  it("확장 유사어는 어떤 경우에도 원문 키워드보다 가볍다", () => {
    // '도서관'은 후보 절반에 등장(변별력 보통), '현황'은 전 건에 등장(변별력 없음)
    const stats = buildKeywordStats(pool, ["현황", "도서관"], ["현황"]);
    const core = stats.find((s) => s.keyword === "현황")!;
    const expanded = stats.find((s) => s.keyword === "도서관")!;

    expect(expanded.weight).toBeLessThan(core.weight);
  });
});

describe("matchKeywords", () => {
  const keywords = ["도서관", "현황", "정보"];
  const stats = buildKeywordStats(pool, keywords, keywords);

  it("질의를 모두 충족하면 커버리지가 1이다", () => {
    expect(matchKeywords(pool[0]!, stats).ratio).toBe(1);
  });

  it("범용어만 맞은 데이터는 주제어 매칭(primaryHit)으로 인정되지 않는다", () => {
    const generic = matchKeywords(pool[2]!, stats); // 상수도 — 현황·정보만 일치
    expect(generic.strongHits).toBeGreaterThan(0);
    expect(generic.primaryHit).toBe(false);
    expect(generic.ratio).toBeLessThan(matchKeywords(pool[0]!, stats).ratio);
  });

  it("매칭 위치는 제목 > 태그 > 본문 순으로 하나만 인정한다", () => {
    const dataset = makeDataset({
      id: "OA-pos",
      title: "서울시 대기환경 측정 정보",
      department: "교통정책과",
      field: "환경",
    });
    const text = datasetText(dataset);

    expect(findMatchPosition(text, "대기환경")).toBe("title");
    expect(findMatchPosition(text, "환경")).toBe("title");
    expect(findMatchPosition(text, "교통정책")).toBe("body");
    expect(findMatchPosition(text, "없는말")).toBe(null);
  });

  it("2글자 이하 키워드는 제공부서명 우연 일치를 인정하지 않는다", () => {
    const dataset = makeDataset({
      id: "OA-short",
      title: "서울시 상수도 요금 현황",
      department: "교통정책과",
      field: "도시관리",
    });
    const text = datasetText(dataset);

    expect(findMatchPosition(text, "교통")).toBe(null);
  });
});
