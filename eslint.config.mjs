// 最小 ESLint 配置：只抓"未定义标识符"这类会导致运行时 ReferenceError 的硬错误。
// 背景：vite build 不校验未导入的 JSX 组件（曾因 pages.jsx 缺 Trash2 导致全站白屏，commit 3ebbf9c）。
// 刻意不开风格类规则——本仓库无 lint 历史，风格规则会制造海量噪音掩盖真问题。
import react from "eslint-plugin-react";

const browserGlobals = {
  window: "readonly", document: "readonly", localStorage: "readonly", navigator: "readonly",
  fetch: "readonly", console: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
  setInterval: "readonly", clearInterval: "readonly", URL: "readonly", URLSearchParams: "readonly",
  AbortController: "readonly", EventSource: "readonly", WebSocket: "readonly", FileReader: "readonly",
  Blob: "readonly", crypto: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
  performance: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
  ResizeObserver: "readonly", IntersectionObserver: "readonly", atob: "readonly", btoa: "readonly",
  alert: "readonly", confirm: "readonly", prompt: "readonly", structuredClone: "readonly",
  queueMicrotask: "readonly", getComputedStyle: "readonly", CustomEvent: "readonly", Event: "readonly"
};
const nodeGlobals = {
  process: "readonly", console: "readonly", Buffer: "readonly", global: "readonly", globalThis: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  setImmediate: "readonly", URL: "readonly", URLSearchParams: "readonly", AbortController: "readonly",
  fetch: "readonly", crypto: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
  structuredClone: "readonly", queueMicrotask: "readonly", performance: "readonly",
  WebSocket: "readonly", __dirname: "readonly", require: "readonly", module: "readonly",
  FormData: "readonly", Blob: "readonly", Headers: "readonly", Request: "readonly", Response: "readonly"
};

export default [
  {
    files: ["src/**/*.jsx"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals
    },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error"
    }
  },
  {
    files: ["server/**/*.mjs", "scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: nodeGlobals },
    rules: { "no-undef": "error" }
  }
];
