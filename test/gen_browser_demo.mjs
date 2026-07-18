// 生成浏览器可查看的标注 PDF (v1.3.8 引擎)
import { readFileSync, writeFileSync } from "node:fs";
import { processPdf, configurePdfjs } from "../src/engine.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const src = readFileSync("D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf");
const r = await processPdf(new Uint8Array(src), {
  annualColor: "blue", fileName: "browser-test",
  ocr: false, onWarn: () => {},
});
writeFileSync("dist/demo-annotated.pdf", Buffer.from(r.bytes));
console.log(`done: red=${r.red} blue=${r.blue} drawn=${r.drawnBoxes.length}`);
