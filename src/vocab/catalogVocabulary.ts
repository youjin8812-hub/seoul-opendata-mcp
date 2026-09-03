/**
 * 서울 열린데이터광장 카탈로그에서 어휘 사전을 자동 생성한다.
 *
 * 손으로 쓴 유사어 사전(extractKeywords.ts의 DOMAIN_EXPANSIONS)에는 두 가지
 * 구조적 한계가 있다.
 *   1) 신조어가 나올 때마다 사람이 사전에 추가해야 한다.
 *   2) 사전 어휘가 카탈로그의 실제 서비스명과 다를 수 있다. 사전에 "그늘막"이
 *      있어도 등재명이 "폭염저감시설"이면 검색에 걸리지 않는다.
 *
 * 그래서 카탈로그 전체(수천 건)의 서비스명(INF_NM)을 한 번 읽어 색인해 둔다.
 * 여기서 나온 표제어는 정의상 카탈로그에 실재하므로 검색이 반드시 걸린다.
 *
 *   - n-gram 역색인: "그늘맵"의 2-gram("그늘","늘맵")으로 "그늘막"·"그늘목"을 찾는다
 *   - 분류 공출현:   매칭된 표제어가 속한 분류(MAP_CATE_NM)의 빈출어를 함께 제안한다
 *
 * 카탈로그 전수 조회는 비싸므로 24시간 캐시하고, 실패해도 추천 자체는
 * 사전 기반으로 계속 동작하도록 호출부에서 폴백한다.
 */

import { searchSeoulCatalog } from "../services/seoulCatalogService.js";
import { logger } from "../utils/logger.js";

/** 색인 캐시 수명 — 카탈로그 등재명은 자주 바뀌지 않는다 */
const VOCAB_TTL_MS = 24 * 60 * 60 * 1000;

/** 카탈로그 1회 조회 상한 (API 제약과 동일) */
const PAGE_SIZE = 1000;

/** 전수 조회 페이지 수 상한 — 카탈로그는 8천여 건 규모다 */
const MAX_PAGES = 12;

/** 색인에서 제외할 범용어 — 어느 데이터셋에나 붙어 변별력이 없다 */
const GENERIC_TERMS = new Set([
  "서울", "서울시", "서울특별시", "현황", "정보", "목록", "통계", "자료",
  "데이터", "내역", "실태", "결과", "이용", "관리", "표준", "공공", "일반",
  "기준", "대상", "구분", "전체", "기타", "관련", "제공", "지역", "연도",
  "월별", "일별", "연별", "년도", "분기", "코드", "명칭", "번호", "서비스",
  // 서술어성 명사 — 어떤 주제에나 붙어 유사어로는 쓸모가 없다
  "설치", "운영", "조성", "식재", "부과", "신청", "접수", "처리", "등록",
  "변경", "지정", "보유", "배치", "추진", "지원", "사업", "시설", "장소",
  "위치", "주소", "명단", "안내", "공고", "통보", "점검", "조사", "평가",
]);

/**
 * 공출현 확장에서 제외할 분류 수 상한.
 * 여러 분류에 두루 등장하는 표제어는 변별력이 없어 유사어로 부적절하다.
 */
const MAX_CATEGORIES_FOR_COOCCURRENCE = 3;

/** 한 표제어에 대해 제안할 최대 유사어 수 */
const MAX_RELATED_PER_KEYWORD = 6;

export interface CatalogVocabulary {
  /** 색인된 표제어 → 등장 횟수 */
  termFrequency: Map<string, number>;
  /** n-gram → 그 n-gram을 포함하는 표제어들 */
  ngramIndex: Map<string, Set<string>>;
  /** 표제어 → 함께 등장한 분류(MAP_CATE_NM)들 */
  termCategories: Map<string, Set<string>>;
  /** 분류 → 그 분류에서 자주 쓰이는 표제어 (빈도 내림차순) */
  categoryTerms: Map<string, string[]>;
  /** 색인에 사용된 데이터셋 수 */
  datasetCount: number;
}

