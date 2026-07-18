import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, degrees } from "pdf-lib";
import { configurePdfjs } from "../src/engine.js";

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const SRC = "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
const bytes = readFileSync(SRC);
const srcDoc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
const pages = srcDoc.getPages();
for (let i = 0; i < Math.min(6, pages.length); i++) pages[i].setRotation(degrees(90));
const rotated = await srcDoc.save();

const doc = await pdfjs.getDocument({ data: new Uint8Array(rotated) }).promise;
for (const pno of [3, 4, 5]) {
  const page = await doc.getPage(pno + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter((it) => it.str && it.str.trim().length);
  // 媒体框
  const libPage = (await PDFDocument.load(new Uint8Array(rotated), { ignoreEncryption: true })).getPages()[pno];
  const mb = libPage.node.MediaBox();
  console.log(`\n=== pno=${pno} ===`);
  console.log("pdf.js vp: w=%s h=%s transform=%o", vp.width.toFixed(1), vp.height.toFixed(1), vp.transform.map((n) => +n.toFixed(2)));
  console.log("pdf-lib page getWidth/Height=%s/%s", libPage.getWidth().toFixed(1), libPage.getHeight().toFixed(1));
  // 打印前 3 个文字项的原始 transform + width/height
  for (const it of items.slice(0, 3)) {
    console.log("  item str=%j transform=%o w=%s h=%s", it.str, it.transform.map((n) => +n.toFixed(1)), it.width.toFixed(1), it.height.toFixed(1));
  }
}
process.exit(0);
