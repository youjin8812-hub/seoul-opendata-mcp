#!/usr/bin/env node
/**
 * Seoul Open Data API Finder — Streamable HTTP 진입점 (원격 배포용)
 *
 * Fly.io·Render·Cloud Run 등 어디에 올리든 동일하게 동작하는 MCP Streamable HTTP 서버.
 * 무상태(stateless) 모드로, 요청마다 Server·Transport 인스턴스를 새로 만들어
 * 여러 머신으로 수평 확장해도 세션이 특정 인스턴스에 묶이지 않는다.
 *
 * 엔드포인트
 *   POST /mcp      MCP JSON-RPC 요청 (Streamable HTTP)
 *   GET  /healthz  헬스체크 (배포 플랫폼용)
 *   GET  /         서버 소개 JSON
 *
 * 환경변수
 *   SEOUL_OPEN_DATA_API_KEY  (필수) 서울 열린데이터광장 인증키
 *   PORT                     리스닝 포트 (기본 8080)
 *   MCP_AUTH_TOKEN           (선택) 설정 시 Authorization: Bearer <토큰> 필수.
 *                            공개 서버에서는 비워두고 아래 요청 제한으로 보호한다.
 *   MCP_RATE_LIMIT_PER_MIN   IP당 분당 요청 수 (기본 60, 버스트는 2배)
 *   MCP_RATE_LIMIT_PER_DAY   IP당 하루 요청 수 (기본 2000)
 *   SEOUL_API_DAILY_BUDGET   상위 API 전역 일일 호출 상한 (기본 50000, 0이면 해제)
 *   MCP_ALLOWED_HOSTS        쉼표 구분 Host 허용 목록 (DNS 리바인딩 방지)
 *   MCP_ALLOWED_ORIGINS      쉼표 구분 Origin 허용 목록
 */

import "dotenv/config";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createSeoulMcpServer } from "./createServer.js";
import { logger } from "./utils/logger.js";
import { RateLimiter } from "./utils/rateLimiter.js";
import { seoulApiQuota } from "./utils/dailyQuota.js";

const PORT = Number(process.env["PORT"] ?? 8080);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const AUTH_TOKEN = process.env["MCP_AUTH_TOKEN"]?.trim();
const MCP_PATH = process.env["MCP_PATH"] ?? "/mcp";

/** 요청 본문 최대 크기 (4MB) */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * 토큰 없이 공개된 서버를 보호하는 IP 단위 제한.
 *
 * 서울 열린데이터광장 일반 오픈API에는 호출 횟수 제한이 없으므로, 이 제한이
 * 지키는 대상은 인증키 한도가 아니라 이 서버가 올라간 머신(shared-cpu-1x)이다.
 * 사람이 대화하며 쓰는 속도보다 한참 넉넉하고, 스크립트 난사만 걸린다.
 */
const rateLimiter = new RateLimiter({
  perMinute: envInt("MCP_RATE_LIMIT_PER_MIN", 60),
  perDay: envInt("MCP_RATE_LIMIT_PER_DAY", 2000),
});

// 오래된 버킷 정리 (10분마다) — 프로세스 종료를 막지 않도록 unref
setInterval(() => rateLimiter.prune(), 10 * 60 * 1000).unref();

/** 프록시(Fly.io 등) 뒤에서 실제 클라이언트 IP를 찾는다. */
function clientIp(req: http.IncomingMessage): string {
  const flyIp = req.headers["fly-client-ip"];
  if (typeof flyIp === "string" && flyIp.trim()) return flyIp.trim();

  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  if (first) return first;

  return req.socket.remoteAddress ?? "unknown";
}