let cached: { value: CatalogVocabulary; expiresAt: number } | null = null;
let inFlight: Promise<CatalogVocabulary> | null = null;

// ─── 토큰화 / n-gram ──────────────────────────────────────────────────────────

/** 서비스명을 색인 가능한 표제어로 쪼갠다 */
function tokenizeTitle(title: string): string[] {
  return title
    .replace(/[^가-힣\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 12 && !GENERIC_TERMS.has(t));
}

/** 문자열의 n-gram 집합 (기본 2-gram) */
export function ngrams(text: string, n = 2): string[] {
  if (text.length < n) return text.length > 0 ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i <= text.length - n; i++) out.push(text.slice(i, i + n));
  return out;
}

// ─── 색인 구축 ────────────────────────────────────────────────────────────────

export function buildVocabulary(
  rows: { infNm: string; mapCateNm: string }[]
): CatalogVocabulary {
  const termFrequency = new Map<string, number>();
  const ngramIndex = new Map<string, Set<string>>();
  const termCategories = new Map<string, Set<string>>();
  const categoryCounts = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const category = row.mapCateNm?.trim();
    for (const term of tokenizeTitle(row.infNm ?? "")) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);

      for (const g of ngrams(term)) {
        let bucket = ngramIndex.get(g);
        if (!bucket) ngramIndex.set(g, (bucket = new Set()));
        bucket.add(term);
      }

      if (category) {
        let cats = termCategories.get(term);
        if (!cats) termCategories.set(term, (cats = new Set()));
        cats.add(category);

        let counts = categoryCounts.get(category);
        if (!counts) categoryCounts.set(category, (counts = new Map()));
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }

  const categoryTerms = new Map<string, string[]>();
  for (const [category, counts] of categoryCounts) {
    categoryTerms.set(
      category,
      [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)
    );
  }

  return {
    termFrequency,
    ngramIndex,
    termCategories,
    categoryTerms,
    datasetCount: rows.length,
  };
}

// ─── 카탈로그 전수 조회 ───────────────────────────────────────────────────────

async function fetchAllCatalogRows(
  serviceKey: string
): Promise<{ infNm: string; mapCateNm: string }[]> {
  const first = await searchSeoulCatalog({ start: 1, end: PAGE_SIZE }, serviceKey);
  const rows = [...first.items];

  const totalPages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / PAGE_SIZE));
  if (totalPages > 1) {
    const pages = await Promise.allSettled(
      Array.from({ length: totalPages - 1 }, (_, i) => {
        const start = (i + 1) * PAGE_SIZE + 1;
        return searchSeoulCatalog({ start, end: start + PAGE_SIZE - 1 }, serviceKey);
      })
    );
    for (const p of pages) {
      if (p.status === "fulfilled") rows.push(...p.value.items);
    }
  }

  return rows.map((r) => ({ infNm: r.infNm, mapCateNm: r.mapCateNm }));
}

/**
 * 카탈로그 어휘 색인을 가져온다 (24시간 캐시).
 * 동시 호출이 들어와도 카탈로그 전수 조회는 한 번만 수행한다.
 */
