# 交易驾驶舱参考图重构报告

日期：2026-09-04
最终生产实现源提交：`5cc071ad44489af8a6c37252be716df4d1eca82e`
原 Task 9 收敛实现：`30458a06996ae5c029361600f3d62bf07d3a1dc6`

## 交付范围与边界

本任务只对桌面端「交易驾驶舱」五页做两轮有界视觉收敛。视觉权威为仓库根目录 `交易驾驶舱参考图/` 中五张原始尺寸 PNG；对应关系如下。

| 页面 | 生产 URL | 参考图 | 核心布局 |
|---|---|---|---|
| 总览 | `/app/trade/overview` | `(1)` | 账户真相、行情、AI 判断、组合、交易流水、Agent 活动 |
| 行情 | `/app/trade/market` | `(2)` | 图表、周期、市场状态、自选、衍生品、事件与 AI 观察 |
| 持仓 | `/app/trade/positions` | `(3)` | 组合敞口、持仓表、配置、多空分布、净值趋势、风险健康 |
| 执行与复盘 | `/app/trade/execution-review` | `(4)` | 绩效、AI 结论、复盘列表、证据、行为与下一步 |
| 委托与成交 | `/app/trade/orders-fills` | `(5)` | 委托、订单详情、执行时间线、成交与费用账本 |

未修改 API、数据库、权限、交易执行、OKX 连接、风控、授权或资源状态语义。页面继续消费现有生产模型与动作；浏览器证据使用不含敏感信息的 production-shaped fixture，并挂载真实 `August15AuthenticatedShell` 与生产驾驶舱组件。确认、平仓等测试动作只记录 fixture-local 请求，不调用生产写接口。

## 两轮视觉收敛

### Round 1：系统级批量修正

先扩展浏览器合同，再运行基线得到真实 RED。初始 1440 测量为：

| 页面 | Grid | 最小正文 | 最小目标 | 最末区域 bottom | RED |
|---|---:|---:|---:|---:|---|
| 总览 | 58 / 42 | 11px | 36px | 1084.9 | footer 超出主视口 |
| 行情 | 74 / 26 | 11px | 32px | 1039.3 | 操作目标不足 36px |
| 持仓 | 24 / 52 / 24 | 10px | 36px | 941.0 | 真实操作文字不足 11px |
| 执行与复盘 | 36 / 64 | 9px | 14.5px | 1072.4 | 文字和目标均不足 |
| 委托与成交 | 53 / 47 | 11px | 36px | 1068.8 | 几何通过 |

Round 1 一次性调整页头/画布、五页 Grid、标题与数字层级、面板高度、表格密度、图表高度、空状态、11px 可读下限、36px 桌面目标及 1024 重排；同时删除总览中无真实来源的固定 `4H`，只展示真实交易对身份。

### Round 2：逐图检查后的最终批量修正

Round 2 打开五张 1440 图并检查 1280/1024。最终批次同时处理：

- 总览回收顶层间距，使策略 footer 完整落入 1440×1080；
- 行情将五条自选统一为紧凑且仍满足 36px 操作高度的行，并完整显示 5/5 行；
- 行情在 1024 下保持主报价列不截断、图表完成加载、页面无横向溢出；
- 持仓在 1024 下收敛 Hero 数值，避免大数截断；
- 执行与复盘保持 36/64 工作台与完整详情，同时让行为洞察和下一步行动完整落入 1440 视口；
- 委托与成交保留参考稿的 53/47 主工作台与目的明确的 1024 纵向重排。

没有继续进行第三轮视觉改造；两次 Round 2 内部捕获被新硬门禁拦截后，仅完成同一批次的尺寸校准与全量重抓。

### 独立审查修复：可访问性、真实图层与证据密度

独立审查在现已被取代的原证据提交 `dd58cde9aae1fa0a2d5cdbf40616e300df1ee93f` 上发现 Critical 0 / Important 6 / Minor 1。本次按测试先行逐项修复六项 Important，不将审查修复冒充第三个视觉方向：

