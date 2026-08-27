import { Component } from "react";

function RecoveryState({ lang, onRetry, onUseLegacy }) {
  const chinese = lang === "zh";
  return (
    <section
      className="authenticatedEntryLoading"
      data-authenticated-state="v2-load-failed"
      role="alert"
      aria-live="assertive"
      aria-labelledby="kordyn-v2-load-error-title"
    >
      <div>
        <span>
          <b id="kordyn-v2-load-error-title">{chinese ? "KORDYN V2 加载失败" : "KORDYN V2 could not be loaded"}</b>
          <small>{chinese ? "请重试，或返回旧版工作区。服务器任务与数据不会被修改。" : "Retry, or return to the legacy workspace. Server tasks and data are unchanged."}</small>
        </span>
        <button type="button" data-v2-recovery-action="retry" onClick={onRetry}>{chinese ? "重试" : "Retry"}</button>
        <button type="button" data-v2-recovery-action="legacy" onClick={onUseLegacy}>{chinese ? "使用旧版界面" : "Use legacy interface"}</button>
      </div>
    </section>
  );
}

export class AuthenticatedV2Boundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  render() {
    if (this.state.failed) {
      return <RecoveryState lang={this.props.lang} onRetry={this.props.onRetry} onUseLegacy={this.props.onUseLegacy} />;
    }
    return this.props.children;
  }
}
