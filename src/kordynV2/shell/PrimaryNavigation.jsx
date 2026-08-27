import { Bot, Boxes, ShieldCheck, WalletCards } from "lucide-react";
import { KORDYN_V2_DOMAINS } from "../architecture/domains.js";

const DOMAIN_ICONS = Object.freeze({
  ai: Bot,
  account: WalletCards,
  assets: Boxes,
  governance: ShieldCheck
});

function connectionHealth(state) {
  const kind = typeof state?.kind === "string" ? state.kind : "not_loaded";
  if (kind === "ready") return { tone: "mint", label: "系统在线" };
  if (["failed", "forbidden", "stale", "degraded", "disabled"].includes(kind)) {
    return { tone: "danger", label: "系统异常" };
  }
  return { tone: "unavailable", label: "Unavailable" };
}

export function PrimaryNavigation({ domainId, state, onNavigate }) {
  const health = connectionHealth(state);
  return (
    <aside className="kordynV2PrimaryNavigation" data-kordyn-v2-primary-nav>
      <div className="kordynV2Brand" aria-label="KORDYN">
        <span className="kordynV2BrandMark" aria-hidden="true">
          <img src="/kordyn-logo-white.svg" alt="" />
        </span>
        <span>KORDYN</span>
      </div>
      <nav aria-label="全局工作域">
        {KORDYN_V2_DOMAINS.map((domain) => {
          const Icon = DOMAIN_ICONS[domain.id];
          const active = domain.id === domainId;
          return (
            <button
              key={domain.id}
              type="button"
              className="kordynV2DomainTarget"
              data-kordyn-v2-domain-target={domain.id}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(domain.id, domain.defaultWorkspace)}
            >
              <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
              <span>{domain.label}</span>
            </button>
          );
        })}
      </nav>
      <footer
        className="kordynV2PrimaryFooter"
        data-health-tone={health.tone}
        role="status"
        aria-label={`连接状态：${health.label}`}
      >
        <span className="kordynV2Presence" aria-hidden="true" />
        <span>{health.label}</span>
      </footer>
    </aside>
  );
}
