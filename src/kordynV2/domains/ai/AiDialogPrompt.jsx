import { Send, Sparkles } from "lucide-react";

export function AiDialogPrompt({ mobile = false, commandBar = false, onOpen = () => {} }) {
  return (
    <button
      className={mobile ? "kordynV2AiMobilePrompt kordynV2AiMobileAction" : "kordynV2AiMissionPrompt"}
      data-kordyn-v2-dialog-trigger
      data-kordyn-v2-mission-command-bar={commandBar ? "" : undefined}
      type="button"
      onClick={onOpen}
    >
      <Sparkles size={20} aria-hidden="true" />
      <span>{mobile ? "告诉 AI 交易员你的目标…" : "告诉 AI 交易员你的目标，或检查当前任务…"}</span>
      <Send size={18} aria-hidden="true" />
    </button>
  );
}
