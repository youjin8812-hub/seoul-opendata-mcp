#!/usr/bin/env node
/**
 * Seoul Open Data API Finder — MCP 서버 진입점
 * Claude Desktop / Cursor 등 MCP 클라이언트와 stdio로 통신한다.
 *
 * 서울 열린데이터광장(data.seoul.go.kr)의 자체 카탈로그 API인 SearchCatalogService를
 * 직접 호출해 8천여 건의 서울시(본청+산하기관+자치구) 데이터셋을 검색·추천한다.
 */
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { recommendSeoulApisForIdea } from "./tools/recommendSeoulApisForIdea.js";
import { searchSeoulDatasetsForTool } from "./tools/searchSeoulDatasets.js";
import { refineRecommendations } from "./tools/refineRecommendations.js";
import { getSeoulDatasetDetail } from "./tools/getSeoulDatasetDetail.js";
import { listSeoulRecentUpdates } from "./tools/listSeoulRecentUpdates.js";
import { logger } from "./utils/logger.js";
// ─── Zod 스키마 ────────────────────────────────────────────────────────────────
const RecommendInputSchema = z.object({
    ideaText: z.string().min(1, "아이디어 텍스트를 입력하세요"),
    apiOnly: z.boolean().optional(),
    realtimePreferred: z.boolean().optional(),
    domainHint: z.string().optional(),
    limit: z.number().int().min(1).max(10).optional(),
    orgName: z.string().optional(),
    division: z.string().optional(),
});
const SearchInputSchema = z.object({
    query: z.string().min(1),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    orgName: z.string().optional(),
    division: z.string().optional(),
});
const DatasetDetailInputSchema = z.object({
    detailUrl: z.string().min(1, "URL 또는 서비스 ID(예: OA-15529)를 입력하세요"),
});
const RecentUpdatesInputSchema = z.object({
    keyword: z.string().optional(),
    orgName: z.string().optional(),
    division: z.string().optional(),
    apiOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(30).optional(),
});
const RefineInputSchema = z.object({
    previousResults: z.array(z.object({
        title: z.string(),
        provider: z.string(),
        type: z.enum(["API", "FILE", "UNKNOWN"]),
        updateCycle: z.string(),
        reason: z.string(),
        score: z.number(),
        detailUrl: z.string(),
    })),
    apiOnly: z.boolean().optional(),
    realtimePreferred: z.boolean().optional(),
    providerIncludes: z.string().optional(),
});
// ─── 서버 생성 ────────────────────────────────────────────────────────────────
const server = new Server({
    name: "seoul-opendata-mcp",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {},
    },
});
// ─── 도구 목록 ────────────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "recommend_seoul_apis_for_idea",
            description: "자연어로 아이디어를 설명하면 서울 열린데이터광장(data.seoul.go.kr) 카탈로그에서 적합한 API 후보를 추천합니다. 키워드 검색·점수화를 자동으로 수행하고 상위 결과를 반환합니다.",
            inputSchema: {
                type: "object",
                properties: {
                    ideaText: {
                        type: "string",
                        description: "만들고 싶은 서비스/앱의 아이디어를 자연어로 설명하세요 (한국어 권장)",
                    },
                    apiOnly: {
                        type: "boolean",
                        description: "true이면 API형 데이터만 반환합니다 (파일데이터 제외)",
                    },
                    realtimePreferred: {
                        type: "boolean",
                        description: "true이면 실시간·고빈도 업데이트 데이터를 우선 정렬합니다",
                    },
                    domainHint: {
                        type: "string",
                        description: "검색 도메인 힌트 (예: '교통', '따릉이', '한강')",
                    },
                    limit: {
                        type: "number",
                        description: "최대 반환 추천 수 (기본 5, 최대 10)",
                    },
                    orgName: {
                        type: "string",
                        description: "제공기관명으로 범위를 좁힙니다 (예: '강남구', '서울교통공사')",
                    },
                    division: {
                        type: "string",
                        description: "제공 주체 구분 필터 — '본청'/'산하기관'/'자치구' 중 일부 입력 (예: '자치구'만 보거나 자치구 데이터를 빼려면 '본청')",
                    },
                },
                required: ["ideaText"],
            },
        },
        {
            name: "search_seoul_datasets",
            description: "서울 열린데이터광장 카탈로그(서비스명 기준)를 키워드로 직접 검색합니다. 원시 검색 결과와 함께 조건에 해당하는 전체 건수(totalMatchCount)를 반환합니다.",
            inputSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "검색 키워드",
                    },
                    page: {
                        type: "number",
                        description: "페이지 번호 (기본 1)",
                    },
                    limit: {
                        type: "number",
                        description: "결과 수 (기본 10)",
                    },
                    orgName: {
                        type: "string",
                        description: "제공기관명으로 범위를 좁힙니다 (예: '강남구', '서울교통공사')",
                    },
                    division: {
                        type: "string",
                        description: "제공 주체 구분 필터 — '본청'/'산하기관'/'자치구' 중 일부 입력",
                    },
                },
                required: ["query"],
            },
        },
        {
            name: "get_seoul_dataset_detail",
            description: "서울시 데이터셋 상세 메타데이터를 조회합니다. 서울 열린데이터광장 카탈로그 API로 제공기관, 담당부서, 갱신주기, 최종갱신일, 제공형식(SRV_TYPE)을 반환합니다. " +
                "※ 개별 API의 요청 URL·파라미터 명세는 이 도구로 조회 불가하므로, 반환된 swaggerUrl(상세페이지)의 'Open API' 탭을 브라우저에서 직접 확인하세요.",
            inputSchema: {
                type: "object",
                properties: {
                    detailUrl: {
                        type: "string",
                        description: "data.seoul.go.kr 데이터셋 상세 페이지 URL 또는 서비스 ID (예: https://data.seoul.go.kr/dataList/OA-15529/S/1/datasetView.do 또는 OA-15529)",
                    },
                },
                required: ["detailUrl"],
            },
        },
        {
            name: "refine_seoul_recommendations",
            description: "이전 추천 결과를 재검색 없이 조건에 맞게 재필터링/재정렬합니다. 토큰과 API 호출을 절약합니다.",
            inputSchema: {
                type: "object",
                properties: {
                    previousResults: {
                        type: "array",
                        description: "recommend_seoul_apis_for_idea가 반환한 recommendations 배열",
                        items: { type: "object" },
                    },
                    apiOnly: {
                        type: "boolean",
                        description: "API형만 남깁니다",
                    },
                    realtimePreferred: {
                        type: "boolean",
                        description: "실시간 데이터를 앞으로 정렬합니다",
                    },
                    providerIncludes: {
                        type: "string",
                        description: "특정 제공기관 이름 포함 필터 (예: '서울교통공사')",
                    },
                },
                required: ["previousResults"],
            },
        },
        {
            name: "list_seoul_recent_updates",
            description: "최근 갱신된 서울시 데이터셋을 최종갱신일(DATA_LT_NM) 기준 내림차순으로 조회합니다. " +
                "키워드/제공기관/제공주체(본청·산하기관·자치구)로 범위를 좁힐 수 있어, '요즘 활발히 관리되는 API'를 바로 찾을 때 유용합니다. " +
                "조건에 맞는 전체 건수가 1,000건을 넘으면 표본 내 정렬임을 note로 안내합니다.",
            inputSchema: {
                type: "object",
                properties: {
                    keyword: {
                        type: "string",
                        description: "검색 키워드 (선택 — 비우면 전체 범위에서 조회)",
                    },
                    orgName: {
                        type: "string",
                        description: "제공기관명 필터 (예: '강남구')",
                    },
                    division: {
                        type: "string",
                        description: "제공 주체 구분 필터 — '본청'/'산하기관'/'자치구' 중 일부 입력",
                    },
                    apiOnly: {
                        type: "boolean",
                        description: "true이면 SRV_TYPE에 Api가 포함된 데이터만 반환",
                    },
                    limit: {
                        type: "number",
                        description: "최대 반환 수 (기본 10, 최대 30)",
                    },
                },
            },
        },
    ],
}));
// ─── 도구 호출 핸들러 ─────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === "recommend_seoul_apis_for_idea") {
            const input = RecommendInputSchema.parse(args);
            const result = await recommendSeoulApisForIdea(input);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        if (name === "search_seoul_datasets") {
            const input = SearchInputSchema.parse(args);
            const result = await searchSeoulDatasetsForTool(input);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        if (name === "get_seoul_dataset_detail") {
            const { detailUrl } = DatasetDetailInputSchema.parse(args);
            const result = await getSeoulDatasetDetail(detailUrl);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        if (name === "refine_seoul_recommendations") {
            const input = RefineInputSchema.parse(args);
            const result = refineRecommendations(input);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        if (name === "list_seoul_recent_updates") {
            const input = RecentUpdatesInputSchema.parse(args ?? {});
            const result = await listSeoulRecentUpdates(input);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        }
        return {
            content: [{ type: "text", text: `알 수 없는 도구: ${name}` }],
            isError: true,
        };
    }
    catch (err) {
        logger.error(`도구 호출 오류 [${name}]`, err);
        const message = err instanceof Error ? err.message : String(err);
        // MCP 스펙: isError:true + 사람이 읽을 수 있는 오류 메시지 반환
        // AI 어시스턴트가 오류 원인을 파악하고 사용자에게 설명할 수 있도록 상세 기술
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message,
                        tool: name,
                        timestamp: new Date().toISOString(),
                        hint: message.includes("일시 불가")
                            ? "서울 열린데이터광장 API 서버가 일시적으로 응답하지 않습니다. 30초~1분 후 재시도하세요."
                            : message.includes("인증키") || message.includes("SEOUL_OPEN_DATA_API_KEY")
                                ? "data.seoul.go.kr에서 발급받은 인증키가 SEOUL_OPEN_DATA_API_KEY 환경변수에 올바르게 설정되어 있는지 확인하세요."
                                : "잠시 후 다시 시도하거나 관리자에게 문의하세요.",
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
});
// ─── 서버 시작 ────────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Seoul Open Data API Finder MCP 서버 시작됨 (stdio)");
}
main().catch((err) => {
    logger.error("서버 시작 실패", err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map
