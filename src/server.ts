#!/usr/bin/env node
/**
 * Seoul Open Data API Finder — stdio 진입점
 *
 * Claude Desktop / Claude Code / Cursor 등 로컬 MCP 클라이언트와 stdio로 통신한다.
 * 원격(HTTP) 배포용 진입점은 src/httpServer.ts 참고.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSeoulMcpServer } from "./createServer.js";
import { logger } from "./utils/logger.js";

async function main() {
  const server = createSeoulMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Seoul Open Data API Finder MCP 서버 시작됨 (stdio)");
}

main().catch((err) => {
  logger.error("서버 시작 실패", err);
  process.exit(1);
});
