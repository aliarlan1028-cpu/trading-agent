# August 15 Product UI Professional Polish Design

## Intent

Refine the currently deployed August 15 Web and Capacitor APP experience into one professional, readable, accessible trading product without changing product capability, information architecture, route ownership, API behavior, permissions, trading, execution, risk semantics, authentication behavior, or marketing content.

The approved direction is **system-first convergence**. The existing warm cream / ink / orange product world remains the incumbent design. This is not a zero-base redesign and does not revive retained Kordyn V2 or older visual generations.

## Current production boundary

- Production source: `src/main.jsx` lazily loads `src/aug15/App.jsx` through the legacy cutover.
- Authenticated Web and APP surfaces are React components under `src/aug15/**` plus `src/entry.css` and `src/aug15-auth.css`.
- Public marketing remains the isolated `public/landing.html`, `public/landing.css`, and `public/landing.js` iframe.
- Native APP is the Capacitor Web shell. Mobile layout may adapt independently, but it must preserve the same objects, actions, permissions, and state meanings.
- Retained zero-base and Kordyn V2 code is outside the visual implementation scope unless a build-boundary change is required to stop unused production assets loading.

## Audit evidence

The read-only baseline audit exercised 69 real production surfaces at 1440, 1280, 768, 430, and 390 pixels.

- No audited surface had document-level horizontal overflow.
- The full test baseline passed 2216/2216.
- The active UI contains about 587 KB decoded CSS and a large authenticated module graph.
- Active styles contain 40 `!important` declarations and about 2,900 literal color occurrences.
- Every audited 390/430 surface contained visible text below 11px and controls below 44px.
- Account settings, emergency confirmation, mobile drawers, and mobile sheets do not consistently implement labelled modal semantics, focus containment, Escape dismissal, and trigger focus return.
- Clickable Registry rows do not expose an equivalent keyboard activation path.
- The Research knowledge validation funnel collapses into one-character vertical labels at 1440px.
- At 768px, the product uses a stretched phone composition rather than a purposeful tablet layout.
- The direct marketing capture renders correctly. The prior blank iframe screenshot was a capture-timing artifact.

## Approved visual system

### Color

- Preserve warm canvas, white operational surfaces, deep ink, warm orange brand/action color, green success, amber warning, red danger, blue information, and purple secondary categorization.
- Use semantic tokens for foreground, surface, border, focus, action, success, warning, danger, information, and disabled states.
- Normal text and placeholders must reach at least 4.5:1 contrast. Large text and non-text controls must reach at least 3:1.
- Orange is not automatically safe for small text or white button labels. Use the higher-contrast orange text token for links and a dark-enough action orange for white button labels.

### Typography

- Keep the current Space Grotesk / Public Sans / Noto Sans SC family relationship.
- Use mono only for prices, measurements, timestamps, IDs, and code-like values.
- Desktop body text is 13–14px; APP body text is 14–15px.
- Essential metadata is at least 11px on desktop and 12px on APP.
- Page title, section title, body, metadata, and numeric value roles must have repeatable size and weight steps.

### Spacing and shape

- Retain the 4px spacing base and the current restrained 7–12px product radii.
- Use tighter spacing inside a semantic group and larger spacing between groups.
- Avoid introducing a new override stylesheet. Fix shared primitives and the selectors that own the current presentation.
- Use one elevation mechanism per surface: border for operational cards; soft shadow for floating overlays.

### Interaction

- APP touch targets are at least 44×44 CSS pixels.
- Desktop compact controls remain efficient but must be at least 32px high unless the control is part of a larger clickable row.
- Every interactive element has visible hover, focus-visible, active, disabled, loading, error, and success treatment where applicable.
- Account settings, danger confirmation, mobile drawers, and mobile sheets are labelled dialogs with focus containment, Escape dismissal, and trigger focus restoration.
- Clickable data rows support Enter and Space without changing their pointer behavior.
- Reduced-motion mode removes decorative motion while preserving visible state changes and focus feedback.

## Layout model

### Desktop

- Preserve the five-domain left navigation and existing page/tab ownership.
- AI Trader remains the primary work surface. Balance the conversation column against a readable contextual rail; do not leave a featureless central void while compressing account and risk facts.
- Cockpit uses a stable 12-column rhythm for truth metrics, chart, account, position, execution, and review information.
- Research registries use bounded filter / registry / inspector proportions. The validation funnel remains horizontal and readable at 1180 and 1440.
- Risk, Operations, and Settings use the same page header, tab, card, table, status, and action hierarchy as the core surfaces.

### Tablet

- At 768px, retain mobile navigation composition but use tablet-aware content widths and two-column arrangements where the content supports them.
- Conversation content has a readable maximum measure instead of stretching narrow mobile controls across the full screen.

### APP

- Preserve the five primary roots and the More drawer without duplicating root destinations.
- Keep context in sheets and stacked sections rather than shrinking desktop inspectors.
- Raise control size and type legibility without hiding capability or flattening state semantics.
- Preserve safe areas and avoid horizontal overflow at 390 and 430.

### Marketing and authentication

- Preserve marketing content, structure, and dark presentation.
- Preserve the APP Agent animation and all login, MFA, registration, subscription, consent, CAPTCHA, and server actions.
- Converge typography, orange, focus, form, and status tokens between public/auth and product surfaces without forcing identical backgrounds.

## Performance and code quality

- Do not load retained visual generations on the current production path.
- Keep authenticated CSS behind the existing authenticated lazy boundary.
- Split route-level production code only where it reduces initial work without changing route or data behavior.
- Remove obsolete declarations only when the owning active selector and visual evidence are understood.
- Do not add dependencies unless a current platform capability cannot satisfy the requirement.

## Verification contract

- RED→GREEN browser contracts for typography, touch targets, focus, keyboard activation, dialog semantics, research funnel geometry, tablet composition, and overflow.
- Real production screenshots at 1440×900, 1280×800, 768×1024, 430×932, and 390×844.
- Cover AI, Cockpit, Research, Risk, Operations, Settings, account modal, danger confirmation, APP drawer/sheets, auth, loading, connection failure, and marketing.
- Run focused tests, the complete Node suite, lint, production build, the August 15 visual runner, auth/entry runners, the professional-polish browser gate, Impeccable detector, and `git diff --check`.

## Non-goals

- No IA redesign, route renaming, feature removal, new trading ability, new Agent authority, mock production data, API change, database change, permission change, or business-copy rewrite.
- No reintroduction of the paper/ink/acid prototype, Kordyn V2 shell, or any earlier visual generation.
- No deployment until the polished production build and visual evidence have passed final review.
