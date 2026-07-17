import { defineConfig } from "vite";

// 构建期注入: 更新日期(取构建当天, 按东八区北京时间, 避免深夜构建显示"昨天")与版本号, 供页脚展示。
const APP_BUILD_DATE = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const APP_VERSION = "1.3.0";

// 相对 base: 部署到 Cloudflare Pages 任意路径(含自定义子路径)都能正常加载资源
export default defineConfig({
  base: "./",
  define: {
    __APP_BUILD_DATE__: JSON.stringify(APP_BUILD_DATE),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 4000,
  },
});
