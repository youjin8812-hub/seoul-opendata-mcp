import { describe, it, expect, vi } from "vitest";
import { searchSeoulCatalog } from "../src/services/seoulCatalogService.js";

const MOCK_KEY = "test-service-key";

function makeJsonFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

function makeTextFetch(text: string, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  }) as unknown as typeof fetch;
}

function makeSuccessBody(rows: object[], totalCount = rows.length) {
  return {
    SearchCatalogService: {
      list_total_count: totalCount,
      RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" },
      row: rows,
    },
  };
}

describe("searchSeoulCatalog (서울 열린데이터광장 SearchCatalogService)", () => {
  it("정상 응답의 row 배열을 파싱한다", async () => {
    const body = makeSuccessBody(
      [
        {
          INF_ID: "OA-22784",
          INF_NM: "[내국인] 서울 생활인구(250m)",
          CATE_NM: "공공데이터",
          DITC_NM: "서울시(본청)",
          MAP_CATE_NM: "일반행정",
          MNG_ORGAN_NAME: "서울특별시",
          MNG_STATION_NAME: "디지털도시국 데이터전략과",
          LINK_DESC: "빅데이터 서비스 플랫폼",
          LINK_INFO: "빅데이터 서비스 플랫폼",
          MANAGER_NAME: "",
          MANAGER_PHONE: "02-2133-4267",
          CHNG_LOAD_NM: "일간",
          DATA_LT_NM: "2026-08-11",
          SRV_TYPE: "File,Sheet,Api",
          SHORT_URL: "https://data.seoul.go.kr/dataList/OA-22784/S/1/datasetView.do",
        },
      ],
      24
    );

    const result = await searchSeoulCatalog(
      { keyword: "생활인구" },
      MOCK_KEY,
      makeJsonFetch(body)
    );

    expect(result.totalCount).toBe(24);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.infNm).toBe("[내국인] 서울 생활인구(250m)");
    expect(result.items[0]?.srvType).toBe("File,Sheet,Api");
  });

  it("GET 요청 URL에 인증키/시작/종료/키워드가 경로로 포함된다", async () => {
    const mockFetch = makeJsonFetch(makeSuccessBody([]));

    await searchSeoulCatalog({ keyword: "버스", start: 1, end: 5 }, MOCK_KEY, mockFetch);

    const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = callArgs[0] as string;
    const init = callArgs[1] as RequestInit;

    expect(init.method).toBe("GET");
    expect(url).toContain(`/${MOCK_KEY}/json/SearchCatalogService/1/5/`);
    expect(url).toContain(encodeURIComponent("버스"));
  });

  it("end가 1000건 범위를 넘으면 API 제약(최대 1,000건)에 맞춰 잘린다", async () => {
    const mockFetch = makeJsonFetch(makeSuccessBody([]));
    await searchSeoulCatalog({ start: 1, end: 5000 }, MOCK_KEY, mockFetch);

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/SearchCatalogService/1/1000/");
  });

  it("빈 슬롯은 공백(%20)으로 채워진다", async () => {
    const mockFetch = makeJsonFetch(makeSuccessBody([]));
    await searchSeoulCatalog({ start: 1, end: 3 }, MOCK_KEY, mockFetch);

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/1/3/%20/%20/%20/");
  });

  it("INFO-200(결과 없음)은 빈 배열을 반환한다 (오류 아님)", async () => {
    const result = await searchSeoulCatalog(
      { keyword: "없는데이터" },
      MOCK_KEY,
      makeJsonFetch({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } })
    );
    expect(result.items).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("인증키 오류(INFO-100, json 요청에도 XML로 응답)를 파싱해 에러를 throw한다", async () => {
    const xml =
      "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>";
    await expect(
      searchSeoulCatalog({ keyword: "축제" }, MOCK_KEY, makeTextFetch(xml))
    ).rejects.toThrow("인증키");
  });

  it("네트워크 장애 시 에러를 throw한다", async () => {
    const brokenFetch = vi
      .fn()
      .mockRejectedValue(new Error("network failure")) as unknown as typeof fetch;
    await expect(
      searchSeoulCatalog({ keyword: "축제" }, MOCK_KEY, brokenFetch)
    ).rejects.toThrow("네트워크 오류");
  });
});
