/**
 * 질의에서 정책분야(BRM 1차 분류)를 추론한다.
 *
 * 카탈로그의 소분류(MAP_CATE_NM)는 전 건이 12개 정책분야와 1:1로 맞아떨어지는
 * 공식 값이다(classification/brmCategory.ts). 질의도 같은 12개 분야로 옮길 수 있으면,
 * 제목 글자만 겹치고 주제는 다른 데이터를 걸러내는 강한 축이 하나 더 생긴다.
 * 예: "주차장" 질의에서 '교통' 분야 데이터와 '일반행정' 분야의 주차위반 과태료
 * 부과 내역을 구분한다.
 *
 * 오추론이 정답 데이터를 깎아내리지 않도록 보수적으로 판정한다.
 *   - 사용자가 분야명을 그대로 말한 경우(예: "교통 데이터")는 무조건 채택
 *   - 그 외에는 해당 분야 단서가 2개 이상 잡힐 때만 채택
 *   - 채택된 분야가 없으면 이 항목은 아예 배점에서 빠진다 (감점 요인이 되지 않는다)
 */

import type { BrmPrimaryCategory } from "../types/index.js";

/** 정책분야별 단서 어휘 — 카탈로그 서비스명에 실제로 자주 쓰이는 말로 구성했다 */
const POLICY_FIELD_TERMS: Record<BrmPrimaryCategory, string[]> = {
  교통: [
    "교통", "버스", "지하철", "도로", "주차", "주차장", "따릉이", "자전거",
    "택시", "보행", "횡단보도", "노선", "정류장", "통행", "철도", "교차로",
    "대중교통", "운행", "환승", "주차난",
  ],
  환경: [
    "환경", "대기", "미세먼지", "공기질", "수질", "기후", "폭염", "열섬",
    "녹지", "공원", "가로수", "재활용", "폐기물", "소음", "온실가스", "기온",
    "날씨", "기상", "하천", "탄소", "그늘",
  ],
  안전: [
    "안전", "재난", "소방", "화재", "범죄", "치안", "cctv", "방범", "응급",
    "구조", "그늘막", "무더위쉼터", "한파쉼터", "침수", "지진", "사고",
    "위험", "구급", "보안",
  ],
  보건: [
    "보건", "의료", "병원", "진료", "의약품", "약국", "감염병", "코로나",
    "건강", "백신", "정신건강", "위생", "방역",
  ],
  복지: [
    "복지", "돌봄", "어르신", "노인", "장애인", "아동", "보육", "어린이집",
    "기초생활", "급여", "지원금", "경로당", "쉼터", "자활", "봉사",
  ],
  "문화/관광": [
    "문화", "관광", "축제", "행사", "공연", "전시", "박물관", "미술관",
    "도서관", "체육", "여행", "명소", "관광지", "한강공원", "축제행사",
  ],
  "산업/경제": [
    "산업", "경제", "상권", "소상공인", "창업", "스타트업", "기업", "일자리",
    "취업", "고용", "시장", "물가", "매출", "금융", "투자", "전통시장",
  ],
  도시관리: [
    "도시", "도시계획", "시설물", "상수도", "하수도", "가로등", "정비",
    "재개발", "지적", "측량", "공간정보", "지도", "토지", "구역",
  ],
  교육: ["교육", "학교", "학생", "학원", "유치원", "평생교육", "진로", "도서"],
  "인구/가구": [
    "인구", "가구", "세대", "생활인구", "유동인구", "체류인구", "출생",
    "사망", "혼인", "전입", "전출", "고령화",
  ],
  "주택/건설": [
    "주택", "아파트", "전세", "월세", "부동산", "건축", "건설", "임대",
    "재건축", "공동주택", "분양", "주거",
  ],
  일반행정: [
    "행정", "민원", "예산", "재정", "조례", "공무원", "선거", "청사",
    "결산", "감사", "위원회",
  ],
};

const ALL_FIELDS = Object.keys(POLICY_FIELD_TERMS) as BrmPrimaryCategory[];

/** 분야 하나를 채택하는 데 필요한 최소 단서 수 (분야명 직접 언급은 예외) */
const MIN_HITS = 2;

/** 동시에 채택할 수 있는 분야 수 상한 — 너무 넓게 잡으면 변별력이 사라진다 */
const MAX_FIELDS = 2;

/**
 * 질의 키워드에서 정책분야를 추론한다.
 * @param keywords 원문 + 확장 유사어
 * @param coreKeywords 사용자 입력에 실제로 등장한 키워드
 */
export function inferQueryPolicyFields(
  keywords: string[],
  coreKeywords?: string[]
): BrmPrimaryCategory[] {
  const normalized = keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return [];

  const core = new Set(
    (coreKeywords ?? keywords).map((k) => k.trim().toLowerCase()).filter(Boolean)
  );

  const hits = new Map<BrmPrimaryCategory, number>();
  const explicit = new Set<BrmPrimaryCategory>();

  for (const field of ALL_FIELDS) {
    // 사용자가 분야명을 그대로 말한 경우 — 가장 확실한 근거
    const fieldNames = [field.toLowerCase(), ...field.toLowerCase().split("/")];
    if (fieldNames.some((name) => core.has(name))) explicit.add(field);

    let count = 0;
    for (const term of POLICY_FIELD_TERMS[field]) {
      if (normalized.some((kw) => kw === term || kw.includes(term))) count++;
    }
    if (count > 0) hits.set(field, count);
  }

  const qualified = [...hits.entries()]
    .filter(([field, count]) => explicit.has(field) || count >= MIN_HITS)
    .sort((a, b) => b[1] - a[1]);

  // 단서가 많은 순으로 최대 2개까지 채택한다.
  // 단서 수가 적다고 잘라내지 않는 이유: "그늘막"은 안전(그늘막·무더위쉼터)이자
  // 환경(폭염·가로수·녹지)이다. 유사어를 늘렸다는 이유만으로 한쪽 분야가 탈락하면,
  // 정작 그 분야로 등록된 정답 데이터가 감점된다.
  return qualified.slice(0, MAX_FIELDS).map(([field]) => field);
}
