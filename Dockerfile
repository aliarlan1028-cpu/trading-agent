ARG APP_RELEASE=dev

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 normally downloads a prebuilt binary. Production builds must still
# survive a transient prebuild CDN failure, so keep the native toolchain only in
# the dependency stage and let node-gyp compile from source when necessary.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
ARG APP_RELEASE
ENV VITE_APP_RELEASE=${APP_RELEASE}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM deps AS runtime-deps
# Reuse the already-installed native dependency tree instead of launching a
# second npm ci in parallel with the frontend build on the small production VM.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ARG APP_RELEASE
WORKDIR /app
ENV NODE_ENV=production
ENV APP_RELEASE=${APP_RELEASE}
# 字体:slim 镜像不带字体+fontconfig,导致 sharp/librsvg 渲染海报 SVG 的 <text> 全空白
# (数字/标签渲染不出来)。装 DejaVu(拉丁/数字)+ Noto CJK(中文)+ fontconfig 修复。
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig fonts-dejavu-core fonts-noto-cjk \
    && fc-cache -f && rm -rf /var/lib/apt/lists/*
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY public/kordyn-logo.svg ./public/kordyn-logo.svg
COPY scripts ./scripts
COPY package*.json ./
USER node
EXPOSE 8787
CMD ["npm", "run", "server"]
