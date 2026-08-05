// 轻量增量 i18n:适合大规模硬编码中文的渐进翻译。
// 用法:t("中文", "English") —— 当前语言 en 时返回英文、否则中文;没翻的地方直接留中文串即可(优雅降级)。
// 语言存 localStorage;切换后由 App 根 remount 全量重渲染,所有 t() 立即生效。
let current = "zh";
try { const v = localStorage.getItem("ui_lang"); if (v === "en" || v === "zh") current = v; } catch { /* SSR/隐私模式忽略 */ }

export function getLang() { return current; }
export function setLang(l) { current = l === "en" ? "en" : "zh"; try { localStorage.setItem("ui_lang", current); } catch { /* 忽略 */ } }
export function t(zh, en) { return current === "en" ? (en == null ? zh : en) : zh; }
