/**
 * 키워드 매칭 — 관련도 점수의 핵심.
 *
 * 이전 방식(매칭 건별 고정 가산)의 문제:
 *   1) "정보"·"현황"·"위치"처럼 카탈로그 어디에나 있는 단어가 관련 있는 단어와
 *      같은 점수를 받아, 주제가 전혀 다른 데이터가 상위로 올라왔다.
 *   2) 키워드 2개 중 1개만 맞은 데이터와 2개 다 맞은 데이터를 구분하지 못했다
 *      (제목 매칭 1건이면 20점 상한에 바로 도달).
 *
 * 그래서 두 가지를 도입한다.
 *
 *   IDF 가중 — 후보군 안에서 흔한 단어일수록 가중을 낮춘다. 후보 전부에 등장하는
 *              단어는 변별력이 0이므로 사실상 점수에 기여하지 않는다. 사람이
 *              범용어 목록을 손으로 관리하지 않아도 질의마다 자동으로 조정된다.
 *   커버리지 — "맞은 키워드 가중 합 / 변별력 있는 전체 키워드 가중 합" 비율로 계산한다.
 *              질의를 얼마나 충족했는지가 그대로 점수가 되고, 유사어를 늘려도
 *              비율의 분자·분모가 함께 커져 점수가 희석되지 않는다.
 *
 * 후보군에 한 번도 등장하지 않는 키워드(df=0)는 분모에서 제외한다. "그늘맵"처럼
 * 카탈로그에 없는 신조어가 분모에 남으면, 나머지를 모두 맞춘 정답 데이터까지
 * 커버리지가 깎여 게이트에 걸리기 때문이다.
 */

import type { NormalizedDataset } from "../types/index.js";
import {
  EXPANDED_KEYWORD_DECAY,
  EXPANDED_KEYWORD_FACTOR,
  MATCH_POSITION_FACTOR,
  MIN_KEYWORD_WEIGHT,
  PRIMARY_KEYWORD_WEIGHT_RATIO,
  SHORT_KEYWORD_LENGTH,
} from "../config/scoringConfig.js";

export type MatchPosition = "title" | "tag" | "body";

/** 데이터셋에서 매칭 대상이 되는 텍스트를 위치별로 분리한 형태 */
export interface DatasetText {
  title: string;
  tag: string;
  body: string;
}

export interface KeywordStat {
  keyword: string;
  /** 사용자가 실제로 입력한 원문 키워드인지 (false면 확장 유사어) */
  core: boolean;
  /** 후보군 안에서 이 키워드가 등장한 데이터셋 수 */
  df: number;
  /** IDF 가중 × 원문/유사어 계수 */
  weight: number;
}

export interface KeywordMatchResult {
  /** 0~1 — 변별력 기준 질의 충족률 */
  ratio: number;
  /** 제목·태그에 걸린 키워드 수 (본문 매칭은 세지 않는다) */
  strongHits: number;
  /**
   * 질의의 주요 키워드(가장 변별력 있는 키워드급)를 하나라도 제목·태그에서
   * 맞췄는지. 범용어만 여러 개 맞아 커버리지가 올라간 경우를 걸러낸다.
   */
  primaryHit: boolean;
  /** 실제로 매칭된 키워드 (제목 매칭 우선 정렬) */
  matched: string[];
  /** 분모가 되는 키워드가 하나라도 있었는지 */
  applicable: boolean;
}

const textCache = new WeakMap<NormalizedDataset, DatasetText>();

/** 데이터셋의 매칭 텍스트 — 반복 호출되므로 데이터셋 단위로 캐시한다 */
export function datasetText(dataset: NormalizedDataset): DatasetText {
  const cached = textCache.get(dataset);
  if (cached) return cached;

  const value: DatasetText = {
    title: dataset.title.toLowerCase(),
    // 태그는 카탈로그 소분류(정책분야)에서 온다 — 주제를 나타내는 공식 값이다
    tag: [...dataset.tags, dataset.brm?.primary ?? ""].join(" ").toLowerCase(),
    body: [
      dataset.description,
      dataset.provider,
      dataset._raw?.mngStationName ?? "",
      dataset._raw?.linkDesc ?? "",
    ]
      .join(" ")
      .toLowerCase(),
  };

  textCache.set(dataset, value);
  return value;
}

/** 키워드가 걸린 가장 강한 위치 하나를 반환한다 (제목 > 태그 > 본문) */
export function findMatchPosition(
  text: DatasetText,
  keyword: string
): MatchPosition | null {
  const k = keyword.toLowerCase();
  if (!k) return null;
  if (text.title.includes(k)) return "title";
  if (text.tag.includes(k)) return "tag";
  // 2글자 이하 키워드는 제공기관·부서명에 우연히 걸리는 경우가 많아 본문을 보지 않는다
  if (k.length > SHORT_KEYWORD_LENGTH && text.body.includes(k)) return "body";
  return null;
}

/**
 * 후보군 전체를 기준으로 키워드별 IDF 가중을 계산한다.
 * @param datasets 점수화 대상 후보군 (검색으로 모은 실제 후보)
 * @param keywords 원문 + 확장 유사어 전체
 * @param coreKeywords 사용자 입력에 실제로 등장한 키워드 (생략 시 전체를 원문으로 취급)
 */
