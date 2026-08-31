import { AuditWorkspace } from "./AuditWorkspace.jsx";
import { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
import { ConfigurationWorkspace } from "./ConfigurationWorkspace.jsx";
import { EventInputWorkspace } from "./EventInputWorkspace.jsx";
import { MobileAuditScreen } from "./MobileAuditScreen.jsx";
import { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
import { MobileConfigurationScreen } from "./MobileConfigurationScreen.jsx";
import { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";
import { MobileNotificationScreen } from "./MobileNotificationScreen.jsx";
import { MobileOperationsScreen } from "./MobileOperationsScreen.jsx";
import { MobileRecoveryScreen } from "./MobileRecoveryScreen.jsx";
import { NotificationWorkspace } from "./NotificationWorkspace.jsx";
import { OperationsWorkspace } from "./OperationsWorkspace.jsx";
import { RecoveryWorkspace } from "./RecoveryWorkspace.jsx";

const surface = ({ id, workspaceId, route, identity, actions, state, desktopComponent, desktopEntry, mobileComponent, mobileEntry, permission = "authenticated identity + existing server-authoritative RBAC" }) => Object.freeze({
  id,
  domainId: "governance",
  workspaceId,
  route,
  objectIdentity: identity,
  actionBoundary: actions,
  permissionBoundary: permission,
  resourceStateBoundary: state,
  desktop: Object.freeze({ component: desktopComponent, entry: desktopEntry }),
  mobile: Object.freeze({ component: mobileComponent, entry: mobileEntry })
});

const boundary = (id, identity, entry) => surface({ id, workspaceId: "overview", route: "riskOverview", identity, actions: "read-only effective facts and canonical selection; durable edits deep-link to Configuration", state: "selected target, effective state, blockers, last-valid evidence and action boundary remain distinct", desktopComponent: BoundaryWorkspace, desktopEntry: `系统治理 → 运行总览 → ${entry}`, mobileComponent: MobileBoundaryScreen, mobileEntry: `系统治理 → 运行 → ${entry}` });
const eventInput = (id, identity, actions, entry) => surface({ id, workspaceId: "event-inputs", route: "eventRisk", identity, actions, state: "source health and formed event windows remain separate; missing sources fail closed", desktopComponent: EventInputWorkspace, desktopEntry: `系统治理 → 事件输入 → ${entry}`, mobileComponent: MobileEventInputScreen, mobileEntry: `系统治理 → 事件输入 → ${entry}` });
const operations = (id, identity, actions, entry) => surface({ id, workspaceId: "runs", route: "operationsCenter:tasks", identity, actions, state: "task ownership never substitutes for current Run outcome; authoritative, last-valid, degraded and failed remain explicit", desktopComponent: OperationsWorkspace, desktopEntry: `系统治理 → 任务与运行 → ${entry}`, mobileComponent: MobileOperationsScreen, mobileEntry: `系统治理 → 任务 → ${entry}` });
const notifications = (id, identity, actions, entry) => surface({ id, workspaceId: "notifications", route: "operationsCenter:notifications", identity, actions, state: "delivery intent, channel outcome and per-user read state remain distinct", desktopComponent: NotificationWorkspace, desktopEntry: `系统治理 → 通知 → ${entry}`, mobileComponent: MobileNotificationScreen, mobileEntry: `系统治理 → 通知 → ${entry}` });
const audit = (id, identity, entry) => surface({ id, workspaceId: "audit", route: "operationsCenter:audit", identity, actions: "immutable read-only audit selection and evidence inspection", state: "chain and WORM integrity never infer healthy from record presence", desktopComponent: AuditWorkspace, desktopEntry: `系统治理 → 审计 → ${entry}`, mobileComponent: MobileAuditScreen, mobileEntry: `系统治理 → 审计 → ${entry}` });
const recovery = (id, identity, actions, entry) => surface({ id, workspaceId: "recovery", route: "operationsCenter:recovery", identity, actions, state: "pending, partial, failed and reconciled outcomes remain server-authoritative", desktopComponent: RecoveryWorkspace, desktopEntry: `系统治理 → 恢复 → ${entry}`, mobileComponent: MobileRecoveryScreen, mobileEntry: `系统治理 → 恢复 → ${entry}` });
const configuration = (id, identity, actions, entry, permission = "authenticated Owner + existing server-authoritative RBAC") => surface({ id, workspaceId: "configuration", route: "systemSettings", identity, actions, permission, state: "selected target, preflight, confirmation, authoritative result, effective state and audit are distinct", desktopComponent: ConfigurationWorkspace, desktopEntry: `系统治理 → 配置 → ${entry}`, mobileComponent: MobileConfigurationScreen, mobileEntry: `系统治理 → 配置范围 → ${entry}` });

export const GOVERNANCE_CAPABILITY_SURFACES = Object.freeze({
  "control.risk-posture": boundary("control.risk-posture", "current risk snapshot plus freshness and source", "风险态势"),
  "control.operating-mode": boundary("control.operating-mode", "selected mode and effective mode as separate facts", "运行模式"),
  "control.mandate-context": boundary("control.mandate-context", "Mandate by immutable mandate id and version", "当前授权"),
  "control.rule-monitor": boundary("control.rule-monitor", "Risk check by evaluation id and rule id", "规则监控"),
  "control.event-risk": eventInput("control.event-risk", "Event by event-risk window id", "read-only Event selection and route to configured source/rule editors", "事件窗口"),
  "control.permission-boundaries": boundary("control.permission-boundaries", "readiness chain evidence plus allowed/blocked action classes", "权限边界"),
  "operations.runtime-health": boundary("operations.runtime-health", "service topology node by registered service id", "运行拓扑"),
  "operations.tasks": operations("operations.tasks", "Task by persisted task id", "existing task run/pause/resume actions; system-managed definitions stay read-only", "任务 Registry"),
  "operations.task-runs": operations("operations.task-runs", "Agent/System Run by persisted run id", "read-only Run evidence selection", "Run 账本"),
  "operations.event-input-health": eventInput("operations.event-input-health", "Event source by persisted source id", "existing refresh and test actions; durable source edits remain in Configuration", "来源健康"),
  "operations.notifications": notifications("operations.notifications", "Notification by persisted notification id", "existing per-user mark-read action; delivery status is immutable", "通知证据"),
  "operations.audit": audit("operations.audit", "Audit log by immutable audit id", "审计账本"),
  "operations.reconcile": recovery("operations.reconcile", "Recovery by reconciliation report id", "existing protected /api/reconciler/run action", "权威对账"),
  "operations.recovery": recovery("operations.recovery", "Recovery, Risk incident, unknown execution or scheduler state by persisted id", "existing scheduler recovery and risk-incident resolve actions", "恢复队列"),
  "configuration.operating-mode": configuration("configuration.operating-mode", "Configuration scope operating-mode", "existing protected config save and server preflight", "运行模式"),
  "configuration.mandate": configuration("configuration.mandate", "Mandate draft/active id and immutable revision", "existing save then explicit activate actions", "交易授权"),
  "configuration.risk-rules": configuration("configuration.risk-rules", "Risk rule by persisted rule id", "existing create/update rule actions; system-managed rules disabled", "风险规则"),
  "configuration.environment": configuration("configuration.environment", "Configuration scope environment", "existing protected /api/config save", "环境"),
  "configuration.network": configuration("configuration.network", "Configuration scope network", "existing protected /api/config save", "网络"),
  "configuration.backup": configuration("configuration.backup", "Backup result by authoritative server result", "existing protected /api/system/backup action", "备份"),
  "configuration.security": configuration("configuration.security", "Security scope with masked credential metadata only", "existing security endpoints; secret clear is destructive-confirmed", "安全"),
  "configuration.exchange": configuration("configuration.exchange", "Exchange account and API metadata by persisted id", "existing exchange update and no-withdraw confirmation", "交易所"),
  "configuration.event-sources": configuration("configuration.event-sources", "Event source by persisted source id", "existing create/test/enable/delete/refresh actions", "事件源"),
  "configuration.notifications": configuration("configuration.notifications", "Notification channel by configured channel identity", "existing config save and channel test actions", "通知渠道"),
  "configuration.models": configuration("configuration.models", "Model/provider configuration with masked key status", "existing config save and preflight; no key plaintext", "模型与密钥"),
  "configuration.agents": configuration("configuration.agents", "Agent profile by persisted profile id", "existing profile PATCH within deployed tool/workflow boundary", "AI 交易员"),
  "configuration.users": configuration("configuration.users", "User by persisted user id", "existing Owner create/update/RBAC actions", "用户与权限"),
  "configuration.subscriptions": configuration("configuration.subscriptions", "Subscription by persisted subscription/user id", "existing Owner grant action and server lifecycle", "订阅"),
  "configuration.account-profile": configuration("configuration.account-profile", "current authenticated user id", "existing allowed profile update only", "账户资料", "authenticated identity; Owner authority only for cross-user changes")
});
