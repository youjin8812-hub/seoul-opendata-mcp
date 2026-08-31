# ─── 빌드 단계 ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# 런타임에 필요한 의존성만 남긴다
RUN pnpm prune --prod

# ─── 실행 단계 ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node
EXPOSE 8080

# 배포 환경에서는 Streamable HTTP 전송을 사용한다 (stdio는 로컬 전용)
CMD ["node", "dist/httpServer.js"]
