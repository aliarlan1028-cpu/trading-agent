# KORDYN 零基产品功能地图

- 最终产品源：`c16a13e6bb078504e40bce74a990707248ccdc04`
- 最终浏览器 / 性能 gate 工具：`72eede05773c1679d16a11d0b38714c56f353231`
- 当前 52 张视觉证据树：`b4842c963e78e361713a9f25156672825b735b1f`
- 初始证据批次（历史）：`628aecabe2cd990a74df8aa10e0e7d6f954c1157`
- 审计日期：2026-08-26
- 范围：营销页、Web/APP 认证、登录后的桌面端和 APP

## 1. 当前产品模型

本轮是零基重构，不继承此前任何桌面或 APP 的信息架构。生产功能、真实数据、权限、动作、错误与恢复语义保持不变，页面名称与归属按用户任务重新组织。

桌面端用 `Core / Intelligent assets / Governance` 三组十个页面族；APP 用 `今日 / AI / 资产 / 智能 / 更多` 五个根入口。AI 交易员是主要操作台，今日首页同时给出 AI 判断、账户、风险、策略、能力、知识和待办，不要求用户先在多个模块中寻找上下文。

`智能表单` 与 `DAO 治理` 已从当前产品模型、导航、搜索、APP 更多及营销产品演示中移除。

## 2. 页面族与真实功能归属

| 页面族 | 桌面入口与生产组件 | APP 入口与生产组件 | 真实路由 / 资源 | 关键能力与动作边界 |
| --- | --- | --- | --- | --- |
| 今日 `today` | `ZeroBaseToday`，Owner / 交易用户首页 / 全部待办 | `ZeroBaseMobileToday`，今日及全部待办 | `today`；账户、AI、策略、能力、知识、任务等已取得数据 | 汇总而不复制编辑器；任何不可用值保持 unavailable；待办继续跳入权威页面 |
| AI 交易员 `ai` | `AiTraderCenter`：对话、自主巡检、情报、盯盘、事件日历、分析海报 | AI 根入口及同族触控 rail | `chat`、`intelligence`、`watch`、`eventsTasks:events` | 对话使用手动 session；巡检严格使用 `chat_autocycle`；海报聚合 `scope=all`；保留发送、证据、工具轨迹、海报语言与 PNG 输出 |
| 账户与交易 `portfolio` | `TradingCenter`：总览、市场、账户、持仓、计划与执行、订单与成交、保护与对账 | 资产根入口，`MobilePortfolioOverview` / `MobilePortfolioProtection` 等 | `cockpit`、`market`、`marketAccount`、`positions`、`executionReview`、`tradeLedger`、`portfolioProtection` | 账户与保护不再是同一视图别名；订单、持仓与执行继续使用现有交易及风险动作、确认和对账语义 |
| 策略 `strategy` | `ResearchCenter` + `StrategyLibraryConcept`：策略库、详情、工作室、内部市场、历史验证、纯前向验证 | 智能入口中的策略 registry / detail / studio / validation | `strategyLib`、`strategyStudio`、`strategyMarket` | 原生、导入和知识生成的已支持策略进入同一来源可见 registry；发布与验证仍使用原权限和状态门槛 |
| 知识 `knowledge` | `KnowledgeConcept`：总览、导入来源、来源证据、关系图谱、提取产物、工作流候选 | 智能入口中的知识来源、图谱与产物视图 | `knowledgeBase` 的 `reference/import/rules/graph/methods/workflows` | 只展示系统现有的 PDF/DOCX/Web/GitHub 导入、解析、概念、候选与转换能力；不声称可生成任意可执行代码 |
| 能力 `capability` | `CapabilitiesConcept`：总览、原生工具、工作流、MCP、连接器、导入技能 | 智能入口中的能力 registry 与详情 | `capabilityLib`，按现有类型过滤 | 原生能力、工作流、MCP、连接器和技能在同一 registry 中按来源与可用性区分；未知工具默认拒绝 |
| 学习与复盘 `reviews` | `TradeReviewWorkbenchConcept` / `OwnerReviewWorkspaceConcept`：交易复盘、详情、Owner 优化、候选教训 | 智能入口中的复盘与 Owner 队列 | `labReviews`、`ownerReviewWorkspace` | 复盘事实与策略/能力候选建立链接但不混成一个库；Owner 发布继续要求原有验证证据与 Owner 权限 |
| 风险与边界 `guard` | `RiskCenter`：风险姿态、事件风险、权限边界、规则监控 | 更多中的风险入口；单一 rail 的四个独立页面 | `riskCenter`、`eventRisk`、`riskMandate`、`riskSettings` | 当前风险事实与配置编辑分离；事件风险不是风险姿态别名；危险动作继续走受保护确认 |
| 系统运维 `operations` | `OperationsCenter`：系统健康、任务与运行、事件源健康、恢复、通知、审计 | 更多中的原生 Operations 任务流 | `operationsCenter` 子路由及 `auditSystem` | 保留任务/运行、重试、恢复、对账、通知确认与不可变审计；系统管理计划仍为只读 |
| 配置 `configuration` | `SettingsConcept`：交易与运行、风险、交易所、环境、网络、备份、安全、通知、事件源、模型、Agent、用户、订阅 | 更多中的 scope-first Configuration | `systemSettings:*` | 所有持久配置集中到一个权威入口；继续使用原端点、Owner/RBAC、保存结果、403 和安全边界 |

