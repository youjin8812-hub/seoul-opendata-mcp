import { describe, it, expect } from "vitest";
import { classifyOrganization } from "../src/classification/organizationType.js";
import type { RawSeoulCatalogItem } from "../src/types/index.js";

function makeRaw(overrides: Partial<RawSeoulCatalogItem>): RawSeoulCatalogItem {
  return {
    infId: "OA-1",
    infNm: "테스트",
    cateNm: "",
    ditcNm: "",
    mapCateNm: "",
    mngOrganName: "테스트기관",
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

describe("classifyOrganization", () => {
  it("실측 DITC_NM 6개 값을 표준 기관유형으로 매핑한다", () => {
    expect(classifyOrganization(makeRaw({ ditcNm: "서울시(본청)" })).type).toBe("headquarters");
    expect(classifyOrganization(makeRaw({ ditcNm: "자치구 및 자치구산하" })).type).toBe("district");
    expect(classifyOrganization(makeRaw({ ditcNm: "서울시(사업소)" })).type).toBe("business_office");
    expect(classifyOrganization(makeRaw({ ditcNm: "서울시(산하기관)" })).type).toBe("invested_funded");
    expect(classifyOrganization(makeRaw({ ditcNm: "공공기관(외부)" })).type).toBe("other");
    expect(classifyOrganization(makeRaw({ ditcNm: "민간(기업)" })).type).toBe("other");
  });

  it("알려진 값은 raw_division 출처와 high 신뢰도를 가진다", () => {
    const result = classifyOrganization(makeRaw({ ditcNm: "서울시(본청)" }));
    expect(result.source).toBe("raw_division");
    expect(result.confidence).toBe("high");
    expect(result.label).toBe("서울시 본청");
  });

  it("불확실한 기관유형은 추측하지 않고 기타로 분류한다", () => {
    const result = classifyOrganization(makeRaw({ ditcNm: "알수없는값" }));
    expect(result.type).toBe("other");
    expect(result.source).toBe("unclassified");
    expect(result.confidence).toBe("low");
  });
});
