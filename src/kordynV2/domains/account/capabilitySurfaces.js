import { AccountWorkspace } from "./AccountWorkspace.jsx";
import { FillWorkspace } from "./FillWorkspace.jsx";
import { MarketWorkspace } from "./MarketWorkspace.jsx";
import { MobileAccountScreen } from "./MobileAccountScreen.jsx";
import { MobileExecutionScreen } from "./MobileExecutionScreen.jsx";
import { MobileMarketScreen } from "./MobileMarketScreen.jsx";
import { MobilePositionScreen } from "./MobilePositionScreen.jsx";
import { OrderWorkspace } from "./OrderWorkspace.jsx";
import { PlanWorkspace } from "./PlanWorkspace.jsx";
import { PositionWorkspace } from "./PositionWorkspace.jsx";

const surface = ({
  id,
  workspaceId,
  route,
  objectIdentity,
  actionBoundary,
  resourceStateBoundary,
  desktopComponent,
  desktopEntry,
  mobileComponent,
  mobileEntry
}) => Object.freeze({
  id,
  domainId: "account",
  workspaceId,
  route,
  objectIdentity,
  actionBoundary,
  permissionBoundary: "authenticated identity + existing server-authoritative RBAC",
  resourceStateBoundary,
  desktop: Object.freeze({ component: desktopComponent, entry: desktopEntry }),
  mobile: Object.freeze({ component: mobileComponent, entry: mobileEntry })
});

