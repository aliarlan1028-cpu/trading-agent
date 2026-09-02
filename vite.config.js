import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${process.env.PORT || 8787}`;
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        entryFileNames: (chunk) => `assets/${chunk.name === "app" ? "index" : chunk.name}-[hash].js`
      },
      input: {
        app: path.resolve(root, "index.html"),
        landing: path.resolve(root, "landing.html")
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": apiTarget
    }
  }
});
