/**
 * 서울 열린데이터광장(data.seoul.go.kr) 자체 카탈로그 API — SearchCatalogService
 *
 * 요청 URL 패턴 (GET):
 *   http://openapi.seoul.go.kr:8088/{인증키}/{xml|json}/SearchCatalogService/{시작}/{종료}/{서비스ID}/{서비스명 키워드}/{제공기관명}/
 *
 * - 시작/종료: 1-base 인덱스 범위 (예: 1/5 → 5건)
 * - 서비스ID/서비스명/제공기관명: 비워둘 땐 공백(" ")을 그대로 보낸다 (빈 문자열이면 404)
 * - 응답: 정상 시 { SearchCatalogService: { list_total_count, RESULT, row: [...] } }
 *         결과 없음/오류 시 { RESULT: { CODE, MESSAGE } } (오류는 json 요청에도 XML로 오기도 함)
 */
import { logger } from "../utils/logger.js";
import { fetchWithRetry } from "../utils/retry.js";
const BASE_URL = "http://openapi.seoul.go.kr:8088";
const SERVICE_NAME = "SearchCatalogService";
function encodeSegment(value) {
    const trimmed = value?.trim();
    return encodeURIComponent(trimmed && trimmed.length > 0 ? trimmed : " ");
}
function mapRow(row) {
    return {
        infId: String(row["INF_ID"] ?? ""),
        infNm: String(row["INF_NM"] ?? ""),
        cateNm: String(row["CATE_NM"] ?? ""),
        ditcNm: String(row["DITC_NM"] ?? ""),
        mapCateNm: String(row["MAP_CATE_NM"] ?? ""),
        mngOrganName: String(row["MNG_ORGAN_NAME"] ?? ""),
        mngStationName: String(row["MNG_STATION_NAME"] ?? ""),
        linkDesc: String(row["LINK_DESC"] ?? ""),
        linkInfo: String(row["LINK_INFO"] ?? ""),
        managerName: String(row["MANAGER_NAME"] ?? ""),
        managerPhone: String(row["MANAGER_PHONE"] ?? ""),
        chngLoadNm: String(row["CHNG_LOAD_NM"] ?? ""),
        dataLtNm: String(row["DATA_LT_NM"] ?? ""),
        srvType: String(row["SRV_TYPE"] ?? ""),
        shortUrl: String(row["SHORT_URL"] ?? ""),
    };
}
/** 인증 오류 등은 json 요청에도 XML로 응답하는 경우가 있어 정규식으로 폴백 파싱한다 */
function parseXmlResultFallback(text) {
    const codeMatch = text.match(/<CODE>([^<]*)<\/CODE>/);
    if (!codeMatch)
        return null;
    const msgMatch = text.match(/<MESSAGE>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/MESSAGE>/);
    return {
        RESULT: {
            CODE: codeMatch[1].trim(),
            MESSAGE: (msgMatch?.[1] ?? "").trim(),
        },
    };
}
export async function searchSeoulCatalog(options, apiKey, fetchFn = fetch) {
    const { start = 1, end = 20, infId, keyword, orgName } = options;
    // API 제약: 한 번 요청에 최대 1,000건까지만 허용 (초과 시 ERROR-336)
    const clampedEnd = Math.min(end, start + 999);
    const url = [
        BASE_URL,
        apiKey,
        "json",
        SERVICE_NAME,
        String(start),
        String(clampedEnd),
        encodeSegment(infId),
        encodeSegment(keyword),
        encodeSegment(orgName),
        "",
    ].join("/");
    logger.info("searchSeoulCatalog 호출", { start, end, infId, keyword, orgName });
    let res;
    try {
        res = await fetchWithRetry(url, { method: "GET", headers: { Accept: "application/json" } }, { maxAttempts: 3, baseDelayMs: 500, timeoutMs: 8000, fetchFn });
    }
    catch (err) {
        logger.error("네트워크 오류", err);
        throw new Error(`서울 열린데이터광장 API 네트워크 오류: ${String(err)}`);
    }
    const text = await res.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        const fallback = parseXmlResultFallback(text);
        if (!fallback) {
            throw new Error(`서울 열린데이터광장 API 응답을 해석할 수 없습니다 (HTTP ${res.status})`);
        }
        parsed = fallback;
    }
    const wrapper = parsed[SERVICE_NAME] ?? parsed;
    const result = wrapper["RESULT"] ?? {};
    const code = String(result["CODE"] ?? "");
    const message = String(result["MESSAGE"] ?? "알 수 없는 오류");
    if (code === "INFO-200") {
        return { items: [], totalCount: 0 };
    }
    if (code !== "INFO-000") {
        logger.error("카탈로그 API 오류 응답", { code, message });
        if (code === "INFO-100" || message.includes("인증키")) {
            throw new Error(`서울 열린데이터광장 인증키 오류: ${message}. data.seoul.go.kr에서 발급받은 인증키가 맞는지 확인하세요.`);
        }
        throw new Error(`서울 열린데이터광장 API 오류 [${code}]: ${message}`);
    }
    const rows = Array.isArray(wrapper["row"])
        ? wrapper["row"]
        : [];
    return {
        items: rows.map(mapRow),
        totalCount: Number(wrapper["list_total_count"] ?? rows.length),
    };
}
export function getServiceKey() {
    const key = process.env["SEOUL_OPEN_DATA_API_KEY"];
    if (!key) {
        throw new Error("SEOUL_OPEN_DATA_API_KEY 환경변수가 설정되지 않았습니다.");
    }
    return key;
}
//# sourceMappingURL=seoulCatalogService.js.map