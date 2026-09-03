# 交易驾驶舱五页参考稿高保真重构设计

## 1. 目标与验收口径

本次只重构桌面端“交易驾驶舱”的五个生产页面：总览、行情、持仓、执行与复盘、委托与成交。仓库根目录 `交易驾驶舱参考图/` 中五张 1448×1086 最终稿是布局、组件形态、密度和视觉层级的唯一 Source of Truth；需求附件定义真实能力与状态边界。

本轮不是在现有实现上继续“补卡片”。现有 `src/aug15/tradingCockpit.jsx` 只保留路由接线、真实数据消费、动作与可访问性行为作为产品事实，页面内部按参考稿重新拆解。目标是在 1440×1080 的实际浏览器视口中，让页面结构、区域比例、字号层级、表格密度、图表占比、边线、圆角、颜色和留白与对应参考图达到肉眼可直接确认的高保真一致。

验收不以测试通过代替视觉通过。每页必须具有：同尺寸参考图、同尺寸生产组件截图、逐区域对照记录，以及真实/空/加载状态证据。

## 2. 不可变业务边界

不修改 API contract、数据库、鉴权、权限、交易逻辑、Agent 逻辑、风控逻辑、订单执行、OKX/WebSocket 所有权、账户计算、状态语义、现有路由或移动端。

- 页面继续消费现有 `data`、`action` 与 `ui`。
- 参考稿中的示例数字、币种、订单、持仓和绩效不得写入生产代码。
- 生产页面只展示真实数据；缺失字段显示诚实的不可用/待同步状态。
- 允许在浏览器验证 harness 中使用 production-shaped deterministic fixtures；这些 fixtures 不进入生产 bundle，不调用生产写接口。
- 参考图中若存在当前系统不具备的业务动作，不制作可点击的假动作。纯展示组件、页面内筛选、分页、展开、全屏和选中态可以实现；它们不得改变服务端状态。
- 危险动作继续调用既有 `executionExitAction` 与 `requestExecutionExit`，不增加新交易权限。

## 3. 当前差距与纠正策略

| 问题 | 当前证据 | 本轮纠正 |
|---|---|---|
| 分析视觉层缺失 | 总览与行情主图为空；其余页面主要使用通用表格、进度条与单线折线 | 接通验证环境 K 线；新增成交量、配置环、风险仪表、市场宽度、盈亏分布、累计收益曲线和执行链路等专属图形 |
| 组件级复刻不足 | 只有 Hero、左右栏、列表/详情等大骨架接近 | 按参考稿逐区域建立明确组件与数据来源，禁止以通用 `Panel` 替代页面特有结构 |
| 数据密度不足 | harness 只有 3 持仓、4 复盘、4 委托、3 成交 | 测试环境扩充为参考稿量级的 production-shaped fixtures；生产仍只使用真实行数 |
| 固定高度制造空白 | 373–515px 内容面板和 480px 订单列表放大稀疏数据 | 1440 主视口按参考比例定高；内容不足时使用结构化空态，其他宽度按内容和容器自适应 |
| 字体与层级偏弱 | 大量 8.5–10.5px 标签、重复白卡、数字权重不足 | 正文/表格提高到可读的 11–13px；关键资产数字 28–36px；降低无意义容器层级，强化数字与图形关系 |
| 图表验证接线错误 | fixture 有 candle samples，但 `TradingViewChart` 请求 `/api/market/klines` | 测试 harness 拦截并返回同 schema 的 K 线响应；生产继续调用真实接口，不给生产组件注入假行情 |

## 4. 代码与组件边界

保留 `src/aug15/tradingCockpit.jsx` 作为稳定导出入口，避免改变 `workspacePages.jsx` 的消费接口。内部拆分为职责清晰的模块：

- `src/aug15/tradingCockpit/shared.jsx`：Header、Tabs、Panel frame、Metric、Badge、Empty、table primitives、可访问交互。
- `src/aug15/tradingCockpit/visuals.jsx`：Donut、Gauge、Sparkline、AreaTrend、Distribution、BreadthBars；所有图形只消费传入数据，不自行制造业务事实。
- `src/aug15/tradingCockpit/model.js`：只做展示层 selector 和身份关联，统一 position/order/fill/review/trade-plan 的 canonical identity；不改变 `viewData.js` 的业务计算。
- `src/aug15/tradingCockpit/OverviewPage.jsx`。
- `src/aug15/tradingCockpit/MarketPage.jsx`。
- `src/aug15/tradingCockpit/PositionsPage.jsx`。
- `src/aug15/tradingCockpit/ReviewPage.jsx`。
- `src/aug15/tradingCockpit/LedgerPage.jsx`。
- `src/aug15/tradingCockpit.css`：五页独立视觉系统、参考稿几何和响应式规则；不向生产全局 CSS 继续追加 override。

共享组件只抽取真正重复的视觉语法。每页的结构和分析模块保持专属，避免再次被统一成同一种白卡。

