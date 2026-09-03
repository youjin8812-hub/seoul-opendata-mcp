import { describe, it, expect } from "vitest";
import {
  formatRecommendations,
  formatSearchResults,
  formatRecentUpdates,
  formatDatasetDetail,
  formatRefinedRecommendations,
} from "../src/formatters/textOutput.js";
import type { Recommendation } from "../src/types/index.js";

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    title: "서울시 그늘막 설치 위치 정보",
    provider: "서울특별시",
    type: "FILE",
    updateCycle: "연 1회",
    reason: "'그늘막'와(과) 관련됩니다.",
    score: 35,
    detailUrl: "https://data.seoul.go.kr/dataList/OA-1/S/1/datasetView.do",
    lastUpdated: "2025-03-14",
    department: "안전총괄과",
    brm: { primary: "안전", secondary: null, code: null, source: "catalog_map_category", confidence: "high" },
    ...overrides,
  };
}

/** 표의 각 행이 몇 개 열인지 센다 — 이스케이프된 "\\|"는 구분자가 아니다 */
function columnCountsOf(text: string): Set<number> {
  const rows = text.split("\n").filter((l) => l.startsWith("| "));
  return new Set(rows.map((r) => r.replace(/\\\|/g, "").split("|").length));
}

describe("formatRecommendations", () => {
  const output = {
    ideaSummary: "그늘막 앱 만들고 싶어",
    extractedKeywords: ["그늘막", "무더위쉼터"],
    recommendations: [makeRecommendation()],
  };

  it("사용자가 확인해야 할 항목을 표에 모두 담는다", () => {
    const text = formatRecommendations(output);

    // 제공형식·갱신주기·최종갱신·제공기관·담당부서 — 누락되면 안 되는 항목들
    expect(text).toContain("제공형식");
    expect(text).toContain("갱신주기");
    expect(text).toContain("최종갱신");
    expect(text).toContain("담당부서");
    expect(text).toContain("파일");
    expect(text).toContain("연 1회");
    expect(text).toContain("2025-03-14");
    expect(text).toContain("안전총괄과");
  });

  it("데이터명에 상세페이지 링크를 건다", () => {
    expect(formatRecommendations(output)).toContain(
      "[서울시 그늘막 설치 위치 정보](https://data.seoul.go.kr/dataList/OA-1/S/1/datasetView.do)"
    );
  });

  it("API형은 'OpenAPI'로 표기한다", () => {
    const text = formatRecommendations({
      ...output,
      recommendations: [makeRecommendation({ type: "API" })],
    });
    expect(text).toContain("OpenAPI");
  });

  it("값이 없는 항목은 표를 깨뜨리지 않고 —로 채운다", () => {
    const text = formatRecommendations({
      ...output,
      recommendations: [makeRecommendation({ department: undefined, lastUpdated: undefined })],
    });
    expect(text).toContain("—");
    expect(columnCountsOf(text).size).toBe(1);
  });

  // 제목에 "|"가 들어가면 마크다운 표가 깨진다
  it("데이터명의 파이프 문자를 이스케이프한다", () => {
    const text = formatRecommendations({
      ...output,
      recommendations: [makeRecommendation({ title: "서울시 그늘막|쉼터 현황" })],
    });
    expect(text).toContain("그늘막\\|쉼터");
    expect(columnCountsOf(text).size).toBe(1);
  });

  it("결과가 없으면 warning을 그대로 보여준다", () => {
    const text = formatRecommendations({
      ideaSummary: "블록체인 앱",
      extractedKeywords: ["블록체인"],
      recommendations: [],
      warning: "관련된 데이터가 없었습니다.",
    });
    expect(text).toContain("추천 데이터 0건");
    expect(text).toContain("관련된 데이터가 없었습니다.");
  });

  it("키워드 출처 내역을 함께 보여준다", () => {
    const text = formatRecommendations({
      ...output,
      keywordSources: { core: ["그늘막"], client: ["쿨링포그"], catalog: [], dictionary: ["폭염"] },
    });
    expect(text).toContain("원문 1");
    expect(text).toContain("어시스턴트 1");
  });
});

describe("formatSearchResults", () => {
  it("검색 결과와 전체 건수를 함께 보여준다", () => {
    const text = formatSearchResults({
      query: "그늘막",
      items: [
        {
          title: "서울시 그늘막 현황",
          summary: "안전 · 안전총괄과 · File",
          provider: "서울특별시",
          detailUrl: "https://data.seoul.go.kr/x",
        },
      ],
      totalMatchCount: 42,
    });
    expect(text).toContain("표시 1건 / 전체 42건");
    expect(text).toContain("서울시 그늘막 현황");
  });

  it("결과가 없으면 안내 문구를 보여준다", () => {
    const text = formatSearchResults({ query: "없는키워드", items: [], totalMatchCount: 0 });
    expect(text).toContain("조건에 맞는 데이터가 없습니다");
  });
});

describe("formatRecentUpdates", () => {
  it("표본 정렬 note를 인용문으로 덧붙인다", () => {
    const text = formatRecentUpdates({
      items: [
        {
          title: "서울시 무더위쉼터",
          provider: "서울특별시",
          division: "서울시(본청)",
          type: "API",
          updateCycle: "월 1회",
          lastUpdated: "2026-06-10",
          detailUrl: "https://data.seoul.go.kr/x",
        },
      ],
      totalMatchCount: 1500,
      note: "표본 내 최신순 정렬 결과입니다.",
    });
    expect(text).toContain("전체 1500건");
    expect(text).toContain("> 표본 내 최신순 정렬 결과입니다.");
  });
});

describe("formatDatasetDetail", () => {
  it("메타정보를 항목/내용 표로 정리하고 note를 목록으로 편다", () => {
    const text = formatDatasetDetail({
      title: "서울시 그늘막 현황",
      provider: "서울특별시 / 안전총괄과",
      baseUrl: "http://openapi.seoul.go.kr:8088",
      endpoints: [],
      authMethod: "서울 열린데이터광장 인증키",
      swaggerUrl: "https://data.seoul.go.kr/x",
      detailPageUrl: "https://data.seoul.go.kr/x",
      note: "분류: 공공데이터 > 안전\n갱신주기: 연 1회",
    });
    expect(text).toContain("## 서울시 그늘막 현황");
    expect(text).toContain("| 제공기관 | 서울특별시 / 안전총괄과 |");
    expect(text).toContain("- 갱신주기: 연 1회");
  });
});

describe("formatRefinedRecommendations", () => {
  it("재정렬 결과를 추천과 같은 표 형식으로 보여준다", () => {
    const text = formatRefinedRecommendations([makeRecommendation()]);
    expect(text).toContain("재정렬 결과 1건");
    expect(text).toContain("담당부서");
  });

  it("결과가 비면 필터 완화를 안내한다", () => {
    expect(formatRefinedRecommendations([])).toContain("필터를 완화");
  });
});
