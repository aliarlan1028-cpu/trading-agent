import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasJsonResponseProvenance, jsonResponseArrayValues } from "../jsonResponseProvenance.js";
import { createV2Actions } from "./actions/createV2Actions.js";
import { KORDYN_V2_DOMAINS, KORDYN_V2_WORKSPACES } from "./architecture/domains.js";
import { v2LocationForWorkspace } from "./architecture/routes.js";
import { DesktopShell } from "./shell/DesktopShell.jsx";
import { DestinationBoundary } from "./shell/DestinationBoundary.jsx";
import { MobileShell } from "./shell/MobileShell.jsx";
import { useV2Viewport } from "./shell/useV2Viewport.js";
import { buildAccountTruth } from "./viewModels/accountTruth.js";
import { buildAiSupportContext } from "./viewModels/aiSupport.js";
import { normalizeEvidenceDetails } from "./shell/evidenceDetails.js";
import { createV2Selection } from "./viewModels/selection.js";
import { normalizeResourceState } from "./viewModels/state.js";

const unavailable = "Unavailable";
const EMPTY_DATA = Object.freeze({});
const LazyAiDomain = lazy(() => import("./domains/ai/index.jsx"));
const LazyAccountDomain = lazy(() => import("./domains/account/index.jsx"));
const LazyAssetsDomain = lazy(() => import("./domains/assets/index.jsx"));
const ACCOUNT_WORKSPACE_BY_OBJECT_TYPE = Object.freeze({
  Market: "market",
  Account: "account",
  Position: "positions",
  "Trade plan": "plans",
  Execution: "orders",
  Order: "orders",
  Fill: "fills",
  "Closed trade": "fills",
  Review: "fills"
});

const safeText = (value, fallback = unavailable) => (
  ["string", "number", "boolean"].includes(typeof value) && value !== "" ? String(value) : fallback
);
const optionalText = (...values) => values.map((value) => safeText(value, "")).find(Boolean) || "";
const firstText = (...values) => optionalText(...values) || unavailable;
const list = (value) => Array.isArray(value) ? value : [];

