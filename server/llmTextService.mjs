import { completePrimaryChat, primaryModelRoute } from "./llmGateway.mjs";
import { containsLikelySecret } from "./secretRedaction.mjs";

export function activeProvider() {
  return primaryModelRoute();
}

// LLM 网关边界净化：数据库中的导入知识、Skill 说明或历史消息可能包含代码示例里的
// `\x` / `\u`、孤立 UTF-16 代理项或不可见控制字符。JSON.stringify 对标准服务是安全的，
// 但部分 OpenAI-compatible 网关会对 messages[].content 再做一次转义解析，进而把普通
// 文本中的反斜杠误当成十六进制转义并返回 unexpected end of hex escape。
// 这里只改变发给模型的副本，不修改知识库/记忆原文；全角反斜杠保留可读语义。
export function sanitizeLlmMessageContent(value = "") {
  const raw = String(value);
  const wellFormed = typeof raw.toWellFormed === "function"
    ? raw.toWellFormed()
    : raw.replace(/[\uD800-\uDFFF]/g, "�");
  return wellFormed
    .replace(/\\/g, "＼")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

export function assertExternalModelInputSafe(value, context = "model") {
  if (containsLikelySecret(value)) {
    const error = new Error(`检测到疑似安全凭证，已阻止发送到外部 ${context}`);
    error.code = "external_model_secret_blocked";
    throw error;
  }
}

export function sanitizeOpenAiMessages(messages = []) {
  return messages.map((message) => {
    if (typeof message?.content === "string") return { ...message, content: sanitizeLlmMessageContent(message.content) };
    if (Array.isArray(message?.content)) {
      return {
        ...message,
        content: message.content.map((part) => part?.type === "text" && typeof part.text === "string"
          ? { ...part, text: sanitizeLlmMessageContent(part.text) }
          : part)
      };
    }
    return message;
  });
}

// 简单文本补全（无工具），供知识蒸馏等复用。无 LLM key 时返回 null。
export async function llmComplete(userText, systemPrompt = "") {
  const provider = activeProvider();
  if (!provider) return null;
  assertExternalModelInputSafe({ userText, systemPrompt }, "LLM");
  try {
    const res = await completePrimaryChat({
      messages: sanitizeOpenAiMessages([
        { role: "system", content: systemPrompt || "你是专业的金融知识蒸馏助手。" },
        { role: "user", content: String(userText).slice(0, 24000) }
      ]),
      temperature: 0.2
    });
    return res.message?.content || null;
  } catch {
    return null;
  }
}
