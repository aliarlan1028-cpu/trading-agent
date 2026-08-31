import { useEffect, useMemo, useState } from "react";
import { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
import { EventInputWorkspace } from "./EventInputWorkspace.jsx";
import { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
import { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";
import { buildGovernanceDomainModel } from "./governanceModel.js";
import { OperationsWorkspace } from "./OperationsWorkspace.jsx";
import { NotificationWorkspace } from "./NotificationWorkspace.jsx";
import { AuditWorkspace } from "./AuditWorkspace.jsx";
import { RecoveryWorkspace } from "./RecoveryWorkspace.jsx";
import { MobileNotificationScreen } from "./MobileNotificationScreen.jsx";
import { MobileAuditScreen } from "./MobileAuditScreen.jsx";
import { MobileRecoveryScreen } from "./MobileRecoveryScreen.jsx";
import { MobileOperationsScreen } from "./MobileOperationsScreen.jsx";
import { ConfigurationWorkspace } from "./ConfigurationWorkspace.jsx";
import { MobileConfigurationScreen } from "./MobileConfigurationScreen.jsx";
import { buildConfigurationModel } from "./configurationModel.js";
import "./governance.css";

const actionLabel = (key) => ({
  runTask: "运行任务",
  markNotificationsRead: "更新通知已读状态",
  reconcile: "运行权威对账",
  recoverScheduler: "恢复任务调度",
  saveConfig: "应用配置目标"
}[key] || "提交治理动作");

function actionState(result) {
  if (result?.status === "partial" || (Array.isArray(result?.failed) && result.failed.length)) return "partial";
  if (result?.ok === true || ["accepted", "success", "succeeded", "completed"].includes(result?.status)) return "success";
  return "failed";
}

function GovernanceActionStatus({ outcome }) {
  if (!outcome) return null;
  const copy = outcome.state === "processing"
    ? "等待服务端权威结果，不提前显示成功。"
    : outcome.state === "success"
      ? "服务端已接受并返回成功结果。"
      : outcome.state === "partial"
        ? "服务端只完成了部分影响；失败项仍保留待处理。"
        : "服务端未接受该动作；当前有效状态保持不变。";
  return <aside className="kordynV2GovernanceActionStatus" role="status" aria-live="polite" data-kordyn-v2-governance-action-state={outcome.state} data-kordyn-v2-governance-action={outcome.action}><strong>{outcome.label}</strong><span>{copy}</span></aside>;
}

export default function GovernanceDomain({ device, workspaceId, data, actions, actionsDisabled = false, selection, onSelect, onNavigate }) {
  const model = useMemo(() => buildGovernanceDomainModel(data), [data]);
  const configurationModel = useMemo(() => buildConfigurationModel(data), [data]);
  const [outcome, setOutcome] = useState(null);
  useEffect(() => setOutcome(null), [workspaceId]);
  const governedActions = useMemo(() => Object.freeze(Object.fromEntries(Object.entries(actions || {}).map(([key, value]) => {
    if (typeof value !== "function" || ["navigate", "notify"].includes(key)) return [key, value];
    return [key, async (...args) => {
      setOutcome({ action: key, label: actionLabel(key), state: "processing" });
      try {
        const result = await value(...args);
        setOutcome({ action: key, label: actionLabel(key), state: actionState(result), result });
        return result;
      } catch (error) {
        setOutcome({ action: key, label: actionLabel(key), state: "failed", error: error?.message || "request_failed" });
        throw error;
      }
    }];
  }))), [actions]);
  const pending = outcome?.state === "processing";
  const shared = { model, actions: governedActions, actionsDisabled: actionsDisabled || pending, selection, onSelect, onNavigate };
  let destination = null;
  if (workspaceId === "overview") destination = device === "mobile" ? <MobileBoundaryScreen {...shared} /> : <BoundaryWorkspace {...shared} />;
  else if (workspaceId === "event-inputs") destination = device === "mobile" ? <MobileEventInputScreen {...shared} /> : <EventInputWorkspace {...shared} />;
  else if (workspaceId === "runs") destination = device === "mobile" ? <MobileOperationsScreen {...shared} /> : <OperationsWorkspace {...shared} />;
  else if (workspaceId === "notifications") destination = device === "mobile" ? <MobileNotificationScreen {...shared} /> : <NotificationWorkspace {...shared} />;
  else if (workspaceId === "audit") destination = device === "mobile" ? <MobileAuditScreen {...shared} /> : <AuditWorkspace {...shared} />;
  else if (workspaceId === "recovery") destination = device === "mobile" ? <MobileRecoveryScreen {...shared} /> : <RecoveryWorkspace {...shared} />;
  else if (workspaceId === "configuration") destination = device === "mobile" ? <MobileConfigurationScreen model={configurationModel} actions={governedActions} actionsDisabled={actionsDisabled || pending} onSelect={onSelect} /> : <ConfigurationWorkspace model={configurationModel} actions={governedActions} actionsDisabled={actionsDisabled || pending} onSelect={onSelect} />;
  return <div className="kordynV2GovernanceDomain" data-kordyn-v2-governance-domain={workspaceId}><GovernanceActionStatus outcome={outcome} />{destination}</div>;
}

export { BoundaryWorkspace } from "./BoundaryWorkspace.jsx";
export { EventInputWorkspace } from "./EventInputWorkspace.jsx";
export { MobileBoundaryScreen } from "./MobileBoundaryScreen.jsx";
export { MobileEventInputScreen } from "./MobileEventInputScreen.jsx";
export { OperationsWorkspace } from "./OperationsWorkspace.jsx";
export { TaskRunWorkspace } from "./TaskRunWorkspace.jsx";
export { NotificationWorkspace } from "./NotificationWorkspace.jsx";
export { AuditWorkspace } from "./AuditWorkspace.jsx";
export { RecoveryWorkspace } from "./RecoveryWorkspace.jsx";
export { MobileOperationsScreen } from "./MobileOperationsScreen.jsx";
export { MobileTaskRunScreen } from "./MobileTaskRunScreen.jsx";
export { MobileNotificationScreen } from "./MobileNotificationScreen.jsx";
export { MobileAuditScreen } from "./MobileAuditScreen.jsx";
export { MobileRecoveryScreen } from "./MobileRecoveryScreen.jsx";
export { ConfigurationWorkspace } from "./ConfigurationWorkspace.jsx";
export { MobileConfigurationScreen } from "./MobileConfigurationScreen.jsx";
