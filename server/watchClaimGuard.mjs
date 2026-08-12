const WATCH_REGISTRATION_CLAIM = /(?:(?:已|已经|刚刚|同步|帮你|我已|为你)[^。\n]{0,10}(?:登记|设置|设好|布好|建好|新增|更新)[^。\n]{0,8}(?:观察哨|哨兵))|(?:(?:观察哨|哨兵)[^。\n]{0,10}(?:已登记|已设置|已新增|已更新|已建好))/;

export function hasWatchRegistrationClaim(text = "") {
  return WATCH_REGISTRATION_CLAIM.test(String(text || ""));
}

export function hasSuccessfulWatchRegistration(toolTrace = []) {
  return (toolTrace || []).some((item) => {
    if (item?.name !== "register_watch") return false;
    return !/^(失败|拒绝|错误)/.test(String(item.summary || ""));
  });
}

export function correctUnbackedWatchRegistration(text = "", toolTrace = []) {
  const claimed = hasWatchRegistrationClaim(text);
  const registered = hasSuccessfulWatchRegistration(toolTrace);
  if (!claimed || registered) return { text: String(text || ""), corrected: false };
  return {
    corrected: true,
    text: `${String(text || "")}\n\n> ⚠️ **系统更正**：本轮声称新增或更新的观察条件**未实际调用登记工具**，因此本轮所述新条件不会自动盯盘；右侧已经登记的观察哨仍照常运行。请以「观察哨」面板中的实际记录为准。`
  };
}
