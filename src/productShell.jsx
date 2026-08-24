import React from "react";
import { CONFIGURATION_WORKSPACE, WORKSPACES } from "./productArchitecture.js";
import { t } from "./i18n.js";

const text = (value, fallback = "—") => value == null || value === "" ? fallback : String(value);

function groupViews(views) {
  return views.reduce((groups, view) => {
    const id = view.group || "views";
    let group = groups.find((item) => item.id === id);
    if (!group) {
      group = { id, label: view.group || "视图", labelEn: view.groupEn || "VIEWS", views: [] };
      groups.push(group);
    }
    group.views.push(view);
    return groups;
  }, []);
}

export function ProductWorkspaceFrame({ workspaceId, activeView, views = [], onViewChange = () => {}, inspector, children }) {
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : WORKSPACES.ai);
  const activeItem = views.find((view) => view.id === activeView) || views[0] || {
    label: workspace.label, labelEn: workspace.labelEn, description: workspace.purpose, descriptionEn: workspace.purposeEn
  };
  const groups = groupViews(views);
  return (
    <section className="productWorkspaceFrame" data-product-workspace={workspace.id}>
      <header className="productWorkspaceFrame__header">
        <div>
          <small>{workspace.code} / {t(workspace.eyebrow, workspace.eyebrowEn)}</small>
          <h1>{t(workspace.label, workspace.labelEn)}</h1>
          <p>{t(workspace.purpose, workspace.purposeEn)}</p>
        </div>
        <aside aria-label={t("当前视图", "Current view")}>
          <small>CURRENT WORKSPACE</small>
          <b>{t(activeItem.label, activeItem.labelEn)}</b>
          <span>{t(activeItem.description || "", activeItem.descriptionEn || activeItem.description || "")}</span>
        </aside>
      </header>
      {views.length > 0 && <nav className="productWorkspaceFrame__nav" aria-label={`${t(workspace.label, workspace.labelEn)} ${t("子页面", "sections")}`}>
        {groups.map((group) => <div key={group.id} className="productWorkspaceFrame__navGroup">
          <small>{t(group.label, group.labelEn)}</small>
          <div>{group.views.map((view) => <button type="button" key={view.id} aria-current={activeView === view.id ? "page" : undefined} className={activeView === view.id ? "active" : ""} onClick={() => onViewChange(view.id)}>{t(view.label, view.labelEn)}</button>)}</div>
        </div>)}
      </nav>}
      <div className={inspector ? "productWorkspaceFrame__grid" : "productWorkspaceFrame__grid productWorkspaceFrame__grid--single"}>
        <div className="productWorkspaceFrame__body">{children}</div>
        {inspector ? <aside className="productWorkspaceFrame__inspector">{inspector}</aside> : null}
      </div>
    </section>
  );
}

export function ObjectInspector({ object = {}, onOpenPrimary }) {
  const consumers = Array.isArray(object.consumers) ? object.consumers : object.consumers ? [object.consumers] : [];
  const canOpen = Boolean(object.primaryRoute && onOpenPrimary);
  return <section className="objectInspector" aria-label={t("对象详情", "Object inspector")}>
    <header><small>{text(object.type, "OBJECT")} · {text(object.id)}</small><h2>{text(object.title)}</h2><span>{text(object.status)}</span></header>
    <dl>
      <div><dt>SOURCE</dt><dd>{text(object.source)}</dd></div>
      <div><dt>VERSION</dt><dd>{text(object.version)}</dd></div>
      <div><dt>PERMISSION</dt><dd>{text(object.permission)}</dd></div>
      <div><dt>RISK</dt><dd>{text(object.risk)}</dd></div>
      <div><dt>CONSUMERS</dt><dd>{consumers.length ? <ul>{consumers.map((item) => <li key={item}>{item}</li>)}</ul> : "—"}</dd></div>
      <div><dt>NEXT ACTION</dt><dd>{text(object.nextAction)}</dd></div>
    </dl>
    <footer><small>PRIMARY WORKBENCH</small><button type="button" disabled={!canOpen} data-primary-route={object.primaryRoute || undefined} onClick={() => canOpen && onOpenPrimary(object.primaryRoute)}>{t("打开权威工作台", "Open primary workbench")}</button></footer>
  </section>;
}

function StatePanel({ kind, title, detail, onRetry }) {
  return <section className={`workspaceState workspaceState--${kind}`} role={kind === "error" ? "alert" : "status"}>
    <i aria-hidden="true" />
    <div><b>{title}</b>{detail && <span>{detail}</span>}</div>
    {onRetry && <button type="button" onClick={onRetry}>{t("重试", "Retry")}</button>}
  </section>;
}

export function WorkspaceStateBoundary({ resourceState = "loaded", empty = false, stale = false, degraded = false, forbidden = "", actionOutcome = null, onRetry, children }) {
  if (forbidden) return <StatePanel kind="forbidden" title={t("需要权限", "Permission required")} detail={t(`当前操作需要 ${forbidden} 权限。`, `This surface requires ${forbidden} permission.`)} />;
  if (resourceState === "not_loaded") return <StatePanel kind="loading" title={t("尚未加载", "Not loaded")} detail={t("进入工作区后再请求真实数据。", "Real data loads when the workspace opens.")} />;
  if (resourceState === "loading") return <StatePanel kind="loading" title={t("正在加载", "Loading")} detail={t("正在读取当前工作区事实。", "Loading current workspace facts.")} />;
  if (resourceState === "error") return <StatePanel kind="error" title={t("加载失败", "Workspace failed to load")} detail={t("空白不代表数据为零，请重新加载。", "Blank values do not mean zero. Retry the workspace request.")} onRetry={onRetry} />;
  if (empty) return <StatePanel kind="empty" title={t("暂无数据", "No data")} detail={t("当前筛选或权限范围内没有记录。", "No records exist in the current filter or permission scope.")} />;
  return <div className="workspaceStateBoundary">
    {stale && <StatePanel kind="warning" title={t("数据已陈旧", "Data is stale")} detail={t("保留最后有效事实；执行前需要刷新。", "The last valid facts remain visible; refresh before execution.")} onRetry={onRetry} />}
    {degraded && <StatePanel kind="warning" title={t("服务降级", "Service degraded")} detail={t("部分事实不可用，受影响的动作会保持关闭。", "Some facts are unavailable; affected actions remain closed.")} onRetry={onRetry} />}
    {actionOutcome?.kind === "error" && <StatePanel kind="error" title={t("操作失败", "Action failed")} detail={text(actionOutcome.message, t("服务端未确认变更。", "The server did not confirm the change."))} />}
    {actionOutcome?.kind === "success" && <StatePanel kind="success" title={t("操作已确认", "Action confirmed")} detail={text(actionOutcome.message)} />}
    {children}
  </div>;
}

