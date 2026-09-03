import { describe, it, expect } from "vitest";
import { scoreAndRank, computeScoreBreakdown } from "../src/ranking/scoreDataset.js";
import type { NormalizedDataset } from "../src/types/index.js";

function makeDataset(overrides: Partial<NormalizedDataset>): NormalizedDataset {
  return {
    id: "test-1",
    title: "테스트 데이터셋",
    provider: "테스트기관",
    type: "UNKNOWN",
    description: "",
    updateCycle: "미확인",
    lastUpdated: "2025-01-01",
    detailUrl: "https://example.com",
    tags: [],
    division: "서울시(본청)",
    brm: { primary: null, secondary: null, code: null, source: "unclassified", confidence: "low" },
    organization: {
      type: "headquarters",
      label: "서울시 본청",
      organizationName: "테스트기관",
      source: "raw_division",
      confidence: "high",
    },
    _raw: {
      infId: "OA-0",
      infNm: "테스트 데이터셋",
      cateNm: "",
      ditcNm: "",
      mapCateNm: "",
      mngOrganName: "",
      mngStationName: "",
      linkDesc: "",
      linkInfo: "",
      managerName: "",
      managerPhone: "",
      chngLoadNm: "",
      dataLtNm: "",
      srvType: "",
      shortUrl: "",
    },
    ...overrides,
  };
}

describe("scoreAndRank", () => {
  it("키워드 매칭이 높은 데이터셋이 상위에 온다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "버스 노선 정보", description: "버스 운행 정보", type: "API" }),
      makeDataset({ id: "2", title: "전국 음식점 현황", description: "음식점 목록", type: "FILE" }),
      makeDataset({ id: "3", title: "지역 축제 정보", description: "지역 축제 행사 일정", type: "API" }),
    ];

    const ctx = { keywords: ["축제", "행사", "지역"], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked[0]!.title).toBe("지역 축제 정보");
  });

  it("apiOnly=true이면 FILE 타입은 결과에서 제거된다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "축제 API", type: "API" }),
      makeDataset({ id: "2", title: "축제 파일", type: "FILE" }),
    ];
    const ctx = { keywords: ["축제"], apiOnly: true, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked.every((r) => r.type === "API")).toBe(true);
    expect(ranked).toHaveLength(1);
  });

  it("realtimePreferred=true이면 실시간 데이터셋이 boost된다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "축제 월별 통계", type: "API", updateCycle: "월1회" }),
      makeDataset({ id: "2", title: "축제 실시간 현황", type: "API", updateCycle: "실시간" }),
    ];
    const ctx = { keywords: ["축제"], apiOnly: false, realtimePreferred: true };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked[0]!.title).toBe("축제 실시간 현황");
  });

  it("API형 데이터셋이 FILE형보다 높은 점수를 받는다", () => {
    const api = makeDataset({ id: "1", title: "같은 제목", type: "API", description: "설명" });
    const file = makeDataset({ id: "2", title: "같은 제목", type: "FILE", description: "설명" });

    const ctx = { keywords: [], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank([file, api], ctx);

    expect(ranked[0]!.type).toBe("API");
  });

  it("결과는 내림차순 정렬되어 있다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "저관련 데이터", type: "FILE" }),
      makeDataset({ id: "2", title: "고관련 축제 API", type: "API", description: "축제 행사 지역 일정 정보" }),
    ];
    const ctx = { keywords: ["축제", "행사"], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it("scoreBreakdown이 legacy score와 별개로 함께 반환된다", () => {
    const datasets = [
      makeDataset({ id: "1", title: "축제 API", type: "API", description: "축제 행사 정보" }),
    ];
    const ctx = { keywords: ["축제"], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked[0]!.scoreBreakdown).toBeDefined();
    expect(ranked[0]!.scoreBreakdown!.legacyScore).toBe(ranked[0]!.score);
    expect(ranked[0]!.scoreBreakdown!.relevanceScore).toBeGreaterThan(0);
    expect(ranked[0]!.scoreBreakdown!.qualityScore).toBeGreaterThan(0);
  });

  it("brm/organization 분류결과가 Recommendation에 그대로 전달된다", () => {
    const datasets = [
      makeDataset({
        id: "1",
        title: "축제 API",
        type: "API",
        brm: { primary: "문화/관광", secondary: null, code: null, source: "catalog_map_category", confidence: "high" },
      }),
    ];
    const ctx = { keywords: ["축제"], apiOnly: false, realtimePreferred: false };
    const ranked = scoreAndRank(datasets, ctx);

    expect(ranked[0]!.brm?.primary).toBe("문화/관광");
    expect(ranked[0]!.organization?.type).toBe("headquarters");
  });
});

