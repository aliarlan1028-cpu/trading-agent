const cancelled = Object.freeze({ ok: false, cancelled: true });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const noOp = () => undefined;

const safeId = (value) => encodeURIComponent(String(value ?? "").trim());

export function createGovernanceActions({ action = unavailableAction, confirm = async () => false, notify = noOp, navigate = noOp } = {}) {
  const protectedAction = async (message, options, endpoint, payload = {}, method) => {
    if (!await confirm(message, options)) return cancelled;
    return method ? action(endpoint, payload, method) : action(endpoint, payload);
  };

  return Object.freeze({
    navigate: (...args) => navigate(...args),
    runTask: (id) => action(`/api/tasks/${safeId(id)}/run`, {}),
    pauseTask: (id) => action(`/api/tasks/${safeId(id)}/pause`, { reason: "manual_ui" }),
    resumeTask: (id) => action(`/api/tasks/${safeId(id)}/resume`, {}),
    markNotificationsRead: () => action("/api/notifications/read", {}),
    reconcile: () => protectedAction(
      "Run authoritative account reconciliation now?",
      { title: "Run reconciliation" },
      "/api/reconciler/run",
      { mode: "manual_ui" }
    ),
    recoverScheduler: () => protectedAction(
      "Recover the task scheduler and revalidate its lease state?",
      { title: "Recover scheduler" },
      "/api/scheduler/recover",
      {}
    ),
    resolveRiskIncident: (id) => protectedAction(
      "Mark this risk incident resolved? The audit record remains immutable.",
      { title: "Resolve risk incident" },
      `/api/risk/incidents/${safeId(id)}/close`,
      {}
    ),
    refreshEventSources: () => action("/api/event-sources/refresh", {}),
    testEventSource: (id) => action(`/api/event-sources/${safeId(id)}/test`, {}),
    createEventSource: (payload) => action("/api/event-sources", payload),
    setEventSourceEnabled: (id, enabled) => action(`/api/event-sources/${safeId(id)}`, { enabled: enabled === true }, "PATCH"),
    deleteEventSource: (id, name = "this source") => protectedAction(
      `Delete event source “${String(name)}”? Historical events remain, but future fetching stops.`,
      { danger: true, title: "Delete event source" },
      `/api/event-sources/${safeId(id)}`,
      {},
      "DELETE"
    ),
    saveConfig: (payload) => protectedAction(
      "Apply this configuration target after server preflight?",
      { title: "Review and apply configuration" },
      "/api/config",
      payload
    ),
    saveMandate: (payload = {}) => {
      const { id, ...body } = payload;
      return protectedAction(
        "Save this trading mandate target? It does not become active until server activation succeeds.",
        { title: "Save trading mandate" },
        id ? `/api/mandates/${safeId(id)}` : "/api/mandates",
        body,
        id ? "PATCH" : "POST"
      );
    },
    activateMandate: (id) => protectedAction(
      "Activate this mandate after authoritative risk validation?",
      { title: "Activate mandate" },
      `/api/mandates/${safeId(id)}/activate`,
      {}
    ),
    createRiskRule: (payload) => protectedAction(
      "Create this deterministic risk rule?",
      { title: "Create risk rule" },
      "/api/risk/rules",
      payload
    ),
    updateRiskRule: (id, payload) => protectedAction(
      "Apply this risk-rule change after server validation?",
      { title: "Update risk rule" },
      `/api/risk/rules/${safeId(id)}`,
      payload,
      "PATCH"
    ),
    runBackup: () => protectedAction("Create and verify a system backup now?", { title: "Run backup" }, "/api/system/backup", {}),
    clearSecret: (key) => protectedAction(
      `Clear the stored secret “${String(key)}”?`,
      { danger: true, title: "Clear secret" },
      `/api/config/secret/${safeId(key)}`,
      {},
      "DELETE"
    ),
    confirmNoWithdraw: (id, exchange = "exchange") => protectedAction(
      `Confirm withdrawals are disabled for this ${String(exchange)} API key?`,
      { title: "Confirm withdrawal boundary" },
      `/api/exchange/api-key-metadata/${safeId(id)}/confirm-no-withdraw`,
      {}
    ),
    updateExchangeAccount: (id, payload) => protectedAction(
      "Apply this exchange connection target after server validation?",
      { title: "Update exchange connection" },
      `/api/exchange/accounts/${safeId(id)}`,
      payload,
      "PATCH"
    ),
    testNotification: (channel) => action(`/api/notifications/${safeId(channel)}-test`, {}),
    updateAgentProfile: (id, payload) => protectedAction(
      "Apply this AI Trader profile change?",
      { title: "Update AI Trader profile" },
      `/api/agent/profiles/${safeId(id)}`,
      payload,
      "PATCH"
    ),
    createUser: (payload) => protectedAction("Create this user and default subscription?", { title: "Create user" }, "/api/admin/users", payload),
    updateUser: (id, payload) => protectedAction(
      "Apply this user or RBAC change?",
      { title: "Update user access" },
      `/api/admin/users/${safeId(id)}`,
      payload,
      "PATCH"
    ),
    grantSubscription: (id, payload = {}) => protectedAction(
      "Grant this subscription through the deployed Owner action?",
      { title: "Grant subscription" },
      `/api/admin/users/${safeId(id)}/grant-free`,
      payload
    ),
    notify
  });
}