- Market 使用既有 `TradingViewChart` 的真实逐 K 线成交量图层；主图、成交量和错误状态来自同一条现有 K 线数据链，没有新增 API 或伪造数据。
- Execution 复盘行通过真实键盘 `Tab` 获得 `:focus-visible`，实测为 `solid 3px` 高对比轮廓；浏览器合同不再以 `none 3px` 误判为可见。
- 驾驶舱弱文本 token 调整为在实际浅色背景上至少 4.5:1，并对代表性 operational copy 计算 computed color 与有效背景对比度。
- `.cockpitTone` 纳入正文扫描，字号从 9.5px 提升到 11px，neutral tone 对比度 5.176:1。
- Positions 只重新平衡现有配置、趋势和风险内容高度；1440 最末真实区域从 941px 延伸到 1001px，没有新增 footer 或虚构能力。
- 最终主证据改用既有 test-only enriched production-shaped fixture，使 Event、Agent run、Risk rule、Strategy 等现有能力形状实际出现在五页证据中；该 fixture 从未被生产代码导入，空态/异常态仍单独验证。

### 独立复审修复：完整 operational text 对比度

独立复审在现已被取代的证据提交 `3f51837658eec43aaf83414180405ccada7330d0` 上发现 Critical 0 / Important 1 / Minor 1。唯一 Important 是先前 computed-style 对比度门禁只抽样少数 meta / metric / table / tone 节点，未覆盖真实可见的提示标题、active 周期、语义涨跌值和操作按钮。

本轮先扩展浏览器合同，令最小字号与对比度使用同一个完整 operational population：可见且有几何尺寸的链接、按钮、表单、标签、summary、正文、时间、表格、定义列表、强调文本、带直接文本的 `span` 及 `cockpitTone`。`aria-hidden`、不可见和无几何节点被排除；仅作为子节点容器且自身没有直接文本的 wrapper 不重复计数。有效背景由当前节点到祖先的 computed background 逐层进行 alpha 合成，半透明前景也先与有效背景合成后再计算 WCAG contrast。该合同应用于正常、enriched、empty 及全部真实 shell 资源状态，不以隐藏微小文字的方式通过。

RED 的六个独立复审反例为：系统提示 `3.723:1`、市场提示 `2.771:1`、总览 active 周期 `3.008:1`、行情 active 周期 `3.412:1`、negative `3.788:1`、positive 最低 `4.115:1`（白底时 `4.489:1`）。完整人口扫描还额外捕获持仓集中度 `3.723:1` 与执行页「已记录优势」`3.969:1`。

修复没有改变图表线、K 线、成交量柱、状态圆点或图标的装饰色；只新增 scoped operational text tokens，并让 active control 保留既有橙底 / 浅橙底、underline 与 active class。GREEN 六个反例分别为 `6.623:1`、`6.807:1`、`5.324:1`、`6.071:1`、`5.919:1`、`5.958:1`（白底 `6.501:1`）。五页最终最差值均不低于 `4.905:1`。

### 独立复审修复：组合 opacity 与资源状态文字

独立复审在现已被取代的证据提交 `2897465a57c7e5cf66b3d2cecc528b48841f0b45` 上发现 Critical 0 / Important 1 / Minor 1。唯一 Important 是 `.positionResourceState span` 使用 `opacity:.84`，而浏览器合同没有组合文本节点及祖先节点的 computed opacity，导致真实渲染对比度被高估。

本轮先让对比度事实累乘节点与祖先的 opacity，再将前景合成到已求得的有效背景，并在失败输出中显示 `cumulativeOpacity`。RED 实测为：Loading / Stale / Degraded `4.408:1`，Error / Failed `4.195:1`，Forbidden / Disabled / Not loaded `4.137:1`，均为 `cumulativeOpacity=.84`。修复去掉普通 11px 文字的整组透明度，保留每种资源状态的显式 semantic color 和背景区分。GREEN 三组最低对比度分别为 `6.313:1`、`5.705:1`、`5.932:1`，全部 `cumulativeOpacity=1`。

