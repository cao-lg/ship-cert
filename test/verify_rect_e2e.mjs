// 端到端验证 v1.3.7: 画框走"独立内容流(单位 CTM)", 矩形坐标=绝对页面点坐标。
// 验证标准: 每个 drawnBox 的中心应落在同页某个日期(由 pdf.js 文字坐标换算的绝对页面坐标)附近(<12pt)。
// 同时做结构性检查: 输出页数 == 源页数; 无框落在页面范围外(捕捉翻转/溢出); 源 Annots 保留。
import { readFileSync } from "node:fs";
import Pako from "pako";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import { processPdf, configurePdfjs, buildLines, findDateGroups } from "../src/engine.js";

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const SRC = process.env.SRC || "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
const bytes = readFileSync(SRC);

// ---- 1) 跑引擎 ----
const { bytes: out, red, blue, drawnBoxes, records } = await processPdf(new Uint8Array(bytes), {
  annualColor: "blue", fileName: "demo", ocr: false, onWarn: () => {},
});

// ---- 2) 真值: 每页每个日期的绝对页面坐标 (点, 左下原点) ----
const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
const truth = [];
for (let pno = 0; pno < doc.numPages; pno++) {
  const page = await doc.getPage(pno + 1);
  const vp = page.getViewport({ scale: 1 });
  const ph = vp.height, pw = vp.width;
  const tc = await page.getTextContent();
  const items = tc.items
    .map((it) => ({ str: it.str, x0: it.transform[4], y: it.transform[5], width: it.width, height: it.height }))
    .filter((it) => it.str && it.str.trim().length);
  const { lines } = buildLines(items);
  for (const line of lines) {
    for (const g of findDateGroups(line.items)) {
      const x0 = g.x0Dev, x1 = g.x1Dev;
      const yTop = ph - g.yTopDev, yBot = ph - g.yBotDev;
      truth.push({ pno, cx: (x0 + x1) / 2, cy: (yTop + yBot) / 2 });
    }
  }
}
await doc.destroy();

// ---- 3) 匹配 drawnBox 到最近日期 ----
let matched = 0, worst = 0, outside = 0;
const outDoc = await PDFDocument.load(out, { ignoreEncryption: true });
for (const b of drawnBoxes) {
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const cands = truth.filter((t) => t.pno === b.pno);
  let best = Infinity;
  for (const t of cands) best = Math.min(best, Math.hypot(bcx - t.cx, bcy - t.cy));
  if (best <= 12) matched++;
  worst = Math.max(worst, best);
  // 越界检查(捕捉翻转/溢出)
  const pg = outDoc.getPages()[b.pno];
  if (b.x < -2 || b.y < -2 || b.x + b.w > pg.getWidth() + 2 || b.y + b.h > pg.getHeight() + 2) outside++;
}

// ---- 4) 结构性: 页数保留 + 源 Annots 数量 ----
const srcDoc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
const countAnnots = (d) => {
  let n = 0;
  for (const pg of d.getPages()) {
    const a = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (a) n += a.size();
  }
  return n;
};
const srcAnnots = countAnnots(srcDoc);
const outAnnots = countAnnots(outDoc);

console.log("==== v1.3.7 验证结果 ====");
console.log(`红框=${red} 年检框=${blue} 绘制框=${drawnBoxes.length} 记录=${records.length}`);
console.log(`框命中日期: ${matched}/${drawnBoxes.length}  (阈值 12pt)`);
console.log(`最远偏差: ${worst.toFixed(1)} pt`);
console.log(`越界框(翻转/溢出): ${outside}`);
console.log(`页数: 源=${srcDoc.getPageCount()} 出=${outDoc.getPageCount()}  (应相等)`);
console.log(`源 Annots=${srcAnnots} 出 Annots=${outAnnots}  (应保留)`);
const ok = matched === drawnBoxes.length && outside === 0 && srcDoc.getPageCount() === outDoc.getPageCount() && srcAnnots === outAnnots;
console.log(ok ? "\n✅ 通过: 所有框精确落在日期上, 无翻转/溢出, 页数与原注释均保留" : "\n❌ 未通过, 见上");
process.exit(ok ? 0 : 1);
