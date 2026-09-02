import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokenCss = readFileSync(new URL("../src/kordynV2/styles/tokens.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/kordynV2/styles/shell.css", import.meta.url), "utf8");
const appFrame = readFileSync(new URL("../src/appFrame.jsx", import.meta.url), "utf8");
const august15 = readFileSync(new URL("../src/aug15/App.jsx", import.meta.url), "utf8");
const productFoundation = readFileSync(new URL("../src/product-foundation.css", import.meta.url), "utf8");

const sharedV2FontTokens = {
  "--kordyn-v2-font": 'Inter, "Helvetica Neue", Arial, sans-serif',
  "--kordyn-sans": 'Inter, "Helvetica Neue", Arial, sans-serif',
  "--kordyn-display": '"Avenir Next", "Helvetica Neue", Arial, sans-serif',
  "--kordyn-mono": '"SFMono-Regular", "Roboto Mono", "Space Mono", ui-monospace, monospace'
};

function declarationInRule(css, selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "u"));
  return match?.[1].match(new RegExp(`${property}\\s*:\\s*([^;]+);`, "u"))?.[1].trim();
}

test("V2 sibling overlays inherit the V2 font token only through the active V2 body scope", () => {
  const v2BodyScope = "body:has(.kordynV2Root)";

  assert.match(productFoundation, /--kordyn-sans:\s*Inter,\s*"Helvetica Neue",\s*Arial,\s*sans-serif;/u, "V2 overlay text must keep the established authenticated Inter contract");
  for (const [property, value] of Object.entries(sharedV2FontTokens)) {
    assert.equal(
      declarationInRule(tokenCss, v2BodyScope, property),
      value,
      `${property} must be declared on the common ancestor of KordynV2Root and its ConfirmHost sibling`
    );
  }
  assert.match(appFrame, /\{children\}[\s\S]*?<ConfirmHost\s*\/>/u, "ConfirmHost must remain an AppFrame sibling of the authenticated root");
  assert.match(tokenCss, /body:has\(\.kordynV2Root\)\s+\.authenticatedAppFrame\s*\{[\s\S]*?font-family:\s*var\(--kordyn-sans\);/u, "the shared authenticated frame must carry the V2 font for ConfirmHost and ReleaseUpdateNotice siblings");
  assert.match(shellCss, /body:has\(\.kordynV2Root\)\s+\.cfmCard[\s\S]*?font-family:\s*var\(--kordyn-v2-font\)/u, "V2 ConfirmHost must consume the inherited token");
  for (const property of Object.keys(sharedV2FontTokens)) {
    assert.equal(declarationInRule(tokenCss, ".kordynV2Root", property), undefined, `${property} must not be stranded on the V2 root sibling`);
    assert.equal(declarationInRule(tokenCss, ".publicAppFrame", property), undefined, `${property} must not opt public marketing/login into V2`);
    assert.equal(declarationInRule(tokenCss, ".authenticatedAppFrame", property), undefined, `${property} must not opt legacy authenticated entry into V2`);
  }
  assert.doesNotMatch(august15, /kordynV2Root|kordyn-v2-font/u, "legacy Aug15 remains outside the V2 body scope");
});

test("V2 release notices are fixed above the authenticated root with a mobile touch target", () => {
  const releaseScope = "body:has(.kordynV2Root) .authenticatedAppFrame .releaseUpdateNotice";
  const releaseButtonScope = `${releaseScope} button`;

  assert.equal(declarationInRule(tokenCss, releaseScope, "position"), "fixed", "the release notice must escape the fixed V2 root stacking layer");
  assert.equal(declarationInRule(tokenCss, releaseScope, "z-index"), "1000", "the release notice must layer above V2 shell controls and below confirmation dialogs");
  assert.equal(declarationInRule(tokenCss, releaseScope, "display"), "flex", "the release notice must retain an explicit compact overlay layout");
  assert.equal(declarationInRule(tokenCss, releaseButtonScope, "min-height"), "44px", "the release update action must remain a mobile-sized touch target");
  assert.match(tokenCss, /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?body:has\(\.kordynV2Root\)\s+\.authenticatedAppFrame\s+\.releaseUpdateNotice\s*\{[\s\S]*?width:\s*auto;/u, "mobile V2 notices must remain within both viewport edges without a fixed-width overflow");
  assert.doesNotMatch(tokenCss, /\.publicAppFrame\s+\.releaseUpdateNotice/u, "public release notices must remain outside the V2 overlay scope");
});
