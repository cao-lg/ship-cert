// 用 pdf.js + @napi-rs/canvas 把【已标注】PDF 的日期页渲染成 PNG,
// 作为"红/蓝框确实落在日期文字上"的视觉证据(无需浏览器, 坐标即用输出文件本身)。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const SRC = process.env.SRC || "dist/demo-annotated.pdf";
const OUT = process.env.OUT || "test/shots";
mkdirSync(OUT, { recursive: true });

const pages = (process.env.PAGES || "5,9,10,42").split(",").map((s) => parseInt(s, 10));
const SCALE = Number(process.env.SCALE || "2.2");

const data = new Uint8Array(readFileSync(SRC));
const doc = await pdfjs.getDocument({ data }).promise;

for (const pno of pages) {
  const page = await doc.getPage(pno);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  // 白底, 避免透明背景导致框不可见
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const png = canvas.toBuffer("image/png");
  const file = `${OUT}/page-${pno}.png`;
  writeFileSync(file, png);
  console.log(`rendered ${file}  (${canvas.width}x${canvas.height})`);
}
console.log("done");
