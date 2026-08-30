import { useEffect, useMemo, useRef, useState } from "react";
import { AccountWorkspace } from "./AccountWorkspace.jsx";
import { buildAccountDomainModel } from "./accountModel.js";
import { MarketWorkspace } from "./MarketWorkspace.jsx";
import { MobileAccountScreen } from "./MobileAccountScreen.jsx";
import { MobileMarketScreen } from "./MobileMarketScreen.jsx";
import { MobilePositionScreen } from "./MobilePositionScreen.jsx";
import { PositionWorkspace } from "./PositionWorkspace.jsx";
import "./account.css";

const disabledOutcome = Object.freeze({ ok: false, error: "action_disabled" });
const unavailableOutcome = Object.freeze({ ok: false, error: "action_unavailable" });
const failedOutcome = Object.freeze({ ok: false, error: "action_failed" });

const actionPresentation = (raw, threw = false) => {
  const failed = threw || raw?.ok === false;
  return Object.freeze({
    tone: failed ? "critical" : "unavailable",
    message: failed ? "操作未完成，请重试或检查当前权限。" : "服务端已返回结果，请以最新事实为准。"
  });
};

export async function runAccountAction({ action, run, onTransition = () => {} } = {}) {
  onTransition({ kind: "processing", action, raw: null, presentation: Object.freeze({ tone: "unavailable", message: "正在等待服务端结果…" }) });
  try {
    const raw = await run();
    onTransition({ kind: "result", action, raw, presentation: actionPresentation(raw) });
    return raw;
  } catch {
    onTransition({ kind: "result", action, raw: null, presentation: actionPresentation(null, true) });
    return failedOutcome;
  }
}

export function requestPositionExit(actions, order, actionsDisabled, surface) {
  if (actionsDisabled) return Promise.resolve(disabledOutcome);
  return typeof actions?.exitExecutionOrder === "function"
    ? actions.exitExecutionOrder(order, surface)
    : Promise.resolve(unavailableOutcome);
}

export function mobileDrilldownTransition(current = { view: "list" }, event = "reset") {
  if (event === "open") return { view: "detail", focus: "detail" };
  if (event === "back") return { view: "list", focus: "trigger" };
  return { view: current?.view === "detail" ? "detail" : "list", focus: null };
}

export function requestAccountReconciliation(actions, actionsDisabled) {
  if (actionsDisabled) return Promise.resolve(disabledOutcome);
  return typeof actions?.reconcile === "function" ? actions.reconcile() : Promise.resolve(unavailableOutcome);
}

export function requestWatchlistChange(actions, symbol, isWatched, actionsDisabled) {
  if (actionsDisabled) return Promise.resolve(disabledOutcome);
  const run = isWatched ? actions?.removeWatchlist : actions?.addWatchlist;
  return typeof run === "function" ? run(symbol) : Promise.resolve(unavailableOutcome);
}

