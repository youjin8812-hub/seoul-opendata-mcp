import { describe, it, expect } from "vitest";
import {
  buildVocabulary,
  findSimilarTerms,
  findCooccurringTerms,
  expandWithCatalogVocabulary,
  ngrams,
} from "../src/vocab/catalogVocabulary.js";

/** 서울 카탈로그의 실제 등재명을 본뜬 표본 */
const SAMPLE = [
  ["서울시 그늘막 설치 현황", "안전"],
  ["서울시 그늘목 조성 현황", "환경"],
  ["서울시 폭염저감시설 설치 위치", "안전"],
  ["서울시 쿨링포그 운영 현황", "안전"],
  ["서울시 무더위쉼터 운영 정보", "사회복지"],
  ["서울시 폭염취약지역 통계", "안전"],
  ["서울시 가로수 식재 현황", "환경"],
  ["서울시 도시숲 조성 현황", "환경"],
  ["서울시 상수도 요금 부과 내역", "일반행정"],
  ["서울시 지하철 역별 승하차 인원", "교통"],
  ["서울시 버스 노선 정보", "교통"],
].map(([infNm, mapCateNm]) => ({ infNm: infNm!, mapCateNm: mapCateNm! }));

const vocab = buildVocabulary(SAMPLE);

describe("ngrams", () => {
  it("2-gram으로 쪼갠다", () => {
    expect(ngrams("그늘막")).toEqual(["그늘", "늘막"]);
  });

  it("n보다 짧은 문자열은 그대로 반환한다", () => {
    expect(ngrams("맵")).toEqual(["맵"]);
    expect(ngrams("")).toEqual([]);
  });
});

describe("buildVocabulary", () => {
  it("서비스명에서 표제어를 색인한다", () => {
    expect(vocab.datasetCount).toBe(SAMPLE.length);
    expect(vocab.termFrequency.has("그늘막")).toBe(true);
    expect(vocab.termFrequency.has("쿨링포그")).toBe(true);
  });

  it("'서울시'·'현황' 같은 범용어는 색인에서 제외된다", () => {
    expect(vocab.termFrequency.has("서울시")).toBe(false);
    expect(vocab.termFrequency.has("현황")).toBe(false);
    expect(vocab.termFrequency.has("설치")).toBe(false);
  });

  it("표제어를 분류(MAP_CATE_NM)에 연결한다", () => {
    expect([...(vocab.termCategories.get("그늘막") ?? [])]).toEqual(["안전"]);
  });
});

describe("findSimilarTerms", () => {
  // 손으로 쓴 사전에 없는 신조어를 카탈로그 실제 등재명으로 연결하는 것이 핵심 목적
  it("사전에 없는 신조어 '그늘맵'을 등재명 '그늘막'으로 연결한다", () => {
    const similar = findSimilarTerms(vocab, "그늘맵");
    expect(similar).toContain("그늘막");
    expect(similar).toContain("그늘목");
  });

  it("자기 자신은 결과에 포함하지 않는다", () => {
    expect(findSimilarTerms(vocab, "그늘막")).not.toContain("그늘막");
  });

  it("겹치는 표기가 없으면 빈 배열을 반환한다", () => {
    expect(findSimilarTerms(vocab, "블록체인")).toEqual([]);
  });
});

describe("findCooccurringTerms", () => {
  it("같은 분류의 다른 표제어를 제안한다 — 표기가 달라도 잡힌다", () => {
    const related = findCooccurringTerms(vocab, ["그늘막"]);
    // "쿨링포그"는 "그늘막"과 표기가 전혀 겹치지 않지만 같은 '안전' 분류다
    expect(related).toContain("쿨링포그");
  });

  it("입력 표제어 자신은 제외한다", () => {
    expect(findCooccurringTerms(vocab, ["그늘막"])).not.toContain("그늘막");
  });
});

describe("expandWithCatalogVocabulary", () => {
  it("'그늘맵' 하나로 폭염·그늘 관련 등재명을 폭넓게 확장한다", () => {
    const expanded = expandWithCatalogVocabulary(vocab, ["그늘맵"]);

    expect(expanded).toContain("그늘막");
    expect(expanded).toContain("쿨링포그");
    expect(expanded).toContain("폭염저감시설");
    // 확장 결과는 모두 카탈로그에 실재하는 표제어여야 한다
    for (const term of expanded) {
      expect(vocab.termFrequency.has(term)).toBe(true);
    }
  });

  it("원문 키워드는 확장 결과에 중복해 넣지 않는다", () => {
    expect(expandWithCatalogVocabulary(vocab, ["그늘막"])).not.toContain("그늘막");
  });

  it("limit을 넘지 않는다", () => {
    expect(expandWithCatalogVocabulary(vocab, ["그늘맵"], 3).length).toBeLessThanOrEqual(3);
  });

  it("무관한 키워드에는 확장을 만들지 않는다", () => {
    expect(expandWithCatalogVocabulary(vocab, ["블록체인"])).toEqual([]);
  });
});