新 opacity 合同同时抓到 Ledger 禁用分页按钮的旧 `opacity:.48`，其 11px 文字实测仅 `2.001:1`。修复使禁用按钮继续保持原生 `disabled` 属性、不可操作、不进入焦点顺序、`cursor:not-allowed` 及灰阶填充 / 边框，但以显式文本色取代整体透明度；GREEN 为 `4.845:1`。浏览器合同现在对每个真实 native disabled control 同时验证对比度、disabled 属性与 cursor，没有为通过对比度而重新启用任何动作。

### 独立复审修复：Market 禁用周期的最终 cascade

独立复审在报告/证据索引提交 `25db2a1581e7e31db9b81e02b636299693a71355` 上发现 Critical 0 / Important 1 / Minor 1。前一轮通用 disabled 规则位于后续、同专一性的 `.tradingCockpit .marketIntervals button` 之前，因此 Stale / Degraded 等状态中的周期按钮虽保持原生 `disabled`，computed cursor 却被覆盖为 `pointer`，active 周期也仍使用启用态的橙色外观。

RED 以真实 Market Stale 壳层捕获 6 个 native disabled 周期：全部 `cursor:pointer`，active `1h` 与启用 active 均为 `rgb(158,63,13)` / `rgb(255,243,233)`。后置、更高专一性的 scoped `:disabled` 规则不使用 `!important`：普通禁用周期为灰色文本/填充/边框、`cursor:not-allowed`、`4.845:1`；禁用 active 仍以更深灰阶和底边识别当前周期，但不冒充可操作状态，对比度 `6.892:1`。启用 Market 仍为 `cursor:pointer`，active 橙色规则和 `6.071:1` 对比度不变。合同使用真实 CDP pointer click 与 Tab，证明禁用周期不获得焦点、不改变 active identity、不发起 K 线请求。

## 最终几何与可读性

1440×1080 实测：

| 页面 | Header | Canvas L/R | Active | Grid | 最小正文 | 最小对比 | 最小目标 | 最末区域 bottom | Overflow |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 总览 | 60px | 26 / 26 | 1 | 58 / 42 | 11px | 4.905:1 | 36px | 1076.875 | 0 |
| 行情 | 60px | 26 / 26 | 1 | 74 / 26 | 11px | 4.905:1 | 36px | 1078.016 | 0 |
| 持仓 | 60px | 26 / 26 | 1 | 24 / 52 / 24 | 11px | 5.324:1 | 36px | 1001.000 | 0 |
| 执行与复盘 | 60px | 26 / 26 | 1 | 36 / 64 | 11px | 4.905:1 | 36px | 1070.375 | 0 |
| 委托与成交 | 60px | 26 / 26 | 1 | 53 / 47 | 11px | 5.091:1 | 36px | 1068.750 | 0 |

五页在 1280×960 与 1024×768 也均为 `overflow=0`、Header 60px、唯一 active、最小正文 11px、最小目标 36px。画布边距分别为 18px 与 16px。1024 使用有意的纵向重排和页面滚动，不把桌面三列强行缩窄；Market 主报价、Positions Hero、Execution 详情均通过内容 containment 合同。

Overview 与 Market 的真实图表组件均已呈现非空 canvas，逐 K 线成交量均为 `volumeSeries=ready`；Market 最终状态为 `chartStatus=ok`。默认 fixture 的五条 Market 自选全部渲染且每一行均位于自选列表可视边界内。

## 功能、权限与状态验证

