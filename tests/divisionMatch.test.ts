import { describe, it, expect } from "vitest";
import { matchesDivision } from "../src/utils/divisionMatch.js";

describe("matchesDivision", () => {
  it("필터가 없으면 항상 true", () => {
    expect(matchesDivision("서울시(본청)", undefined)).toBe(true);
    expect(matchesDivision("서울시(본청)", "")).toBe(true);
  });

  it("짧은 키워드로 포함 매칭된다", () => {
    expect(matchesDivision("서울시(본청)", "본청")).toBe(true);
    expect(matchesDivision("서울시(산하기관)", "산하기관")).toBe(true);
    expect(matchesDivision("자치구 및 자치구산하", "자치구")).toBe(true);
  });

  it("일치하지 않으면 false", () => {
    expect(matchesDivision("서울시(본청)", "자치구")).toBe(false);
  });
});
