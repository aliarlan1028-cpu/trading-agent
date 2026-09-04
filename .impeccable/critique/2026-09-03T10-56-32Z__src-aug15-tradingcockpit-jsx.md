---
target: 交易驾驶舱五页相对参考图的视觉差距
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-03T10-56-32Z
slug: src-aug15-tradingcockpit-jsx
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3/4 | Status labels exist, but the primary market area remains in a loading or empty state. |
| 2 | Match System / Real World | 3/4 | The five-page trading model is correct, but the professional analytical layer is compressed. |
| 3 | User Control and Freedom | 2/4 | Many reference filters, pagination controls, chart tools, and row actions are missing. |
| 4 | Consistency and Standards | 3/4 | Pages are internally consistent, but overuse a generic card grammar. |
| 5 | Error Prevention | 2/4 | Risk information exists, but visible constraints before trading actions remain limited. |
| 6 | Recognition Rather Than Recall | 3/4 | Labels are clear, but object marks, trends, and relationships are weak. |
| 7 | Flexibility and Efficiency | 2/4 | Reference shortcuts, bulk actions, and analysis entry points are absent. |
| 8 | Aesthetic and Minimalist Design | 2/4 | Large empty areas coexist with missing high-value analytical information. |
| 9 | Error Recovery | 1/4 | The chart empty state has no effective recovery path in current evidence. |
| 10 | Help and Documentation | 1/4 | AI explanations exist, but advanced metrics and actions lack contextual help. |
| **Total** | | **22/40** | **Structure works; visual and analytical completeness do not yet match the references.** |

## Design Specificity Verdict

The current implementation is a coherent trading administration UI, but it does not yet have the authored specificity of the five references. It reproduces their page skeleton and trading semantics, not their analytical completeness, density, or visual character.

The dominant cause is not insufficient simulated data. Estimated contribution: about 65% implementation/layout/style incompleteness, 20% fixture volume and shape, and 15% screenshot-harness/chart capture behavior.

The deterministic detector returned zero findings for `src/aug15/tradingCockpit.jsx`. Browser DOM inspection confirmed that all five pages and their fixture records render. A clean detector result does not establish visual parity.

## Overall Impression

The five-page information architecture is recognizable, but the result feels like a simplified enterprise dashboard beside a purpose-built professional trading terminal. The single largest opportunity is rebuilding the analytical visual layer rather than adding more generic rows.

## What's Working

- The five-tab immersive shell and page mapping match the reference family.
- Each page preserves the expected high-level composition and real trading object semantics.
- Warm white surfaces, orange current states, financial semantic colors, and the floating assistant establish a coherent base.

## Priority Issues

### [P1] Missing analytical visual layer

The references use candlesticks and volume, annotated chart controls, allocation donuts, gauges, breadth bars, P&L distributions, filled equity curves, key levels, and crypto asset marks. The implementation largely substitutes tables, text, basic rings, and single-line trends. Rebuild these as page-specific components.

Suggested command: `$impeccable layout`, then `$impeccable shape`.

### [P1] Skeleton-level rather than component-level fidelity

Market lacks chart tooling and rich derivatives/catalyst analysis; Positions lacks TP/SL, margin and row actions; Execution lacks detailed curve/distribution evidence and actionable optimization; Orders lacks filters, pagination, reference columns and richer lifecycle evidence. Fixtures cannot reveal components that do not exist.

Suggested command: `$impeccable clarify`.

### [P1] Chart fixture is not connected to the chart component

The fixture provides candle samples, but `TradingViewChart` ignores them and independently requests `/api/market/klines`. Overview and Market therefore show a chart loading/empty state in the evidence. Provide deterministic chart input in the validation environment while preserving real-data-only production behavior.

Suggested command: `$impeccable harden`.

### [P2] Sparse data amplified by fixed panel heights

Three positions, four reviews, four orders, and three fills are materially less dense than the references. Fixed minimum heights create large vacant areas. Add richer production-shaped fixtures for validation and make panel sizing respond to content.

Suggested command: `$impeccable adapt`.

### [P2] Weak hierarchy and generic visual language

Many labels and cells are approximately 8.5–10.5px. Uniform white cards, generic icons, weak number hierarchy, and repeated primitives make the experience category-interchangeable. Strengthen type scale, asset identity, state graphics, and page-specific visualization.

Suggested command: `$impeccable typeset`, then `$impeccable bolder`.

## Persona Red Flags

**Power trader:** Missing filters, chart tools, bulk actions, position controls, and execution evidence makes scanning and acting slower than the references imply.

**Risk-sensitive owner:** Risk numbers exist, but source-to-position-to-strategy-to-action relationships are not visually connected.

**First-time operator:** The interface is not overly complex, but small text, weak hierarchy, and large empty regions make important information hard to prioritize.

## Minor Observations

- The current green/red KORDYN mark and generic icon set diverge from the reference's stronger orange trading identity.
- Full-content screenshots use variable heights while references use a fixed 1448x1086 frame, slightly distorting direct comparison.
- The current overview trade flow merges orders and fills, creating duplicated-looking records.

## Questions to Consider

- Should the next pass target strict screenshot-level fidelity, or retain KORDYN branding while matching the reference's component anatomy and density?
- Which reference-specific controls are genuinely supported by production actions, and which must remain read-only presentation?
- Can every large region prove its value with real data, a deterministic validation fixture, or an explicit honest empty state?
