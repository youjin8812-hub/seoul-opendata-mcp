import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/services/seoulCatalogService.js", () => ({
  getServiceKey: () => "test-key",
  searchSeoulCatalog: vi.fn(),
}));

import { searchSeoulCatalog } from "../src/services/seoulCatalogService.js";
import { listSeoulRecentUpdates } from "../src/tools/listSeoulRecentUpdates.js";

function makeRow(overrides: Partial<Record<string, string>> = {}) {
  return {
    infId: "OA-1",
    infNm: "테스트 데이터셋",
    cateNm: "공공데이터",
    ditcNm: "서울시(본청)",
    mapCateNm: "교통",
    mngOrganName: "서울특별시",
    mngStationName: "",
    linkDesc: "",
    linkInfo: "",
    managerName: "",
    managerPhone: "",
    chngLoadNm: "일간",
    dataLtNm: "2026-01-01",
    srvType: "File,Api",
    shortUrl: "https://data.seoul.go.kr/dataList/OA-1/S/1/datasetView.do",
    ...overrides,
  };
}

describe("listSeoulRecentUpdates", () => {
  beforeEach(() => {
    vi.mocked(searchSeoulCatalog).mockReset();
  });

  it("최종갱신일 내림차순으로 정렬한다", async () => {
    vi.mocked(searchSeoulCatalog).mockResolvedValue({
      items: [
        makeRow({ infId: "OA-1", infNm: "오래된 데이터", dataLtNm: "2024-01-01" }),
        makeRow({ infId: "OA-2", infNm: "최신 데이터", dataLtNm: "2026-08-12" }),
        makeRow({ infId: "OA-3", infNm: "중간 데이터", dataLtNm: "2025-06-01" }),
      ],
      totalCount: 3,
    });

    const result = await listSeoulRecentUpdates({});
    expect(result.items.map((i) => i.title)).toEqual([
      "최신 데이터",
      "중간 데이터",
      "오래된 데이터",
    ]);
  });

  it("division 필터를 적용한다", async () => {
    vi.mocked(searchSeoulCatalog).mockResolvedValue({
      items: [
        makeRow({ infId: "OA-1", infNm: "본청 데이터", ditcNm: "서울시(본청)" }),
        makeRow({ infId: "OA-2", infNm: "자치구 데이터", ditcNm: "자치구 및 자치구산하" }),
      ],
      totalCount: 2,
    });

    const result = await listSeoulRecentUpdates({ division: "자치구" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("자치구 데이터");
  });

  it("apiOnly=true이면 SRV_TYPE에 Api가 없는 항목을 제외한다", async () => {
    vi.mocked(searchSeoulCatalog).mockResolvedValue({
      items: [
        makeRow({ infId: "OA-1", infNm: "파일만", srvType: "File" }),
        makeRow({ infId: "OA-2", infNm: "API 있음", srvType: "File,Api" }),
      ],
      totalCount: 2,
    });

    const result = await listSeoulRecentUpdates({ apiOnly: true });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("API 있음");
  });

  it("최종갱신일이 없는 항목은 제외한다", async () => {
    vi.mocked(searchSeoulCatalog).mockResolvedValue({
      items: [
        makeRow({ infId: "OA-1", infNm: "날짜없음", dataLtNm: "" }),
        makeRow({ infId: "OA-2", infNm: "날짜있음", dataLtNm: "2026-01-01" }),
      ],
      totalCount: 2,
    });

    const result = await listSeoulRecentUpdates({ keyword: "날짜필터테스트" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("날짜있음");
  });
});
