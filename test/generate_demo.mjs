// 生成一份"已标注"演示 PDF: 用引擎处理合并测试 PDF(含整页 Y 翻转页), 输出到工作区根目录。
import { readFileSync, writeFileSync } from "fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { processPdf, configurePdfjs } from "../src/engine.js";

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const SRC = process.argv[2] || "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
const OUT = process.argv[3] || "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试-标注.pdf";
const bytes = readFileSync(SRC);
const { bytes: out, red, blue, drawnBoxes } = await processPdf(new Uint8Array(bytes), {
  annualColor: "blue", fileName: "demo", ocr: false, onWarn: () => {},
});
writeFileSync(OUT, out);
console.log(`已生成: ${OUT}`);
console.log(`red=${red} blue=${blue} drawnBoxes=${drawnBoxes.length} outBytes=${out.length}`);