function ownJsonData(record, key) {
  if (!hasJsonResponseProvenance(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function identityTruth(data) {
  const user = ownJsonData(data, "user");
  const explicitCount = ownJsonData(data, "notificationCount");
  const notifications = jsonResponseArrayValues(ownJsonData(data, "notifications"));
  return {
    name: optionalText(ownJsonData(user, "displayName"), ownJsonData(user, "name"), ownJsonData(user, "id")),
    notificationCount: Number.isInteger(explicitCount) && explicitCount >= 0 ? explicitCount : notifications?.length
  };
}

function firstSelectionCandidate(data) {
  const collections = [
    [data?.agentRuns, "Agent run", ["id", "agentRunId"]],
    [data?.watchTriggers, "Watch", ["id"]],
    [data?.events, "Event", ["id", "eventId"]],
    [data?.positions, "Position", ["id", "positionId", "instId", "symbol"]],
    [data?.tradePlans, "Trade plan", ["id"]]
  ];
  for (const [rows, type, fields] of collections) {
    for (const row of list(rows)) {
      const id = fields.map((field) => safeText(row?.[field], "")).find(Boolean);
      if (!id) continue;
      const candidate = { id, type };
      if (createV2Selection({ data, candidate })) return candidate;
    }
  }
  return null;
}

function accountLocationForSelection(candidate, viewport) {
  const scope = typeof candidate?.workspaceId === "string" ? candidate.workspaceId : "";
  if (scope && !["account", "live"].includes(scope)) return null;
  const workspaceId = ACCOUNT_WORKSPACE_BY_OBJECT_TYPE[candidate?.type];
  return workspaceId ? v2LocationForWorkspace("account", workspaceId, viewport) : null;
}

export function resolveEvidenceSelection({ data = EMPTY_DATA, selection = null, request = null } = {}) {
  let hasCandidate = false;
  let candidate = null;
  try {
    hasCandidate = Boolean(request && typeof request === "object" && Object.hasOwn(request, "candidate"));
    if (hasCandidate) candidate = request.candidate;
  } catch {
    return null;
  }
  return hasCandidate ? createV2Selection({ data, candidate }) : selection;
}

export function KordynV2Root({ api, lang }) {
  const viewport = useV2Viewport();
  const data = api?.data || EMPTY_DATA;
  const [location, setLocation] = useState(() => v2LocationForWorkspace("ai", "missions"));
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [evidenceRequest, setEvidenceRequest] = useState(null);
  const returnPromptFocusRef = useRef(false);
  const domain = KORDYN_V2_DOMAINS.find((item) => item.id === location.domainId) || KORDYN_V2_DOMAINS[0];
  const workspace = (KORDYN_V2_WORKSPACES[domain.id] || []).find((item) => item.id === location.workspaceId)
    || KORDYN_V2_WORKSPACES[domain.id][0];

  useEffect(() => {
    setLocation((current) => {
      const resolved = v2LocationForWorkspace(current.domainId, current.workspaceId, viewport);
      return resolved.resourceSection === current.resourceSection && resolved.objectId === current.objectId
        ? current
        : resolved;
    });
  }, [viewport]);

  useEffect(() => {
    Promise.resolve(api?.ensureSection?.(location.resourceSection)).catch(() => {});
  }, [api?.ensureSection, location.resourceSection]);

  const navigate = useCallback((domainId, workspaceId) => {
    returnPromptFocusRef.current = false;
    setLocation(v2LocationForWorkspace(domainId, workspaceId, viewport));
  }, [viewport]);

  const actions = useMemo(() => createV2Actions({
    action: api?.action,
    notify: api?.notify,
    download: api?.download,
    navigate
  }), [api?.action, api?.download, api?.notify, navigate]);

  const openDialog = useCallback(() => {
    returnPromptFocusRef.current = true;
    setLocation(v2LocationForWorkspace("ai", "dialog", viewport));
  }, [viewport]);

  const closeDialog = useCallback(() => {
    setLocation(v2LocationForWorkspace("ai", "missions", viewport));
  }, [viewport]);

  useEffect(() => {
    if (location.domainId !== "ai" || location.workspaceId !== "missions" || !returnPromptFocusRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector("[data-kordyn-v2-dialog-trigger]")?.focus();
      returnPromptFocusRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.domainId, location.workspaceId]);

  const defaultCandidate = useMemo(() => firstSelectionCandidate(data), [data]);
  const selection = useMemo(() => {
    const requested = createV2Selection({ data, candidate: selectedCandidate || defaultCandidate });
    return requested || (selectedCandidate ? createV2Selection({ data, candidate: defaultCandidate }) : null);
  }, [data, defaultCandidate, selectedCandidate]);

  const select = useCallback((candidate) => {
    const nextSelection = createV2Selection({ data, candidate });
    if (!nextSelection) return;
    const selectedObject = nextSelection.object;
    const targetLocation = accountLocationForSelection({
      ...candidate,
      id: selectedObject.id,
      type: selectedObject.type
    }, viewport);
    if (targetLocation) {
      returnPromptFocusRef.current = false;
      setLocation(targetLocation);
    }
    setSelectedCandidate({ id: selectedObject.id, type: selectedObject.type });
    return selectedObject;
  }, [data, viewport]);

  const truth = useMemo(() => buildAccountTruth(data, domain.truthMode), [data, domain.truthMode]);
  const resourceState = data?.resourceState?.[location.resourceSection] || (api?.data ? "loaded" : "loading");
  const state = useMemo(() => normalizeResourceState({
    resourceState,
    error: api?.connectionError || null,
    data: {
      source: firstText(data?.lastValidSource, data?.source, data?.meta?.source, data?.portfolio?.source),
      asOf: firstText(data?.lastValidAt, data?.asOf, data?.meta?.asOf, data?.portfolio?.marginSyncedAt)
    }
  }), [api?.connectionError, data, resourceState]);

  const retry = useCallback(() => {
    Promise.resolve(api?.ensureSection?.(location.resourceSection, { force: true })).catch(() => {});
  }, [api?.ensureSection, location.resourceSection]);

  const requestProof = useCallback((trigger, request = {}) => {
    const panel = ["details", "context", "proof"].includes(request?.panel) ? request.panel : "proof";
    setEvidenceRequest((current) => ({
      panel,
      details: normalizeEvidenceDetails(request?.details),
      selection: resolveEvidenceSelection({ data, selection, request }),
      token: (current?.token || 0) + 1,
      trigger
    }));
  }, [data, selection]);

  const identity = useMemo(() => identityTruth(data), [data]);
  const supportContext = useMemo(() => buildAiSupportContext({ data, location, selection, state }), [data, location, selection, state]);

  const destination = location.domainId === "ai"
    ? (
      <Suspense fallback={<div className="kordynV2AiDomainLoading" role="status">正在加载 AI 交易员工作区…</div>}>
        <LazyAiDomain
          device={viewport}
          workspaceId={location.workspaceId}
          data={data}
          actions={actions.ai}
          actionsDisabled={state.kind !== "ready"}
          truth={truth}
          selection={selection}
          onSelect={select}
          onOpenDialog={openDialog}
          onCloseDialog={closeDialog}
          onOpenProof={requestProof}
        />
      </Suspense>
    )
    : location.domainId === "account" && ["market", "account", "positions", "plans", "orders", "fills"].includes(location.workspaceId)
      ? (
        <Suspense fallback={<div className="kordynV2AccountDomainLoading" role="status">正在加载账户交易工作区…</div>}>
          <LazyAccountDomain
            device={viewport}
            workspaceId={location.workspaceId}
            data={data}
            actions={actions.account}
            actionsDisabled={state.kind !== "ready"}
            truth={truth}
            state={state}
            selection={selection}
            onSelect={select}
          />
        </Suspense>
      )
      : location.domainId === "assets"
        ? (
          <Suspense fallback={<div className="kordynV2AssetsDomainLoading" role="status">正在加载智能资产工作区…</div>}>
            <LazyAssetsDomain
              device={viewport}
              workspaceId={location.workspaceId}
              data={data}
              actions={actions.assets}
              actionsDisabled={state.kind !== "ready"}
              truth={truth}
              state={state}
              selection={selection}
              onSelect={select}
              onNavigate={navigate}
            />
          </Suspense>
        )
      : <DestinationBoundary domain={domain} workspace={workspace} location={location} state={state} />;

  const Shell = viewport === "mobile" ? MobileShell : DesktopShell;
  return (
    <div className="kordynV2Root" data-kordyn-v2-root={viewport} lang={lang === "en" ? "en" : "zh-CN"}>
      <Shell
        location={location}
        truth={truth}
        state={state}
        selection={selection}
        identity={identity}
        supportContext={supportContext}
        evidenceRequest={evidenceRequest}
        onNavigate={navigate}
        onSelect={select}
        onRetry={retry}
      >
        {destination}
      </Shell>
    </div>
  );
}
