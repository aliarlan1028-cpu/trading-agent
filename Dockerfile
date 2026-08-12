ARG APP_RELEASE=dev

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

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
