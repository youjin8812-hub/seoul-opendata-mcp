import type { NormalizedDataset, RawSeoulCatalogItem, BrmPrimaryCategory } from "../../src/types/index.js";

export interface DatasetSpec {
  id?: string;
  title: string;
  provider?: string;
  department?: string;
  type?: NormalizedDataset["type"];
  updateCycle?: string;
  lastUpdated?: string;
  /** 정책분야(카탈로그 소분류) — 태그와 brm.primary에 함께 반영된다 */
  field?: BrmPrimaryCategory;
  division?: string;
}

/**
 * 실제 카탈로그 응답에 가까운 데이터셋을 만든다.
 * 점수화는 raw 필드(제공부서·연락처·상세URL 등)까지 보므로,
 * 현실과 동떨어진 빈 껍데기로 시험하면 활용도 점수가 전부 0이 되어
 * 순위 검증이 무의미해진다.
 */
export function makeDataset(spec: DatasetSpec): NormalizedDataset {
  const provider = spec.provider ?? "서울특별시";
  const department = spec.department ?? "데이터정책과";
  const type = spec.type ?? "API";
  const field = spec.field ?? null;

  const raw: RawSeoulCatalogItem = {
    infId: spec.id ?? `OA-${Math.abs(hash(spec.title))}`,
    infNm: spec.title,
    cateNm: "공공데이터",
    ditcNm: spec.division ?? "서울시(본청)",
    mapCateNm: field ?? "",
    mngOrganName: provider,
    mngStationName: department,
    linkDesc: "",
    linkInfo: "",
    managerName: "홍길동",
    managerPhone: "02-000-0000",
    chngLoadNm: spec.updateCycle ?? "일간",
    dataLtNm: spec.lastUpdated ?? "2026-08-01",
    srvType: type === "API" ? "File,Sheet,Api" : type === "FILE" ? "File,Sheet" : "",
    shortUrl: `https://data.seoul.go.kr/dataList/${spec.id ?? "OA-1"}/S/1/datasetView.do`,
  };

  return {
    id: raw.infId,
    title: spec.title,
    provider,
    type,
    description: "",
    updateCycle: raw.chngLoadNm,
    lastUpdated: raw.dataLtNm,
    detailUrl: raw.shortUrl,
    tags: field ? [field] : [],
    division: raw.ditcNm,
    brm: field
      ? { primary: field, secondary: null, code: null, source: "catalog_map_category", confidence: "high" }
      : { primary: null, secondary: null, code: null, source: "unclassified", confidence: "low" },
    organization: {
      type: "headquarters",
      label: "서울시 본청",
      organizationName: provider,
      source: "raw_division",
      confidence: "high",
    },
    _raw: raw,
  };
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}