export default function AccountDomain({ device, workspaceId, data, actions, actionsDisabled = false, truth, state, selection, onSelect }) {
  const model = useMemo(() => buildAccountDomainModel(data), [data]);
  const [mobileView, setMobileView] = useState("list");
  const [mobileFocus, setMobileFocus] = useState(null);
  const [actionOutcome, setActionOutcome] = useState(null);
  const mobileReturnFocusRef = useRef(null);
  const mobileDetailHeadingRef = useRef(null);
  const selectedMarketId = selection?.object?.type === "Market" ? selection.object.id : null;
  const selectedPositionObjectId = ["Position", "Execution"].includes(selection?.object?.type)
    ? selection.object.id
    : null;

  useEffect(() => {
    if ((workspaceId === "market" && selectedMarketId) || (workspaceId === "positions" && selectedPositionObjectId)) {
      const next = mobileDrilldownTransition({ view: mobileView }, "open");
      setMobileView(next.view);
      setMobileFocus(next.focus);
    } else {
      setMobileView("list");
      setMobileFocus(null);
    }
  }, [selectedMarketId, selectedPositionObjectId, workspaceId]);

  useEffect(() => {
    if (!mobileFocus) return;
    const target = mobileFocus === "detail" ? mobileDetailHeadingRef.current : mobileReturnFocusRef.current;
    target?.focus?.();
    setMobileFocus(null);
  }, [mobileFocus, mobileView]);

  const reconcile = () => runAccountAction({ action: "reconcile", run: () => requestAccountReconciliation(actions, actionsDisabled), onTransition: setActionOutcome });
  const changeWatchlist = (symbol, isWatched) => runAccountAction({ action: "watchlist", run: () => requestWatchlistChange(actions, symbol, isWatched, actionsDisabled), onTransition: setActionOutcome });
  const exitPosition = (order, surface) => runAccountAction({
    action: "exitExecutionOrder",
    run: () => requestPositionExit(actions, order, actionsDisabled, surface),
    onTransition: setActionOutcome
  });
  const selectMarket = (candidate, event) => {
    if (event?.currentTarget) mobileReturnFocusRef.current = event.currentTarget;
    if (selection?.object?.type === "Market" && selection.object.id === candidate?.id) {
      const next = mobileDrilldownTransition({ view: mobileView }, "open");
      setMobileView(next.view);
      setMobileFocus(next.focus);
    }
    onSelect(candidate);
  };
  const selectPosition = (candidate, event) => {
    if (event?.currentTarget) mobileReturnFocusRef.current = event.currentTarget;
    if (selection?.object?.type === candidate?.type && selection.object.id === candidate?.id) {
      const next = mobileDrilldownTransition({ view: mobileView }, "open");
      setMobileView(next.view);
      setMobileFocus(next.focus);
    }
    onSelect(candidate);
  };
  const openMobileDetail = (event) => {
    if (event?.currentTarget) mobileReturnFocusRef.current = event.currentTarget;
    const next = mobileDrilldownTransition({ view: mobileView }, "open");
    setMobileView(next.view);
    setMobileFocus(next.focus);
  };
  const closeMobileDetail = () => {
    const next = mobileDrilldownTransition({ view: mobileView }, "back");
    setMobileView(next.view);
    setMobileFocus(next.focus);
  };

  const interactionDisabled = actionsDisabled || actionOutcome?.kind === "processing";
  const shared = { model, truth, state, selection, actions, actionsDisabled: interactionDisabled, actionOutcome, onSelect, onReconcile: reconcile, onWatchlistChange: changeWatchlist, onExit: exitPosition };
  if (device === "mobile") {
    if (workspaceId === "market") return <MobileMarketScreen {...shared} view={mobileView} onSelect={selectMarket} onOpenList={closeMobileDetail} detailHeadingRef={mobileDetailHeadingRef} returnFocusRef={mobileReturnFocusRef} />;
    if (workspaceId === "positions") return <MobilePositionScreen {...shared} view={mobileView} onSelect={selectPosition} onOpenList={closeMobileDetail} detailHeadingRef={mobileDetailHeadingRef} returnFocusRef={mobileReturnFocusRef} />;
    if (workspaceId === "account") return <MobileAccountScreen {...shared} view={mobileView} onOpenList={closeMobileDetail} onOpenDetail={openMobileDetail} detailHeadingRef={mobileDetailHeadingRef} returnFocusRef={mobileReturnFocusRef} />;
    return null;
  }
  if (workspaceId === "market") return <MarketWorkspace {...shared} />;
  if (workspaceId === "positions") return <PositionWorkspace {...shared} />;
  if (workspaceId === "account") return <AccountWorkspace {...shared} />;
  return null;
}

export { AccountWorkspace } from "./AccountWorkspace.jsx";
export { MarketWorkspace } from "./MarketWorkspace.jsx";
export { MobileAccountScreen } from "./MobileAccountScreen.jsx";
export { MobileMarketScreen } from "./MobileMarketScreen.jsx";
export { MobilePositionScreen } from "./MobilePositionScreen.jsx";
export { MarketInstrumentPicker } from "./MarketInstrumentPicker.jsx";
export { PositionWorkspace } from "./PositionWorkspace.jsx";
