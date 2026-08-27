import { KORDYN_V2_WORKSPACES } from "../architecture/domains.js";

export function WorkspaceNavigation({ domainId, workspaceId, onNavigate }) {
  const workspaces = KORDYN_V2_WORKSPACES[domainId] || KORDYN_V2_WORKSPACES.ai;
  return (
    <nav className="kordynV2WorkspaceNavigation" aria-label="域内工作区" data-kordyn-v2-workspace-nav>
      {workspaces.map((workspace) => {
        const active = workspace.id === workspaceId;
        return (
          <button
            key={workspace.id}
            type="button"
            data-kordyn-v2-workspace-target={workspace.id}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(domainId, workspace.id)}
          >
            {workspace.label}
          </button>
        );
      })}
    </nav>
  );
}
