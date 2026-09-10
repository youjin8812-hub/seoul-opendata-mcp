/**
 * 지역 적합도 — "질의가 지목한 공간 범위"와 "데이터가 담고 있는 공간 범위"의 일치.
 *
 * 서울 열린데이터광장은 자치구 데이터가 2,134건(전체의 26%)이고, 25개 자치구가
 * 같은 주제를 각자 등재한다. 그래서 공간 범위는 이 카탈로그에서 늘 따져야 하는 축이다.
 *
 *   - 자치구를 지목한 질의("강남구 주차장")
 *       강남구 데이터 > 서울시 전체 데이터(강남구를 포함하므로) > 다른 자치구 데이터
 *   - 자치구를 지목하지 않은 질의("주차장")
 *       서울시 전체 데이터 > 특정 자치구 데이터(한 구만 담고 있으므로)
 *
 * 이전 구현은 REGION_TERMS에 "시"·"구"·"도" 같은 한 글자를 넣고 제목에 몇 개나
 * 들어 있는지를 셌다. 서울시 데이터는 제목·기관명에 "서울시"가 거의 항상 들어가므로
 * 사실상 전 건이 점수를 받았고, "구인구직"·"시설" 같은 키워드까지 지역 조건으로
 * 오인됐다. 변별력이 0인 배점이었다.
 */

import type { NormalizedDataset } from "../types/index.js";

/** 서울특별시 25개 자치구 */
export const SEOUL_DISTRICTS = [
  "종로구", "중구", "용산구", "성동구", "광진구",
  "동대문구", "중랑구", "성북구", "강북구", "도봉구",
  "노원구", "은평구", "서대문구", "마포구", "양천구",
  "강서구", "구로구", "금천구", "영등포구", "동작구",
  "관악구", "서초구", "강남구", "송파구", "강동구",
] as const;

/** "강남구"의 "강남"처럼 '구'를 뗀 형태 — 2글자 미만("중구"→"중")은 오탐이 커서 제외한다 */
const DISTRICT_STEMS = new Map<string, string | null>(
  SEOUL_DISTRICTS.map((d) => {
    const stem = d.slice(0, -1);
    return [d, stem.length >= 2 ? stem : null];
  })
);

/** 데이터가 담고 있는 공간 범위 */
export type DatasetScope =
  /** 서울시 전체 — 본청·사업소·산하기관 */
  | "citywide"
  /** 특정 자치구 */
  | "district";

/** 키워드 하나가 지목하는 자치구 (없으면 null) */
function districtOf(keyword: string): string | null {
  const kw = keyword.trim();
  if (!kw) return null;
  for (const district of SEOUL_DISTRICTS) {
    const stem = DISTRICT_STEMS.get(district);
    // 자치구명은 부분 포함까지 인정하고("강남구청"), 줄임말은 완전일치만 인정한다("강남")
    if (kw.includes(district) || (stem !== null && kw === stem)) return district;
  }
  return null;
}

/** 질의 키워드에서 지목된 자치구를 찾는다 (가나다순 — 입력 순서에 좌우되지 않는다) */
export function detectQueryDistricts(keywords: string[]): string[] {
  const found = new Set<string>();
  for (const keyword of keywords) {
    const district = districtOf(keyword);
    if (district) found.add(district);
  }
  return [...found].sort();
}

/**
 * 자치구를 지목하는 키워드를 걸러낸다.
 *
 * "강남구 주차장"에서 '강남구'는 주제가 아니라 공간 조건이다. 키워드로도 두면
 * 제목 매칭과 지역 배점이 같은 근거를 이중으로 세고, "강남구 주차장"·"주차장 강남구"·
 * "강남의 주차장"이 서로 다른 키워드 집합이 되어 결과가 흔들린다.
 * 주제(키워드)와 장소(지역)를 갈라 놓으면 표현이 달라져도 같은 질의로 수렴한다.
 */
export function stripDistrictKeywords(keywords: string[]): string[] {
  return keywords.filter((kw) => districtOf(kw) === null);
}

/**
 * 데이터셋이 담고 있는 공간 범위를 판정한다.
 * 공식 구분값(DITC_NM 기반 분류)을 우선 보되, 본청이 자치구별로 등재한 데이터도
 * 있으므로 제목·제공기관에 자치구명이 있으면 자치구 범위로 본다.
 */
export function scopeOf(dataset: NormalizedDataset): DatasetScope {
  if (dataset.organization?.type === "district") return "district";
  return districtOfDataset(dataset) !== null ? "district" : "citywide";
}

/** 데이터셋이 속한 자치구 (자치구 데이터가 아니면 null) */
export function districtOfDataset(dataset: NormalizedDataset): string | null {
  const text = [
    dataset.provider,
    dataset._raw?.mngStationName ?? "",
    dataset.title,
  ].join(" ");

  for (const district of SEOUL_DISTRICTS) {
    if (text.includes(district)) return district;
  }
  // 자치구 구분이지만 이름을 못 찾은 경우 — 줄임말까지 확인한다
  for (const district of SEOUL_DISTRICTS) {
    const stem = DISTRICT_STEMS.get(district);
    if (stem !== null && stem !== undefined && text.includes(stem)) return district;
  }
  return null;
}

/**
 * 지역 적합도 (0~1).
 * @param queryDistricts 질의가 지목한 자치구 (없으면 빈 배열)
 */
export function regionFit(
  dataset: NormalizedDataset,
  queryDistricts: string[]
): { fit: number; label: string } {
  const datasetDistrict = districtOfDataset(dataset);
  const isDistrictData = scopeOf(dataset) === "district";

  if (queryDistricts.length === 0) {
    // 자치구를 지목하지 않았다면 서울시 전체를 포괄하는 데이터가 더 쓸모 있다
    return isDistrictData
      ? { fit: 0.5, label: `${datasetDistrict ?? "자치구"} 한 곳만 포함` }
      : { fit: 1, label: "서울시 전체 범위" };
  }

  if (datasetDistrict !== null && queryDistricts.includes(datasetDistrict)) {
    return { fit: 1, label: `지목한 자치구(${datasetDistrict}) 데이터` };
  }
  if (!isDistrictData) {
    // 서울시 전체 데이터에는 지목한 자치구도 들어 있다
    return { fit: 0.5, label: `서울시 전체 범위 — ${queryDistricts.join("·")} 포함` };
  }
  return { fit: 0, label: `다른 자치구(${datasetDistrict ?? "미상"}) 데이터` };
}

/**
 * 자치구 근사중복 판정을 위한 제목 정규화.
 * "강남구 공영주차장 현황"·"노원구 공영주차장 현황" → "공영주차장현황"
 */
export function districtNeutralTitle(dataset: NormalizedDataset): string {
  let title = dataset.title;
  for (const district of SEOUL_DISTRICTS) {
    title = title.split(district).join(" ");
    const stem = DISTRICT_STEMS.get(district);
    if (stem) title = title.split(stem).join(" ");
  }
  return title
    .replace(/서울특별시|서울시|서울/g, " ")
    .replace(/\d{4}년?/g, " ")
    .replace(/[^가-힣\w]/g, "")
    .toLowerCase();
}