## 3. Desktop 与 APP 的共同契约

| 契约 | 当前实现 |
| --- | --- |
| 对象身份 | Market、Position、Plan、Order、Fill、Event、Watch、Strategy product、Strategy、Validation/Paper run、Review、Mandate、Risk incident、Task、Agent run、Audit log 继续走同一 canonical selection；无法解析时 fail closed |
| Context / Trace | Desktop 为右侧有界对话框；APP 为触控 sheet。两端显示同一选中对象的 id、type、workspace、source、route 与证据阶段 |
| 搜索 | 桌面全局对象/功能搜索继续索引真实已取得对象与合法路由；状态、权限或来源失效时不保留旧选择 |
| 配置归属 | 运营页面显示当前有效事实，持久编辑集中在 Configuration，避免同一配置散落多个页面 |
| 状态 | loading、empty、stale、degraded、failed、forbidden、disabled、retry、confirm 和 last-valid 明确区分；stale/degraded 的旧数据不可操作 |
| 交互 | 键盘 focus、Tab、Escape、焦点返回、`aria-current`、dialog 语义、移动触控尺寸与无页面级横向溢出均为硬合同 |
| 数据 | 生产组件仍接收真实 `data`、`action`、`ensureSection`、refresh、权限和路由；浏览器截图使用确定性 fixture 驱动同一生产组件，仅用于可复跑验收 |

## 4. 视觉系统

统一 token 为 Paper `#F4F1E9`、Ink `#111311`、Acid `#CCFF3D`、Green `#4FB78B`、Danger `#E25645`、Amber `#EFB44B`。Web3 感来自资产身份、来源、网络关系、验证路径和证据链，不使用泛紫渐变、玻璃卡片墙、粒子画布或全局模糊。

桌面工作台与 APP 使用同一视觉语义，但不做缩放复制：桌面强调连续工作区、registry/detail 和多列事实；APP 用五个根入口、同族 rail、纵向 disclosure 和有界 sheet 重排。Acid 只表示当前、明确授权或可行动；Green 表示健康/已验证；Danger 与 Amber 只用于对应风险语义。

## 5. 营销与认证边界

- 营销页保持既有内容、区块顺序、双语文案、锚点、ticker、能力/安全演示、登录、订阅、联系与转化行为；只替换色彩与呈现系统。
- Web 与 APP 登录、注册、MFA、邀请、条款、隐私、风险确认、Turnstile、服务地址、订阅与错误行为全部保留，但视觉重新设计。
- Google Fonts 网络请求已移除；初始公共 CSS 与认证后产品 CSS 分开加载，避免把大型工作台样式阻塞营销/登录首屏。

## 6. 明确不扩张的能力边界

- 知识导入只生成系统当前支持的 `strategy_draft`、`knowledge_lens`、`knowledge_workflow`、`imported_skill_record` 等封闭产物，不生成任意执行代码。
- 系统管理任务/计划不可由普通用户任意编辑；用户任务只走已有端点。
- 未知能力、未授权 MCP、过期来源、权限不足及无法解析对象默认拒绝。
- 交易 API、风险判断、授权、确认、审计和成功判定语义未因本轮 UI 重构改变。
