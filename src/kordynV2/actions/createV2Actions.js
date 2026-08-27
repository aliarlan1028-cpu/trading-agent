import { uiConfirm } from "../../confirm.jsx";

const cancelled = Object.freeze({ ok: false, cancelled: true });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const noOp = () => undefined;

export function createV2Actions({
  action = unavailableAction,
  confirm = uiConfirm,
  notify = noOp,
  download = noOp,
  navigate = noOp
} = {}) {
  void notify;

  const protect = async (message, options, endpoint, payload) => {
    if (!await confirm(message, options)) return cancelled;
    return action(endpoint, payload);
  };
  const reconcile = () => protect(
    "Run account, order, protection, and ledger reconciliation now? The result is written to audit.",
    { title: "Run reconciliation" },
    "/api/reconciler/run",
    { mode: "manual_ui" }
  );
  const flattenAll = () => protect(
    "Close every position at market? New entries will pause until authoritative reconciliation confirms completion.",
    { danger: true, title: "Flatten all positions" },
    "/api/risk/emergency-flatten",
    {}
  );
  const setKillSwitch = (enabled, reason = "") => protect(
    enabled
      ? "Activate the emergency stop and block all new trades?"
      : "Request clearing the emergency stop after backend revalidation?",
    { danger: enabled, title: enabled ? "Emergency stop" : "Clear emergency stop" },
    "/api/risk/kill-switch",
    { enabled: Boolean(enabled), reason: String(reason ?? "") }
  );
  const runNavigate = (...args) => navigate(...args);
  const runDownload = (...args) => download(...args);

  return Object.freeze({
    ai: Object.freeze({}),
    account: Object.freeze({}),
    assets: Object.freeze({}),
    governance: Object.freeze({}),
    global: Object.freeze({
      reconcile,
      flattenAll,
      setKillSwitch,
      navigate: runNavigate,
      download: runDownload
    })
  });
}
