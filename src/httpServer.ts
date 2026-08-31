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
 *   MCP_AUTH_TOKEN           설정 시 Authorization: Bearer <토큰> 필수
 *   MCP_ALLOWED_HOSTS        쉼표 구분 Host 허용 목록 (DNS 리바인딩 방지)
 *   MCP_ALLOWED_ORIGINS      쉼표 구분 Origin 허용 목록
 */

import "dotenv/config";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createSeoulMcpServer } from "./createServer.js";
import { logger } from "./utils/logger.js";

const PORT = Number(process.env["PORT"] ?? 8080);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const AUTH_TOKEN = process.env["MCP_AUTH_TOKEN"]?.trim();
const MCP_PATH = process.env["MCP_PATH"] ?? "/mcp";

/** 요청 본문 최대 크기 (4MB) */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

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
      docs: "https://github.com/youjin8812-hub/seoul-opendata-mcp",
    });
    return;
  }

  if (url.pathname !== MCP_PATH) {
    sendJson(res, 404, { error: "Not Found", hint: `MCP 엔드포인트는 ${MCP_PATH} 입니다` });
    return;
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
  if (!AUTH_TOKEN) {
    logger.warn("MCP_AUTH_TOKEN이 없어 인증 없이 공개됩니다 — 외부 배포 시 설정을 권장합니다");
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
