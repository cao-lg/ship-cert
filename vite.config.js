import { defineConfig } from "vite";

// 相对 base: 部署到 Cloudflare Pages 任意路径(含自定义子路径)都能正常加载资源
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 4000,
  },
});
