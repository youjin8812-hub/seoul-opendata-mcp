/**
 * 자연어 아이디어 텍스트에서 검색에 유용한 핵심 키워드를 추출한다.
 * LLM 호출 없이 규칙 기반으로 동작하여 토큰을 절약한다.
 */

/** 한국어 불용어 목록 */
const STOP_WORDS = new Set([
  "을", "를", "이", "가", "은", "는", "의", "에", "에서", "으로", "로",
  "와", "과", "도", "만", "부터", "까지", "하고", "이고", "거나", "하는",
  "있는", "없는", "만들고", "만들기", "만들어", "하기", "되는", "되어",
  "싶어", "싶다", "싶은", "주는", "주기", "주고", "해서", "해주는",
  "서비스", "앱", "애플리케이션", "시스템", "플랫폼", "사이트", "웹",
  "개발", "구현", "제작", "위한", "관련", "이용", "활용", "사용", "데이터",
  "한국", "대한민국", "전국", "맞는", "맞춤", "맞게", "찾아줘", "찾기",
  "알려줘", "보여줘", "추천", "좋은", "좋은데", "정도", "수준", "것",
  "거", "때", "후", "전", "중", "내", "외", "안", "밖", "위", "아래",
  "아이디어", "기획", "과제", "사업", "분석기획", "제안",
]);

/**
 * "만들게", "추천해줘"처럼 요청 문장에만 등장하는 동사류 토큰.
 * 어간 접두사로 판정해 활용형 전체를 한 번에 걸러낸다.
 * (STOP_WORDS는 완전일치라 "만들게"·"추천해줘" 같은 변형을 잡지 못했다)
 */
const REQUEST_VERB_PREFIXES = [
  "만들", "만드", "추천", "알려", "찾아", "보여", "뽑아", "골라", "구해",
  "해줘", "해주", "주세요", "부탁", "필요", "싶어", "싶다", "하고싶",
];

function isRequestVerb(token: string): boolean {
  return REQUEST_VERB_PREFIXES.some((p) => token.startsWith(p));
}

