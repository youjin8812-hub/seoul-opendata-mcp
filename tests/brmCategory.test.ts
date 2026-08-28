import { describe, it, expect } from "vitest";
import { classifyBrm } from "../src/classification/brmCategory.js";
import type { RawSeoulCatalogItem } from "../src/types/index.js";

function makeRaw(overrides: Partial<RawSeoulCatalogItem>): RawSeoulCatalogItem {
  return {
    infId: "OA-1",
    infNm: "테스트",
    cateNm: "공공데이터",
    ditcNm: "서울시(본청)",
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
    ...overrides,
  };
}

describe("classifyBrm", () => {
  it("공식 MAP_CATE_NM 값을 12개 정책분야 중 하나로 고신뢰 분류한다", () => {
    const categories = [
      "보건", "일반행정", "문화/관광", "산업/경제", "복지", "환경",
      "교통", "도시관리", "교육", "안전", "인구/가구", "주택/건설",
    ];
    for (const cat of categories) {
      const result = classifyBrm(makeRaw({ mapCateNm: cat }));
      expect(result.primary).toBe(cat);
      expect(result.source).toBe("catalog_map_category");
      expect(result.confidence).toBe("high");
      expect(result.code).toBeNull();
    }
  });

  it("표기 변형은 표준 12개 분야로 정규화한다", () => {
    expect(classifyBrm(makeRaw({ mapCateNm: "문화관광" })).primary).toBe("문화/관광");
    expect(classifyBrm(makeRaw({ mapCateNm: "산업경제" })).primary).toBe("산업/경제");
    expect(classifyBrm(makeRaw({ mapCateNm: "인구가구" })).primary).toBe("인구/가구");
    expect(classifyBrm(makeRaw({ mapCateNm: "주택건설" })).primary).toBe("주택/건설");
  });

  it("공식 필드가 없으면 임의로 코드를 생성하지 않고 미분류로 둔다", () => {
    const result = classifyBrm(makeRaw({ mapCateNm: "", cateNm: "" }));
    expect(result.primary).toBeNull();
    expect(result.code).toBeNull();
    expect(result.source).toBe("unclassified");
    expect(result.confidence).toBe("low");
  });

  it("공식 필드가 없어도 다른 텍스트 필드에서 분야명이 확인되면 낮은 신뢰도로 보조 분류한다", () => {
    const result = classifyBrm(makeRaw({ mapCateNm: "", cateNm: "교통 공공데이터" }));
    expect(result.primary).toBe("교통");
    expect(result.source).toBe("keyword_inference");
    expect(result.confidence).toBe("low");
  });
});
