const safeText = (value, fallback = "Unavailable") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const presentationText = (value) => safeText(value).replace(/^\s{0,3}#{1,6}\s+/gmu, "");

function posterDate(value, language) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Unavailable";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC"
  }).format(new Date(time));
}

export function PosterCanvas({ message, language = "zh", content }) {
  const english = language === "en";
  return (
    <article className="kordynV2PosterCanvas" data-kordyn-v2-poster-canvas data-language={english ? "en" : "zh"}>
      <header>
        <span className="kordynV2PosterBrand"><img src="/kordyn-logo.svg" alt="" /><span><strong>KORDYN</strong><small>AI TRADING OPERATING SYSTEM</small></span></span>
        <span className="kordynV2PosterEdition">FIELD NOTE / {safeText(message?.id, "LIVE").slice(-6).toUpperCase()}</span>
      </header>
      <section className="kordynV2PosterTitle">
        <small>ANALYSIS / AI TRADER</small>
        <h1>{english ? "MARKET FIELD NOTE" : "市场分析手记"}</h1>
        <p><span>{english ? "GENERATED" : "生成时间"}</span><time>{posterDate(message?.createdAt, language)}</time></p>
      </section>
      <section className="kordynV2PosterBody">
        <p>{presentationText(content)}</p>
      </section>
      <footer>
        <span>{english ? "SYSTEM-GENERATED / NOT FINANCIAL ADVICE" : "系统生成 / 仅供参考 / 不构成投资建议"}</span>
        <strong>{english ? "Audit the reasoning. Keep control." : "看见推理，保留控制。"}</strong>
      </footer>
    </article>
  );
}