export const ACCOUNT_CAPABILITY_SURFACES = Object.freeze({
  "live.overview": surface({
    id: "live.overview",
    workspaceId: "account",
    route: "marketAccount",
    objectIdentity: "read-only Account truth summary; no standalone mutable object",
    actionBoundary: "read-only cross-workspace account and trading truth",
    resourceStateBoundary: "account domain model freshness, reconciliation, and execution status",
    desktopComponent: AccountWorkspace,
    desktopEntry: "Live Desk → overview truth composition",
    mobileComponent: MobileAccountScreen,
    mobileEntry: "Live → compact truth and account detail"
  }),
  "live.market": surface({
    id: "live.market",
    workspaceId: "market",
    route: "market",
    objectIdentity: "Market by bounded market id/symbol from account model",
    actionBoundary: "existing watchlist and reconcile boundaries only",
    resourceStateBoundary: "market rows, watchlist, source freshness, and reconciliation state",
    desktopComponent: MarketWorkspace,
    desktopEntry: "Live Desk → Market cockpit",
    mobileComponent: MobileMarketScreen,
    mobileEntry: "Live → Market list/detail"
  }),
  "live.account": surface({
    id: "live.account",
    workspaceId: "account",
    route: "marketAccount",
    objectIdentity: "Account by unique exchangeAccounts[].id; snapshots are freshness evidence only",
    actionBoundary: "existing reconciliation action and read-only account detail facts",
    resourceStateBoundary: "exchange account, snapshot, and reconciliation availability",
    desktopComponent: AccountWorkspace,
    desktopEntry: "Live Desk → Account workspace",
    mobileComponent: MobileAccountScreen,
    mobileEntry: "Live → Account health/detail"
  }),
  "live.positions": surface({
    id: "live.positions",
    workspaceId: "positions",
    route: "positions",
    objectIdentity: "Position by canonical id → positionId → instId → symbol precedence",
    actionBoundary: "read-only position selection; protected exit stays on eligible execution order",
    resourceStateBoundary: "position facts, mirror provenance, and linked execution availability",
    desktopComponent: PositionWorkspace,
    desktopEntry: "Live Desk → Position registry/detail",
    mobileComponent: MobilePositionScreen,
    mobileEntry: "Live → Position list/detail"
  }),
  "live.execution": surface({
    id: "live.execution",
    workspaceId: "plans",
    route: "executionReview",
    objectIdentity: "Trade plan remains deployed object type `Trade plan`",
    actionBoundary: "existing approvePlan/rejectPlan delegation; no direct exchange order result implied",
    resourceStateBoundary: "trade plan status, risk check, account impact, and evidence availability",
    desktopComponent: PlanWorkspace,
    desktopEntry: "Live Desk → Trade plan approval lane",
    mobileComponent: MobileExecutionScreen,
    mobileEntry: "Live → Execution plans"
  }),
  "live.orders": surface({
    id: "live.orders",
    workspaceId: "orders",
    route: "tradeLedger",
    objectIdentity: "Execution and Order stay separate canonical object identities",
    actionBoundary: "read-only order lane; no cancel or amend action exists in this plan",
    resourceStateBoundary: "exchange acceptance is distinct from fill and financial finality",
    desktopComponent: OrderWorkspace,
    desktopEntry: "Live Desk → Execution and Order lanes",
    mobileComponent: MobileExecutionScreen,
    mobileEntry: "Live → Orders"
  }),
  "live.fills": surface({
    id: "live.fills",
    workspaceId: "fills",
    route: "tradeLedger",
    objectIdentity: "Fill by unique fill id and explicit lifecycle linkage",
    actionBoundary: "read-only fill facts and closed lifecycle inspection",
    resourceStateBoundary: "fill, lifecycle, performance, and review linkage availability",
    desktopComponent: FillWorkspace,
    desktopEntry: "Live Desk → Fills and lifecycle ledger",
    mobileComponent: MobileExecutionScreen,
    mobileEntry: "Live → Fills"
  }),
  "live.protection": surface({
    id: "live.protection",
    workspaceId: "positions",
    route: "positions",
    objectIdentity: "eligible Execution order linked to the selected Position",
    actionBoundary: "sole exitExecutionOrder boundary when execution-exit contract says eligible",
    resourceStateBoundary: "mirror timestamp/account/exchange, stop evidence, and risk incidents",
    desktopComponent: PositionWorkspace,
    desktopEntry: "Live Desk → Position protection rail",
    mobileComponent: MobilePositionScreen,
    mobileEntry: "Live → Position protection detail"
  }),
  "live.reconcile-status": surface({
    id: "live.reconcile-status",
    workspaceId: "account",
    route: "marketAccount",
    objectIdentity: "latest reconciliation report as freshness evidence, not an Account identity",
    actionBoundary: "existing reconcile action result and retry semantics",
    resourceStateBoundary: "reconciliation report availability, partial/failure result, and source time",
    desktopComponent: AccountWorkspace,
    desktopEntry: "Live Desk → Account reconciliation strip",
    mobileComponent: MobileAccountScreen,
    mobileEntry: "Live → Account health reconciliation"
  }),
  "live.review-status": surface({
    id: "live.review-status",
    workspaceId: "fills",
    route: "tradeLedger",
    objectIdentity: "Review by explicit review id/linkage only",
    actionBoundary: "existing openReviews navigation; navigation is not proof a Review exists",
    resourceStateBoundary: "review link availability and closed lifecycle review status",
    desktopComponent: FillWorkspace,
    desktopEntry: "Live Desk → Review link/status rail",
    mobileComponent: MobileExecutionScreen,
    mobileEntry: "Live → Review status"
  }),
  "live.closed-trade-poster": surface({
    id: "live.closed-trade-poster",
    workspaceId: "fills",
    route: "tradeLedger",
    objectIdentity: "Closed trade by explicit lifecycle id plus unique closed Execution id",
    actionBoundary: "downloadClosedTradePoster(executionId) through the authenticated server PNG endpoint",
    resourceStateBoundary: "poster eligibility only when reconciled Closed trade resolves one closed Execution",
    desktopComponent: FillWorkspace,
    desktopEntry: "Live Desk → Closed trade output sheet",
    mobileComponent: MobileExecutionScreen,
    mobileEntry: "Live → Closed trade output"
  })
});
