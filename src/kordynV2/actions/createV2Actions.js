import { uiConfirm } from "../../confirm.jsx";
import { createAccountActions } from "../domains/account/accountActions.js";
import { createAiActions } from "../domains/ai/aiActions.js";

const cancelled = Object.freeze({ ok: false, cancelled: true });
const invalidKillSwitchState = Object.freeze({ ok: false, error: "invalid_kill_switch_state" });
const unavailableAction = async () => ({ ok: false, error: "action_unavailable" });
const noOp = () => undefined;

export function createV2Actions({
  action = unavailableAction,
  confirm = uiConfirm,
  notify = noOp,
  download = noOp,
  navigate = noOp
} = {}) {
  const protect = async (message, options, endpoint, payload) => {
    if (!await confirm(message, options)) return cancelled;
    return action(endpoint, payload);
  };
  const flattenAll = () => protect(
    "Close every position at market? New entries will pause until authoritative reconciliation confirms completion.",
    { danger: true, title: "Flatten all positions" },
    "/api/risk/emergency-flatten",
    {}
  );
  const setKillSwitch = (enabled, reason = "") => {
    if (typeof enabled !== "boolean") return invalidKillSwitchState;
    return protect(
      enabled
      ? "Activate the emergency stop and block all new trades?"
      : "Request clearing the emergency stop after backend revalidation?",
      { danger: enabled, title: enabled ? "Emergency stop" : "Clear emergency stop" },
      "/api/risk/kill-switch",
      { enabled, reason: String(reason ?? "") }
    );
  };
  const runNavigate = (...args) => navigate(...args);
  const runDownload = (...args) => download(...args);
  const ai = createAiActions({ action, confirm, notify, download, navigate });
  const account = createAccountActions({ action, confirm, navigate, download, ai });

  return Object.freeze({
    ai,
    account,
    assets: Object.freeze({}),
    governance: Object.freeze({}),
    global: Object.freeze({
      reconcile: account.reconcile,
      flattenAll,
      setKillSwitch,
      navigate: runNavigate,
      download: runDownload
    })
  });
}
