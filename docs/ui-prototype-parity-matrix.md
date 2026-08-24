# KORDYN Prototype → Desktop → APP 一致性矩阵

基准锁定：`codex/kordyn-interactive-prototype` / commit `1056233` / `prototypes/kordyn-operating-system.html` / blob `43267ccfca051351823c668932c857350fb592b9`。规格基准为同提交中的 `docs/superpowers/specs/2026-08-21-kordyn-interactive-operating-system-prototype-design.md`。

本矩阵不是主题色清单。它逐项约束原型的空间骨架、对象语法、交互层级和状态表达。生产实现始终使用真实数据、权限、动作和错误边界；“结构已接入”不等于“视觉已验收”。

结论枚举：`PASS` / `GAP` / `BLOCKED` / `PENDING VISUAL`。首次落库记录当前已知状态，Task 7–9 逐项关闭并附视觉证据。

| ID | 原型基准元素 | Desktop 实现位置 | APP 实现位置 | 交互 / 状态覆盖 | 当前视觉差异 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| G01 | 精确语义色板：Paper `#F4F1E9`、Ink `#111311`、Dark `#111511`、Acid `#CCFF3D`、Mint `#4FB78B`、Danger `#E25645`、硬线 | `src/product-foundation.css`, `src/product-system.css` | `src/styles.css` | 当前、健康、危险、阻断均有文字语义 | 主 token 大体存在，但局部 legacy/raw 状态色尚未逐块审计 | GAP |
| G02 | Display / Sans / Mono 三层字体；大标题、正文、ID/时间各司其职 | `src/product-foundation.css`, 各 workspace header | `src/styles.css`, mobile masthead/metadata | 中英文、价格、ID、时间均有不同语义 | 尚未按原型字号、行高、字距逐视口比对 | PENDING VISUAL |
| G03 | 高密度连续网格、1px 硬边界、矩形操作面；非卡片墙 | `productWorkspaceFrame`, `kWorkbench`, workspace CSS | `mWorkspaceRail`, `mNativeSection`, shared roles | hover/focus/active 已有结构规则 | 多个深页已收敛，仍需截图确认旧圆角/浮卡残留 | PENDING VISUAL |
| G04 | 顶部 Command Rail：品牌、全局搜索、连接/新鲜度、模式、Watch、通知、Flatten、Kill | `src/main.jsx` `AppTopbar`, `src/styles.css` | `src/mobile.jsx` 顶部壳与安全动作 | 真实 OKX、运行模式、通知、Flatten、Kill；确认链接真实 API | Desktop 信息存在但排列/密度尚未证明严格复刻；APP 为触屏重排待比对 | GAP |
| G05 | 编号 Workspace Rail：当前近黑、酸绿边、职责说明 | 桌面主导航 + `src/productArchitecture.js` | bottom tabs + `MobileWorkspaceRail` | Desktop 五工作区；APP `AI/Live/Lab/Control/More`，本地 rail 可达 | Desktop/APP 当前选择、编号、职责说明与原型形态待截图核验 | PENDING VISUAL |
| G06 | 共享 Context Dock：Evidence/Risk/Mandate/Object/Version/Permissions，不在页面重复造卡 | `ProductWorkspaceFrame` inspector、`ObjectInspector`；各深页仍有局部 inspector | mobile details/sheets/inspector disclosure | 选择对象、权限和下一动作已有真实字段 | 没有被证明为持续共享的右侧 Dock；APP sheet 形态也未对照原型 | GAP |
| G07 | 底部 Trace Rail：Sense→Recall→Plan→Guard→Execute→Monitor→Review，可展开 | 分散在 decision chain、execution path、audit/run trace | mobile evidence/trace sheets | 阶段事实在多个工作区存在 | 缺少全局持续可达的 Trace Rail/触屏等价入口 | GAP |
| G08 | 编辑式 Page Head + 紧凑 workspace toolbar/local modes | `ProductWorkspaceFrame__header/__nav` | `MobileWorkspaceRail` + native page heads | 路由、active、focus 可用 | 字号、留白、边界与原型工具栏密度待视觉比对 | PENDING VISUAL |
| G09 | 近黑 Truth / Decision / Execution / Risk 区，只承载权威当前事实 | `kTruthBand`, AI Command, Live/Control/Operations truth surfaces | mobile truth bands | unavailable 不伪造 0；正负/阻断语义已测试 | 需核对使用范围是否过多/过少及内部对比度 | PENDING VISUAL |
| G10 | Acid 仅用于当前、授权、待行动和 Guard | shared active/action tokens | active bottom/local rail and authorized actions | hover/focus/danger 分层已覆盖 | 仍需检查所有 workspace 是否存在装饰性滥用 | PENDING VISUAL |
| G11 | Registry：密集对象行、状态、来源、时间、下一步 | `kRegistry`, Lab/Live/Operations registries | `kRegistry`, native lists | 真实对象、空状态、筛选、选择 | 行高、列密度与 hover/selected 需并列截图 | PENDING VISUAL |
| G12 | Inspector：选中对象上下文与允许动作 | `kInspector`, `ObjectInspector`, workspace inspectors | details/sheets | 权限、版本、来源、风险、动作 | Desktop shared-dock 关系与 APP sheet chrome 未严格对齐 | GAP |
| G13 | Evidence Ledger / audit / run records | `kEvidenceLedger`, audit/review/execution ledgers | native ledgers | 时间、版本、来源、费用、审计状态真实 | 视觉密度与展开层级待核验 | PENDING VISUAL |
| G14 | 全局对象搜索 / Object Switcher，结果行可跳对象/功能 | `AppTopbar` 搜索输入 | APP 搜索/当前导航能力 | Desktop 当前输入尚未证明完整对象切换闭环 | 原型有浮层结果与类型/ID；生产差异明显 | GAP |
| G15 | 抽屉 / sheet：硬边界、近黑遮罩、对象详情，不丢字段 | Desktop panels/modals；各 workspace detail | mobile More drawer、patrol/detail/config sheets | 打开/关闭、真实动作、长内容 | 需对照遮罩、边界、标题、sticky action、滚动 | PENDING VISUAL |
| G16 | 普通 modal：矩形、1px 边界、酸绿偏移阴影、明确 action row | `ConfirmHost`, account/config modals | `modalOverlay`, native dialogs | cancel/confirm/busy/disabled | 当前 modal 体系未按原型逐项比对 | GAP |
| G17 | 危险确认：Danger 偏移、影响范围、会做/不会做、输入确认、结果与审计 ID | Flatten `uiConfirm`, `KillConfirmDialog`, recovery/risk actions | 同一真实动作的 mobile confirm | Kill/Flatten 语义分离；部分结果依赖后端刷新 | 需核对影响说明、typed confirm、审计结果呈现是否完整 | GAP |
| G18 | Loading / empty / stale / failed / forbidden / disabled 独立表达 | `WorkspaceStateBoundary`, component states | mobile native state boundaries | 结构测试覆盖多状态；真实失败不乐观成功 | 尚无每种状态的真实截图证据 | BLOCKED |
| G19 | Desktop focus 清晰；APP touch target ≥40–44px | shared focus rules/action bars | 44px local rail/actions | 键盘/触摸契约存在 | 需真实 tab/触摸和截图检查遮挡 | PENDING VISUAL |
| G20 | 长中英文、ID、URL 可换行且无页面级横向溢出 | shared containment / empty-state rules | mobile `overflow-wrap`/horizontal local rail | 结构契约存在 | 未在指定视口注入长内容做视觉证据 | BLOCKED |
| W01 | Command / AI：Situation + Intelligence + Watch + Decisions；AI 输入是任务条 | `src/chat.jsx`, `IntelligenceConcept`, `WatchMonitorConcept` | `MobileIntelligence`, `MobileWatch`, `MobileTasks`, chat | 真实巡检、海报、情报、盯盘、事件、确认动作 | 功能完整，但原型三列 operations + Command/Context/Trace 空间关系未证明 | GAP |
| W02 | Live Desk：Market Canvas + Plan Ladder + Exposure + Positions/Orders/Fills/Protection/Trace | `MarketConcept`, `PositionsConcept`, `ExecutionLedgerConcept`, `ExecutionReviewConcept` | `MobileMarket`, `MobilePositions`, `MobileExecution` | 真实订单/成交/持仓/保护/对账对象分离 | 深页角色已收敛，整体 desk topology 与原型并列差异待处理 | PENDING VISUAL |
| W03 | Lab：Library/Strategies/Validations/Learn/Capabilities，Registry + Provenance Inspector | Lab map/knowledge/strategy/capability/review/owner in `conceptPages.jsx` | native Lab registries/sheets in `mobile.jsx` | 双来源、验证、实盘证据、Owner 发布真实 | 代码审查进行中；完整 Lab overview 与原型 research band 待视觉审查 | PENDING VISUAL |
| W04 | Control：明确姿态、预算、Mandate、Rules、Incidents、四类安全动作 | risk/control views | `riskHub` local destinations | Control 只读；持久编辑在 Configuration；真实确认 | 原型 posture banner/safety band 的布局与状态强度未比对 | GAP |
| W05 | Run Control：拓扑、Agent/任务/连接、Run dossier、事件/通知/审计 | Operations command/tasks/recovery/audit/inbox | `mobileOperations.jsx` | 真实系统健康、任务、恢复、审计、通知 | Operations 是当前参考实现，但仍需对照原型 Context/Trace/拓扑密度 | PENDING VISUAL |
| W06 | Administration：scope-first registry、Secure Session、配置审计 | Configuration workspace / `workspacePages.jsx` | More → Configuration deep forms | durable editor 唯一归属、真实 save/error/disabled | 多个旧子表单可能仍为 legacy card/form，需要全路由截图 | GAP |
| R01 | 原型与生产 Desktop 1440×900 | 待 `.impeccable/review/prototype-1440x900.png` / `desktop-1440x900.png` | 不适用 | 关键工作区/overlay/modal/danger | 尚未生成 final-HEAD 并列证据 | BLOCKED |
| R02 | 生产中等桌面宽度 | 待 `.impeccable/review/desktop-medium.png` | 不适用 | Context Dock 转侧层、网格重排 | 尚未验证 | BLOCKED |
| R03 | APP 390×844 | 不适用 | 待 `.impeccable/review/mobile-390x844.png` | 工作区、drawer/sheet/modal/danger/长内容/状态 | 尚未用可设 viewport 的浏览器验证 | BLOCKED |
| R04 | APP 430×932 | 不适用 | 待 `.impeccable/review/mobile-430x932.png` | 同上，并验证更宽手机下密度 | 尚未验证 | BLOCKED |
| R05 | 并列差异记录 / contact sheet | 待 `.impeccable/review/parity-contact-sheet.png` | 同一证据集 | 每项关联矩阵 ID | 尚未生成 | BLOCKED |

