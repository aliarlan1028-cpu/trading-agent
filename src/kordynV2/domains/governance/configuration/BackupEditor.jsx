import { DatabaseBackup } from "lucide-react";
import { EditorFrame } from "./editorShared.jsx";
export function BackupEditor({ model = {}, actions, actionsDisabled = false }) { return <EditorFrame id="backup" title="备份" description="创建 SQLite 一致性备份并执行完整性验证。" target="manual verified backup" current={model.status || "Unavailable"} actionsDisabled={actionsDisabled} onSubmit={(event) => { event.preventDefault(); actions?.runBackup?.(); }}><div className="kordynV2ConfigAction"><DatabaseBackup size={20} /><span><strong>最近完成</strong><small>{model.completedAt || "Unavailable"}</small></span></div></EditorFrame>; }

