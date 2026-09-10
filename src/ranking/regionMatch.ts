/**
 * 지역(자치구) 일치 판정.
 *
 * 이전 지역 점수는 REGION_TERMS에 "시"·"구"·"도" 같은 한 글자를 넣어 두고
 * 제목에 몇 개나 들어 있는지를 셌다. 서울시 데이터는 제목·기관명에 "서울시"가
 * 거의 항상 들어가므로 사실상 전 건이 점수를 받았고, "구인구직"·"시설" 같은
 * 키워드까지 지역 조건으로 오인됐다. 변별력이 0인 배점이었다.
 *
 * 지금은 "질의가 특정 자치구를 지목했을 때, 그 자치구 데이터인가"만 본다.
 * 자치구를 지목하지 않은 질의에서는 이 항목 자체를 적용하지 않는다.
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

/** 질의 키워드에서 지목된 자치구를 찾는다 */
export function detectQueryDistricts(keywords: string[]): string[] {
  const found = new Set<string>();

  for (const raw of keywords) {
    const kw = raw.trim();
    if (!kw) continue;
    for (const district of SEOUL_DISTRICTS) {
      const stem = DISTRICT_STEMS.get(district);
      // 자치구명은 부분 포함까지 인정하고("강남구청"), 줄임말은 완전일치만 인정한다("강남")
      if (kw.includes(district) || (stem !== null && kw === stem)) {
        found.add(district);
      }
    }
  }

  return [...found];
}

/** 데이터셋이 지목된 자치구 중 하나에 속하는지 판정한다 */
export function matchesDistricts(
  dataset: NormalizedDataset,
  districts: string[]
): boolean {
  if (districts.length === 0) return false;

  const text = [
    dataset.title,
    dataset.provider,
    dataset.division,
    dataset._raw?.mngStationName ?? "",
  ].join(" ");

  return districts.some((district) => {
    if (text.includes(district)) return true;
    const stem = DISTRICT_STEMS.get(district);
    return stem !== null && stem !== undefined && text.includes(stem);
  });
}
