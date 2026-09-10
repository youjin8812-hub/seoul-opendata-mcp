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
  // 질문 말투에만 등장하는 말. 남겨 두면 같은 뜻을 다르게 물었을 때
  // 검색 키워드 자체가 달라져 결과가 흔들린다.
  "있는지", "되는지", "인지", "건지", "것들", "좀", "혹시",
  "그리고", "또는", "등등", "같은", "관한", "대한", "대해",
  "데이터셋", "목록", "리스트", "자료", "현행",
  // 장소를 가리키지만 주제가 아닌 말 — 공간 조건은 지역 배점이 따로 다룬다
  "지역", "일대", "인근", "주변", "근처", "쪽",
  // "보고 싶어"의 '보고' — 합성어("업무보고")는 다른 토큰이라 그대로 살아남는다
  "보고", "보려", "쓰려", "쓸",
]);

/**
 * "만들게", "추천해줘"처럼 요청 문장에만 등장하는 동사류 토큰.
 * 어간 접두사로 판정해 활용형 전체를 한 번에 걸러낸다.
 * (STOP_WORDS는 완전일치라 "만들게"·"추천해줘" 같은 변형을 잡지 못했다)
 */
const REQUEST_VERB_PREFIXES = [
  "만들", "만드", "추천", "알려", "찾아", "보여", "뽑아", "골라", "구해",
  "해줘", "해주", "주세요", "부탁", "필요", "싶어", "싶다", "하고싶",
  // 질문형 어미 — "있을까", "없나", "가능한가" 같은 변형까지 한 번에 걸러낸다
  "있을", "있나", "없나", "될까", "가능", "궁금", "쓸만", "쓸 수",
];

/**
 * 의문사 — 활용형이 많아 완전일치로는 못 잡는다.
 * "어떤지"·"어떤가"·"어디에"·"얼마나"를 접두 판정 하나로 전부 걸러낸다.
 */
const QUESTION_WORD_PREFIXES = [
  "어디", "어떤", "어떻", "어느", "언제", "누가", "누구",
  "무엇", "무슨", "뭐", "뭔", "얼마", "몇", "왜",
];

