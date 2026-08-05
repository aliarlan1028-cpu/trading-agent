// 营销页脚本(外置以满足 CSP script-src 'self',不用内联)。
// 「Start Trading」→ 通知父页(React)唤起真实登录/订阅,营销页自身不做登录。
function sT() {
  try { window.parent.postMessage({ type: "lp-start" }, "*"); } catch (e) {}
}

// 事件委托:所有 [data-start] 按钮触发登录/订阅;[data-scroll] 滚动到锚点。
document.addEventListener("click", (e) => {
  const start = e.target.closest("[data-start]");
  if (start) { sT(); return; }
  const scroll = e.target.closest("[data-scroll]");
  if (scroll) {
    const el = document.getElementById(scroll.getAttribute("data-scroll"));
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }
});

// 滚动显现:进入视口即加 .in(CSS 负责淡入上移)。
const io = new IntersectionObserver(
  (es) => es.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
  }),
  { threshold: 0.1 }
);
document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));

// 数字滚动计数(装饰性,展示口径:5 视角 / 24-7 巡查 / 7 道风控等)。
function cu(id, to) {
  const el = document.getElementById(id);
  if (!el) return;
  let n = 0;
  const timer = setInterval(() => {
    n += Math.max(1, Math.ceil(to / 28));
    if (n >= to) { n = to; clearInterval(timer); }
    el.textContent = n;
  }, 34);
}
["c1", "c2", "s1", "s2", "s3", "s4"].forEach((id, i) => cu(id, [5, 24, 5, 7, 13, 100][i]));

// 顶部行情跑马灯(示意数据)。
const syms = [
  ["BTC", "64,292", "+0.3"], ["ETH", "3,148", "+1.2"], ["SOL", "172.4", "-0.8"],
  ["ADA", "0.192", "+2.1"], ["SUI", "0.693", "-0.2"], ["BNB", "604.1", "+0.4"],
  ["XRP", "0.612", "+1.7"], ["DOGE", "0.163", "-1.1"]
];
const one = syms
  .map((s) => `<span>${s[0]}/USDT</span> <b>${s[1]}</b> <span class="${s[2][0] === "-" ? "dn" : "up"}">${s[2]}%</span>`)
  .join("   ");
const tkrEl = document.getElementById("tkr");
if (tkrEl) tkrEl.innerHTML = one + "   " + one;
