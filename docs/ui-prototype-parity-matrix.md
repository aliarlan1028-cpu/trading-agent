# KORDYN 零基 Desktop ↔ APP 一致性矩阵

> 文件名保留用于兼容历史链接；此前不可变 HTML 原型及其纸张/硬边框语法已被用户明确撤销为当前设计基准。本矩阵只验收 2026-08-26 零基 Web3 产品系统，不再主张与任何旧版本视觉一致。

## 基线

- 零基设计规格：`docs/superpowers/specs/2026-08-25-kordyn-zero-base-web3-product-system-design.md`
- 最终生产 UI 源：`c16a13e6bb078504e40bce74a990707248ccdc04`
- 最终浏览器 / 性能 gate 工具：`72eede05773c1679d16a11d0b38714c56f353231`
- 当前 52 张证据树：`b4842c963e78e361713a9f25156672825b735b1f`
- 初始证据批次（历史）：`628aecabe2cd990a74df8aa10e0e7d6f954c1157`
- 精确视口：Desktop 1440×900、1180×800；APP 390×844、430×932

## 页面族矩阵

| ID | 基准任务 | Desktop 实现 | APP 实现 | 交互 / 状态覆盖 | 代表证据 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| F00 | AI 主导但账户、策略、能力、知识与待办首屏可见 | `ZeroBaseToday`，Owner/Trader/Actions | `ZeroBaseMobileToday`，Today/Actions | 真实取得值；unavailable 不伪造 0；待办跳权威页 | `desktop-1440-today.png`、`desktop-1180-today.png`、`mobile-390-today.png`、`mobile-430-today-actions.png` | PASS |
| F01 | 对话、巡检、情报、盯盘、事件、海报属于 AI 交易员 | `AiTraderCenter` + `ChatPage` | AI root + family rail | 巡检 `sessionId=chat_autocycle`；海报 `scope=all`；页面切换保留真实组件 | `desktop-1180-ai-patrol.png`、`desktop-1180-ai-intelligence.png`、`mobile-430-ai-patrol.png`、`mobile-430-ai-poster.png` | PASS |
| F02 | 账户、交易与保护关系直观且语义独立 | `TradingCenter` + Account/Position/Protection concepts | Assets root + account/protection views | account、protection、positions 为不同路由与内容；动作继续受风险合同保护 | `desktop-1180-portfolio-account.png`、`desktop-1180-portfolio-protection.png`、`mobile-430-portfolio-account.png`、`mobile-430-portfolio-protection.png` | PASS |
| F03 | 策略来源、构建与验证在同一产品域 | `StrategyLibraryConcept` / studio / research | strategy registry/detail/validation | 历史验证与 catalog 可独立到达；状态、发布和 Owner 边界不变 | `desktop-1180-strategy.png`、`mobile-430-strategy-historical.png` | PASS |
| F04 | 导入知识与系统知识库、图谱、产物衔接但不混为平行空壳 | `KnowledgeConcept` 六个 section | knowledge import/graph/workflows | Import 与 Graph 语义、组件、空态独立；失败来源不会进入证据包 | `desktop-1180-knowledge-import.png`、`desktop-1180-knowledge-graph.png`、`mobile-430-knowledge-import.png`、`mobile-430-knowledge-graph.png` | PASS |
| F05 | 原生、工作流、MCP、连接器、导入技能统一可发现 | `CapabilitiesConcept` 类型 registry | Intelligent hub 的 capability views | MCP 独立筛选；未知/未授权能力 fail closed | `desktop-1180-capability.png`、`mobile-430-intelligent-hub.png` | PASS |
| F06 | 交易复盘、Owner 优化与候选教训形成学习闭环 | Review / Owner production workbenches | review / owner mobile flows | Lessons 与 Owner 队列独立；发布继续受验证和 Owner 权限限制 | `desktop-1180-reviews.png`、`mobile-430-intelligent-hub.png` | PASS |
| F07 | 风险事实、事件风险、边界与规则一眼可分 | `RiskCenter` 四个独立 view | More → Guard，单一四入口 rail | Event Risk 独立路由；选中 Event 同步 Context/Trace；危险动作不自动提交 | `desktop-1180-guard-events.png`、`mobile-430-event-risk.png` | PASS |
| F08 | 系统健康、任务、输入、恢复、通知、审计统一运维 | `OperationsCenter` | More → native Operations | tasks/runs/recovery/audit 使用既有动作与权限；系统计划只读 | `desktop-1180-operations-tasks.png`、`mobile-430-more-hub.png` | PASS |
| F09 | 所有持久配置只有一个权威归属 | `SettingsConcept` scope directory | More → Configuration | Security 深链接到真实 section；Owner/RBAC/403/保存状态保留 | `desktop-1180-configuration-security.png`、`mobile-430-configuration-security.png` | PASS |