export function buildKeywordStats(
  datasets: NormalizedDataset[],
  keywords: string[],
  coreKeywords?: string[]
): KeywordStat[] {
  const texts = datasets.map(datasetText);
  const n = Math.max(1, datasets.length);
  const coreSet = new Set((coreKeywords ?? keywords).map((k) => k.trim().toLowerCase()));

  // 1단계: 등장 빈도(df)와 원시 IDF
  const entries: { keyword: string; core: boolean; df: number; idf: number }[] = [];
  const seen = new Set<string>();

  for (const raw of keywords) {
    const k = raw.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);

    const df = texts.reduce(
      (count, t) => (findMatchPosition(t, k) !== null ? count + 1 : count),
      0
    );
    entries.push({
      keyword: k,
      core: coreSet.has(k),
      df,
      idf: Math.log((n + 1) / (df + 1)),
    });
  }

  // 2단계: 가장 변별력 있는 키워드를 1.0으로 두고 나머지를 상대적으로 재는다.
  // 절대 IDF를 후보 수로 나누면 후보군이 작을 때 값이 전부 0 근처로 눌려,
  // 정작 주제어와 범용어("현황"·"정보")의 차이가 사라진다.
  // df=0인 키워드는 어차피 분모에서 빠지므로 기준에서도 제외한다.
  const maxIdf = Math.max(0, ...entries.filter((e) => e.df > 0).map((e) => e.idf));

  const discriminability = (idf: number): number =>
    maxIdf > 0 ? Math.min(1, Math.max(MIN_KEYWORD_WEIGHT, idf / maxIdf)) : 1;

  // 3단계: 확장 유사어는 "가장 약한 원문 키워드"보다도 가볍게 만든다.
  // 이 불변식이 없으면, 사용자가 쓴 단어가 후보 전체에 흔하다는 이유로 바닥
  // 가중을 받는 사이 유사어가 순위를 좌우하는 역전이 생긴다.
  const coreWeights = entries
    .filter((e) => e.core && e.df > 0)
    .map((e) => discriminability(e.idf));
  const coreScale = coreWeights.length > 0 ? Math.min(...coreWeights) : 1;

  return entries.map((e) => ({
    keyword: e.keyword,
    core: e.core,
    df: e.df,
    weight: e.core
      ? discriminability(e.idf)
      : discriminability(e.idf) * EXPANDED_KEYWORD_FACTOR * coreScale,
  }));
}

/** 데이터셋 하나의 키워드 커버리지를 계산한다 */
export function matchKeywords(
  dataset: NormalizedDataset,
  stats: KeywordStat[]
): KeywordMatchResult {
  // 후보군에 한 번도 없는 키워드는 변별에 쓸 수 없으므로 분모에서 제외한다
  const usable = stats.filter((s) => s.df > 0);
  if (usable.length === 0) {
    return { ratio: 0, strongHits: 0, primaryHit: false, matched: [], applicable: false };
  }

  // 주요 키워드 기준선 — 최고 가중의 절반 이상이면 "질의의 주제어급"으로 본다.
  // 유사어가 여럿인 질의(그늘막/무더위쉼터)에서 어느 쪽을 맞춰도 인정되도록
  // 최고 하나만 고집하지 않는다.
  const primaryThreshold =
    Math.max(...usable.map((s) => s.weight)) * PRIMARY_KEYWORD_WEIGHT_RATIO;

  const text = datasetText(dataset);
  let strongHits = 0;
  let primaryHit = false;
  const titleHits: string[] = [];
  const otherHits: string[] = [];

  // 원문 키워드는 전부 더하고(AND), 확장 유사어는 잘 맞은 순으로 체감시킨다(OR에 가깝게)
  let coreDenominator = 0;
  let coreEarned = 0;
  const expandedWeights: number[] = [];
  const expandedEarned: number[] = [];

  for (const stat of usable) {
    const position = findMatchPosition(text, stat.keyword);
    const contribution = position ? stat.weight * MATCH_POSITION_FACTOR[position] : 0;

    if (stat.core) {
      coreDenominator += stat.weight;
      coreEarned += contribution;
    } else {
      expandedWeights.push(stat.weight);
      if (contribution > 0) expandedEarned.push(contribution);
    }

    if (!position) continue;

    if (position === "body") {
      otherHits.push(stat.keyword);
      continue;
    }

    strongHits++;
    if (stat.weight >= primaryThreshold) primaryHit = true;
    if (position === "title") titleHits.push(stat.keyword);
    else otherHits.push(stat.keyword);
  }

  const decayed = (values: number[]): number =>
    values
      .slice()
      .sort((a, b) => b - a)
      .reduce((sum, value, rank) => sum + value * EXPANDED_KEYWORD_DECAY ** rank, 0);

  const denominator = coreDenominator + decayed(expandedWeights);
  const earned = coreEarned + decayed(expandedEarned);

  return {
    ratio: denominator > 0 ? Math.min(1, earned / denominator) : 0,
    strongHits,
    primaryHit,
    matched: [...titleHits, ...otherHits],
    applicable: true,
  };
}
