import { latestSuccessfulAccountSnapshot } from "./store.mjs";

export function currentEquityUsdt(db) {
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  if (snapshot) {
    if (snapshot.exchange === "OKX") {
      const total = Number(snapshot.balances?.[0]?.totalEq);
      if (Number.isFinite(total) && total > 0) return total;
    }
  }
  const fromPortfolio = Number(db.portfolio?.totalEquityUsdt);
  return Number.isFinite(fromPortfolio) && fromPortfolio > 0 ? fromPortfolio : null;
}
