// 营销页脚本(外置满足 CSP script-src 'self')。中英双语 + 实时行情 ticker + 揭示/计数/倒计时 + 按钮接真实登录/订阅/联系。
(function () {
  var GRAD = 'background: linear-gradient(120deg,#ffbe8a,#ff7a2f); -webkit-background-clip: text; background-clip: text; color: transparent;';

  // ---------- i18n 字典 ----------
  var I18N = {
    "nav.capabilities": ["能力", "Capabilities"],
    "nav.lifecycle": ["闭环", "Lifecycle"],
    "nav.guardrails": ["风控", "Guardrails"],
    "nav.knowledge": ["知识库", "Knowledge"],
    "nav.contact": ["联系我们", "Contact"],
    "cta.login": ["登录驾驶舱", "Enter cockpit"],
    "cta.loginArrow": ["登录驾驶舱 →", "Enter cockpit →"],
    "cta.subscribe": ["订阅更新", "Subscribe"],
    "ticker.loading": ["加载实时行情…", "Loading live prices…"],

    "hero.badge": ["数字货币自主交易 Agent", "Autonomous Crypto Trading Agent"],
    "hero.h1": [
      '授权后自主交易,<br><span style="' + GRAD + '">绝不无边界。</span>',
      'Autonomous once authorized —<br><span style="' + GRAD + '">never without bounds.</span>'
    ],
    "hero.sub": ["Authorized autonomy — never boundaryless execution.", "授权范围内自主执行,绝不越界。"],
    "hero.desc": [
      "学习你的交易体系,持续感知市场与事件,在授权范围内执行真实交易、管理仓位并复盘进化。每一步都被授权、硬风控与审计约束。",
      "It learns your trading system, continuously senses markets and events, and — within your mandate — executes real trades, manages positions and evolves through review. Every step is bound by authorization, hard risk controls and audit."
    ],
    "hero.trust": ["默认只读 · 提现权限永不开放", "READ-ONLY DEFAULT · WITHDRAW DISABLED"],

    "cockpit.title": ["COCKPIT · 驾驶舱", "COCKPIT"],
    "cockpit.pnl": ["今日盈亏 · TODAY PNL", "TODAY PNL"],
    "cockpit.equity": ["净值 · EQUITY", "EQUITY"],
    "cockpit.win": ["胜率 WIN", "WIN RATE"],
    "cockpit.dd": ["回撤 MAX DD", "MAX DD"],
    "cockpit.risk": ["风险 RISK", "RISK"],
    "cockpit.normal": ["NORMAL", "NORMAL"],
    "cockpit.view": ["AI 当前判断 · CURRENT VIEW", "AI CURRENT VIEW"],
    "cockpit.viewText": [
      "BTC 结构偏多,资金费率中性;FOMC 窗口临近,已收紧单笔风险至 0.8%,止损强制生效。",
      "BTC structure leans long, funding neutral; FOMC window approaching — per-trade risk tightened to 0.8%, stop-loss enforced."
    ],
    "cockpit.demoNote": ["示意界面 · 数据为演示", "Illustrative UI · demo data"],

    "metric.agents": ["专业 Agent 角色", "Specialized agents"],
    "metric.layers": ["层级硬风控", "Hard risk layers"],
    "metric.audit": ["可追踪 · 可审计", "Traceable & audited"],
    "metric.always": ["全天候感知执行", "Always-on"],

    "mandate.tag": ["授权许可证", "MANDATE"],
    "mandate.h2": ["你划定边界,<br>Agent 只在框内行动", "You set the boundaries,<br>the Agent acts only inside them"],
    "mandate.desc": [
      "交易所、币种、策略族、单笔风险、杠杆、日亏损与有效期——每一项都是可执行的硬约束。超出范围立即拦截。",
      "Exchange, symbols, strategy family, per-trade risk, leverage, daily stop and expiry — each is an enforceable hard constraint. Anything out of range is blocked instantly."
    ],
    "mandate.active": ["授权生效", "AUTHORIZED"],
    "mandate.riskPerTrade": ["单笔风险 · RISK / TRADE", "RISK / TRADE"],
    "mandate.maxLev": ["杠杆上限 · MAX LEVERAGE", "MAX LEVERAGE"],
    "mandate.dailyStop": ["日亏损熔断 · DAILY STOP", "DAILY STOP"],
    "mandate.symbols": ["币种白名单 · SYMBOLS", "SYMBOLS"],
    "mandate.expires": ["有效期 · EXPIRES", "EXPIRES"],

    "cap.tag": ["能力 · CAPABILITIES", "CAPABILITIES"],
    "cap.h2": ["四个专业角色,一套交易大脑", "Four specialist roles, one trading brain"],
    "cap.desc": [
      "AI 交易员、风控官、专家知识库与事件分析员协同运转,把感知、决策、执行与复盘连成闭环。",
      "The AI trader, risk officer, expert knowledge base and event analyst work in concert — closing the loop from sensing to decision, execution and review."
    ],
    "cap.trader": ["AI 交易员", "AI Trader"],
    "cap.traderDesc": [
      "生成交易假设与结构化交易计划,绑定 analysis bundle、风控检查与 trace,从入场理由到失效条件全部可解释。",
      "Forms trade hypotheses and structured plans bound to an analysis bundle, risk checks and traces — explainable from entry rationale to invalidation."
    ],
    "cap.risk": ["风控官", "Risk Officer"],
    "cap.riskDesc": [
      "在授权、风险、事件、执行与 Skill 五个层级校验每笔交易;超范围、无止损、超杠杆或高风险事件一律拦截。",
      "Validates every trade across five layers — mandate, risk, events, execution and skills; out-of-range, no-stop, over-leverage or high-risk events are all blocked."
    ],
    "cap.knowledge": ["专家知识库", "Expert Knowledge"],
    "cap.knowledgeDesc": [
      "把书籍、研报、链上数据与你的复盘蒸馏成概念、框架与规则;每个交易计划都会召回相关证据。",
      "Distills books, research, on-chain data and your reviews into concepts, frameworks and rules; every plan recalls the relevant evidence."
    ],
    "cap.events": ["事件分析员", "Event Analyst"],
    "cap.eventsDesc": [
      "跟踪 CPI、FOMC、ETF、交易所维护、链上异常与解锁,评估影响并实时传递给交易与风控。",
      "Tracks CPI, FOMC, ETF flows, exchange maintenance, on-chain anomalies and unlocks — scoring impact and feeding it live to trading and risk."
    ],

    "loop.tag": ["闭环 · LIFECYCLE", "LIFECYCLE"],
    "loop.h2": ["从感知到复盘的交易闭环", "A trading loop from sensing to review"],
    "loop.1t": ["市场与事件感知", "Sense markets & events"],
    "loop.1d": ["行情、盘口、资金费率、OI 与事件雷达持续输入。", "Prices, order book, funding, OI and an event radar stream in continuously."],
    "loop.2t": ["知识召回", "Knowledge recall"],
    "loop.2d": ["专家知识库生成 analysis bundle 作为决策依据。", "The knowledge base assembles an analysis bundle as decision evidence."],
    "loop.3t": ["结构化交易计划", "Structured trade plan"],
    "loop.3d": ["AI 交易员产出带止损、仓位与失效条件的计划。", "The AI trader outputs a plan with stop-loss, sizing and invalidation."],
    "loop.4t": ["授权范围校验", "Mandate check"],
    "loop.4d": ["MandateGuard 核对交易所、币种、策略与有效期。", "MandateGuard checks exchange, symbols, strategy and expiry."],
    "loop.5t": ["风控引擎校验", "Risk engine check"],
    "loop.5d": ["单笔风险、日亏损、杠杆、滑点与事件风险逐项检查。", "Per-trade risk, daily stop, leverage, slippage and event risk are each checked."],
    "loop.6t": ["受控执行", "Controlled execution"],
    "loop.6d": ["Executor 经统一连接器下单,幂等键 + 双通道对账。", "The executor places orders via a unified connector with idempotency keys and dual-channel reconciliation."],
    "loop.7t": ["仓位监控", "Position monitoring"],
    "loop.7d": ["监控成交、止损止盈、资金费率与失效条件并可触发熔断。", "Monitors fills, stops/targets, funding and invalidation — and can trip the kill switch."],
    "loop.8t": ["复盘进化", "Review & evolve"],
    "loop.8d": ["复盘盈亏归因与偏差,写回记忆与知识库候选规则。", "Reviews PnL attribution and drift, writing back to memory and candidate rules."],

    "guard.tag": ["风控 · GUARDRAILS", "GUARDRAILS"],
    "guard.h2": ["边界写进系统,<br>而非写进承诺", "Boundaries in the system,<br>not in promises"],
    "guard.desc": [
      "硬风控不是可选项。授权范围、密钥隔离与熔断机制在代码层强制执行,任何角色、任何 Skill 都无法绕过。",
      "Hard risk control is not optional. Mandate scope, key isolation and the kill switch are enforced in code — no role and no skill can bypass them."
    ],
    "guard.kill": ["一键熔断", "KILL SWITCH"],
    "guard.denyT": ["禁止提现权限", "No withdraw permission"],
    "guard.denyD": ["Trade 权限仅授权后启用,Withdraw 永不开放。", "Trade permission is enabled only after authorization; Withdraw is never granted."],
    "guard.isoT": ["API Secret 隔离", "API secret isolation"],
    "guard.isoD": ["不进入模型上下文、前端与普通日志。", "Never enters model context, the frontend or ordinary logs."],
    "guard.blockT": ["无止损即拒绝", "No stop, no trade"],
    "guard.blockD": ["无止损、超杠杆、超单笔风险的计划直接驳回。", "Plans without a stop, over leverage or over per-trade risk are rejected outright."],
    "guard.freezeT": ["高影响事件禁新仓", "Freeze on high-impact events"],
    "guard.freezeD": ["对账异常或高风险事件时仅允许降风险动作。", "On reconciliation anomalies or high-risk events, only risk-reducing actions are allowed."],
    "guard.sandT": ["第三方 Skill 不可直连", "Third-party skills sandboxed"],
    "guard.sandD": ["扫描、沙箱、权限声明后才能启用,不得直接下单。", "Enabled only after scanning, sandboxing and permission declaration — never allowed to place orders directly."],
    "guard.auditT": ["全程 append-only 审计", "End-to-end append-only audit"],
    "guard.auditD": ["交易、授权、风控与密钥变更不可被删除。", "Trades, authorizations, risk actions and key changes cannot be deleted."],

    "know.tag": ["知识库 · KNOWLEDGE", "KNOWLEDGE"],
    "know.h2": ["不是资料仓库,是长期专业大脑", "Not a document store — a long-term professional brain"],
    "know.desc": [
      "把书籍、研报、网页、GitHub 与你的复盘转化为可调用的概念、框架、规则与反方观点——并在每一次决策时召回。",
      "Turns books, research, web pages, GitHub and your reviews into callable concepts, frameworks, rules and counter-views — recalled on every decision."
    ],
    "know.sources": ["来源", "SOURCES"],
    "know.s1": ["金融书籍 / 研报", "Books / research"],
    "know.s2": ["网页 / RSS 订阅", "Web pages / RSS"],
    "know.s3": ["链上数据 / GitHub", "On-chain data / GitHub"],
    "know.s4": ["个人笔记 / 复盘", "Personal notes / reviews"],
    "know.distill": ["蒸馏", "DISTILL"],
    "know.d1": ["概念卡 · Concept", "Concept card"],
    "know.d2": ["理论框架卡 · Framework", "Framework card"],
    "know.d3": ["交易规则草案 · Rule", "Trade rule draft"],
    "know.d4": ["反方观点 · Counter", "Counter-view"],
    "know.runtime": ["运行时召回", "RUNTIME RECALL"],
    "know.runtimeDesc": [
      "每个自主交易计划都会调用知识库并生成 evidence bundle——知识不可用时自动降级为保守模式或禁止交易。",
      "Every autonomous plan calls the knowledge base and produces an evidence bundle — if knowledge is unavailable it downgrades to conservative mode or blocks trading."
    ],

    "ctaBand.h2": ["把交易体系交给一个有边界的 Agent", "Hand your trading system to an Agent with boundaries"],
    "ctaBand.desc": ["登录驾驶舱、订阅进展,或直接联系我们了解专属部署。", "Enter the cockpit, subscribe for updates, or contact us about a dedicated deployment."],

    "footer.disclaimer": [
      "免责声明:本系统不构成投资建议、收益承诺或法律意见。数字货币与自动化交易风险极高,生产上线前须完成安全、合规、交易所权限、风控与熔断演练评审。",
      "Disclaimer: this system is not investment advice, a profit guarantee or legal counsel. Crypto and automated trading carry substantial risk; a security, compliance, exchange-permission, risk and kill-switch review is required before production use."
    ]
  };

  var lang = "zh";
  try { lang = localStorage.getItem("ta_lang") || "zh"; } catch (e) {}
  if (lang !== "en" && lang !== "zh") lang = "zh";

  function applyLang(l) {
    lang = l;
    var i = l === "en" ? 1 : 0;
    document.documentElement.setAttribute("lang", l);
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var v = I18N[el.getAttribute("data-i18n")];
      if (v) el.textContent = v[i];
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var v = I18N[el.getAttribute("data-i18n-html")];
      if (v) el.innerHTML = v[i];
    });
    var btn = document.querySelector('[data-action="lang"]');
    if (btn) btn.textContent = l === "en" ? "中文" : "EN";
    try { localStorage.setItem("ta_lang", l); } catch (e) {}
    renderTicker(); // 重渲染 ticker 里的本地化提示
  }

  // ---------- 实时行情 ticker ----------
  var lastTicker = null;
  function fmtPrice(p) {
    if (!isFinite(p)) return "—";
    if (p >= 1000) return Math.round(p).toLocaleString("en-US");
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    return p.toFixed(6);
  }
  function tickerItem(label, valueHtml) {
    return '<span style="color:#a89a83; margin:0 17px; white-space:nowrap;">' + label + ' ' + valueHtml + '</span>';
  }
  function renderTicker() {
    var track = document.getElementById("taTicker");
    if (!track) return;
    if (!lastTicker || !lastTicker.items || !lastTicker.items.length) {
      var loading = I18N["ticker.loading"][lang === "en" ? 1 : 0];
      track.style.animation = "none";
      track.innerHTML = '<div style="display:flex; gap:34px; padding:0 17px; color:#8f836e;">' + loading + '</div>';
      return;
    }
    var parts = [];
    lastTicker.items.forEach(function (it) {
      var up = Number(it.changePct) >= 0;
      var col = up ? "#4fd08a" : "#ef6b52";
      var arrow = up ? "▲" : "▼";
      var chg = Math.abs(Number(it.changePct)).toFixed(2);
      parts.push(tickerItem(it.symbol, '<span style="color:' + col + '">' + fmtPrice(it.last) + ' ' + arrow + chg + '%</span>'));
    });
    if (lastTicker.fundingPct !== null && lastTicker.fundingPct !== undefined) {
      var f = Number(lastTicker.fundingPct);
      var fcol = f >= 0 ? "#4fd08a" : "#ef6b52";
      parts.push(tickerItem("BTC FUNDING", '<span style="color:' + fcol + '">' + (f >= 0 ? "+" : "") + f.toFixed(4) + '%</span>'));
    }
    if (lastTicker.btcOi) {
      var oi = Number(lastTicker.btcOi);
      var oiStr = oi >= 1e6 ? (oi / 1e6).toFixed(2) + "M" : oi >= 1e3 ? (oi / 1e3).toFixed(1) + "K" : String(Math.round(oi));
      parts.push(tickerItem("BTC OI", '<span style="color:#f2ead9">' + oiStr + " BTC</span>"));
    }
    var inner = '<div style="display:flex; align-items:center; padding:0 8px;">' + parts.join("") + "</div>";
    track.style.animation = ""; // 恢复 CSS marquee
    track.innerHTML = inner + inner; // 两份并排 → -50% 无缝循环
  }
  function fetchTicker() {
    fetch("/api/public/ticker-bar", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && Array.isArray(d.items)) { lastTicker = d; renderTicker(); } })
      .catch(function () { /* 拉取失败保持上一次 */ });
  }

  // ---------- 揭示 / 计数 / 进度条 / 倒计时 ----------
  function initAnimations() {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("ta-in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll(".ta-reveal").forEach(function (el) { io.observe(el); });

    function animCount(el) {
      var target = parseFloat(el.getAttribute("data-count"));
      var isInt = el.getAttribute("data-int");
      var suf = el.getAttribute("data-suffix") || "";
      var pre = el.getAttribute("data-prefix") || "";
      var dur = 1400, t0 = performance.now();
      function tick(now) {
        var p = Math.min(1, (now - t0) / dur);
        var ease = 1 - Math.pow(1 - p, 3);
        var v = target * ease;
        el.textContent = pre + (isInt ? Math.round(v) : v.toFixed(2)) + suf;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { animCount(e.target); cio.unobserve(e.target); } });
    }, { threshold: 0.6 });
    document.querySelectorAll("[data-count]").forEach(function (el) { cio.observe(el); });

    var bio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.style.width = e.target.getAttribute("data-w"); bio.unobserve(e.target); } });
    }, { threshold: 0.5 });
    document.querySelectorAll(".ta-bar").forEach(function (el) { bio.observe(el); });

    var cd = document.querySelector("[data-countdown]");
    if (cd) {
      var end = Date.now() + (14 * 86400 + 6 * 3600 + 12 * 60 + 44) * 1000;
      var pad = function (n) { return String(n).padStart(2, "0"); };
      setInterval(function () {
        var s = Math.max(0, Math.floor((end - Date.now()) / 1000));
        var d = Math.floor(s / 86400); s %= 86400;
        var h = Math.floor(s / 3600); s %= 3600;
        var m = Math.floor(s / 60), sec = s % 60;
        cd.textContent = d + "D " + pad(h) + ":" + pad(m) + ":" + pad(sec);
      }, 1000);
    }
  }

  // ---------- 按钮事件委托 ----------
  function startAuth(mode) {
    try { window.parent.postMessage({ type: "lp-start", mode: mode }, "*"); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    if (action === "login") { e.preventDefault(); startAuth("login"); }
    else if (action === "subscribe") { e.preventDefault(); startAuth("subscribe"); }
    else if (action === "contact") { e.preventDefault(); window.open("https://t.me/e2ptradingclub", "_blank", "noopener"); }
    else if (action === "lang") { e.preventDefault(); applyLang(lang === "en" ? "zh" : "en"); }
  });

  // ---------- 启动 ----------
  applyLang(lang);
  initAnimations();
  fetchTicker();
  setInterval(fetchTicker, 20000);
})();
