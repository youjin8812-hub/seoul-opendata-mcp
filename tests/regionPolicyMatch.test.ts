import { describe, it, expect } from "vitest";
import { detectQueryDistricts, matchesDistricts } from "../src/ranking/regionMatch.js";
import { inferQueryPolicyFields } from "../src/ranking/policyFieldMatch.js";
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

describe("matchesDistricts", () => {
  const gangnam = makeDataset({
    id: "OA-1",
    title: "강남구 공영주차장 정보",
    provider: "강남구",
    division: "자치구 및 자치구산하",
  });
  const city = makeDataset({ id: "OA-2", title: "서울시 공영주차장 정보" });

  it("지목한 자치구의 데이터만 일치로 본다", () => {
    expect(matchesDistricts(gangnam, ["강남구"])).toBe(true);
    expect(matchesDistricts(city, ["강남구"])).toBe(false);
    expect(matchesDistricts(gangnam, [])).toBe(false);
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
