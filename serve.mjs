// 零依赖本地静态服务器: 用于在本机预览构建产物(dist)。
// 用法: node serve.mjs   (或 npm run start), 然后浏览器打开 http://localhost:4173/
// 浏览器安全限制: ES Module 构建产物不能用 file:// 双击打开, 必须经 HTTP 提供, 本脚本即为此而生。
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (urlPath === "/") urlPath = "/index.html";
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(DIST, safe);
    let st = await stat(filePath).catch(() => null);
    if (st && st.isDirectory()) {
      filePath = join(filePath, "index.html");
      st = await stat(filePath).catch(() => null);
    }
    if (!st) filePath = join(DIST, "index.html"); // SPA 回退
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error: " + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`船舶证书标注工具已启动 ->  http://localhost:${PORT}/`);
  console.log("(在本机浏览器打开上面的地址即可使用; 关闭此终端即停止服务)");
});
