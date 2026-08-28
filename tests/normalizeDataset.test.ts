import { describe, it, expect } from "vitest";
import {
  normalizeDataset,
  normalizeDatasets,
  deduplicateByTitle,
  deduplicateDatasets,
} from "../src/parsers/normalizeDataset.js";
import type { RawSeoulCatalogItem } from "../src/types/index.js";

function makeRaw(overrides: Partial<RawSeoulCatalogItem>): RawSeoulCatalogItem {
  return {
    infId: "",
    infNm: "테스트 데이터셋",
    cateNm: "공공데이터",
    ditcNm: "서울시(본청)",
    mapCateNm: "교통",
    mngOrganName: "서울시",
    mngStationName: "",
    linkDesc: "",
    linkInfo: "",
    managerName: "",
    managerPhone: "",
    chngLoadNm: "",
    dataLtNm: "",
    srvType: "Api",
    shortUrl: "",
    ...overrides,
  };
}

describe("normalizeDataset", () => {
  it("brm/organization 분류결과를 함께 계산해 채운다", () => {
    const normalized = normalizeDataset(makeRaw({ mapCateNm: "교통", ditcNm: "자치구 및 자치구산하" }));
    expect(normalized.brm.primary).toBe("교통");
    expect(normalized.organization.type).toBe("district");
  });
});

describe("deduplicateDatasets (서비스 ID 우선)", () => {
  it("같은 서비스 ID를 가진 항목은 제목이 달라도 하나만 남긴다", () => {
    const datasets = normalizeDatasets([
      makeRaw({ infId: "OA-1", infNm: "버스 도착 정보" }),
      makeRaw({ infId: "OA-1", infNm: "버스 도착 정보(중복 검색어로 재수집)" }),
    ]);
    const result = deduplicateDatasets(datasets);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("OA-1");
  });

  it("서비스 ID가 없으면 제목 기준으로 폴백해 중복을 제거한다", () => {
    const datasets = normalizeDatasets([
      makeRaw({ infId: "", infNm: "동일 제목" }),
      makeRaw({ infId: "", infNm: "동일 제목" }),
    ]);
    const result = deduplicateDatasets(datasets);
    expect(result).toHaveLength(1);
  });

  it("서비스 ID가 다르면 제목이 같아도 유지한다", () => {
    const datasets = normalizeDatasets([
      makeRaw({ infId: "OA-1", infNm: "같은 제목" }),
      makeRaw({ infId: "OA-2", infNm: "같은 제목" }),
    ]);
    const result = deduplicateDatasets(datasets);
    expect(result).toHaveLength(2);
  });
});

describe("deduplicateByTitle (기존 동작 유지)", () => {
  it("제목 기준으로 중복을 제거한다", () => {
    const datasets = normalizeDatasets([
      makeRaw({ infId: "OA-1", infNm: "같은 제목" }),
      makeRaw({ infId: "OA-2", infNm: "같은 제목" }),
    ]);
    const result = deduplicateByTitle(datasets);
    expect(result).toHaveLength(1);
  });
});
