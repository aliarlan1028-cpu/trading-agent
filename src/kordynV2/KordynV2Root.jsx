export function KordynV2Root({ api, lang, switchLang }) {
  const chinese = lang === "zh";
  const userName = api.data?.user?.name || (chinese ? "已认证用户" : "Authenticated user");

  return (
    <div className="kordynV2Root" data-kordyn-v2-root="foundation" lang={chinese ? "zh-CN" : "en"}>
      <header className="kordynV2FoundationHeader">
        <div>
          <small>KORDYN V2</small>
          <strong>{chinese ? "新工作区边界" : "New workspace boundary"}</strong>
        </div>
        <button type="button" onClick={() => switchLang(chinese ? "en" : "zh")}>
          {chinese ? "English" : "中文"}
        </button>
      </header>
      <main className="kordynV2FoundationCanvas">
        <span>{userName}</span>
        <h1>{chinese ? "交易工作区正在迁移" : "The trading workspace is migrating"}</h1>
        <p>{chinese ? "此隔离入口将承载新的四域界面。" : "This isolated entry will host the new four-domain interface."}</p>
      </main>
    </div>
  );
}