## 5. 视觉系统合同

### 5.1 基础 token

- Canvas：接近白色的暖灰 `#fbfaf8`。
- Surface：`#ffffff`；Hero 可使用极轻暖橙背景层，但不得形成大面积橙色块。
- Primary text：接近黑色；Secondary/Tertiary 形成两级灰度。
- Brand：参考稿橙色，只用于 active、关键洞察、主要按钮、重点图形和少量图标。
- Positive / Negative / Warning：分别承担盈利、亏损、风险注意，不作为装饰色。
- Border：低对比 1px；内部 hairline 更浅。
- Radius：主要容器 8–10px，按钮/输入 5–8px，badge 3–5px。
- Shadow：仅大容器使用极轻扩散阴影；禁止重阴影和黑色硬偏移。

### 5.2 字体与密度

- Header 品牌 18–20px；导航 12–14px。
- 页面标题 20–24px；面板标题 12–14px。
- 正文和表格 11–13px，不再以 8.5px 作为主要阅读字号。
- 资产主数字 30–36px；关键绩效 22–30px；次级指标 16–20px。
- 数字使用 tabular numerals，金额和百分比按小数点/列对齐。
- 1440 主视口使用约 20px 页面边距、12–16px section gap、12–18px card padding；以参考图的紧凑密度为准，不平均分配视觉权重。

### 5.3 状态与交互

- tab、交易对、周期、表格行、筛选器、分页、展开与合法动作具有 hover、active、focus-visible 和 disabled 状态。
- 键盘可操作项不得小于 36px 桌面点击高度；图标按钮具有可读 `aria-label`。
- Loading 不清空已存在事实；stale/degraded/failed/forbidden 继续由上层状态表达。
- 空态保留参考稿的区域结构，用简短说明替代大量“—”，不得为了填满画面制造仓位或成交。

## 6. 五页组件与真实数据映射

### 6.1 总览

**几何：** 约 60px 沉浸式 Header；其下为全宽 Portfolio Hero、双通道系统/市场提示、约 58/42 的主行情与右侧情报栏。左栏为行情图和最近交易，右栏依次为 AI 市场判断、持仓概览、系统与 Agent 活动；底部为策略状态条。

**必须实现：**

- Hero 中突出总资产，并显示今日盈亏、未实现盈亏、风险使用率圆环、可用保证金和 AI 策略状态；背景使用真实账户快照绘制弱化趋势。
- 系统提示与市场快讯为两个信息槽，分别来自 notifications/automation 和 events/market regime；缺一时保留单槽，不重复同一内容。
- BTC/USDT 主图含价格、24h 高低、周期切换、K 线与成交量；生产读取真实 K 线。
- AI 判断使用真实 regime label/summary/confidence/event；关键价位只在真实数据存在时显示。
- 组合环图基于 position notional 占比，旁边列出真实持仓与盈亏；无仓位时使用专业空仓状态。
- 最近交易优先呈现 fills，再补 orders，避免同一事实在订单与成交中重复显示。
- Agent 活动按真实运行轨迹显示服务身份、时间和状态。

### 6.2 行情

**几何：** Market Header 横向占满；主区约 74/26，为大型 K 线工作区和状态/自选侧栏；底部为四块分析模块与全宽 ticker。

**必须实现：**

- Header 展示交易对、价格、24h 涨跌/高/低/成交额、市场状态和半圆风险/趋势仪表。
- 图表提供真实可工作的交易对与周期选择；指标、全屏、截图等控制只有在当前组件实际支持时才可点击，否则不伪造按钮。
- K 线下方显示成交量；加载、空、失败分别呈现，不允许永久“加载中”。
- 右栏显示市场状态、动量/波动/资金费率/OI/宽度、AI 置信度和自选列表。
- 底部显示衍生品、市场宽度、宏观事件、AI 观点与关键位。只计算可由现有 market/regime/analytics/events 字段证明的指标。
- ticker 使用真实 markets，可横向滚动但页面本身不得横向溢出。

### 6.3 持仓

**几何：** 全宽 Exposure Hero 与一条账户约束栏；主体约 24/52/24，左为配置/多空/盈亏分布，中为持仓明细与组合盈亏趋势，右为风险健康/保证金安全/多空平衡/集中度。

**必须实现：**

- Hero 显示总持仓价值、未实现盈亏、保证金占用、可用保证金、平均杠杆与风险状态，并用快照趋势作为弱化背景。
- 配置环按真实 notional 聚合；多空分布按 notional 而非行数；盈亏分布使用真实 position PnL。
- 持仓主表每个对象展示 Symbol、方向、规模、Entry、Mark、Unrealized PnL、杠杆、Liquidation、Margin，并在第二层展示可关联到真实计划/保护事实的 Stop Loss、Take Profit 和保证金率。
- Stop/Target 通过 position identity、execution order 与 trade plan 关联；缺失时显示“未登记”，不得从参考数字推断。
- 只有 `executionExitAction` 允许的仓位/执行对象出现退出操作。
- 趋势图使用 account snapshots；没有两个以上真实快照时显示短高度解释空态。
- 风险健康显示强平距离、保证金安全、集中度与多空平衡，任何评分都标明其可验证输入，不制造黑盒综合分。