function splitList(value: string | undefined): string[] | undefined {
  const items = (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const allowedHosts = splitList(process.env["MCP_ALLOWED_HOSTS"]);
const allowedOrigins = splitList(process.env["MCP_ALLOWED_ORIGINS"]);

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** JSON-RPC 규격 오류 응답 (id를 알 수 없는 단계이므로 id: null) */
function sendRpcError(res: http.ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() === AUTH_TOKEN;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("요청 본문이 너무 큽니다"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleMcpPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let parsedBody: unknown;
  try {
    const raw = await readBody(req);
    parsedBody = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendRpcError(res, 400, -32700, `요청 본문을 해석할 수 없습니다: ${message}`);
    return;
  }

  // 무상태 모드: 요청마다 새 서버·전송 인스턴스를 만들고 응답 후 정리한다.
  const server = createSeoulMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableDnsRebindingProtection: Boolean(allowedHosts || allowedOrigins),
    ...(allowedHosts ? { allowedHosts } : {}),
    ...(allowedOrigins ? { allowedOrigins } : {}),
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    logger.error("MCP 요청 처리 실패", err);
    if (!res.headersSent) {
      sendRpcError(res, 500, -32603, "서버 내부 오류");
    } else {
      res.end();
    }
  }
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  if (url.pathname === "/healthz" || url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      apiKeyConfigured: Boolean(process.env["SEOUL_OPEN_DATA_API_KEY"]),
      quota: seoulApiQuota.status(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/" && method === "GET") {
    sendJson(res, 200, {
      name: "seoul-opendata-mcp",
      version: "1.0.0",
      transport: "streamable-http",
      endpoint: MCP_PATH,
      authRequired: Boolean(AUTH_TOKEN),
      limits: {
        perIpPerMinute: envInt("MCP_RATE_LIMIT_PER_MIN", 60),
        perIpPerDay: envInt("MCP_RATE_LIMIT_PER_DAY", 2000),
        sharedApiCallsPerDay: seoulApiQuota.status().budget,
        note: "서버 보호용 제한입니다. 대화하며 쓰는 정도로는 걸리지 않습니다",
      },
      quota: seoulApiQuota.status(),
      docs: "https://github.com/youjin8812-hub/seoul-opendata-mcp",
    });
    return;
  }

  if (url.pathname !== MCP_PATH) {
    sendJson(res, 404, { error: "Not Found", hint: `MCP 엔드포인트는 ${MCP_PATH} 입니다` });
    return;
  }

  // 토큰을 설정한 서버에서는 인증된 요청이 IP 제한을 면제받는다.
  if (!AUTH_TOKEN) {
    const decision = rateLimiter.check(clientIp(req));
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSec ?? 60));
      const message =
        decision.reason === "per_day"
          ? `이 IP의 하루 요청 한도를 초과했습니다. 한국시간 자정에 초기화됩니다.`
          : `요청이 너무 잦습니다. ${decision.retryAfterSec ?? 60}초 후 다시 시도해 주세요.`;
      sendRpcError(res, 429, -32002, message);
      return;
    }
  }

  if (!isAuthorized(req)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="seoul-opendata-mcp"');
    sendRpcError(res, 401, -32001, "인증이 필요합니다 (Authorization: Bearer <MCP_AUTH_TOKEN>)");
    return;
  }

  if (method === "POST") {
    void handleMcpPost(req, res);
    return;
  }

  // 무상태 모드에서는 서버→클라이언트 스트림(GET)과 세션 종료(DELETE)를 지원하지 않는다.
  res.setHeader("Allow", "POST");
  sendRpcError(res, 405, -32000, "이 서버는 무상태 모드이며 POST만 지원합니다");
});

httpServer.listen(PORT, HOST, () => {
  if (!process.env["SEOUL_OPEN_DATA_API_KEY"]) {
    logger.warn("SEOUL_OPEN_DATA_API_KEY가 설정되지 않았습니다 — 모든 도구 호출이 실패합니다");
  }
  const quota = seoulApiQuota.status();
  if (AUTH_TOKEN) {
    logger.info("MCP_AUTH_TOKEN이 설정되어 인증된 요청만 허용합니다 (IP 제한 면제)");
  } else {
    logger.info("토큰 없이 공개 운영 중 — IP 제한과 일일 예산으로 보호합니다", {
      perMinute: envInt("MCP_RATE_LIMIT_PER_MIN", 60),
      perDay: envInt("MCP_RATE_LIMIT_PER_DAY", 2000),
      sharedApiBudget: quota.budget,
    });
  }
  process.stderr.write(`[INFO] Seoul Open Data MCP 서버 시작됨 (http://${HOST}:${PORT}${MCP_PATH})\n`);
});

function shutdown(signal: string): void {
  process.stderr.write(`[INFO] ${signal} 수신 — 서버를 종료합니다\n`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
