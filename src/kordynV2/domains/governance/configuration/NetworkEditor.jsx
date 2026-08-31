import { useState } from "react";
import { EditorFrame } from "./editorShared.jsx";

export function NetworkEditor({ model = {}, actions, actionsDisabled = false }) {
  const [httpProxy, setHttpProxy] = useState("");
  const [httpsProxy, setHttpsProxy] = useState("");
  const dirty = Boolean(httpProxy.trim() || httpsProxy.trim());
  const summary = [model.httpProxySet && "HTTP", model.httpsProxySet && "HTTPS"].filter(Boolean).join(" + ") || "Unavailable";
  const submit = (event) => {
    event.preventDefault();
    const payload = {};
    if (httpProxy.trim()) payload.HTTP_PROXY = httpProxy.trim();
    if (httpsProxy.trim()) payload.HTTPS_PROXY = httpsProxy.trim();
    return Object.keys(payload).length ? actions?.saveConfig?.(payload) : undefined;
  };
  return <EditorFrame id="network" title="网络" description="代理值永不回显；这里只能输入替换值或通过密钥生命周期清除。" target={dirty ? "Replacement pending" : summary} current={summary} actionsDisabled={actionsDisabled} submitDisabled={!dirty} onSubmit={submit}>
    <div className="kordynV2ConfigurationFields">
      <label><span>HTTP Proxy 替换值</span><input type="password" name="HTTP_PROXY" autoComplete="new-password" value={httpProxy} onChange={(event) => setHttpProxy(event.target.value)} disabled={actionsDisabled} placeholder={model.httpProxySet ? "已配置；输入新值以替换" : "Unavailable；输入新值以配置"} /><small>当前值不会进入 DOM</small></label>
      <label><span>HTTPS Proxy 替换值</span><input type="password" name="HTTPS_PROXY" autoComplete="new-password" value={httpsProxy} onChange={(event) => setHttpsProxy(event.target.value)} disabled={actionsDisabled} placeholder={model.httpsProxySet ? "已配置；输入新值以替换" : "Unavailable；输入新值以配置"} /><small>当前值不会进入 DOM</small></label>
    </div>
  </EditorFrame>;
}