describe("유사어 확장 대응 — 희석 방지와 관련도 게이트", () => {
  const shadeMap = makeDataset({
    id: "shade",
    title: "서울시 그늘막(파라솔) 설치 위치 정보",
    type: "FILE",
    updateCycle: "연 1회",
    lastUpdated: "2023-05-01",
    tags: ["안전"],
  });

  it("유사어를 늘려도 관련 데이터의 점수가 떨어지지 않는다", () => {
    const core = ["그늘막"];
    const few = scoreAndRank([shadeMap], {
      keywords: ["그늘막", "그늘"],
      coreKeywords: core,
      apiOnly: false,
      realtimePreferred: false,
    })[0]!.score;

    const many = scoreAndRank([shadeMap], {
      keywords: ["그늘막", "그늘", "폭염", "무더위쉼터", "쉼터", "가로수", "녹지"],
      coreKeywords: core,
      apiOnly: false,
      realtimePreferred: false,
    })[0]!.score;

    // 기존 비율 방식에서는 49점 → 28점으로 오히려 떨어졌다
    expect(many).toBeGreaterThanOrEqual(few);
  });

  it("키워드에 전혀 걸리지 않는 데이터셋은 형태·최신성이 좋아도 제외된다", () => {
    const unrelated = makeDataset({
      id: "unrelated",
      title: "서울시 상수도 요금 부과 현황",
      type: "API",
      updateCycle: "실시간",
      lastUpdated: new Date().toISOString().slice(0, 10),
      tags: ["일반행정"],
    });

    const ranked = scoreAndRank([unrelated, shadeMap], {
      keywords: ["그늘막", "그늘", "폭염"],
      coreKeywords: ["그늘막"],
      apiOnly: false,
      realtimePreferred: false,
    });

    expect(ranked.map((r) => r.title)).toEqual([shadeMap.title]);
  });

  it("키워드가 없는 질의에서는 게이트가 동작하지 않는다", () => {
    const ranked = scoreAndRank(
      [makeDataset({ id: "any", title: "아무 데이터", type: "API" })],
      { keywords: [], apiOnly: false, realtimePreferred: false }
    );
    expect(ranked).toHaveLength(1);
  });

  // "그늘막"으로 검색했는데 그늘막 데이터가 갱신주기·최신성에 밀려 3등으로
  // 내려가던 문제 — 원문 키워드가 제목에 있으면 도메인 점수만으로 20점을 얻어
  // 관련도가 순위를 주도한다.
  it("조건이 같으면 원문 키워드가 제목에 있는 데이터가 1등이 된다", () => {
    const common = { type: "API" as const, updateCycle: "월 1회", lastUpdated: "2026-06-10" };
    const ranked = scoreAndRank(
      [
        makeDataset({ id: "a", title: "서울시 무더위쉼터 운영 현황", ...common }),
        makeDataset({ id: "b", title: "서울시 그늘막 설치 위치 정보", ...common }),
      ],
      {
        keywords: ["그늘막", "무더위쉼터", "폭염"],
        coreKeywords: ["그늘막"],
        apiOnly: false,
        realtimePreferred: false,
      }
    );

    expect(ranked[0]!.title).toBe("서울시 그늘막 설치 위치 정보");
  });

  it("원문 키워드 제목 매칭만으로 도메인 20점을 확보한다", () => {
    const dataset = makeDataset({ id: "t", title: "서울시 그늘막 설치 위치 정보" });
    const [scored] = scoreAndRank([dataset], {
      keywords: ["그늘막"],
      coreKeywords: ["그늘막"],
      apiOnly: false,
      realtimePreferred: false,
    });

    // 도메인 20 + 형태(UNKNOWN) 3 + 주기(미확인) 3 + 최신성 + 지역 5
    expect(scored!.scoreBreakdown!.relevanceScore).toBeGreaterThanOrEqual(20);
  });

  it("원문 키워드 매칭이 확장 유사어 매칭보다 높은 점수를 받는다", () => {
    const ctx = { keywords: ["그늘막", "폭염"], apiOnly: false, realtimePreferred: false };
    const asCore = scoreAndRank([shadeMap], { ...ctx, coreKeywords: ["그늘막"] })[0]!.score;
    const asExpanded = scoreAndRank([shadeMap], { ...ctx, coreKeywords: [] })[0]!.score;

    expect(asCore).toBeGreaterThan(asExpanded);
  });
});

describe("computeScoreBreakdown", () => {
  it("제공기관 필터가 적용되면 관련도 점수에 반영된다", () => {
    const dataset = makeDataset({ title: "테스트" });
    const ctx = { keywords: [], apiOnly: false, realtimePreferred: false, orgFilterApplied: true };
    const breakdown = computeScoreBreakdown(dataset, 20, ctx);

    expect(breakdown.legacyScore).toBe(20);
    expect(breakdown.relevanceReasons.some((r) => r.includes("제공기관"))).toBe(true);
  });

  it("메타정보가 풍부한 데이터셋이 더 높은 활용도 점수를 받는다", () => {
    const sparse = makeDataset({ title: "빈약한 데이터" });
    const rich = makeDataset({
      title: "풍부한 데이터",
      _raw: {
        infId: "OA-1",
        infNm: "풍부한 데이터",
        cateNm: "공공데이터",
        ditcNm: "서울시(본청)",
        mapCateNm: "교통",
        mngOrganName: "서울시",
        mngStationName: "교통정책과",
        linkDesc: "",
        linkInfo: "",
        managerName: "홍길동",
        managerPhone: "02-000-0000",
        chngLoadNm: "일간",
        dataLtNm: "2026-08-01",
        srvType: "Api",
        shortUrl: "https://data.seoul.go.kr/dataList/OA-1/S/1/datasetView.do",
      },
    });
    const ctx = { keywords: [], apiOnly: false, realtimePreferred: false };

    const sparseBreakdown = computeScoreBreakdown(sparse, 0, ctx);
    const richBreakdown = computeScoreBreakdown(rich, 0, ctx);

    expect(richBreakdown.qualityScore).toBeGreaterThan(sparseBreakdown.qualityScore);
  });
});
