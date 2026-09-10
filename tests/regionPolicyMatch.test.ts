import { describe, it, expect } from "vitest";
import {
  detectQueryDistricts,
  districtNeutralTitle,
  regionFit,
  scopeOf,
  stripDistrictKeywords,
} from "../src/ranking/regionMatch.js";
import {
  inferQueryPolicyFields,
  inferPolicyFieldsFromPool,
} from "../src/ranking/policyFieldMatch.js";
import { makeDataset } from "./helpers/makeDataset.js";

describe("detectQueryDistricts", () => {
  it("자치구명과 줄임말을 인식한다", () => {
    expect(detectQueryDistricts(["강남구", "주차장"])).toEqual(["강남구"]);
    expect(detectQueryDistricts(["영등포", "축제"])).toEqual(["영등포구"]);
  });

  it("자치구가 없는 질의에서는 아무것도 지목하지 않는다", () => {
    // '시설'·'구인구직'처럼 '시'·'구'가 들어간 단어를 지역 조건으로 오인하지 않는다
    expect(detectQueryDistricts(["주차장", "시설", "구인구직", "전국"])).toEqual([]);
  });
});

describe("stripDistrictKeywords", () => {
  it("자치구명을 키워드에서 걷어낸다 — 주제와 장소를 갈라 놓는다", () => {
    expect(stripDistrictKeywords(["강남구", "주차장"])).toEqual(["주차장"]);
    expect(stripDistrictKeywords(["강남", "주차장"])).toEqual(["주차장"]);
    // 자치구가 없으면 그대로 둔다
    expect(stripDistrictKeywords(["주차장", "혼잡"])).toEqual(["주차장", "혼잡"]);
  });
});

describe("regionFit", () => {
  const gangnam = makeDataset({
    id: "OA-1",
    title: "강남구 공영주차장 정보",
    provider: "강남구",
    division: "자치구 및 자치구산하",
  });
  const nowon = makeDataset({
    id: "OA-2",
    title: "노원구 공영주차장 정보",
    provider: "노원구",
    division: "자치구 및 자치구산하",
  });
  const city = makeDataset({ id: "OA-3", title: "서울시 공영주차장 정보" });

  it("자치구 데이터와 시 전체 데이터를 구분한다", () => {
    expect(scopeOf(gangnam)).toBe("district");
    expect(scopeOf(city)).toBe("citywide");
  });

  it("자치구를 지목하면 그 구 > 시 전체 > 다른 구 순으로 본다", () => {
    expect(regionFit(gangnam, ["강남구"]).fit).toBe(1);
    // 시 전체 데이터에도 강남구가 들어 있으므로 절반은 인정한다
    expect(regionFit(city, ["강남구"]).fit).toBe(0.5);
    expect(regionFit(nowon, ["강남구"]).fit).toBe(0);
  });

  it("자치구를 지목하지 않으면 시 전체를 포괄하는 데이터를 우대한다", () => {
    expect(regionFit(city, []).fit).toBe(1);
    expect(regionFit(gangnam, []).fit).toBe(0.5);
  });
});

describe("districtNeutralTitle", () => {
  it("자치구명·서울시 표기를 걷어내 근사중복을 같은 키로 묶는다", () => {
    const gangnam = makeDataset({
      id: "OA-1",
      title: "강남구 공영주차장 현황",
      provider: "강남구",
      division: "자치구 및 자치구산하",
    });
    const nowon = makeDataset({
      id: "OA-2",
      title: "노원구 공영주차장 현황",
      provider: "노원구",
      division: "자치구 및 자치구산하",
    });

    expect(districtNeutralTitle(gangnam)).toBe(districtNeutralTitle(nowon));
  });
});

describe("inferQueryPolicyFields", () => {
  it("단서가 충분할 때만 정책분야를 채택한다", () => {
    expect(inferQueryPolicyFields(["따릉이", "자전거", "대여소"])).toContain("교통");
    // 단서가 하나뿐이면 추론하지 않는다 — 틀린 추론으로 정답을 깎지 않기 위해서다
    expect(inferQueryPolicyFields(["도서"])).toEqual([]);
  });

  it("사용자가 분야명을 직접 말하면 단서가 하나여도 채택한다", () => {
    expect(inferQueryPolicyFields(["교통", "혼잡"], ["교통"])).toContain("교통");
  });

  it("한 주제가 두 분야에 걸치면 둘 다 채택한다", () => {
    const fields = inferQueryPolicyFields(
      ["그늘막", "무더위쉼터", "폭염", "가로수", "녹지"],
      ["그늘막"]
    );
    expect(fields).toContain("환경");
    expect(fields).toContain("안전");
    expect(fields.length).toBeLessThanOrEqual(2);
  });
});

describe("inferPolicyFieldsFromPool", () => {
  it("질의어가 걸린 후보들의 분야 분포로 질의 분야를 잡아낸다", () => {
    // 사전이 모르는 신조어 질의여도, 카탈로그 자신의 분류가 답을 알려준다
    const matched = ["교통", "교통", "교통", "교통", "일반행정"] as const;
    expect(inferPolicyFieldsFromPool([...matched])).toEqual(["교통"]);
  });

  it("표본이 적으면 분포를 믿지 않는다", () => {
    // 두세 건짜리 후보군에서는 한 건만 달라도 점유율이 50%씩 튄다
    expect(inferPolicyFieldsFromPool(["교통", "복지"])).toEqual([]);
  });

  it("분야가 넓게 흩어져 있으면 아무것도 채택하지 않는다", () => {
    const spread = ["교통", "복지", "환경", "교육", "보건", "안전"] as const;
    expect(inferPolicyFieldsFromPool([...spread])).toEqual([]);
  });
});