/** 도메인 키워드 사전 — 입력 텍스트에 포함되면 관련 검색어를 추가한다 */
const DOMAIN_EXPANSIONS: Record<string, string[]> = {
  // 문화/관광
  축제: ["행사", "문화행사", "지역행사"],
  행사: ["축제", "이벤트", "문화행사"],
  관광: ["여행", "관광지", "관광명소"],
  여행: ["관광", "관광지"],
  // 교통
  버스: ["대중교통", "교통", "노선"],
  지하철: ["대중교통", "교통", "노선"],
  교통: ["버스", "지하철", "도로"],
  주차: ["주차장", "주차정보"],
  // 의료/보건
  병원: ["의료기관", "의료", "진료", "보건"],
  의료: ["병원", "의료기관", "진료"],
  심평원: ["건강보험", "진료비", "의료기관", "의약품"],
  건강보험: ["진료비", "보험급여", "의료기관"],
  진료: ["의료기관", "병원", "진료비"],
  약: ["의약품", "약품", "처방"],
  의약품: ["약", "처방", "약품"],
  감염병: ["코로나", "보건", "역학"],
  코로나: ["감염병", "보건", "백신"],
  // 환경
  날씨: ["기상", "기후", "날씨예보"],
  기상: ["날씨", "기후"],
  환경: ["대기", "수질", "오염"],
  대기: ["환경", "미세먼지", "공기"],
  미세먼지: ["대기", "환경", "공기질"],
  // 부동산/주거
  부동산: ["아파트", "주택", "토지", "매매"],
  아파트: ["부동산", "주택", "매매"],
  // 교육
  학교: ["교육", "학교정보"],
  교육: ["학교", "학원"],
  // 식품
  음식: ["식당", "음식점", "요식업"],
  식당: ["음식점", "요식업", "음식"],
  // 복지/고용
  취업: ["일자리", "고용", "구인"],
  일자리: ["취업", "고용", "구인구직"],
  복지: ["사회복지", "지원서비스", "복지서비스"],
  // 통계
  인구: ["인구통계", "통계"],
  통계: ["인구", "조사"],
  KOSIS: ["통계", "국가통계", "통계청"],
  // 안전
  범죄: ["치안", "경찰", "안전"],
  소방: ["화재", "안전", "재난"],
  재난: ["소방", "안전", "재해"],
  // 조달/공공구매
  나라장터: ["조달", "입찰", "계약", "공공구매"],
  조달: ["나라장터", "입찰", "계약"],
  입찰: ["조달", "나라장터", "계약"],
  // 창업/기업지원
  창업: ["스타트업", "벤처", "중소기업"],
  스타트업: ["창업", "벤처"],
  중소기업: ["창업", "스타트업", "소상공인"],
  // 연구개발
  연구: ["R&D", "과제", "기술"],
  // 금융
  금융: ["은행", "보험", "주식", "투자"],
  부동산등기: ["등기", "부동산", "소유권"],
  // 농업
  농업: ["농산물", "농지", "작물"],
  농산물: ["농업", "식품"],
  // 서울시 특화
  따릉이: ["공유자전거", "자전거", "대여소"],
  공유자전거: ["따릉이", "자전거"],
  한강: ["한강공원", "수질", "공원"],
  공원: ["녹지", "공원시설"],
  도서관: ["작은도서관", "공공도서관"],
  주차장: ["주차", "공영주차장"],
  cctv: ["방범", "안전"],
  반려동물: ["동물병원", "유기동물"],
  무더위쉼터: ["폭염", "복지시설", "쉼터", "그늘막", "한파쉼터"],
  폭염: ["무더위쉼터", "한파", "그늘막", "그늘", "온열질환", "기온", "폭염저감시설"],
  // 도시 열환경 / 그늘 — "그늘맵" 같은 신조어는 부분매칭으로 "그늘"에 연결된다
  그늘: ["그늘막", "무더위쉼터", "폭염", "가로수", "녹지", "그늘목"],
  그늘막: ["그늘", "파라솔", "폭염", "무더위쉼터", "횡단보도"],
  쉼터: ["무더위쉼터", "휴게시설", "그늘막"],
  가로수: ["녹지", "수목", "가로수길", "그늘"],
  녹지: ["공원", "가로수", "수목", "녹지대"],
  열섬: ["폭염", "기온", "도시열섬", "열환경"],
  기온: ["날씨", "기상", "폭염", "온도"],
  // 지도/공간 — 위치 기반 앱 아이디어에서 자주 쓰인다
  지도: ["위치", "좌표", "공간정보", "지리정보"],
  위치: ["좌표", "지도", "위치정보"],
  경로: ["보행", "이동", "노선", "동선"],
  보행: ["보행자", "보도", "횡단보도", "경로"],
  상권: ["소상공인", "골목상권", "상가"],
  청년: ["청년정책", "청년지원"],
  생활인구: ["체류인구", "유동인구"],
  유동인구: ["생활인구", "체류인구"],
  격자: ["250m"],
};

/** 실시간성 관련 키워드 */
const REALTIME_KEYWORDS = new Set([
  "실시간", "현재", "즉시", "바로", "라이브", "live", "현황",
]);

/** 단어 끝에 붙는 한국어 조사/어미를 제거 */
const ENDINGS = [
  "으로부터", "에서부터", "로부터", "으로서", "에서는", "로서는",
  "에서도", "에서는", "에게서", "에게는", "에게도", "에게",
  "으로는", "으로도", "으로만", "로서는",
  "이라는", "이라고", "이라도",
  "에서", "으로", "로", "에도", "에는", "부터", "까지",
  "하고", "이고", "이랑",
  "에서", "에는", "에도",
  "을", "를", "은", "는", "의", "와", "과", "도",
];

