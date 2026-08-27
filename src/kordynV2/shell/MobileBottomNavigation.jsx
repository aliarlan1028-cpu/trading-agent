import { Bot, Boxes, ShieldCheck, WalletCards } from "lucide-react";
import { KORDYN_V2_DOMAINS } from "../architecture/domains.js";

const DOMAIN_ICONS = Object.freeze({
  ai: Bot,
  account: WalletCards,
  assets: Boxes,
  governance: ShieldCheck
});

export function MobileBottomNavigation({ domainId, onNavigate }) {
  return (
    <nav className="kordynV2MobileBottomNavigation" aria-label="全局工作域" data-kordyn-v2-mobile-navigation>
      {KORDYN_V2_DOMAINS.map((domain) => {
        const Icon = DOMAIN_ICONS[domain.id];
        const active = domain.id === domainId;
        return (
          <button
            key={domain.id}
            type="button"
            data-kordyn-v2-domain-target={domain.id}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(domain.id, domain.defaultWorkspace)}
          >
            <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
            <span>{domain.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
