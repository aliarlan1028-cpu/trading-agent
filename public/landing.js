(function () {
  "use strict";

  var I18N = {
    "nav.problem": ["问题", "Problem"],
    "nav.system": ["系统", "System"],
    "nav.capabilities": ["能力", "Capabilities"],
    "nav.compare": ["对比", "Compare"],
    "nav.guardrails": ["安全边界", "Guardrails"],
    "nav.contact": ["联系", "Contact"],
    "cta.dashboard": ["进入驾驶舱", "Open cockpit"],
    "cta.launch": ["启动驾驶舱", "Launch cockpit"],
    "cta.flightplan": ["查看飞行计划", "See the flight plan"],
    "cta.request": ["申请开通", "Request access"],
    "ticker.label": ["OKX 实时信号", "OKX LIVE SIGNAL"],
    "ticker.loading": ["正在接入实时行情…", "Connecting to live market data…"],
    "ticker.unavailable": ["实时行情暂不可用 · 正在自动重试", "LIVE FEED UNAVAILABLE · RETRYING"],
    "hero.kicker": ["有边界的自主智能", "BOUND AUTONOMOUS INTELLIGENCE"],
    "hero.statement": ["不是靠冲动起飞。<br>让 AI 把每一步变成有证据的航线。", "Not a launch on impulse.<br>AI turns every step into an evidenced flight path."],
    "hero.description": ["KORDYN 把交易所实时事实、专业知识、结构化计划、硬风控、受控执行与复盘连接起来，在你设定的资金与权限边界内持续工作。", "KORDYN connects live exchange facts, expert knowledge, structured plans, hard risk controls, controlled execution, and review—continuously operating within the capital and authority limits you define."],
    "hero.boundary1": ["默认只读", "Read-only by default"],
    "hero.boundary2": ["提现权限关闭", "Withdrawals disabled"],
    "hero.boundary3": ["每笔动作可追踪", "Every action traceable"],
    "hero.noteLabel": ["TO THE MOON", "TO THE MOON"],
    "hero.note": ["是对系统工程标准的要求，不是收益承诺。", "describes our engineering ambition—not a promise of returns."],
    "telemetry.market": ["市场事实已绑定", "Market facts bound"],
    "telemetry.risk": ["硬风控在线", "Hard risk online"],
    "console.title": ["决策证据链", "Decision evidence chain"],
    "console.fact1": ["账户绑定", "Account binding"],
    "console.fact2": ["市场事实", "Market facts"],
    "console.fact3": ["执行状态", "Execution state"],
    "console.bound": ["已验证", "VERIFIED"],
    "console.fresh": ["双时钟", "DUAL CLOCK"],
    "console.reconcile": ["持续对账", "RECONCILING"],
    "console.footer": ["模型负责判断，系统负责边界。", "The model reasons. The system enforces."],
    "lunar.captionTitle": ["可验证的智能", "Verifiable intelligence"],
    "lunar.captionText": ["API 事实先归一、校验、绑定证据，再进入模型。", "API facts are normalized, validated, and evidence-bound before the model sees them."],
    "proof.phases": ["个连续决策阶段", "connected decision phases"],
    "proof.clocks": ["交易所源时间 + 接收时间", "exchange source + receive time"],
    "proof.authority": ["套明确交易权限", "explicit authority envelope"],
    "proof.monitor": ["市场与仓位持续监控", "continuous market & position watch"],

    "problem.title": ["市场没有下班，人的注意力会。", "Markets never clock out. Human attention does."],
    "problem.lead": ["问题不是缺少信息，而是信息、判断、风险与执行彼此断开。交易者在多块屏幕间追赶，普通机器人只会重复规则，通用 Agent 又缺少真实交易状态。", "The problem is not a lack of information. Facts, judgment, risk, and execution are disconnected. Traders chase screens, fixed bots repeat rules, and general agents lack real trading state."],
    "problem.oneTitle": ["事实碎片化", "Fragmented facts"],
    "problem.oneText": ["行情、盘口、资金费率、OI、事件、账户与挂单散落在不同接口，单位和时间口径也不一致。", "Price, order book, funding, OI, events, accounts, and orders live across different interfaces with different units and clocks."],
    "problem.twoTitle": ["纪律难以持续", "Discipline decays"],
    "problem.twoText": ["人会疲劳、追涨、忽略事件窗口；固定机器人又无法理解新的市场语境和你的专业知识。", "People tire, chase moves, and miss event windows. Fixed bots cannot understand new context or apply your evolving expertise."],
    "problem.threeTitle": ["执行不等于闭环", "Execution is not closure"],
    "problem.threeText": ["下单只是开始。部分成交、止损、撤单、响应未知、费用和资金费都需要持续对账与恢复。", "Placing an order is only the start. Partial fills, stops, cancellations, unknown responses, fees, and funding all require reconciliation and recovery."],
    "problem.answerLabel": ["KORDYN 的回答", "KORDYN'S ANSWER"],
    "problem.answer": ["让 AI 负责持续理解，让确定性系统负责权限、风险和执行真相。", "Let AI sustain understanding—while deterministic systems own authority, risk, and execution truth."],

    "system.title": ["一条航线，连接感知、判断与行动。", "One flight path connects sensing, judgment, and action."],
    "system.lead": ["这不是“让模型直接下单”。每个阶段都有输入、证据、状态与明确后继；远端结果未知时进入恢复，而不是假装成功。", "This is not “let the model place orders.” Every phase has inputs, evidence, state, and a defined successor. Unknown remote outcomes enter recovery instead of being called success."],
    "system.sense": ["感知真实市场", "Sense the real market"],
    "system.senseText": ["OKX 行情、盘口、资金费率、OI、账户、持仓与订单，经单位和源时间校验。", "OKX prices, book, funding, OI, account, positions, and orders are validated for units and source time."],
    "system.recall": ["召回专业知识", "Recall expert knowledge"],
    "system.recallText": ["书籍、研究、规则、复盘与反方观点按当前问题组成证据包。", "Books, research, rules, reviews, and counter-views form an evidence bundle for the decision at hand."],
    "system.plan": ["生成结构化计划", "Build a structured plan"],
    "system.planText": ["方向、入场、止损、目标、仓位、失效条件与依据完整绑定。", "Direction, entry, stop, target, sizing, invalidation, and evidence are bound together."],
    "system.guard": ["通过硬风控闸", "Pass hard risk gates"],
    "system.guardText": ["权限、日亏损、杠杆、流动性、事件窗和同向风险在模型之外校验。", "Authority, daily loss, leverage, liquidity, event windows, and correlated exposure are checked outside the model."],
    "system.execute": ["受控执行与对账", "Execute and reconcile"],
    "system.executeText": ["稳定订单身份、幂等提交、状态轮询、保护确认和异常恢复共用一套状态机。", "Stable order identity, idempotent submission, polling, protection confirmation, and recovery share one state machine."],
    "system.monitor": ["持续管理仓位", "Continuously manage risk"],
    "system.monitorText": ["跟踪止损止盈、强平距离、移动保护与事件变化，只在证据充分时行动。", "Stops, targets, liquidation distance, trailing protection, and events are monitored; actions require sufficient evidence."],
    "system.review": ["财务对账与复盘", "Reconcile and review"],
    "system.reviewText": ["真实成交、手续费、返佣与资金费完成后，才进入净绩效与知识反馈。", "Only reconciled fills, fees, rebates, and funding enter net performance and the knowledge feedback loop."],

    "cap.title": ["不是一个聊天框，是一套交易操作系统。", "Not a chat box. A trading operating system."],
    "cap.lead": ["模型只是其中的判断层。真正让自主交易可用的，是事实、知识、风险、执行和审计共同工作。", "The model is only the reasoning layer. Useful autonomy comes from facts, knowledge, risk, execution, and audit working together."],
    "cap.evidenceTitle": ["交易所事实，先校验再进入 AI。", "Exchange facts are validated before AI sees them."],
    "cap.evidenceText": ["API Key 指纹、账户、实盘/模拟环境、分页完整性、张数与币量、交易所源时间全部绑定。缺失就是不可确认，不会被编成 0。", "API key fingerprint, account, production/demo environment, pagination completeness, contracts versus coins, and exchange source time are all bound. Missing means unknown—not zero."],
    "cap.knowledgeTitle": ["让知识在需要时出现。", "Knowledge appears when it matters."],
    "cap.knowledgeText": ["书籍和复盘沉淀为概念、方法、规则候选与关系图谱；未审批自由文本不会晋升为系统指令。", "Books and reviews become concepts, methods, candidate rules, and a relationship graph. Unapproved free text never becomes a system instruction."],
    "cap.riskTitle": ["AI 可以建议，不能越权。", "AI can advise. It cannot overrule authority."],
    "cap.riskText": ["单笔风险、杠杆、日亏损、事件静默期、市场新鲜度、保护单与账户权限由确定性代码把关。", "Per-trade risk, leverage, daily loss, event blackouts, market freshness, protection orders, and account permissions are enforced by deterministic code."],
    "cap.executionTitle": ["对响应未知保持诚实。", "Honest about unknown outcomes."],
    "cap.executionText": ["下单、撤单、平仓和保护动作拥有稳定身份与持久意图；进程重启后继续恢复，旧响应不能覆盖更新事实。", "Orders, cancellations, closes, and protection actions carry stable identity and durable intent. Recovery continues after restart; stale responses cannot overwrite newer truth."],
    "cap.auditTitle": ["结果不完整，就不写成精确收益。", "Incomplete results never become precise performance."],
    "cap.auditText": ["成交、真实手续费、返佣与资金费对账完成后才形成净结果；动作、依据与权限变更保留可追踪记录。", "Net results require reconciled fills, actual fees, rebates, and funding. Actions, evidence, and authority changes remain traceable."],

    "compare.title": ["AI Agent 很多，交易闭环很少。", "AI agents are everywhere. Closed trading loops are not."],
    "compare.lead": ["差别不在会不会聊天，而在它能否读懂真实账户、遵守确定性边界、处理执行异常，并解释最终结果。", "The difference is not conversation. It is whether the system understands real account state, obeys deterministic limits, survives execution anomalies, and explains final results."],
    "compare.dimension": ["关键能力", "CORE CAPABILITY"],
    "compare.manual": ["人工交易", "MANUAL TRADING"],
    "compare.bot": ["固定策略机器人", "RULE BOT"],
    "compare.general": ["通用 AI Agent", "GENERAL AI AGENT"],
    "compare.row1": ["理解实时市场语境", "Understands live market context"],
    "compare.row2": ["调用你的专业知识", "Applies your expertise"],
    "compare.row3": ["模型之外的硬风控", "Hard risk outside the model"],
    "compare.row4": ["远端结果未知与崩溃恢复", "Unknown outcomes & crash recovery"],
    "compare.row5": ["真实净绩效与审计", "True net performance & audit"],
    "compare.humanLimited": ["受精力限制", "Attention-limited"],
    "compare.ruleOnly": ["仅固定条件", "Fixed conditions only"],
    "compare.contextNoState": ["有语境，缺真实状态", "Context, but no real state"],
    "compare.factBound": ["交易所事实绑定", "Exchange-fact bound"],
    "compare.memory": ["依赖记忆", "Relies on memory"],
    "compare.hardcoded": ["需手工编码", "Must be hard-coded"],
    "compare.genericRag": ["泛化检索", "Generic retrieval"],
    "compare.graphRecall": ["知识图谱 + 审批规则", "Knowledge graph + approved rules"],
    "compare.selfDiscipline": ["靠自律", "Self-discipline"],
    "compare.basicLimits": ["基础阈值", "Basic thresholds"],
    "compare.promptRules": ["常依赖提示词", "Often prompt-based"],
    "compare.codeGuard": ["确定性代码闸门", "Deterministic code gates"],
    "compare.manualCheck": ["人工检查", "Manual checking"],
    "compare.varies": ["实现不一", "Varies"],
    "compare.noOms": ["通常无 OMS", "Usually no OMS"],
    "compare.durable": ["持久意图 + 对账恢复", "Durable intent + reconciliation"],
    "compare.manualJournal": ["手工复盘", "Manual journal"],
    "compare.tradeLog": ["交易日志", "Trade log"],
    "compare.narrative": ["多为文字总结", "Mostly narrative"],
    "compare.financial": ["费用/资金费对账 + 证据链", "Fee/funding reconciliation + evidence"],
    "compare.note": ["比较基于系统设计目标，不代表任何收益优劣；交易风险始终存在。", "Comparison describes system design goals, not return superiority. Trading risk always remains."],

    "guard.title": ["飞得更远之前，先知道哪里不能去。", "Before going farther, define where not to go."],
    "guard.lead": ["自主不等于无限授权。你定义市场、资金、杠杆、日亏损和有效期；系统只在边界内工作，异常时优先降风险。", "Autonomy is not unlimited authority. You define markets, capital, leverage, daily loss, and expiry. The system operates inside those limits and prioritizes risk reduction when facts deteriorate."],
    "guard.oneTitle": ["密钥不进入模型", "Secrets never enter the model"],
    "guard.oneText": ["API Secret、Passphrase 与敏感令牌隔离于模型上下文、前端和普通日志。", "API secrets, passphrases, and sensitive tokens are isolated from model context, the frontend, and ordinary logs."],
    "guard.twoTitle": ["权限由你定义", "You define authority"],
    "guard.twoText": ["交易所、币种、策略、单笔风险、杠杆、日亏损和有效期都有明确上限。", "Exchange, symbols, strategies, per-trade risk, leverage, daily loss, and expiry all have explicit limits."],
    "guard.threeTitle": ["保护无法证明则降级", "Unproven protection means degraded mode"],
    "guard.threeText": ["止损、订单、持仓或财务事实不可确认时，不会以“看起来正常”继续开仓。", "When stops, orders, positions, or financial facts cannot be proven, the system does not keep opening risk because things merely look normal."],
    "guard.fourTitle": ["一键停止与只减仓", "Emergency stop and reduce-only"],
    "guard.fourText": ["异常、事件窗口或操作员指令可暂停新仓，并持续跟踪撤单与退出结果。", "Anomalies, event windows, or an operator command can freeze new risk while cancellations and exits remain tracked."],
    "closing.title": ["TO THE MOON.<br><em>WITH A FLIGHT PLAN.</em>", "TO THE MOON.<br><em>WITH A FLIGHT PLAN.</em>"],
    "closing.text": ["让 AI 持续理解，让系统守住边界，让每一次行动都留下证据。", "Let AI sustain understanding, let the system hold the boundaries, and let every action leave evidence."],
    "footer.tagline": ["有边界的 AI 自主交易系统", "Bounded autonomous AI trading"],
    "footer.disclaimer": ["免责声明：KORDYN 不构成投资建议或收益承诺。数字资产与自动化交易风险极高，可能损失全部本金；实盘前必须完成安全、权限、风控和紧急停止演练。", "Disclaimer: KORDYN is not investment advice and makes no promise of returns. Digital assets and automated trading carry extreme risk, including total loss. Complete security, authority, risk, and emergency-stop reviews before live use."]
  };

  var lang = "zh";
  var tickerPayload = null;
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    var requested = new URLSearchParams(window.location.search).get("lang");
    lang = requested === "en" || requested === "zh" ? requested : (localStorage.getItem("ui_lang") || "zh");
  } catch (_error) { lang = "zh"; }
  if (lang !== "en" && lang !== "zh") lang = "zh";

  function textFor(key) {
    var value = I18N[key];
    return value ? value[lang === "en" ? 1 : 0] : key;
  }

  function applyLang(nextLang) {
    lang = nextLang;
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      var value = I18N[node.getAttribute("data-i18n")];
      if (value) node.textContent = value[lang === "en" ? 1 : 0];
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (node) {
      var value = I18N[node.getAttribute("data-i18n-html")];
      if (value) node.innerHTML = value[lang === "en" ? 1 : 0];
    });
    document.querySelectorAll('[data-action="lang"]').forEach(function (button) {
      button.textContent = lang === "en" ? "中文" : "EN";
    });
    try { localStorage.setItem("ui_lang", lang); } catch (_error) { /* local storage may be unavailable */ }
    renderTicker();
  }

  function formatPrice(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 1000) return number.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (number >= 1) return number.toFixed(2);
    if (number >= .01) return number.toFixed(4);
    return number.toFixed(6);
  }

  function createTickerGroup() {
    var group = document.createElement("div");
    group.className = "ticker-group";
    (tickerPayload.items || []).forEach(function (item) {
      var row = document.createElement("span");
      row.className = "ticker-item";
      row.append(document.createTextNode(item.symbol));
      var value = document.createElement("b");
      var change = Number(item.changePct);
      value.className = change >= 0 ? "up" : "down";
      value.textContent = formatPrice(item.last) + " " + (change >= 0 ? "↗ +" : "↘ ") + change.toFixed(2) + "%";
      row.append(value);
      group.append(row);
    });
    if (tickerPayload.fundingPct !== null && tickerPayload.fundingPct !== undefined) {
      var funding = document.createElement("span");
      funding.className = "ticker-item";
      funding.append(document.createTextNode("BTC FUNDING"));
      var fundingValue = document.createElement("b");
      var fundingNumber = Number(tickerPayload.fundingPct);
      fundingValue.className = fundingNumber >= 0 ? "up" : "down";
      fundingValue.textContent = (fundingNumber >= 0 ? "+" : "") + fundingNumber.toFixed(4) + "%";
      funding.append(fundingValue);
      group.append(funding);
    }
    if (Number.isFinite(Number(tickerPayload.btcOi))) {
      var oi = document.createElement("span");
      oi.className = "ticker-item";
      oi.append(document.createTextNode("BTC OI"));
      var oiValue = document.createElement("b");
      oiValue.textContent = Number(tickerPayload.btcOi).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " BTC";
      oi.append(oiValue);
      group.append(oi);
    }
    return group;
  }

  function renderTicker() {
    var track = document.getElementById("taTicker");
    if (!track) return;
    var tickerShell = track.closest(".ticker");
    track.replaceChildren();
    if (!tickerPayload || !Array.isArray(tickerPayload.items) || !tickerPayload.items.length) {
      track.classList.add("is-static");
      if (tickerShell) tickerShell.classList.toggle("is-unavailable", Boolean(tickerPayload));
      track.textContent = tickerPayload ? textFor("ticker.unavailable") : textFor("ticker.loading");
      return;
    }
    if (tickerShell) tickerShell.classList.remove("is-unavailable");
    track.classList.remove("is-static");
    var first = createTickerGroup();
    track.append(first, first.cloneNode(true));
    var time = document.getElementById("tickerTime");
    var stamp = new Date(tickerPayload.at || Date.now());
    if (time && Number.isFinite(stamp.getTime())) time.textContent = stamp.toLocaleTimeString(lang === "en" ? "en-GB" : "zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function fetchTicker() {
    fetch("/api/public/ticker-bar", { headers: { Accept: "application/json" } })
      .then(function (response) { if (!response.ok) throw new Error("ticker_http_" + response.status); return response.json(); })
      .then(function (payload) {
        if (payload && Array.isArray(payload.items) && payload.items.length) tickerPayload = payload;
        else if (!tickerPayload) tickerPayload = { items: [], error: payload?.error || "ticker_unavailable", at: payload?.at || new Date().toISOString() };
        renderTicker();
      })
      .catch(function () {
        if (!tickerPayload) tickerPayload = { items: [], error: "ticker_unavailable", at: new Date().toISOString() };
        renderTicker();
      });
  }

  function initReveal() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(".ta-reveal"));
    if (reducedMotion || !("IntersectionObserver" in window)) {
      nodes.forEach(function (node) { node.classList.add("ta-in"); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("ta-in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12, rootMargin: "0px 0px -6%" });
    nodes.forEach(function (node) { observer.observe(node); });
  }

  function initFlightAnimation() {
    if (reducedMotion) return;
    var steps = Array.prototype.slice.call(document.querySelectorAll(".flight-step"));
    var consoleSteps = Array.prototype.slice.call(document.querySelectorAll(".console-route span"));
    var systemModules = Array.prototype.slice.call(document.querySelectorAll(".os-module"));
    var boundaryBeacons = Array.prototype.slice.call(document.querySelectorAll(".boundary-beacon"));
    var index = 0;
    window.setInterval(function () {
      index = (index + 1) % steps.length;
      steps.forEach(function (step, stepIndex) {
        step.classList.toggle("is-active", stepIndex === index);
        step.classList.toggle("is-complete", stepIndex < index);
      });
      consoleSteps.forEach(function (step, stepIndex) { step.classList.toggle("is-active", stepIndex === index % consoleSteps.length); });
      systemModules.forEach(function (module, moduleIndex) { module.classList.toggle("is-active", moduleIndex === index % systemModules.length); });
      boundaryBeacons.forEach(function (beacon, beaconIndex) { beacon.classList.toggle("is-active", beaconIndex === index % boundaryBeacons.length); });
    }, 1800);
  }

  function initScrollState() {
    var nav = document.getElementById("siteNav");
    var progress = document.getElementById("scrollProgress");
    var queued = false;
    function update() {
      queued = false;
      var top = window.scrollY || document.documentElement.scrollTop || 0;
      if (nav) nav.classList.toggle("is-scrolled", top > 16);
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (progress) progress.style.width = Math.min(100, top / max * 100) + "%";
    }
    window.addEventListener("scroll", function () {
      if (!queued) { queued = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  function startAuth(mode) {
    try { window.parent.postMessage({ type: "lp-start", mode: mode }, window.location.origin); } catch (_error) { /* parent may be unavailable */ }
  }

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;
    var action = target.getAttribute("data-action");
    if (action === "login" || action === "subscribe") {
      event.preventDefault();
      startAuth(action === "subscribe" ? "subscribe" : "login");
    } else if (action === "contact") {
      event.preventDefault();
      window.open("https://t.me/e2ptradingclub", "_blank", "noopener,noreferrer");
    } else if (action === "lang") {
      event.preventDefault();
      applyLang(lang === "en" ? "zh" : "en");
    }
  });

  applyLang(lang);
  initReveal();
  initFlightAnimation();
  initScrollState();
  fetchTicker();
  window.setInterval(fetchTicker, 20000);
})();
