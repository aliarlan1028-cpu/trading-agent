import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeLlmMessageContent, truncateUtf16Safely } from "../server/agentChat.mjs";

test("LLM 请求边界清除会被兼容网关二次解析的十六进制转义", () => {
  const input = String.raw`Skill 示例：\x、\x4、\u12、C:\trading\agent`;
  const clean = sanitizeLlmMessageContent(input);
  assert.equal(clean.includes("\\"), false);
  assert.match(clean, /＼x/);
  assert.match(clean, /C:＼trading＼agent/);
  assert.equal(JSON.parse(JSON.stringify({ messages: [{ content: clean }] })).messages[0].content, clean);
});

test("LLM 请求边界替换孤立代理项与非法控制字符但保留正常 emoji 和换行", () => {
  const clean = sanitizeLlmMessageContent(`正常😀\n孤立\uD800尾\u0000`);
  assert.match(clean, /正常😀\n孤立�尾 /);
  assert.equal(clean.includes("\u0000"), false);
});

test("提示词字符上限不会从 emoji 中间截出孤立 UTF-16 半字符", () => {
  const input = `1234😀尾`;
  const clipped = truncateUtf16Safely(input, 5, true);
  assert.equal(clipped, "1234…");
  assert.equal(clipped.isWellFormed?.() ?? true, true);
});