- 五个导航入口、浏览器 back/forward、品牌退出和生产搜索别名均使用唯一 canonical URL；伪造或废弃路由 fail closed。
- Position 与 Ledger 的平仓只在唯一 canonical execution identity 下出现。测试真实点击后先出现带准确交易对的确认框，确认前请求为 `null`，确认后仍是原有 `/api/execution-orders/ord-01/close` 和受保护 payload。
- Execution 真实点击、筛选、分页、deep link、失效对象与恢复均通过；Ledger 选择、详情、时间线、状态族、分页与费用事实均通过。
- fresh Chrome 状态矩阵通过：Loading、Empty / No result、Stale、Degraded / retained partial truth、Failed、Forbidden、Disabled；Market、Positions、Execution、Ledger 的 malformed fail-closed；Positions partial composition；Ledger long / large list。
- Market malformed 首次运行的退出 1 来自新增 runner 合同错误地把「默认 fixture 必须有 5 条自选」套到已过滤 malformed fixture 的 2 条合法行，并非产品回归。合同修正为默认数据精确 5 条、所有场景的 accepted rows 均需完整可见后，该生产组件场景 fresh 复跑退出 0。
- 默认 Execution fixture 含 Processing 对象；Position/Ledger 浏览器流程覆盖 Approval required / Danger confirmation。空仓截图与 loaded-empty 事实不伪造持仓、订单、成交或权限。
- chart empty/error/partial-init/refetch/update 共 9 个生命周期状态、position partial composition、ledger adversarial/identity/status/risk counterexamples 等更细状态由专项与全量自动测试继续守护；隔离 chart lifecycle fixture 只豁免其没有挂载的 shell header/nav 几何，chart status、cleanup、volume/error 语义仍为硬断言；本任务未改变这些语义。
- exact 验证中第一次把隔离 chart lifecycle fixture 错误地同时请求了不存在的 Market shell，因等待 Market 页面而退出 1；改用其文档化的 Overview production-chart scope 后 6/6 隔离故障均退出 0，另 3 个真实 Overview/Market shell 图表状态也均退出 0。该次失败是 runner 调用范围错误，不是产品回归，也未通过放宽图表状态合同绕过。

## 最终视觉证据

五页 1440×1080：

- `.impeccable/review/trading-cockpit-v2-overview-1440.png`
- `.impeccable/review/trading-cockpit-v2-market-1440.png`
- `.impeccable/review/trading-cockpit-v2-positions-1440.png`
- `.impeccable/review/trading-cockpit-v2-execution-1440.png`
- `.impeccable/review/trading-cockpit-v2-ledger-1440.png`

补充证据：

- `.impeccable/review/trading-cockpit-v2-market-1280.png`
- `.impeccable/review/trading-cockpit-v2-ledger-1024.png`
- `.impeccable/review/trading-cockpit-v2-positions-empty-1440.png`

八张 PNG 的当前像素来源分开记录：Overview / Market / Positions / Execution 的四张主图、Market 1280 与 Positions empty 共六张仍是 exact `d9efcea` detached clone 的已验证捕获；它们在 opacity 修复中没有渲染 `.positionResourceState` 或 disabled paginator，因此像素没有变化。Ledger 1440 与 Ledger 1024 会渲染禁用分页，已从 exact `30806e3` detached clone 重新捕获。本轮仅修正不可用 Market 资源状态的周期按钮；现有八张计划证据只包含已加载的 Market 和 Positions 空态，均不呈现该禁用 Market 节点，因此本轮没有为无像素变化的 PNG 制造重复证据 churn。八张均已逐图打开：文件名与页面/viewport 匹配，Overview footer、Market 5 条自选与 ticker、Execution 底部三块、Ledger 分页均完整；Market K 线与逐 K 线成交量均非空，无半加载、错误页面、横向裁切或误标文件。七张主证据来自 enriched test-only fixture；Positions empty 保持独立 loaded-empty 证据。加深后的 operational 文本仍保持橙 / 绿 / 红 / 黄语义层级，没有把图表与装饰色整体压暗。

