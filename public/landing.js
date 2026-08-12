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
    "cta.login": ["登录驾驶舱", "Open dashboard"],
    "cta.loginArrow": ["登录驾驶舱 →", "Open dashboard →"],
    "cta.subscribe": ["申请开通", "Request access"],
    "ticker.loading": ["加载实时行情…", "Loading live prices…"],

    "hero.badge": ["数字货币自主交易 Agent", "Autonomous crypto trading"],
    "hero.h1": [
      '让 Agent 自主交易，<br><span style="' + GRAD + '">让每一步都有边界。</span>',
      'Let the agent trade autonomously.<br><span style="' + GRAD + '">Keep every action within bounds.</span>'
    ],
    "hero.sub": ["真正自主执行，但始终受你设定的边界约束。", "Real autonomy, always inside the boundaries you set."],
    "hero.desc": [
      "学习你的交易体系,持续感知市场与事件,在授权范围内执行真实交易、管理仓位并复盘进化。每一步都被授权、硬风控与审计约束。",
      "It learns your trading approach, monitors markets and events around the clock, and can execute trades, manage positions, and learn from results—always within the permissions and risk limits you define. Every decision is traceable."
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

    "metric.agents": ["专业 Agent 角色", "Specialist AI roles"],
    "metric.layers": ["层级硬风控", "Hard risk layers"],
    "metric.audit": ["可追踪 · 可审计", "Traceable by design"],
    "metric.always": ["全天候感知执行", "Always monitoring"],

    "mandate.tag": ["交易权限", "TRADING PERMISSIONS"],
    "mandate.h2": ["你定义交易权限，<br>Agent 在边界内自主决策。", "You define the trading authority.<br>The agent decides within it."],
    "mandate.desc": [
      "交易所、币种、策略族、单笔风险、杠杆、日亏损与有效期——每一项都是可执行的硬约束。超出范围立即拦截。",
      "Choose the exchange, markets, strategies, risk per trade, leverage, daily loss limit, and expiry. These are enforced controls, not suggestions—anything outside them is blocked."
    ],
    "mandate.active": ["权限已生效", "PERMISSIONS ACTIVE"],
    "mandate.riskPerTrade": ["单笔风险 · RISK / TRADE", "RISK / TRADE"],
    "mandate.maxLev": ["杠杆上限 · MAX LEVERAGE", "MAX LEVERAGE"],
    "mandate.dailyStop": ["单日亏损上限 · DAILY LOSS LIMIT", "DAILY LOSS LIMIT"],
    "mandate.symbols": ["允许的交易对 · ALLOWED PAIRS", "ALLOWED PAIRS"],
    "mandate.expires": ["有效期 · EXPIRES", "EXPIRES"],

    "cap.tag": ["自主交易能力 · CAPABILITIES", "AUTONOMOUS CAPABILITIES"],
    "cap.h2": ["四个专业角色协同，从读懂市场到执行交易", "Four specialist roles, from market insight to trade execution"],
    "cap.desc": [
      "AI 交易员、风控官、专家知识库与事件分析员协同运转,把感知、决策、执行与复盘连成闭环。",
      "The AI trader, risk officer, knowledge system, and events analyst work together across research, decisions, execution, and review."
    ],
    "cap.trader": ["AI 交易员", "AI Trader"],
    "cap.traderDesc": [
      "生成交易假设与结构化交易计划,绑定 analysis bundle、风控检查与 trace,从入场理由到失效条件全部可解释。",
      "Turns market evidence into structured trade plans with clear entry logic, sizing, stops, targets, and invalidation conditions."
    ],
    "cap.risk": ["风控官", "Risk Officer"],
    "cap.riskDesc": [
      "在授权、风险、事件、执行与 Skill 五个层级校验每笔交易;超范围、无止损、超杠杆或高风险事件一律拦截。",
      "Checks every trade against permissions, risk limits, event risk, execution conditions, and strategy rules. Missing stops, excess leverage, and out-of-scope trades are blocked."
    ],
    "cap.knowledge": ["专家知识库", "Expert Knowledge"],
    "cap.knowledgeDesc": [
      "把书籍、研报、链上数据与你的复盘蒸馏成概念、框架与规则;每个交易计划都会召回相关证据。",
      "Turns books, research, on-chain data, and your own reviews into reusable concepts, frameworks, and rules that can support future decisions."
    ],
    "cap.events": ["事件分析员", "Event Analyst"],
    "cap.eventsDesc": [
      "跟踪 CPI、FOMC、ETF、交易所维护、链上异常与解锁,评估影响并实时传递给交易与风控。",
      "Tracks CPI, FOMC decisions, ETF flows, exchange maintenance, on-chain anomalies, and token unlocks, then feeds their potential impact into trading and risk decisions."
    ],

    "loop.tag": ["交易闭环 · LIFECYCLE", "TRADING LIFECYCLE"],
    "loop.h2": ["从发现机会到复盘改进，每一笔交易都有完整闭环", "From opportunity to review, every trade completes the loop"],
    "loop.1t": ["市场与事件感知", "Sense markets & events"],
    "loop.1d": ["行情、盘口、资金费率、OI 与事件雷达持续输入。", "Prices, order book, funding, OI and an event radar stream in continuously."],
    "loop.2t": ["知识召回", "Knowledge recall"],
    "loop.2d": ["专家知识库生成证据包，作为决策依据。", "The knowledge system gathers relevant evidence for the decision."],
    "loop.3t": ["结构化交易计划", "Structured trade plan"],
    "loop.3d": ["AI 交易员产出带止损、仓位与失效条件的计划。", "The AI trader outputs a plan with stop-loss, sizing and invalidation."],
    "loop.4t": ["交易权限校验", "Permission check"],
    "loop.4d": ["系统核对交易所、币种、策略与有效期是否在你的授权范围内。", "The system verifies that the exchange, market, strategy, and time window are within your permissions."],
    "loop.5t": ["风控引擎校验", "Risk engine check"],
    "loop.5d": ["单笔风险、单日亏损上限、杠杆、滑点与事件风险逐项检查。", "Per-trade risk, daily loss limits, leverage, slippage, and event risk are checked before execution."],
    "loop.6t": ["受控执行", "Controlled execution"],
    "loop.6d": ["执行器通过统一连接器下单，并防止重复下单、持续核对成交状态。", "Orders go through a single execution path with duplicate-order protection and continuous reconciliation."],
    "loop.7t": ["仓位监控", "Position monitoring"],
    "loop.7d": ["监控成交、止损止盈、资金费率与失效条件，必要时紧急停止新交易。", "Monitors fills, stops, targets, funding, and invalidation conditions, and can stop new trading in an emergency."],
    "loop.8t": ["复盘进化", "Review & evolve"],
    "loop.8d": ["复盘盈亏归因与偏差,写回记忆与知识库候选规则。", "Reviews PnL attribution and drift, writing back to memory and candidate rules."],

    "guard.tag": ["权限与风控 · GUARDRAILS", "AUTHORITY & GUARDRAILS"],
    "guard.h2": ["每一笔交易，<br>都必须通过权限与风控。", "Every trade<br>must pass permissions and risk controls."],
    "guard.desc": [
      "硬风控不是可选项。交易权限、密钥隔离与紧急停止机制在代码层强制执行，任何角色、任何 Skill 都无法绕过。",
      "Hard risk controls are enforced in code. Trading permissions, secret isolation, and emergency stops cannot be bypassed by an agent or third-party skill."
    ],
    "guard.kill": ["紧急停止", "EMERGENCY STOP"],
    "guard.denyT": ["禁止提现权限", "Withdrawals disabled"],
    "guard.denyD": ["交易权限仅在授权后启用，提现权限始终关闭。", "Trading is enabled only after authorization. Withdrawal access is never granted."],
    "guard.isoT": ["API Secret 隔离", "API secret isolation"],
    "guard.isoD": ["不进入模型上下文、前端与普通日志。", "Never enters model context, the frontend or ordinary logs."],
    "guard.blockT": ["无止损即拒绝", "No stop, no trade"],
    "guard.blockD": ["无止损、超杠杆、超单笔风险的计划直接驳回。", "Plans without a stop, over leverage or over per-trade risk are rejected outright."],
    "guard.freezeT": ["高影响事件禁新仓", "Freeze on high-impact events"],
    "guard.freezeD": ["对账异常或高风险事件时仅允许降风险动作。", "On reconciliation anomalies or high-risk events, only risk-reducing actions are allowed."],
    "guard.sandT": ["第三方 Skill 不可直连", "Third-party skills are isolated"],
    "guard.sandD": ["扫描、沙箱验证和权限声明全部通过后才能启用，第三方 Skill 不得直接下单。", "Third-party skills must pass scanning, sandbox validation, and permission review. They can never place orders directly."],
    "guard.auditT": ["全程 append-only 审计", "End-to-end append-only audit"],
    "guard.auditD": ["交易、授权、风控与密钥变更不可被删除。", "Trades, authorizations, risk actions and key changes cannot be deleted."],

    "know.tag": ["交易知识库 · KNOWLEDGE", "TRADING KNOWLEDGE"],
    "know.h2": ["把研究、策略与真实复盘，沉淀为下一次更好的决策", "Turn research, strategy, and real reviews into better decisions ahead"],
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

    "ctaBand.h2": ["让 AI 在你的规则内运行交易体系", "Put your trading process to work—within your rules"],
    "ctaBand.desc": ["登录驾驶舱、申请开通，或联系我们了解专属部署。", "Open the dashboard, request access, or contact us about a dedicated deployment."],

    "footer.disclaimer": [
      "免责声明：本系统不构成投资建议、收益承诺或法律意见。数字货币与自动化交易风险极高，生产上线前须完成安全、合规、交易所权限、风控与紧急停止演练评审。",
      "Disclaimer: This system does not provide investment advice, legal advice, or any guarantee of returns. Crypto assets and automated trading involve substantial risk. Review security, compliance, exchange permissions, risk limits, and emergency controls before live use."
    ]
  };

  var lang = "zh";
  try {
    var requestedLang = new URLSearchParams(window.location.search).get("lang");
    lang = (requestedLang === "en" || requestedLang === "zh")
      ? requestedLang
      : (localStorage.getItem("ui_lang") || "zh");
  } catch (e) {}
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
    try { localStorage.setItem("ui_lang", l); } catch (e) {}
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