/** 주제어가 아닌 토큰 — 요청 동사류이거나 의문사 */
function isNonTopicToken(token: string): boolean {
  return (
    REQUEST_VERB_PREFIXES.some((p) => token.startsWith(p)) ||
    QUESTION_WORD_PREFIXES.some((p) => token.startsWith(p))
  );
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

/**
 * 실시간성을 요구하는 말.
 *
 * "현황"은 일부러 뺐다. 서울 열린데이터광장은 서비스명 상당수가 "○○ 현황"이고
 * 사용자도 "무더위쉼터 현황"처럼 그냥 '자료'라는 뜻으로 쓴다. 이걸 실시간 요구로
 * 읽으면 "따릉이 대여소 현황"과 "따릉이 대여소 관련 데이터"가 서로 다른 질의가 되어,
 * 같은 뜻인데 다른 추천이 나온다. 같은 이유로 "최근"·"요즘"도 뺐다 — 그건 최신성이지
 * 실시간이 아니다.
 */
const REALTIME_KEYWORDS = new Set([
  "실시간", "현재", "즉시", "바로", "라이브", "live",
  // 같은 요구를 다르게 말한 표현들 — "지금 몇 대 있는지"도 실시간 요구다
  "지금", "오늘", "당장", "수시로",
]);

/**
 * 카탈로그 전반에 흔히 등장해 변별력이 없는 범용 명사 — 키워드에서 아예 뺀다.
 *
 * 두 가지 이유다.
 *   1) 변별력이 없다. "현황"·"정보"는 서울 열린데이터광장 서비스명 명명 관행상
 *      거의 모든 데이터에 붙어 있어서, 검색어로도 점수 근거로도 쓸모가 없다.
 *   2) 표현마다 붙었다 떨어졌다 한다. "따릉이 대여소 현황"과 "따릉이 대여소 관련 데이터"는
 *      같은 질의인데, 이 말들을 키워드에 남기면 두 질의의 후보군과 IDF 가중이 갈라져
 *      같은 뜻인데 다른 답이 나온다.
 *
 * 실시간 계열은 여기서 빠지더라도 isRealtimeHinted로 따로 전달되므로 의미가 사라지지 않는다.
 */
const GENERIC_CORE_TERMS = new Set([
  ...REALTIME_KEYWORDS,
  "현황", "위치", "정보", "상태", "자료", "현행", "최근", "요즘", "내역", "실태",
]);

/**
 * 사전이 아는 말 — 모호한 조사를 뗄지 판단하는 기준이 된다.
 */
const KNOWN_TERMS = new Set<string>([
  ...STOP_WORDS,
  ...GENERIC_CORE_TERMS,
  ...Object.keys(DOMAIN_EXPANSIONS),
]);

/** 한글 음절에 받침이 있는지 — 주격조사 '이/가'를 가리는 데 쓴다 */
function hasFinalConsonant(syllable: string): boolean {
  const code = syllable.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

/**
 * 주격조사 '이'·'가'를 뗀다. 둘 다 낱말의 일부이기도 해서 그냥 자르면 안 된다
 * ("따릉이" → "따릉", "물가" → "물").
 *
 * 두 가지 근거를 쓴다.
 *   '가' — 받침 없는 음절 뒤에만 조사로 붙는다. "대여소가"의 '소'는 받침이 없으니
 *          조사가 맞고, "물가"의 '물'은 받침이 있으니 조사가 아니다.
 *   '이' — 받침 있는 음절 뒤에 붙으므로 음운 규칙만으로는 "따릉이"와 "현황이"를
 *          가릴 수 없다. 그래서 떼고 남은 말이 사전에 있는 말일 때만 뗀다.
 */
function stripAmbiguousEnding(token: string): string {
  const stem = token.slice(0, -1);
  if (stem.length < 2) return token;
  const lastOfStem = stem[stem.length - 1] ?? "";

  if (token.endsWith("가") && !hasFinalConsonant(lastOfStem)) return stem;
  if (token.endsWith("이") && hasFinalConsonant(lastOfStem) && KNOWN_TERMS.has(stem)) {
    return stem;
  }
  return token;
}

/** 단어 끝에 붙는 한국어 조사/어미를 제거 */
const ENDINGS = [
  "으로부터", "에서부터", "로부터", "으로서", "에서는", "로서는",
  "에서도", "에서는", "에게서", "에게는", "에게도", "에게",
  "으로는", "으로도", "으로만", "로서는",
  "이라는", "이라고", "이라도",
  // 보조사 — "몇 개나", "축제나 행사"처럼 붙는다. 떼고 나면 "개"는 한 글자라 자동으로 걸러지고
  // "축제나"는 "축제"로 정리된다
  "이나", "라도", "든지",
  "에서", "으로", "로", "에도", "에는", "부터", "까지",
  "하고", "이고", "이랑",
  "에서", "에는", "에도",
  "을", "를", "은", "는", "의", "와", "과", "도", "나", "씩",
];

/**
 * 조사가 아닌 접미사 — "대여소별 현황"과 "대여소 현황"은 같은 질의여야 한다.
 *
 * 다만 짧은 말에는 적용하지 않는다. "성별"에서 '별'을 떼면 '성'만 남아 뜻이 사라지고,
 * "구별"·"월별"도 마찬가지다. 원본 4글자 이상이면서 떼고도 2글자 이상 남을 때만 자른다.
 */
const TRAILING_SUFFIXES = ["별", "들", "당"];
const MIN_LENGTH_FOR_SUFFIX_STRIP = 4;

function stripSuffix(token: string): string {
  if (token.length < MIN_LENGTH_FOR_SUFFIX_STRIP) return token;
  for (const suffix of TRAILING_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 2) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

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
    .map((t) => stripSuffix(stripAmbiguousEnding(stripEndings(t.trim()))))
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
 * 키워드를 정규 순서로 정렬한다 — 질의 표현이 달라도 같은 결과를 내기 위한 장치.
 *
 * 정렬하지 않으면 키워드 배열이 문장에서 단어가 나온 순서를 그대로 따른다.
 * 그런데 이 배열의 앞쪽 8개만 카탈로그를 검색하므로, "따릉이 대여소 현황"과
 * "대여소별 따릉이 현황"이 서로 다른 후보군을 만들고, 후보군이 다르면 IDF 가중과
 * 점수까지 달라진다. 같은 뜻인데 답이 흔들리는 것이다.
 *
 * 그래서 의미에만 의존하는 기준으로 세운다.
 *   1) 긴 말 먼저 — 한국어 합성어는 길수록 구체적이다 (무더위쉼터 > 쉼터, 그늘막 > 그늘).
 *      구체적인 말일수록 검색이 정확하고 변별력도 높으므로 먼저 검색해야 한다.
 *   2) 같은 길이면 가나다순 — 남은 동률을 완전히 없앤다.
 */
export function canonicalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unique.push(k);
  }
  return unique.sort((a, b) => b.length - a.length || a.localeCompare(b, "ko"));
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

  // 불용어 + 요청 동사류("만들게", "추천해줘") + 범용어("현황"·"정보") 제거.
  // 범용어를 여기서 빼야 유사어 확장의 출발점으로도 쓰이지 않는다 —
  // "위치"를 남겨 두면 사전이 "좌표"·"지도"까지 끌어와 질의가 통째로 달라진다.
  const filtered = tokens.filter(
    (t) => !STOP_WORDS.has(t) && !isNonTopicToken(t) && !GENERIC_CORE_TERMS.has(t)
  );

  // 실시간 힌트 감지
  const isRealtimeHinted = tokens.some((t) => REALTIME_KEYWORDS.has(t));

  const core = new Set<string>(filtered);
  const expanded = new Set<string>();

  /** 토큰 하나를 사전 표제어에 연결하고 유사어를 확장한다 */
  const expandToken = (token: string, limit = Infinity) => {
    for (const key of matchDictionaryKeys(token)) {
      // 표제어 자체도 검색어로 쓸모가 있다 ("그늘맵"→"그늘")
      if (!core.has(key) && !GENERIC_CORE_TERMS.has(key)) expanded.add(key);
      const expansions = DOMAIN_EXPANSIONS[key] ?? [];
      for (const e of expansions.slice(0, limit)) {
        if (!core.has(e) && !GENERIC_CORE_TERMS.has(e)) expanded.add(e);
      }
    }
  };

  for (const token of filtered) expandToken(token);

  // 도메인 힌트 추가
  if (domainHint) {
    const hintTokens = tokenize(domainHint).filter(
      (t) => !STOP_WORDS.has(t) && !isNonTopicToken(t)
    );
    hintTokens.forEach((t) => {
      core.add(t);
      expandToken(t, 2);
    });
  }

  // 원문 키워드를 앞에 배치해 검색 쿼리 우선순위를 확보하되,
  // 문장에서 나온 순서가 아니라 정규 순서로 정렬한다 (아래 canonicalizeKeywords 참고)
  const coreKeywords = canonicalizeKeywords([...core]).slice(0, MAX_KEYWORDS);
  const expandedKeywords = canonicalizeKeywords([...expanded])
    .filter((e) => !coreKeywords.includes(e))
    .slice(0, Math.max(0, MAX_KEYWORDS - coreKeywords.length));

  return {
    keywords: [...coreKeywords, ...expandedKeywords],
    coreKeywords,
    expandedKeywords,
    isRealtimeHinted,
  };
}
