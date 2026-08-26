# KORDYN V2 Approved Concept Manifest

## Status

- Approved by the user on 2026-08-26.
- These files are the immutable visual authority for the authenticated Desktop and APP redesign.
- Product data, permissions, actions, errors, and safety semantics continue to come from production code. Text accidentally invented or misspelled by image generation is not a product claim and must be corrected during implementation without changing the approved composition.

## Fidelity contract

- Desktop comps are compared at `1440x900`. Their stored raster size is `1586x992`; the visual test harness must normalize the reference to the target viewport before overlay comparison.
- APP comps are compared at `390x844` and adapted at `430x932`. Their stored raster size is approximately `853x1844`; the harness must normalize the reference without changing the composition.
- Layout topology, region proportions, navigation, density, typography hierarchy, color relationships, border/elevation language, and state expression are binding.
- Semantic HTML, accessibility, responsive reflow, real copy, and real data are implementation responsibilities. They may correct raster-generation defects but may not recomcompose the page.

## Approved assets

| Domain | Surface | File | Stored pixels | SHA-256 |
| --- | --- | --- | --- | --- |
| AI 交易员 | Mission control | `.impeccable/mocks/kordyn-v2-approved/desktop-ai-mission-control.png` | 1586x992 | `55f988f9c87d1dce83d528bd2ad224b0951542cbab32eca018bf6c78818dbc20` |
| AI 交易员 | Signals / intelligence / watch / event calendar | `.impeccable/mocks/kordyn-v2-approved/desktop-ai-signals.png` | 1586x992 | `beec4a413a6c1c174ea25fed47c862163415a9d577771feace2a80c715e2b283` |
| 账户交易 | Position truth workspace | `.impeccable/mocks/kordyn-v2-approved/desktop-account-position.png` | 1586x992 | `38d6a875aa1cd26af0ef19510fe993255c572d97468ad9a940d734c92acfd148` |
| 智能资产 | Relationship overview | `.impeccable/mocks/kordyn-v2-approved/desktop-assets-relationship.png` | 1586x992 | `3e3678da9efdd9f14b024f9a727dfb2fc629efe2672322db4f3b08d340569f34` |
| 智能资产 | Strategy registry and studio | `.impeccable/mocks/kordyn-v2-approved/desktop-strategy-registry.png` | 1586x992 | `3712c52e241df44c31348a139da2803677674ac7d1e4a72433bc07377bf5fc85` |
| 智能资产 | Knowledge incubator | `.impeccable/mocks/kordyn-v2-approved/desktop-knowledge-incubator.png` | 1586x992 | `e25ae9442a3c72f9a76966752f83c63217cbe61105271c3fb02cbeaee8de95b7` |
| 智能资产 | Capability registry | `.impeccable/mocks/kordyn-v2-approved/desktop-capability-registry.png` | 1586x992 | `b11c8b42683c20a8c9994256f0ec754f37d39fd6109a2a496e1bb38a2dd8a649` |
| 智能资产 | Review, Owner queue, release, poster draft | `.impeccable/mocks/kordyn-v2-approved/desktop-review-owner-release.png` | 1586x992 | `468aa2d74347e6a52ad6d931726c3afcde2bd935d94df5bf9cef933f125961c6` |
| 系统治理 | Current boundary | `.impeccable/mocks/kordyn-v2-approved/desktop-governance-boundary.png` | 1586x992 | `ff3e1be00ead587259ef823ef4f17b17e5d4580af2018431d7af151141ca8200` |
| 系统治理 | Operations | `.impeccable/mocks/kordyn-v2-approved/desktop-governance-operations.png` | 1586x992 | `e0dc2e320cf6ed19f9ce0e14f983f7a0b91b06d33a1b0777f93699b0e2b67108` |
| 系统治理 | Configuration | `.impeccable/mocks/kordyn-v2-approved/desktop-governance-configuration.png` | 1586x992 | `9498438347d6097d0591161ad4c08538e8c2fe9a68ef4316ead6c6169991b58d` |
| AI 交易员 | Mobile mission home | `.impeccable/mocks/kordyn-v2-approved/mobile-ai-mission-home.png` | 853x1844 | `6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b` |
| AI 交易员 | Mobile one-shot approval task | `.impeccable/mocks/kordyn-v2-approved/mobile-ai-task-approval.png` | 853x1844 | `341997877d9cf8cbae27b6f2f31c5cb79b546927a3e5b3ac3d9efea5c11f0778` |
| 智能资产 | Mobile relationship overview | `.impeccable/mocks/kordyn-v2-approved/mobile-intelligent-assets.png` | 853x1844 | `6a2785438be0ebc43a522cd31d0c4f9253930467ee83d5c73b367eaa4375d1db` |
| 系统治理 | Mobile operations with open read-only AI support | `.impeccable/mocks/kordyn-v2-approved/mobile-system-governance.png` | 852x1846 | `cbcfd92d83b38a856e42da689347fe71b548911a4054ce7adb53ffadf4a1a9ac` |

## Navigation authority

### Desktop global domains

`AI 交易员 / 账户交易 / 智能资产 / 系统治理`

### Desktop local navigation

- AI 交易员: `任务 / 情报 / 观察哨 / 事件日历 / 对话`
- 账户交易: `市场 / 账户 / 持仓 / 计划 / 订单 / 成交`
- 智能资产: `关系总览 / 策略库 / 知识库 / 能力库 / 复盘与发布`
- 系统治理: `运行总览 / 任务与运行 / 事件输入 / 通知 / 审计 / 恢复 / 配置`

### APP global domains

`AI 交易员 / 账户交易 / 智能资产 / 系统治理`

No authenticated `Today`, `More`, Smart Forms, or DAO Governance destination may appear in the rebuilt navigation.
