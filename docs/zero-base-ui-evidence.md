# KORDYN 零基 Web3 UI/UX 验收证据

## 1. 来源链

- 设计规格：`docs/superpowers/specs/2026-08-25-kordyn-zero-base-web3-product-system-design.md`
- 实施计划：`docs/superpowers/plans/2026-08-25-kordyn-zero-base-web3-product-system.md`
- 最终生产 UI 源：`c16a13e6bb078504e40bce74a990707248ccdc04`
- 最终浏览器 / 性能 gate 工具：`72eede05773c1679d16a11d0b38714c56f353231`
- 初始 52 张视觉证据集：`628aecabe2cd990a74df8aa10e0e7d6f954c1157`
- 当前 52 张视觉证据树：`b4842c963e78e361713a9f25156672825b735b1f`
- 捕获日期：2026-08-26

`b4842c9` 在最终生产源 `c16a13e` 上更新 24 张发生像素变化的 PNG；另外 28 个路径沿用与 `628aeca` 字节一致的 blob。因而 `b4842c9` 的提交树（而不是单看该提交的 changed-file 数量）是当前完整 52 张证据状态；`628aeca` 只作为此前的初始证据批次保留。

## 2. 验收方法与边界

三套零基 runner 启动隔离 Vite 与本机 Chrome，通过 CDP 设置精确 viewport，导航真实生产组件、点击真实入口、读取 DOM 身份/状态/几何并捕获 PNG。为稳定复跑，认证后组件由测试 fixture 提供确定性输入；fixture 不进入生产 bundle。生产仍使用真实 API、权限、动作、错误、刷新、确认和路由合同。

因此：这些图片是“真实生产组件 + 明确测试输入”的视觉证据，不是“截图当时后端自然返回了这些数据”的声明。loading、failed、forbidden、stale、degraded 同样由真实 `WorkspaceStateBoundary` 以明确资源状态驱动；stale/degraded 的 last-valid surface 必须 `aria-disabled=true`。

## 3. 可复跑命令

```bash
env KORDYN_ZERO_BASE_SCREENSHOT_DIR="$PWD/.impeccable/zero-base/desktop" node tests/run-zero-base-shell-browser.mjs
env KORDYN_ZERO_BASE_MOBILE_SCREENSHOT_DIR="$PWD/.impeccable/zero-base/mobile" node tests/run-zero-base-mobile-browser.mjs
env KORDYN_ZERO_BASE_AUTH_SCREENSHOT_DIR="$PWD/.impeccable/zero-base/auth" node tests/run-zero-base-auth-browser.mjs
node tests/run-zero-base-performance-build.mjs
node tests/run-zero-base-production-gates.mjs
```

最终工程 gate：

```bash
npm test
npm run lint
npm run build
node tests/run-authenticated-shell-browser.mjs
node tests/run-canonical-selection-browser.mjs
node tests/run-zero-base-production-gates.mjs
git diff --check
git status --short
```

`run-zero-base-production-gates.mjs` 是 production selection 与 Event Risk 两个真实壳 gate 的自包含入口：它在规范化系统 `/tmp` 下建立隔离数据根，分配临时端口，启动真实后端与带 API proxy 的 Vite，依次执行两个 Chrome runner，并在 `finally` 中停止服务、删除它拥有的临时目录。无需预先占用 `127.0.0.1:5178`，也不会读取或修改生产数据。

## 4. 视觉资产索引

视觉证据目录共 52 张 PNG；每张都已通过 `sips` 验证宽高为正数。

### Desktop（24 张）

- 1440×900：`desktop-1440-today.png`。
- 1180×800：Today；AI patrol/intelligence；Portfolio account/protection/positions；Strategy；Knowledge overview/import/graph；Capability；Reviews；Guard Event Risk；Operations Tasks；Configuration Security。
- Overlay：`desktop-1180-context-dialog.png`、`desktop-1180-trace-dialog.png`、`desktop-1180-confirm.png`。
- 状态：`desktop-1180-state-loading.png`、`failed`、`forbidden`、`stale`、`degraded`。

### APP（22 张）

- 390×844：Today；loading、failed、forbidden、stale、degraded。
- 430×932：Today/Actions；AI patrol/poster/intelligence；Intelligent/More hubs；Portfolio account/protection；Strategy historical；Knowledge import/graph；Event Risk；Configuration Security；Context/Trace sheets。

### Marketing 与认证（6 张）

- Marketing 1440×900。
- Web authentication modal 1440×900。
- Native authentication 1440×900、390×844、430×932；注册 430×932。

## 5. 真实浏览器覆盖

Desktop runner 验证：

- 1440×900 与 1180×800 无 document overflow。
- Today/Actions、AI Patrol/Poster/Intelligence、Portfolio Account/Protection/Positions、Strategy Historical、Knowledge Import/Graph/Workflows、Capability MCP、Reviews Lessons、Guard Events、Operations Tasks、Configuration Security 的生产组件导航。
- 巡检请求 `sessionId=chat_autocycle`；海报请求 `scope=all`。
- Context、Trace、普通 Confirm 的 focus containment、Escape close 与 focus return。
- 搜索选择 `Event:event-5` 后 Context/Trace identity 同步。
- loading、failed、forbidden 不显示 last-valid；stale/degraded 显示不可操作的 last-valid。

APP runner 验证：

- 390×844 与 430×932 无 document overflow。
- 五根入口与每个页面族的代表子页面；root tab 不在 More 重复。
- Today/Actions、Portfolio Account/Protection、Knowledge Import/Graph 等语义独立页面。
- Event selection、Context/Trace sheet、状态边界及真实组件触控交互。

Auth runner 验证：

- 1440、390、430 的 login/MFA/register，以及 Web 营销认证弹窗。
- 对话框标签、初始 focus、Tab containment、Escape 关闭与 focus return。

## 6. 性能与构建记录

当前构建采用公共/认证 CSS 与认证后产品 CSS 分离加载。最终 fresh 构建观测：

- 初始 CSS：15.30 KB raw / 3.75 KB gzip。
- 认证后产品 CSS：843.66 KB raw / 141.38 KB gzip。
- 初始主 JS：369.88 KB raw / 122.02 KB gzip。
- 无新增 runtime dependency，无 Google Fonts 请求，无粒子 canvas、全局 blur 或无界动画。

## 7. 最终裁决

- `npm test`：1675 / 1675 PASS。
- `npm run lint`：PASS。
- `npm run build`：PASS；1645 modules transformed。
- 八套浏览器 / 性能 gate：零基 Desktop、零基 APP、零基 Auth、fresh performance build、authenticated lifecycle、canonical selection、production selection、Event Risk 全部 PASS；后两项由自包含 production wrapper 一次启动隔离服务后执行。
- 精确视口：Desktop 1440×900、1180×800（认证生命周期另含 1180×820）；APP 390×844、430×932，均无 document overflow。
- 触控合同：390/430 的 APP Objects / Context / Trace 工具栏实测高度 44px；底部五根入口实测高度 66px。
- 视觉资产：52 / 52 PNG 宽高为正；关键桌面、APP、认证、营销、Confirm、Context、Trace 与状态图已人工打开抽查。
- `git diff --check`：PASS。
- 独立只读审查：Critical 0 / Important 0 / Minor 0，结论 APPROVE。最终 clean status 在本文件提交后由交付命令核对。
