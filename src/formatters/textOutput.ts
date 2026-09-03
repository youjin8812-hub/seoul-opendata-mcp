/**
 * 도구 결과를 사람이 바로 읽을 수 있는 마크다운으로 변환한다.
 *
 * 원시 JSON만 돌려주면 호출하는 AI 어시스턴트가 매번 다르게 요약해서,
 * 정작 중요한 항목(제공형식·갱신주기·담당부서)이 빠지거나 표현이 들쭉날쭉해진다.
 * 표 형태로 고정해 두면 어느 클라이언트에서든 같은 항목이 같은 자리에 나온다.
 *
 * JSON은 별도 블록으로 함께 반환한다 — refine_seoul_recommendations가
 * 이전 결과를 그대로 돌려받아야 하기 때문이다.
 */

import type {
  DatasetType,
  Recommendation,
  RecommendOutput,
  SearchOutput,
  RecentUpdatesOutput,
  DatasetDetailOutput,
} from "../types/index.js";

/** 표에서 값이 없을 때 쓰는 표기 */
const EMPTY = "—";

/** SRV_TYPE 기반 내부 타입을 사용자가 읽는 말로 바꾼다 */
function typeLabel(type: DatasetType): string {
  if (type === "API") return "OpenAPI";
  if (type === "FILE") return "파일";
  return "미상";
}

/** 표 셀에 들어갈 값 — 구분자와 줄바꿈을 무력화한다 */
function cell(value: string | undefined | null): string {
  const text = (value ?? "").trim();
  if (!text) return EMPTY;
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const divider = `|${headers.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, divider, body].join("\n");
}

/** 제목에 상세페이지 링크를 건다 */
function titleLink(title: string, url: string | undefined): string {
  const safeTitle = cell(title);
  if (!url?.trim()) return safeTitle;
  return `[${safeTitle}](${url.trim()})`;
}

// ─── 추천 결과 ────────────────────────────────────────────────────────────────

const RECOMMENDATION_HEADERS = [
  "#",
  "데이터명",
  "제공형식",
  "갱신주기",
  "최종갱신",
  "제공기관",
  "담당부서",
  "점수",
];

function recommendationRows(items: Recommendation[]): string[][] {
  return items.map((r, i) => [
    String(i + 1),
    titleLink(r.title, r.detailUrl),
    cell(typeLabel(r.type)),
    cell(r.updateCycle),
    cell(r.lastUpdated),
    cell(r.provider),
    cell(r.department),
    String(r.score),
  ]);
}

/** 항목별 추천 근거 — 표에 담기 어려운 서술형 정보 */
function recommendationNotes(items: Recommendation[]): string {
  return items
    .map((r, i) => {
      const facts: string[] = [];
      if (r.brm?.primary) facts.push(`정책분야 ${r.brm.primary}`);
      if (r.organization?.label) facts.push(r.organization.label);
      if (r.scoreBreakdown) {
        facts.push(
          `관련도 ${r.scoreBreakdown.relevanceScore} · 활용도 ${r.scoreBreakdown.qualityScore}`
        );
      }

      const lines = [`**${i + 1}. ${r.title}**`];
      if (facts.length > 0) lines.push(`- ${facts.join(" · ")}`);
      if (r.reason?.trim()) lines.push(`- ${r.reason.trim()}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatRecommendations(output: RecommendOutput): string {
  const { recommendations, ideaSummary, extractedKeywords, keywordSources, warning } = output;

  const parts: string[] = [`## "${ideaSummary}" — 추천 데이터 ${recommendations.length}건`];

  if (extractedKeywords.length > 0) {
    const detail = keywordSources
      ? ` (원문 ${keywordSources.core.length} · 카탈로그 ${keywordSources.catalog.length}` +
        ` · 어시스턴트 ${keywordSources.client.length} · 사전 ${keywordSources.dictionary.length})`
      : "";
    parts.push(`**검색 키워드** ${extractedKeywords.join(" · ")}${detail}`);
  }

  if (recommendations.length === 0) {
    parts.push(warning ?? "조건에 맞는 데이터를 찾지 못했습니다.");
    return parts.join("\n\n");
  }

  parts.push(table(RECOMMENDATION_HEADERS, recommendationRows(recommendations)));
  parts.push(recommendationNotes(recommendations));

  if (warning) parts.push(`> ⚠️ ${warning}`);

  return parts.join("\n\n");
}

// ─── 검색 결과 ────────────────────────────────────────────────────────────────

export function formatSearchResults(output: SearchOutput): string {
  const parts: string[] = [
    `## "${output.query}" 검색 결과 — 표시 ${output.items.length}건 / 전체 ${output.totalMatchCount}건`,
  ];

  if (output.items.length === 0) {
    parts.push("조건에 맞는 데이터가 없습니다. 다른 키워드를 시도해 보세요.");
    return parts.join("\n\n");
  }

  parts.push(
    table(
      ["#", "데이터명", "요약", "제공기관", "정책분야"],
      output.items.map((item, i) => [
        String(i + 1),
        titleLink(item.title, item.detailUrl),
        cell(item.summary),
        cell(item.provider),
        cell(item.brm?.primary),
      ])
    )
  );

  return parts.join("\n\n");
}

// ─── 최근 갱신 목록 ───────────────────────────────────────────────────────────

export function formatRecentUpdates(output: RecentUpdatesOutput): string {
  const parts: string[] = [
    `## 최근 갱신 데이터 ${output.items.length}건 (조건 일치 전체 ${output.totalMatchCount}건)`,
  ];

  if (output.items.length === 0) {
    parts.push("조건에 맞는 데이터가 없습니다.");
    return parts.join("\n\n");
  }

  parts.push(
    table(
      ["#", "데이터명", "제공형식", "갱신주기", "최종갱신", "제공기관", "구분"],
      output.items.map((item, i) => [
        String(i + 1),
        titleLink(item.title, item.detailUrl),
        cell(typeLabel(item.type)),
        cell(item.updateCycle),
        cell(item.lastUpdated),
        cell(item.provider),
        cell(item.division),
      ])
    )
  );

  if (output.note) parts.push(`> ${output.note}`);

  return parts.join("\n\n");
}

// ─── 데이터셋 상세 ────────────────────────────────────────────────────────────

export function formatDatasetDetail(output: DatasetDetailOutput): string {
  const parts: string[] = [`## ${output.title}`];

  const rows: string[][] = [["제공기관", cell(output.provider)]];
  if (output.baseUrl) rows.push(["기본 URL", cell(output.baseUrl)]);
  rows.push(["인증방식", cell(output.authMethod)]);
  if (output.detailPageUrl) rows.push(["상세페이지", output.detailPageUrl]);

  parts.push(table(["항목", "내용"], rows));

  if (output.note?.trim()) {
    parts.push(
      output.note
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => `- ${line.trim()}`)
        .join("\n")
    );
  }

  return parts.join("\n\n");
}

// ─── 재정렬 결과 ──────────────────────────────────────────────────────────────

export function formatRefinedRecommendations(items: Recommendation[]): string {
  const parts: string[] = [`## 재정렬 결과 ${items.length}건`];

  if (items.length === 0) {
    parts.push("조건에 맞는 항목이 없습니다. 필터를 완화해 보세요.");
    return parts.join("\n\n");
  }

  parts.push(table(RECOMMENDATION_HEADERS, recommendationRows(items)));
  return parts.join("\n\n");
}
