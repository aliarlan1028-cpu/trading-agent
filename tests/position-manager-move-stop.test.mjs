import test from "node:test";
import assert from "node:assert/strict";
import { STOP_MOVE_SUCCESS, moveStopSucceeded } from "../server/positionManager.mjs";

// 回归:止损"移动成功"只能是交易所真正接受或幂等重放,绝不能把降级/拒单当成功。
// 旧 bug:positionManager 用 status !== "blocked" 判定成功,OKX 的 unsupported_move_stop_okx
// 不等于 blocked → 被误判成功 → 回写本地止损 + 推"✅已保本",但交易所侧止损纹丝未动。

test("move_stop 成功白名单:只认 ok/submitted/idempotent_replay", () => {
  assert.deepEqual([...STOP_MOVE_SUCCESS].sort(), ["idempotent_replay", "ok", "submitted"]);
  for (const s of ["ok", "submitted", "idempotent_replay"]) {
    assert.ok(moveStopSucceeded({ status: s }), `${s} 应判为已移动`);
  }
});

test("OKX 降级 unsupported_move_stop_okx 必须判为「未移动」(谎报保本的根因)", () => {
  assert.equal(moveStopSucceeded({ status: "unsupported_move_stop_okx" }), false);
});

test("其余失败/降级态一律「未移动」", () => {
  for (const s of ["blocked", "exchange_rejected", "missing_credentials", "instrument_spec_unavailable", "below_min_size", "partial_failure", "unsupported_action", undefined, null]) {
    assert.equal(moveStopSucceeded({ status: s }), false, `${s} 不应判为已移动`);
  }
  assert.equal(moveStopSucceeded(undefined), false);
  assert.equal(moveStopSucceeded(null), false);
});
