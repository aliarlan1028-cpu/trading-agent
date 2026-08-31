import { EditorFrame, TextField, submitFields } from "./editorShared.jsx";
export function NetworkEditor({ model = {}, actions, actionsDisabled = false }) { const value = model.proxy || model.httpProxy || "not configured"; return <EditorFrame id="network" title="网络" description="网络代理与连接边界。" target={value} current={value} actionsDisabled={actionsDisabled} onSubmit={(event) => submitFields(event, (fields) => actions?.saveConfig?.(fields))}><TextField label="HTTPS Proxy" name="HTTPS_PROXY" defaultValue={value} disabled={actionsDisabled} hint="凭据部分不会回显" /></EditorFrame>; }