export async function getCatalogVocabulary(
  serviceKey: string
): Promise<CatalogVocabulary> {
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const started = Date.now();
    const rows = await fetchAllCatalogRows(serviceKey);
    const vocab = buildVocabulary(rows);
    cached = { value: vocab, expiresAt: Date.now() + VOCAB_TTL_MS };
    logger.info("카탈로그 어휘 색인 구축", {
      datasets: vocab.datasetCount,
      terms: vocab.termFrequency.size,
      elapsedMs: Date.now() - started,
    });
    return vocab;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** 테스트·운영 점검용 — 캐시된 색인을 비운다 */
export function resetCatalogVocabulary(): void {
  cached = null;
  inFlight = null;
}

// ─── 유사어 조회 ──────────────────────────────────────────────────────────────

/**
 * 키워드와 표기가 겹치는 카탈로그 표제어를 찾는다.
 *
 * "그늘맵"은 카탈로그에 없지만 2-gram "그늘"을 공유하는 "그늘막"·"그늘목"이
 * 색인에 있으므로, 사전에 없는 신조어도 실제 등재명으로 연결된다.
 */
export function findSimilarTerms(
  vocab: CatalogVocabulary,
  keyword: string,
  limit = MAX_RELATED_PER_KEYWORD
): string[] {
  const grams = ngrams(keyword);
  if (grams.length === 0) return [];

  // n-gram이 몇 개나 겹치는지로 후보를 모은다
  const overlap = new Map<string, number>();
  for (const g of grams) {
    for (const term of vocab.ngramIndex.get(g) ?? []) {
      if (term === keyword) continue;
      overlap.set(term, (overlap.get(term) ?? 0) + 1);
    }
  }
  if (overlap.size === 0) return [];

  const scored = [...overlap.entries()].map(([term, hits]) => {
    // 겹친 비율(질의 기준)과 길이 유사도로 점수화한다.
    // 빈도는 약한 가산으로만 반영해 범용어가 상위를 독점하지 않게 한다.
    const coverage = hits / grams.length;
    const lengthPenalty = Math.abs(term.length - keyword.length) / 10;
    const frequency = Math.log10((vocab.termFrequency.get(term) ?? 1) + 1) / 20;
    return { term, score: coverage - lengthPenalty + frequency };
  });

  return scored
    .filter((s) => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.term);
}

/**
 * 표제어들이 속한 분류에서 자주 쓰이는 다른 표제어를 제안한다 (공출현 확장).
 * 표기가 전혀 다른 유의어("그늘막" ↔ "쿨링포그")를 잡는 경로다.
 */
export function findCooccurringTerms(
  vocab: CatalogVocabulary,
  terms: string[],
  limit = MAX_RELATED_PER_KEYWORD
): string[] {
  const categories = new Set<string>();
  for (const term of terms) {
    for (const c of vocab.termCategories.get(term) ?? []) categories.add(c);
  }
  if (categories.size === 0) return [];

  const seen = new Set(terms);
  const out: string[] = [];
  // 분류별로 고르게 뽑아 한 분류가 결과를 독점하지 않게 한다
  const perCategory = Math.max(1, Math.ceil(limit / categories.size));
  for (const category of categories) {
    let taken = 0;
    for (const term of vocab.categoryTerms.get(category) ?? []) {
      if (taken >= perCategory || out.length >= limit) break;
      if (seen.has(term)) continue;
      // 여러 분류에 걸친 범용어는 건너뛴다
      const spread = vocab.termCategories.get(term)?.size ?? 0;
      if (spread > MAX_CATEGORIES_FOR_COOCCURRENCE) continue;
      seen.add(term);
      out.push(term);
      taken++;
    }
  }
  return out.slice(0, limit);
}

/**
 * 원문 키워드들을 카탈로그 실제 등재 어휘로 확장한다.
 * 표기 유사(n-gram) → 분류 공출현 순으로 우선순위를 둔다.
 */
export function expandWithCatalogVocabulary(
  vocab: CatalogVocabulary,
  coreKeywords: string[],
  limit = 8
): string[] {
  const similar: string[] = [];
  for (const kw of coreKeywords) {
    for (const term of findSimilarTerms(vocab, kw)) {
      if (!similar.includes(term)) similar.push(term);
    }
  }

  const cooccurring = findCooccurringTerms(vocab, similar).filter(
    (t) => !similar.includes(t)
  );

  return [...similar, ...cooccurring]
    .filter((t) => !coreKeywords.includes(t))
    .slice(0, limit);
}
