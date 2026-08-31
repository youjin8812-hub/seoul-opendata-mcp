/**
 * get_seoul_dataset_detail — 서울시 데이터셋 상세 메타데이터 조회 도구.
 *
 * SearchCatalogService를 서비스 ID(INF_ID) 단건 조회로 호출해 제공기관/갱신주기/
 * 최종갱신일/제공형식(SRV_TYPE)을 직접 가져온다. 단, 개별 API의 요청 URL·파라미터
 * 명세까지는 이 카탈로그 API로 제공되지 않으므로, 상세페이지(SHORT_URL)의
 * "Open API" 탭을 확인하라는 안내를 함께 반환한다.
 */
import { searchSeoulCatalog, getServiceKey } from "../services/seoulCatalogService.js";
import { MemoryCache, TTL } from "../cache/memoryCache.js";
import { logger } from "../utils/logger.js";
const detailCache = new MemoryCache(TTL.DETAIL);
/** URL 또는 원시 문자열에서 서비스 ID(OA-xxxxx 등)를 추출한다 */
function extractInfId(input) {
    const trimmed = input.trim();
    if (/^OA-[\w-]+$/i.test(trimmed))
        return trimmed;
    const pathMatch = trimmed.match(/dataList\/([\w-]+)\//);
    if (pathMatch)
        return pathMatch[1];
    const queryMatch = trimmed.match(/[?&]infId=([\w-]+)/);
    if (queryMatch)
        return queryMatch[1];
    return null;
}
function buildNotFound(detailUrl, reason) {
    return {
        title: "상세 정보 조회 불가",
        provider: "",
        baseUrl: "",
        endpoints: [],
        authMethod: "서울 열린데이터광장 인증키 — data.seoul.go.kr에서 발급",
        swaggerUrl: detailUrl,
        detailPageUrl: detailUrl,
        note: [
            `사유: ${reason}`,
            "detailUrl에 data.seoul.go.kr 데이터셋 상세 URL 또는 서비스 ID(예: OA-15529)를 입력하세요.",
        ].join("\n"),
    };
}
export async function getSeoulDatasetDetail(detailUrl) {
    const cacheKey = detailUrl.trim();
    const cached = detailCache.get(cacheKey);
    if (cached) {
        logger.info("상세 캐시 히트", { detailUrl });
        return cached;
    }
    const infId = extractInfId(detailUrl);
    if (!infId) {
        return buildNotFound(detailUrl, "서비스 ID를 URL에서 추출할 수 없습니다.");
    }
    logger.info("데이터셋 상세 조회", { detailUrl, infId });
    const serviceKey = getServiceKey();
    const { items } = await searchSeoulCatalog({ infId, start: 1, end: 1 }, serviceKey);
    const item = items[0];
    if (!item) {
        return buildNotFound(detailUrl, `서비스 ID "${infId}"를 찾을 수 없습니다.`);
    }
    const hasApi = item.srvType
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .includes("api");
    const noteLines = [
        `분류: ${item.cateNm} > ${item.mapCateNm} (${item.ditcNm})`,
        `제공형식: ${item.srvType}${hasApi ? " — OpenAPI 호출 가능" : " — OpenAPI 미제공(파일/시트만 제공될 수 있음)"}`,
        `갱신주기: ${item.chngLoadNm || "미확인"}`,
        `최종갱신일: ${item.dataLtNm || "미확인"}`,
        item.mngStationName ? `담당부서: ${item.mngStationName}` : "",
        item.managerPhone ? `문의처: ${item.managerPhone}` : "",
        item.linkInfo ? `연계 시스템: ${item.linkInfo}` : "",
        `요청 URL 패턴: http://openapi.seoul.go.kr:8088/{인증키}/{xml|json}/{서비스명}/{시작}/{종료}/ — 실제 서비스명·파라미터는 아래 상세페이지의 "Open API" 탭에서 확인하세요.`,
    ].filter(Boolean);
    const result = {
        title: item.infNm,
        provider: [item.mngOrganName, item.mngStationName].filter(Boolean).join(" / "),
        baseUrl: "http://openapi.seoul.go.kr:8088",
        endpoints: [],
        authMethod: "서울 열린데이터광장 인증키 — data.seoul.go.kr 마이페이지에서 발급 후 URL 경로에 포함",
        swaggerUrl: item.shortUrl,
        detailPageUrl: item.shortUrl,
        note: noteLines.join("\n"),
    };
    detailCache.set(cacheKey, result, TTL.DETAIL);
    return result;
}
//# sourceMappingURL=getSeoulDatasetDetail.js.map