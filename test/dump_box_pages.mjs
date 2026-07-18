// 打印每个画框所在的页码 + 每条证书记录的页码/日期, 用于浏览器截图定位到"日期页"。
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { processPdf, configurePdfjs } from "../src/engine.js";

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const SRC = process.env.SRC || "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
const bytes = new Uint8Array(readFileSync(SRC));
const { bytes: out, records, red, blue, drawnBoxes, textStats } = await processPdf(bytes, { fileName: SRC.split(/[\\/]/).pop() });

console.log("=== DRAWN BOXES (page, x, y, w, h) ===");
for (const b of drawnBoxes) {
  console.log(`page=${b.pno + 1}  x=${b.x.toFixed(1)} y=${b.y.toFixed(1)} w=${b.w.toFixed(1)} h=${b.h.toFixed(1)}`);
}
console.log("\n=== RECORDS ===");
for (const r of records) {
  console.log(`[page ${r._page != null ? r._page + 1 : "?"}] ${r.type || "?"} | 编号=${r.number || "-"} | 有效=${r.expiry || "-"} | 年检=${r.annual || "-"}`);
}
console.log(`\nred=${red} blue=${blue} pages=${textStats.numPages} ocrPages=${textStats.ocrPages}`);
writeFileSync("dist/demo-annotated.pdf", out);
console.log("wrote dist/demo-annotated.pdf");
