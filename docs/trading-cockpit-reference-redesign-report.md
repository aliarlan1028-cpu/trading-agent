# 交易驾驶舱参考图重构报告

日期：2026-09-04
最终生产实现源提交：`30458a06996ae5c029361600f3d62bf07d3a1dc6`

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

## 最终几何与可读性

1440×1080 实测：

| 页面 | Header | Canvas L/R | Active | Grid | 最小正文 | 最小目标 | 最末区域 bottom | Overflow |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 总览 | 60px | 26 / 26 | 1 | 58 / 42 | 11px | 36px | 1078.875 | 0 |
| 行情 | 60px | 26 / 26 | 1 | 74 / 26 | 11px | 36px | 1078.016 | 0 |
| 持仓 | 60px | 26 / 26 | 1 | 24 / 52 / 24 | 11px | 36px | 941.000 | 0 |
| 执行与复盘 | 60px | 26 / 26 | 1 | 36 / 64 | 11px | 36px | 1070.375 | 0 |
| 委托与成交 | 60px | 26 / 26 | 1 | 53 / 47 | 11px | 36px | 1068.750 | 0 |

五页在 1280×960 与 1024×768 也均为 `overflow=0`、Header 60px、唯一 active、最小正文 11px、最小目标 36px。画布边距分别为 18px 与 16px。1024 使用有意的纵向重排和页面滚动，不把桌面三列强行缩窄；Market 主报价、Positions Hero、Execution 详情均通过内容 containment 合同。

Overview 与 Market 的真实图表组件均已呈现非空 canvas；Market 最终状态为 `chartStatus=ok`。默认 fixture 的五条 Market 自选全部渲染且每一行均位于自选列表可视边界内。

## 功能、权限与状态验证

- 五个导航入口、浏览器 back/forward、品牌退出和生产搜索别名均使用唯一 canonical URL；伪造或废弃路由 fail closed。
- Position 与 Ledger 的平仓只在唯一 canonical execution identity 下出现。测试真实点击后先出现带准确交易对的确认框，确认前请求为 `null`，确认后仍是原有 `/api/execution-orders/ord-01/close` 和受保护 payload。
- Execution 真实点击、筛选、分页、deep link、失效对象与恢复均通过；Ledger 选择、详情、时间线、状态族、分页与费用事实均通过。
- fresh Chrome 状态矩阵通过：Loading、Empty / No result、Stale、Degraded / retained partial truth、Failed、Forbidden、Disabled；Market、Positions、Execution、Ledger 的 malformed fail-closed；Positions partial composition；Ledger long / large list。
- Market malformed 首次运行的退出 1 来自新增 runner 合同错误地把「默认 fixture 必须有 5 条自选」套到已过滤 malformed fixture 的 2 条合法行，并非产品回归。合同修正为默认数据精确 5 条、所有场景的 accepted rows 均需完整可见后，该生产组件场景 fresh 复跑退出 0。
- 默认 Execution fixture 含 Processing 对象；Position/Ledger 浏览器流程覆盖 Approval required / Danger confirmation。空仓截图与 loaded-empty 事实不伪造持仓、订单、成交或权限。
- chart empty/error/partial-init/refetch/update 生命周期、position partial composition、ledger adversarial/identity/status/risk counterexamples 等更细状态由专项与全量自动测试继续守护；本任务未改变这些语义。

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

八张 PNG 均已逐图打开：文件名与页面/viewport 匹配，Overview footer、Market 5 条自选与 ticker、Execution 底部三块、Ledger 分页均完整；图表非空，无半加载、错误页面、横向裁切或误标文件。

## 视觉残余与诚实声明

不声明像素级复刻。参考图是视觉权威，但其静态示例数值、文本长度、图形轨迹和部分事件/系统事实并非生产真相；最终图使用 production-shaped fixture，并对缺失的风险、Agent、事件或路径事实显示「不可用 / 未提供 / 暂无记录」，不为追图编造能力或数据。因此以下差异被有意保留：

- 数值、列表内容、K 线轨迹与参考图示例不同；
- 没有真实来源的 `4H`、风险规则、事件或路径事实不会出现在最终页面；
- 1024 采用可读的纵向重排与滚动，而不是按参考图比例继续压缩；
- 悬浮 AI 客服维持生产入口与安全区，不作为截图装饰重新定位到可能遮挡核心操作的位置。

这些残余不改变视觉语法、信息层级或交互模型，也不扩大产品能力。

## Fresh verification

- Impeccable detector（UI 收敛后仅运行一次）：`[]`。
- 共享工作树诊断：Focused `112/112`、Full `2368/2368`、ESLint PASS、Vite build PASS（1826 modules，1.70s）。这组数字包含未提交的用户/其他任务文件，仅用于确认 Task 9 与并行工作兼容，不作为提交态计数。
- exact detached clone（生产实现 `30458a0` 及其 8 张最终 evidence assets；最终 evidence hash 由交付回报记录，避免报告自引用）：Focused `108/108`、Full `2357/2357`、ESLint PASS、Vite build PASS（1825 modules，fresh 重跑 1.43s）。
- 默认五页 Chrome 在共享工作树与 exact detached clone 均为 15 个 viewport/page 组合 PASS；全部进程与临时 profile 清理成功。exact clone 的 1440 几何与表中最终值一致。
- 状态矩阵 Chrome：上述 13 个资源/数据场景 PASS；Market malformed 的 runner-scope RED 已单独纠正并复跑 PASS。
- `git diff --check`：PASS。

独立只读审查结论在 Task 9 交付回报中记录。本任务没有部署，也没有修改或删除共享工作树中的用户/其他任务文件。