## 视觉证据索引

Task 8 完成前本节不得写 `PASS`。每张图必须记录最终生产 HEAD、视口、路由、状态与关联矩阵 ID；原型图记录 commit `1056233`。

| 文件 | HEAD / 基准 | 视口 | 路由 / 状态 | 覆盖矩阵 ID | 结果 |
| --- | --- | --- | --- | --- | --- |
| `.impeccable/review/prototype-1440x900.png` | `1056233` | 1440×900 | 待捕获 | G01–G17, W01–W06 | BLOCKED |
| `.impeccable/review/desktop-1440x900.png` | 待最终 HEAD | 1440×900 | 待捕获 | G01–G20, W01–W06 | BLOCKED |
| `.impeccable/review/desktop-medium.png` | 待最终 HEAD | 待记录 | 待捕获 | G03–G20 | BLOCKED |
| `.impeccable/review/mobile-390x844.png` | 待最终 HEAD | 390×844 | 待捕获 | G04–G20, W01–W06 | BLOCKED |
| `.impeccable/review/mobile-430x932.png` | 待最终 HEAD | 430×932 | 待捕获 | G04–G20, W01–W06 | BLOCKED |
| `.impeccable/review/parity-contact-sheet.png` | 基准 + 最终 HEAD | 并列 | 待生成 | 全部 | BLOCKED |