## 交互与视觉合同

| ID | 合同 | Desktop | APP | 证据 / 检查 | 结论 |
| --- | --- | --- | --- | --- | --- |
| X01 | 新视觉系统 | Paper/Ink 主场、Acid 当前/行动、Green 验证、Danger/Amber 风险 | 同 token，按触控重排 | 所有 52 图；`zero-base-visual-contract` | PASS |
| X02 | Web3 语义 | 资产身份、来源、关系图、证据路径、可验证状态 | 同一身份与状态语义 | Today、Knowledge graph、Context/Trace | PASS |
| X03 | Canonical selection | 搜索/页面 registry 选择更新统一 Context 与 Trace | 页面行点击更新全局 sheet 身份 | Event `event-5` 真实浏览器交互；既有 selection gates | PASS |
| X04 | Context / Trace | 有界右侧 dialog，清晰详情与阶段 | 触控 sheet，不做另一套视觉 | `desktop-1180-context-dialog.png`、`desktop-1180-trace-dialog.png`、`mobile-430-context-sheet.png`、`mobile-430-trace-sheet.png` | PASS |
| X05 | 普通确认 | 实际 `AppFrame → ConfirmHost`，方形语义色与可见焦点 | 同一 ConfirmHost 合同 | `desktop-1180-confirm.png`；Tab trap、Esc close、focus return | PASS |
| X06 | 真值状态 | loading/failed/forbidden 不显示 last-valid；stale/degraded 显示 inert last-valid | 同规则 | Desktop 与 APP 各五种 state 图；`aria-disabled=true` | PASS |
| X07 | 对话框可达性 | Marketing auth、Context、Trace、Confirm 都有 labelled dialog、焦点陷阱、Esc 和焦点返回 | Auth 与 sheets 保留触控和键盘合同 | 三套零基 Chrome runners | PASS |
| X08 | 响应式边界 | 1440×900 与 1180×800 无页面横溢 | 390×844 与 430×932 无页面横溢 | runner 逐视口断言 `scrollWidth===clientWidth` | PASS |
| X09 | 性能边界 | 公共/认证 CSS 与大型产品 CSS 分离；无 Google Fonts、canvas、全局 blur | 同一 boot/lazy boundary | build + performance runner | PASS |
| X10 | 营销内容不变 | 既有区块、双语、ticker、demo、登录/订阅/联系均保留 | 移动营销响应式保留 | `marketing-web-1440.png` + landing copy tests | PASS |
| X11 | 认证功能不变、视觉重做 | Web login/register/MFA/auth modal | Native 390/430 login/register/MFA | `auth-*` 六张图 + auth runner | PASS |
| X12 | 移除不属于当前产品的工具 | 搜索/导航/页面无智能表单与 DAO 治理 | tab/More/页面无重复入口 | architecture + retired surface tests | PASS |

## 证据真实性

所有认证后截图都由真实 `AppFrame` / `ZeroBaseDesktopShell` / `MobileApp` 生产组件渲染。浏览器 runner 为稳定、可复跑的视觉与交互验收提供确定性 fixture；fixture 不进入生产代码，也不替换生产 API、权限、动作、错误或路由实现。截图证明的是生产组件在明确输入和状态下的行为，不声称这些数据来自截图当时在线后端。

`c16a13e` 是当前截图对应的最终生产 UI 源；`72eede0` 是 fresh performance build 与自包含 production gate 工具源；`b4842c9` 是当前证据树。`b4842c9` 更新了 24 个发生像素变化的 PNG，另外 28 个路径沿用与 `628aeca` 字节一致的 blob，因此完整 52 图以 `b4842c9` 的提交树核对。旧原型及旧 contact sheet 仅保留在历史提交中，不作为当前零基设计的验收依据。

## 最终计数

- 页面族：10 PASS / 0 GAP / 0 BLOCKED
- 跨端合同：12 PASS / 0 GAP / 0 BLOCKED
- 当前矩阵：22 PASS / 0 GAP / 0 BLOCKED
