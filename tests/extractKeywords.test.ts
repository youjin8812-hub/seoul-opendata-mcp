import { describe, it, expect } from "vitest";
import { extractKeywords, MAX_KEYWORDS } from "../src/parsers/extractKeywords.js";

describe("extractKeywords", () => {
  it("축제 앱 아이디어에서 핵심 키워드를 추출한다", () => {
    const { keywords } = extractKeywords(
      "대한민국 지역 축제 시작 전에 알림을 주는 앱을 만들고 싶어"
    );
    expect(keywords).toContain("축제");
    expect(keywords).toContain("지역");
    expect(keywords).toContain("알림");
  });

  it("도메인 확장이 동작한다 — 축제 → 행사 추가", () => {
    const { keywords } = extractKeywords("축제 일정 앱");
    expect(keywords).toContain("축제");
    expect(keywords).toContain("행사");
  });

  it("병원 비급여 서비스에서 의료 관련 키워드가 추출된다", () => {
    const { keywords } = extractKeywords("병원 비급여 비교 서비스");
    expect(keywords).toContain("병원");
    expect(keywords).toContain("비급여");
  });

  it("실시간 키워드가 포함되면 isRealtimeHinted가 true다", () => {
    const { isRealtimeHinted } = extractKeywords("실시간 버스 위치 앱");
    expect(isRealtimeHinted).toBe(true);
  });

  it("실시간 키워드가 없으면 isRealtimeHinted가 false다", () => {
    const { isRealtimeHinted } = extractKeywords("축제 정보 앱");
    expect(isRealtimeHinted).toBe(false);
  });

  it("domainHint가 주어지면 관련 키워드가 추가된다", () => {
    const { keywords } = extractKeywords("알림 앱 만들기", "교통");
    expect(keywords).toContain("교통");
    expect(keywords).toContain("버스");
  });

  it("키워드는 MAX_KEYWORDS를 넘지 않는다", () => {
    const { keywords } = extractKeywords(
      "축제 병원 교통 날씨 음식 관광 취업 복지 환경 통계"
    );
    expect(keywords.length).toBeLessThanOrEqual(MAX_KEYWORDS);
  });

  it("불용어만 있는 입력은 빈 배열을 반환한다", () => {
    const { keywords } = extractKeywords("을 를 이 가 은 는");
    expect(keywords.length).toBe(0);
  });

  // 실제 라이브 테스트에서 노이즈로 확인된 케이스 — "데이터로"/"분석하"/"앱을"이
  // 그대로 키워드에 섞여 불필요한 검색 호출을 유발했던 버그 회귀 테스트
  it("'데이터로'는 조사가 제거되어 '데이터' 불용어로 필터링된다", () => {
    const { keywords } = extractKeywords(
      "생활인구 250m 격자 데이터로 유동인구를 분석하는 앱을 만들고 싶어"
    );
    expect(keywords).not.toContain("데이터로");
    expect(keywords).not.toContain("데이터");
  });

  it("'분석하는'은 동사 어간이 정리되어 '분석'으로 추출된다", () => {
    const { keywords } = extractKeywords("유동인구를 분석하는 앱");
    expect(keywords).toContain("분석");
    expect(keywords).not.toContain("분석하");
    expect(keywords).not.toContain("분석하는");
  });

  it("'앱을'처럼 1음절 어간+조사 조합은 불용어로 걸러진다", () => {
    const { keywords } = extractKeywords("생활인구 앱을 만들고 싶어");
    expect(keywords).not.toContain("앱을");
  });

  it("'교통으로'처럼 받침 있는 어간은 '으로'가 정상 제거된다", () => {
    const { keywords } = extractKeywords("교통으로 통근하는 사람들을 위한 서비스");
    expect(keywords).toContain("교통");
    expect(keywords).not.toContain("교통으로");
  });

  // 실제 사용 중 확인된 케이스 — "그늘맵 앱 만들게 데이터 추천해줘"가
  // ["그늘맵","만들게","추천해줘"]로 추출되어 유사어 확장이 전혀 되지 않던 버그
  describe("요청 동사류 제거 + 합성어 유사어 확장", () => {
    const query = "그늘맵 앱 만들게 데이터 추천해줘";

    it("'만들게'/'추천해줘' 같은 요청 표현은 키워드에서 제외된다", () => {
      const { keywords } = extractKeywords(query);
      expect(keywords).not.toContain("만들게");
      expect(keywords).not.toContain("추천해줘");
    });

    it("'그늘맵' 같은 합성 신조어가 사전 표제어 '그늘'로 연결된다", () => {
      const { keywords } = extractKeywords(query);
      expect(keywords).toContain("그늘");
      expect(keywords).toContain("그늘막");
      expect(keywords).toContain("폭염");
      expect(keywords).toContain("무더위쉼터");
    });

    it("원문 키워드와 확장 유사어가 구분되어 반환된다", () => {
      const { coreKeywords, expandedKeywords, keywords } = extractKeywords(query);
      expect(coreKeywords).toEqual(["그늘맵"]);
      expect(expandedKeywords).toContain("그늘막");
      expect(expandedKeywords).not.toContain("그늘맵");
      // keywords는 원문이 앞에 오는 합집합이다
      expect(keywords[0]).toBe("그늘맵");
      expect(keywords).toEqual([...coreKeywords, ...expandedKeywords]);
    });

    it("확장 유사어가 원문 키워드보다 많이 확보된다", () => {
      const { coreKeywords, expandedKeywords } = extractKeywords(query);
      expect(expandedKeywords.length).toBeGreaterThan(coreKeywords.length);
    });
  });
});
