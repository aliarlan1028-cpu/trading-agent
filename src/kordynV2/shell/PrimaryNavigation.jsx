import { Bot, Boxes, ShieldCheck, WalletCards } from "lucide-react";
import { KORDYN_V2_DOMAINS } from "../architecture/domains.js";

const DOMAIN_ICONS = Object.freeze({
  ai: Bot,
  account: WalletCards,
  assets: Boxes,
  governance: ShieldCheck
});

export function PrimaryNavigation({ domainId, onNavigate }) {
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
      <footer className="kordynV2PrimaryFooter">
        <span className="kordynV2Presence" aria-hidden="true" />
        <span>系统在线</span>
      </footer>
    </aside>
  );
}