### 6.4 执行与复盘

**几何：** 标题/批次筛选；七项绩效 Hero；全宽 AI 复盘结论三列；约 36/64 的 Trade List 与 Trade Detail；底部三块为持仓时长×盈亏分布、行为洞察和下一步行动。

**必须实现：**

- Hero 展示净已实现盈亏、成交笔数、胜率、平均收益/期望、最大回撤、Profit Factor、System Health。字段不存在时用正确名称显示不可用，不得用 profit factor 冒充平均盈亏比。
- AI 结论只汇总真实 review/behavior 内容，并明确所选批次/样本；不把本地推导文案冒充新 AI 结论。
- Trade List 具备状态/方向/结果筛选与本地分页，行数由真实 reviews/lifecycles 决定。
- Trade Detail 通过 canonical identity 关联 review 与 closed lifecycle，展示 PnL、Return、Holding Time、Entry、Exit、费用、策略、信号、置信度、AI score/review；缺失字段诚实标记。
- 本笔收益曲线只有真实 price/equity path 时展示；否则展示“未记录逐时路径”，不得用任意折线伪装。
- 底部分布图使用 `holdMinutes × netReviewResult` 的真实点；行为与下一步使用 behavior flags、lesson、improvement 等现有内容。

### 6.5 委托与成交

**几何：** 标题与日期；六项执行统计 Hero；双通道提示；约 53/47 的委托列表与选中详情；详情内含六阶段时间线；下方为全宽成交流水。

**必须实现：**

- Hero 从真实 orders/fills 计算委托总数、Working、Filled、Rejected/Risk Blocked、Fill Rate 和 Fees；计算口径在 UI 中可追溯。
- 委托列表具有真实状态标签、交易对筛选、本地分页和选中态；Orders 与 Fills 在视觉/语义上严格分离。
- Selected Order Detail 展示订单、成交、交易场所、时间、来源策略/信号等可关联事实。
- 时间线按当前选中订单的 identity 关联 Signal、Risk、Routing、Order、Fill、Protection；不得用“全局存在任意记录”把无关阶段标成完成。
- 交给 AI 只跳转到既有 AI 交易员上下文；取消/退出只调用现有受权动作。
- Fill Ledger 展示真实交易所回报、费用、流动性、开减平性质，并支持本地筛选/分页。

## 7. 视口与降级

- 1440×1080：主视觉验收尺寸，页面首屏高度与参考稿接近；关键分析区不得出现无意义的大空白。
- 1280×960：保留全部模块和交互，缩小列间距与非关键 meta，不裁切关键数字。
- 1024×768：允许分析栏换行/堆叠，表格进入自身横向滚动容器；document 横向溢出必须为 0。
- 本轮不重构 APP；移动端业务和样式保持不变。

## 8. 测试与视觉证据

### 8.1 TDD 合同

先增加失败测试，再实现：

- 每页参考组件 landmark、数据来源和禁止伪造合同。
- K 线 harness 响应接线与 chart-ready 状态。
- canonical identity 关联：position→plan/protection、review→lifecycle、order→fill/risk/plan。
- 订单与成交去重、绩效字段不误标、空数据不产生假数。
- 1440/1280/1024 几何、document overflow、表格容器和键盘行为。

### 8.2 验证 fixtures

浏览器 harness 使用 production-shaped deterministic fixtures，覆盖约 4 个持仓、27 个 closed trades/reviews、32 个 orders、24 个 fills、多个 account snapshots 和真实 schema K 线。fixtures 只用于测试与截图，并显式标记 synthetic；生产入口无 fixture import。

### 8.3 两轮视觉检查

第一轮一次性抓取五页 1440 和代表性 1280/1024，逐页与 1448×1086 参考图并排检查：Header、Hero、grid、card、chart、table、type、color、density、empty/loading。

修复所有成批问题后进行第二轮最终截图。每张截图必须打开确认名称、页面、尺寸和加载状态正确。最终报告逐页列出已对齐项与仍受真实数据差异影响的差异。

### 8.4 完成门槛

- focused tests、完整测试、lint、production build、真实浏览器 gate、Impeccable detector、`git diff --check` 全部通过。
- 参考图与实际图肉眼复审通过；测试通过但视觉明显不同不得声明完成。
- 不改生产业务边界；不在生产代码中出现参考稿数字或测试 fixture。

## 9. 明确不做

- 不重构 APP。
- 不修改营销页、登录页或其他工作区。
- 不创建新的交易、策略、风控或授权能力。
- 不用静态图片替代真实图表。
- 不为了填满参考稿而伪造生产数据。
- 不继续向旧全局 CSS 追加覆盖层。