function stripEndings(token: string): string {
  let result = token;
  for (const ending of ENDINGS) {
    if (result.endsWith(ending) && result.length > ending.length) {
      result = result.slice(0, result.length - ending.length);
      break;
    }
  }
  // "-하다" 동사 어간 잔재 정리 (예: "분석하는"→조사 제거 후 "분석하"→"분석")
  if (result.endsWith("하") && result.length > 2) {
    result = result.slice(0, -1);
  }
  return result;
}

/** 텍스트를 공백/특수문자 기준으로 토큰화 */
function tokenize(text: string): string[] {
  return text
    .replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => stripEndings(t.trim()))
    .filter((t) => t.length >= 2);
}

export interface ExtractedKeywords {
  /** 원문 키워드 + 확장 유사어 (원문이 앞에 온다) */
  keywords: string[];
  /** 사용자 입력에 실제로 등장한 키워드 — 점수화에서 확장 유사어보다 높은 가중을 받는다 */
  coreKeywords: string[];
  /** 사전에서 파생된 유사어 */
  expandedKeywords: string[];
  isRealtimeHinted: boolean;
}

/** 반환 키워드 총 상한 — 확장 유사어를 넉넉히 담기 위한 값 */
export const MAX_KEYWORDS = 14;

/**
 * 사전 표제어를 부분 문자열로 포함하는 합성어/신조어를 표제어에 연결한다.
 * 예: "그늘맵" → "그늘"(표제어) + 그늘의 유사어들.
 * 카탈로그 검색은 서비스명 부분일치라, 표제어 자체가 원문보다 훨씬 잘 걸린다.
 */
function matchDictionaryKeys(token: string): string[] {
  if (DOMAIN_EXPANSIONS[token]) return [token];
  const hits: string[] = [];
  for (const key of Object.keys(DOMAIN_EXPANSIONS)) {
    if (key.length >= 2 && token.includes(key) && token !== key) {
      hits.push(key);
    }
  }
  return hits;
}

/**
 * 아이디어 텍스트에서 핵심 키워드를 추출한다.
 * @param ideaText 사용자 자연어 입력
 * @param domainHint 사용자가 명시한 도메인 힌트 (선택)
 */
export function extractKeywords(
  ideaText: string,
  domainHint?: string
): ExtractedKeywords {
  const tokens = tokenize(ideaText);

  // 불용어 + 요청 동사류("만들게", "추천해줘") 제거
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t) && !isRequestVerb(t));

  // 실시간 힌트 감지
  const isRealtimeHinted = tokens.some((t) => REALTIME_KEYWORDS.has(t));

  const core = new Set<string>(filtered);
  const expanded = new Set<string>();

  /** 토큰 하나를 사전 표제어에 연결하고 유사어를 확장한다 */
  const expandToken = (token: string, limit = Infinity) => {
    for (const key of matchDictionaryKeys(token)) {
      // 표제어 자체도 검색어로 쓸모가 있다 ("그늘맵"→"그늘")
      if (!core.has(key)) expanded.add(key);
      const expansions = DOMAIN_EXPANSIONS[key] ?? [];
      for (const e of expansions.slice(0, limit)) {
        if (!core.has(e)) expanded.add(e);
      }
    }
  };

  for (const token of filtered) expandToken(token);

  // 도메인 힌트 추가
  if (domainHint) {
    const hintTokens = tokenize(domainHint).filter(
      (t) => !STOP_WORDS.has(t) && !isRequestVerb(t)
    );
    hintTokens.forEach((t) => {
      core.add(t);
      expandToken(t, 2);
    });
  }

  // 원문 키워드를 앞에 배치해 검색 쿼리 우선순위를 확보한다
  const coreKeywords = [...core].slice(0, MAX_KEYWORDS);
  const expandedKeywords = [...expanded]
    .filter((e) => !coreKeywords.includes(e))
    .slice(0, Math.max(0, MAX_KEYWORDS - coreKeywords.length));

  return {
    keywords: [...coreKeywords, ...expandedKeywords],
    coreKeywords,
    expandedKeywords,
    isRealtimeHinted,
  };
}
