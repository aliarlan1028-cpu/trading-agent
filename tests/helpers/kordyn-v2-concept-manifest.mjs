import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const approvedRoot = ".impeccable/mocks/kordyn-v2-approved";

export const KORDYN_V2_TARGET_VIEWPORTS = Object.freeze([
  "1440x900",
  "1180x800",
  "390x844",
  "430x932"
]);

const desktopTargets = Object.freeze(["1440x900", "1180x800"]);
const mobileTargets = Object.freeze(["390x844", "430x932"]);

const comparisonScopes = Object.freeze({
  "desktop-ai-mission-control": Object.freeze(["shell", "ai"]),
  "desktop-ai-signals": Object.freeze(["ai"]),
  "desktop-account-position": Object.freeze(["account"]),
  "mobile-ai-mission-home": Object.freeze(["shell", "ai"]),
  "mobile-ai-task-approval": Object.freeze(["ai"])
});

const rows = [
  ["desktop-ai-mission-control", "AI 交易员", "Mission control", "desktop-ai-mission-control.png", 1586, 992, "55f988f9c87d1dce83d528bd2ad224b0951542cbab32eca018bf6c78818dbc20", "ai", "missions", "desktop", true],
  ["desktop-ai-signals", "AI 交易员", "Signals / intelligence / watch / event calendar", "desktop-ai-signals.png", 1586, 992, "beec4a413a6c1c174ea25fed47c862163415a9d577771feace2a80c715e2b283", "ai", "intelligence", "desktop", false],
  ["desktop-account-position", "账户交易", "Position truth workspace", "desktop-account-position.png", 1586, 992, "38d6a875aa1cd26af0ef19510fe993255c572d97468ad9a940d734c92acfd148", "account", "positions", "desktop", false],
  ["desktop-assets-relationship", "智能资产", "Relationship overview", "desktop-assets-relationship.png", 1586, 992, "3e3678da9efdd9f14b024f9a727dfb2fc629efe2672322db4f3b08d340569f34", "assets", "relationships", "desktop", false],
  ["desktop-strategy-registry", "智能资产", "Strategy registry and studio", "desktop-strategy-registry.png", 1586, 992, "3712c52e241df44c31348a139da2803677674ac7d1e4a72433bc07377bf5fc85", "assets", "strategies", "desktop", false],
  ["desktop-knowledge-incubator", "智能资产", "Knowledge incubator", "desktop-knowledge-incubator.png", 1586, 992, "e25ae9442a3c72f9a76966752f83c63217cbe61105271c3fb02cbeaee8de95b7", "assets", "knowledge", "desktop", false],
  ["desktop-capability-registry", "智能资产", "Capability registry", "desktop-capability-registry.png", 1586, 992, "b11c8b42683c20a8c9994256f0ec754f37d39fd6109a2a496e1bb38a2dd8a649", "assets", "capabilities", "desktop", false],
  ["desktop-review-owner-release", "智能资产", "Review, Owner queue, release, poster draft", "desktop-review-owner-release.png", 1586, 992, "468aa2d74347e6a52ad6d931726c3afcde2bd935d94df5bf9cef933f125961c6", "assets", "reviewRelease", "desktop", false],
  ["desktop-governance-boundary", "系统治理", "Current boundary", "desktop-governance-boundary.png", 1586, 992, "ff3e1be00ead587259ef823ef4f17b17e5d4580af2018431d7af151141ca8200", "governance", "overview", "desktop", false],
  ["desktop-governance-operations", "系统治理", "Operations", "desktop-governance-operations.png", 1586, 992, "e0dc2e320cf6ed19f9ce0e14f983f7a0b91b06d33a1b0777f93699b0e2b67108", "governance", "tasks", "desktop", false],
  ["desktop-governance-configuration", "系统治理", "Configuration", "desktop-governance-configuration.png", 1586, 992, "9498438347d6097d0591161ad4c08538e8c2fe9a68ef4316ead6c6169991b58d", "governance", "configuration", "desktop", false],
  ["mobile-ai-mission-home", "AI 交易员", "Mobile mission home", "mobile-ai-mission-home.png", 853, 1844, "6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b", "ai", "missions", "mobile", true],
  ["mobile-ai-task-approval", "AI 交易员", "Mobile one-shot approval task", "mobile-ai-task-approval.png", 853, 1844, "341997877d9cf8cbae27b6f2f31c5cb79b546927a3e5b3ac3d9efea5c11f0778", "ai", "missions", "mobile", false],
  ["mobile-intelligent-assets", "智能资产", "Mobile relationship overview", "mobile-intelligent-assets.png", 853, 1844, "6a2785438be0ebc43a522cd31d0c4f9253930467ee83d5c73b367eaa4375d1db", "assets", "relationships", "mobile", false],
  ["mobile-system-governance", "系统治理", "Mobile operations with open read-only AI support", "mobile-system-governance.png", 852, 1846, "cbcfd92d83b38a856e42da689347fe71b548911a4054ce7adb53ffadf4a1a9ac", "governance", "tasks", "mobile", false]
];

export const KORDYN_V2_CONCEPTS = Object.freeze(rows.map(([
  id, domainLabel, surface, filename, width, height, sha256, domainId, workspaceId, device, foundationComparison
]) => Object.freeze({
  id,
  domainLabel,
  surface,
  file: `${approvedRoot}/${filename}`,
  absoluteFile: path.join(rootDir, approvedRoot, filename),
  source: Object.freeze({ width, height }),
  sha256,
  domainId,
  workspaceId,
  device,
  targets: device === "desktop" ? desktopTargets : mobileTargets,
  foundationComparison,
  comparisonScopes: comparisonScopes[id] || Object.freeze([]),
  status: foundationComparison ? "implemented foundation shell" : "pending domain implementation",
  captures: foundationComparison
    ? Object.freeze((device === "desktop" ? desktopTargets : mobileTargets).map((viewport) => Object.freeze({
      viewport,
      file: `${device}-${viewport}.png`
    })))
    : Object.freeze([]),
  aiCaptures: comparisonScopes[id]?.includes("ai")
    ? Object.freeze((device === "desktop" ? desktopTargets : mobileTargets).map((viewport) => Object.freeze({
      viewport,
      file: `${id}--${viewport}.png`
    })))
    : Object.freeze([]),
  accountCaptures: comparisonScopes[id]?.includes("account") && device === "desktop"
    ? Object.freeze(desktopTargets.map((viewport) => Object.freeze({
      viewport,
      file: `${id}--${viewport}.png`
    })))
    : Object.freeze([])
})));