## 视觉残余与诚实声明

不声明像素级复刻。参考图是视觉权威，但其静态示例数值、文本长度、图形轨迹和部分事件/系统事实并非生产真相；最终图使用 production-shaped fixture，并对缺失的风险、Agent、事件或路径事实显示「不可用 / 未提供 / 暂无记录」，不为追图编造能力或数据。因此以下差异被有意保留：

- 数值、列表内容、K 线轨迹与参考图示例不同；
- 没有真实来源的固定 `4H` 不会出现在生产页面；最终图中的风险规则、事件、Agent run 与策略来自明确标注的 test-only production-shaped fixture，而不是生产凭据或运行数据；
- 1024 采用可读的纵向重排与滚动，而不是按参考图比例继续压缩；
- 悬浮 AI 客服维持生产入口与安全区，不作为截图装饰重新定位到可能遮挡核心操作的位置。

这些残余不改变视觉语法、信息层级或交互模型，也不扩大产品能力。

审查中的 Minor 仍诚实保留：`tradingCockpit.css` 含早期 cockpit-local selector 组，但在共享样式入口下无法证明每个 selector 都已无生产 JSX 使用，因此未进行高风险的宽泛删除。机械 detector 对本次 UI 目标返回 `[]`，该残余是局部样式债务，不是当前五页的视觉或功能阻断。

## Fresh verification

- Impeccable detector（UI 收敛后仅运行一次）：`[]`。本轮对比度修复遵守「最终收敛后 exactly once」约束，没有为了重复生成相同机械结论而再次运行 detector。
- 共享工作树诊断：Focused `112/112`（其中多出 4 项来自共享树的其他未提交项）、Full `2368/2368`、ESLint PASS、Vite build PASS（1826 modules，1.57s）。这组数字包含未提交的用户/其他任务文件，仅用于确认 Task 9 与并行工作兼容，不作为提交态计数。
- exact detached clone（生产实现 `5cc071a`；最终报告 hash 由交付回报记录，避免报告自引用）：Focused `108/108`、Full `2357/2357`、ESLint PASS、Vite build PASS（1825 modules，1.43s）。
- 默认与 enriched 五页 Chrome 在 shared 与 exact detached clone 均各为 15 个 viewport/page 组合 PASS；全部进程与临时 profile 清理成功。exact clone 的 enriched 1440 几何与表中最终值一致，完整 operational population 对比度在五页、三视口均通过。
- Positions 资源状态在 shared 与 exact 均完成 Loading / Stale / Degraded / Error / Failed / Forbidden / Disabled / Not loaded 八态× 1440 / 1280 / 1024 实测；字号 11px、无横向溢出、对比度分别至少 `6.313:1` / `5.705:1` / `5.932:1`。Ledger 原生禁用分页对比度 `4.845:1`，且仍为 disabled / `cursor:not-allowed`。
- Market 在 shared 与 exact 均完成 Loading / Stale / Degraded / Error / Failed / Forbidden / Disabled / Not loaded / Loaded / Empty 十种模式× 1440 / 1280 / 1024；有保留事实的不可用模式还额外通过原生 disabled、真实 pointer click、Tab 跳过、无 K 线请求及禁用 active / 启用 active 视觉差异合同。
- 状态矩阵 Chrome：Loading、Empty、Stale、Degraded、Failed、Forbidden、Disabled 全五页 PASS；Market / Positions / Execution malformed、Market mismatched、Positions partial、Ledger 8 组 malformed / long / identity / risk / status / collection counterexamples 全部 PASS；9 个 chart lifecycle 状态全部在正确挂载范围内 PASS。Market malformed 的早期 runner-scope RED 已单独纠正并复跑 PASS。
- `git diff --check`：PASS。

独立只读审查结论在 Task 9 交付回报中记录。本任务没有部署，也没有修改或删除共享工作树中的用户/其他任务文件。
