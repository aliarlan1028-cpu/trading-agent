# KORDYN V2 Capability Migration Matrix

## Verification basis

- Code source: `src/productCoverage.js` at working tree `4dc7ed0`.
- Verified count on 2026-08-26: `66` capabilities.
- Distribution: AI `8`, account/trading `11`, intelligent assets `18`, risk/boundaries `6`, operations `8`, configuration `15`.
- This matrix changes information architecture and presentation only. Existing API, permission, action, state, object identity, execution, risk, audit, and recovery semantics remain authoritative.

## Full migration matrix

| # | Current capability | Existing production surface | New domain | New workspace | Object / view / action | Desktop | APP |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `ai.dialog` | `AiDialogConcept / ChatPage` | AI 交易员 | 对话 | Mission conversation; send/read session; evidence and trace | AI 对话工作区 | AI 对话全屏流 |
| 2 | `ai.autonomous-patrol` | `ChatPage / ToolTrace` | AI 交易员 | 任务 | Agent run; patrol status; product-language stage trace | Mission queue + live trace | Mission detail + trace disclosure |
| 3 | `ai.intelligence` | `IntelligenceConcept / MobileIntelligence` | AI 交易员 | 情报 | Signal/event evidence; add to AI context; inspect source | Signals workbench | Signals list/detail |
| 4 | `ai.watch` | `WatchMonitorConcept / MobileWatch` | AI 交易员 | 观察哨 | Watch object; trigger status; inspect and navigate | Watch registry | Watch list/detail |
| 5 | `ai.events` | `EventsConcept / MobileTasks:event calendar` | AI 交易员 | 事件日历 | Event object; date/window; related Mission | Calendar + event inspector | Calendar list/detail |
| 6 | `ai.poster-current` | `PosterModal` | AI 交易员 | 任务输出 | Mission/review output draft; preview current supported style | Output drawer | Output sheet |
| 7 | `ai.poster-translate` | `PosterModal:language` | AI 交易员 | 任务输出 | Poster language switch; Chinese/English only | Output drawer language control | Output sheet language control |
| 8 | `ai.poster-png` | `PosterModal:download` | AI 交易员 | 任务输出 | Export reviewed draft as PNG | Manual export action | Manual export action |
| 9 | `live.overview` | `TradingOverviewConcept` | 账户交易 | 账户 | Account truth, exposure, positions, current protection state | Account truth cockpit | Account summary |
| 10 | `live.market` | `MarketConcept / MobileMarket` | 账户交易 | 市场 | Market object; quote/depth/candles; select instrument | Market workspace | Market list/detail |
| 11 | `live.account` | `TradingOverviewConcept / MobileAccountHealth` | 账户交易 | 账户 | Account object; equity, margin, availability, freshness | Account inspector | Account health detail |
| 12 | `live.positions` | `PositionsConcept / MobilePositions` | 账户交易 | 持仓 | Position object; select, inspect, protect, close through existing actions | Position truth workspace | Position list/detail |
| 13 | `live.execution` | `ExecutionReviewConcept / MobileExecution` | 账户交易 | 计划 | Trade plan/execution object; approval and lifecycle | Plan & execution workbench | Plan/execution flow |
| 14 | `live.orders` | `ExecutionLedgerConcept / MobileExecution:orders` | 账户交易 | 订单 | Order object; status, source, cancel where authorized | Order ledger | Order list/detail |
| 15 | `live.fills` | `ExecutionLedgerConcept / MobileExecution:fills` | 账户交易 | 成交 | Fill object; execution truth and provenance | Fill ledger | Fill list/detail |
| 16 | `live.protection` | `PositionsConcept / ExecutionReviewConcept` | 账户交易 | 持仓 | Protection settings/status; protected confirm actions | Position inspector actions | Position protection flow |
| 17 | `live.reconcile-status` | `ExecutionReviewConcept / MobileAccountHealth` | 账户交易 | 账户 | Reconciliation status; last valid source and recovery route | Account truth/reconcile inspector | Account health/reconcile detail |
| 18 | `live.review-status` | `ExecutionReviewConcept / MobileExecution:reviews` | 账户交易 | 成交 | Closed-trade review status; link to authoritative review | Fill/trade detail link | Trade detail link |
| 19 | `live.closed-trade-poster` | `PosterModal / Telegram notifier result` | 账户交易 | 成交 | Closed-trade poster draft/result; review before export/delivery | Trade result output drawer | Trade result output sheet |
| 20 | `lab.research-map` | `ResearchMapConcept / MobileResearchMap` | 智能资产 | 关系总览 | Canonical relationship among Mission, strategy, capability, knowledge, review | Relationship topology | Relationship thread |
| 21 | `lab.knowledge-import` | `KnowledgeConcept / KnowledgeImportPanel` | 智能资产 | 知识库 | Knowledge source; import supported source; processing status | Source registry/import flow | Source import flow |
| 22 | `lab.knowledge-evidence` | `KnowledgeConcept` | 智能资产 | 知识库 | Evidence fragment; source/page/provenance; inspect | Evidence workspace | Evidence detail |
| 23 | `lab.knowledge-graph` | `KnowledgeConcept / ConceptGraph` | 智能资产 | 知识库 | Concept/evidence relationship graph | Graph tab/detail | Graph drill-down |
| 24 | `lab.knowledge-artifacts` | `KnowledgeConcept` | 智能资产 | 知识库 | Supported extracted artifact candidate; adopt/reject | Incubation queue | Candidate detail |
| 25 | `lab.knowledge-workflows` | `KnowledgeConcept` | 智能资产 | 知识库 | Knowledge workflow candidate; evidence, version, approval | Incubation queue | Workflow candidate flow |
| 26 | `lab.strategy-core` | `StrategyLibraryConcept:catalog` | 智能资产 | 策略库 | Strategy product; origin, version, enablement, evidence | Strategy registry/detail | Strategy list/detail |
| 27 | `lab.strategy-studio` | `StrategyLibraryConcept:studio / MobileStrategy:studio` | 智能资产 | 策略库 | Closed-template draft; tests, OOS, forward, Owner release | Strategy studio | Strategy studio flow |
| 28 | `lab.strategy-knowledge` | `KnowledgeConcept / StrategyLibraryConcept` | 智能资产 | 策略库 | Knowledge-derived strategy product with lineage | Registry + lineage inspector | Strategy lineage detail |
| 29 | `lab.strategy-imported` | `StrategyLibraryConcept` | 智能资产 | 策略库 | Imported/adapted strategy product with provenance | Registry + lineage inspector | Strategy lineage detail |
| 30 | `lab.strategy-adaptive` | `StrategyLibraryConcept / owner review data` | 智能资产 | 策略库 | Versioned improvement candidate; controlled validation lifecycle | Studio/release pipeline | Validation/release flow |
| 31 | `lab.capability-native` | `CapabilitiesConcept / MobileCapabilities` | 智能资产 | 能力库 | Code-registered native capability; permissions, effects, health | Capability registry/detail | Capability list/detail |
| 32 | `lab.capability-workflow` | `CapabilitiesConcept / KnowledgeConcept` | 智能资产 | 能力库 | Approved workflow capability; provenance and invocation contract | Capability registry/detail | Capability detail |
| 33 | `lab.capability-imported-skill` | `CapabilitiesConcept / KnowledgeConcept` | 智能资产 | 能力库 | Governed imported skill record; enablement and evaluation | Capability registry/detail | Capability detail |
| 34 | `lab.capability-mcp` | `CapabilitiesConcept` | 智能资产 | 能力库 | MCP capability; explicit per-tool grant, expiry, blocked state | Capability inspector | Capability/grant detail |
| 35 | `lab.capability-connectors` | `CapabilitiesConcept` | 智能资产 | 能力库 | Connector identity/health; configuration deep-link only | Capability inspector | Connector detail |
| 36 | `lab.trade-review` | `TradeReviewWorkbenchConcept / MobileExecution:reviews` | 智能资产 | 复盘与发布 | Closed trade review; evidence, execution, lesson candidate | Review workbench | Review list/detail |
| 37 | `lab.owner-review` | `OwnerReviewWorkspaceConcept / MobileOwnerReview` | 智能资产 | 复盘与发布 | Owner queue; accept into validation/reject/adopt | Owner queue + release pipeline | Owner decision flow |
| 38 | `control.risk-posture` | `RiskPostureConcept / MobileRiskHub` | 系统治理 | 运行总览 | Current risk posture; effective fact, freshness, impact | Boundary overview | Governance status |
| 39 | `control.operating-mode` | `OperatingBoundaryConcept / MobileRiskHub` | 系统治理 | 运行总览 | Desired versus effective operating mode; no editing here | Current boundary view | Boundary detail |
| 40 | `control.mandate-context` | `OperatingBoundaryConcept / MobileRiskHub` | 系统治理 | 运行总览 | Effective mandate and permissions; configuration deep-link | Boundary inspector | Boundary detail |
| 41 | `control.rule-monitor` | `RulesConcept:monitor / MobileRiskHub` | 系统治理 | 运行总览 | Deterministic rule monitor; current evaluation evidence | Rule monitor section | Rule detail |
| 42 | `control.event-risk` | `EventRiskConcept / MobileRisk:events` | 系统治理 | 事件输入 | Event risk window; affected assets/tasks; source health | Event risk workbench | Event risk list/detail |
| 43 | `control.permission-boundaries` | `OperatingBoundaryConcept / MobileRiskHub` | 系统治理 | 运行总览 | Readiness chain and action boundary; fail-closed truth | Boundary chain | Boundary chain detail |
| 44 | `operations.runtime-health` | `OperationsCommandConcept / MobileOperations` | 系统治理 | 运行总览 | Service/system topology; authoritative/degraded/last-valid state | Operations topology | Governance operations summary |
| 45 | `operations.tasks` | `OperationsTasksConcept / MobileOperations` | 系统治理 | 任务与运行 | Task object; supported create/read/retry actions | Task registry | Task list/detail |
| 46 | `operations.task-runs` | `OperationsTasksConcept / MobileOperations` | 系统治理 | 任务与运行 | Agent/system run; stage, result, trace evidence | Run ledger/detail | Run detail |
| 47 | `operations.event-input-health` | `OperationsCommandConcept / MobileOperations` | 系统治理 | 事件输入 | Input source health; stale/degraded/last-valid/retry | Input health inspector | Input health detail |
| 48 | `operations.notifications` | `OperationsInboxConcept / MobileOperations` | 系统治理 | 通知 | Notification delivery record; failure/retry/acknowledge | Notification inbox | Notification detail |
| 49 | `operations.audit` | `OperationsAuditConcept / MobileOperations` | 系统治理 | 审计 | Immutable audit object; actor, action, result, trace | Audit ledger | Audit list/detail |
| 50 | `operations.reconcile` | `OperationsRecoveryConcept / MobileOperations` | 系统治理 | 恢复 | Reconcile operation; confirmation and authoritative outcome | Recovery workbench | Recovery flow |
| 51 | `operations.recovery` | `OperationsRecoveryConcept / MobileOperations` | 系统治理 | 恢复 | Recovery record; retry, evidence, result | Recovery queue/detail | Recovery queue/detail |
| 52 | `configuration.operating-mode` | `MandateConcept / MobileTradingConfiguration` | 系统治理 | 配置 | Selected/effective operating mode; Owner apply | Configuration registry | Scope-first editor |
| 53 | `configuration.mandate` | `MandateConcept / MobileRiskPermissionEditor` | 系统治理 | 配置 | Trading permission/mandate; validate, confirm, apply | Trading authorization editor | Permission editor flow |
| 54 | `configuration.risk-rules` | `RulesConcept:editable / RiskRulesPanel` | 系统治理 | 配置 | Risk rule selected/effective value; Owner apply | Risk rule editor | Risk rule editor |
| 55 | `configuration.environment` | `SettingsConcept:environment` | 系统治理 | 配置 | Environment configuration; permission and audit | Configuration registry | Scope-first editor |
| 56 | `configuration.network` | `SettingsConcept:network` | 系统治理 | 配置 | Network/proxy configuration; validate and apply | Configuration registry | Scope-first editor |
| 57 | `configuration.backup` | `SettingsConcept:data_backup` | 系统治理 | 配置 | Backup configuration/action; Owner authority | Configuration registry | Backup editor/action |
| 58 | `configuration.security` | `SettingsConcept:security / AccountDialog` | 系统治理 | 配置 | Security settings; protected confirmation and masked data | Security editor | Security flow |
| 59 | `configuration.exchange` | `SettingsConcept:exchange` | 系统治理 | 配置 | Exchange connector and masked credentials; test/replace | Exchange editor | Exchange flow |
| 60 | `configuration.event-sources` | `EventSourcesPanel / MobileEventSourcesConfiguration` | 系统治理 | 配置 | Event source configuration; selected/effective and health link | Event source editor | Event source editor |
| 61 | `configuration.notifications` | `SettingsConcept:notifications` | 系统治理 | 配置 | Notification channel settings; save/test through existing actions | Notification editor | Notification editor |
| 62 | `configuration.models` | `SettingsConcept:models` | 系统治理 | 配置 | Model selection and masked keys; permission/preflight | Model editor | Model editor |
| 63 | `configuration.agents` | `SettingsConcept:agents` | 系统治理 | 配置 | AI Trader role/tool/workflow configuration within deployed boundary | Agent editor | Agent editor |
| 64 | `configuration.users` | `SettingsConcept:users` | 系统治理 | 配置 | User/RBAC object; create/update through existing actions | User registry/editor | User flow |
| 65 | `configuration.subscriptions` | `SettingsConcept:users` | 系统治理 | 配置 | Subscription object; existing billing/status actions | Subscription registry | Subscription detail |
| 66 | `configuration.account-profile` | `AccountDialog / MobileSettingsIndex` | 系统治理 | 配置 | Account profile; current identity and allowed edits | Account profile editor | Account profile flow |

## Count gate

Implementation must keep this matrix at exactly `66` rows unless `src/productCoverage.js` changes through a separately approved product-capability change. A count mismatch is a release blocker, not a documentation correction.
