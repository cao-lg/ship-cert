// 端到端验证 v1.3.8: 画框坐标 = pdf.js 设备坐标经 vp.transform 反算的 PDF 用户空间坐标。
// 关键改进: 真值同样用 deviceToUser 计算, 且额外对【旋转页副本】做验证(之前测试 PDF 无旋转页, 导致旋转 bug 从未被触发)。
// 验证标准: 每个 drawnBox 中心应落在同页某个日期(用户空间坐标)附近(<12pt); 无框越界; 页数/源 Annots 保留。
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, PDFArray, degrees } from "pdf-lib";
import { processPdf, configurePdfjs, buildLines, findDateGroups } from "../src/engine.js";

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

// 与 engine.js 完全一致的 device→user 反算(独立实现, 防止与引擎共用导致循环自证)
function deviceToUser(vp, dx, dy) {
  const [a, b, c, d, e, f] = vp.transform;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return [dx, dy];
  return [
    (d * (dx - e) - c * (dy - f)) / det,
    (-b * (dx - e) + a * (dy - f)) / det,
  ];
}

const SRC = process.env.SRC || "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
const bytes = readFileSync(SRC);

async function verifyOn(srcBytes, label) {
  // ---- 真值: 每页每日期的用户空间坐标 ----
  const doc = await pdfjs.getDocument({ data: new Uint8Array(srcBytes) }).promise;
  const truth = [];
  for (let pno = 0; pno < doc.numPages; pno++) {
    const page = await doc.getPage(pno + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .map((it) => ({ str: it.str, x0: it.transform[4], y: it.transform[5], width: it.width, height: it.height }))
      .filter((it) => it.str && it.str.trim().length);
    const { lines } = buildLines(items);
    for (const line of lines) {
      for (const g of findDateGroups(line.items)) {
        // 文字坐标已在用户空间(媒体框坐标系), 直接取日期组极值中心为真值。
        const cx = (g.x0Dev + g.x1Dev) / 2;
        const cy = (g.yTopDev + g.yBotDev) / 2;
        truth.push({ pno, cx, cy });
      }
    }
  }
  await doc.destroy();

  // ---- 跑引擎 ----
  const { bytes: out, red, blue, drawnBoxes } = await processPdf(new Uint8Array(srcBytes), {
    annualColor: "blue", fileName: "demo", ocr: false, onWarn: () => {},
  });

  // ---- 匹配 + 越界检查 ----
  let matched = 0, worst = 0, outside = 0;
  const outDoc = await PDFDocument.load(out, { ignoreEncryption: true });
  for (const b of drawnBoxes) {
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const cands = truth.filter((t) => t.pno === b.pno);
    let best = Infinity;
    for (const t of cands) best = Math.min(best, Math.hypot(bcx - t.cx, bcy - t.cy));
    if (best <= 12) matched++;
    worst = Math.max(worst, best);
    const pg = outDoc.getPages()[b.pno];
    const pw = pg.getWidth(), ph = pg.getHeight();
    if (b.x < -2 || b.y < -2 || b.x + b.w > pw + 2 || b.y + b.h > ph + 2) {
      outside++;
      console.log(`  [越界] pno=${b.pno} box=(${b.x.toFixed(1)},${b.y.toFixed(1)},${b.w.toFixed(1)},${b.h.toFixed(1)}) page=(${pw.toFixed(1)}x${ph.toFixed(1)})`);
    }
  }

  const srcDoc = await PDFDocument.load(new Uint8Array(srcBytes), { ignoreEncryption: true });
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
  const ok = matched === drawnBoxes.length && outside === 0 &&
    srcDoc.getPageCount() === outDoc.getPageCount() && srcAnnots === outAnnots;
  console.log(`\n==== [${label}] 验证结果 ====`);
  console.log(`红框=${red} 年检框=${blue} 绘制框=${drawnBoxes.length} 真值日期=${truth.length}`);
  console.log(`框命中日期: ${matched}/${drawnBoxes.length}  (阈值12pt)`);
  console.log(`最远偏差: ${worst.toFixed(1)} pt`);
  console.log(`越界框: ${outside}`);
  console.log(`页数: 源=${srcDoc.getPageCount()} 出=${outDoc.getPageCount()}  源Annots=${srcAnnots} 出=${outAnnots}`);
  console.log(ok ? "✅ 通过" : "❌ 未通过");
  return ok;
}

// 旋转前 6 页, 生成旋转副本(模拟真实证书常见旋转页)
const srcDoc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
const pages = srcDoc.getPages();
for (let i = 0; i < Math.min(6, pages.length); i++) pages[i].setRotation(degrees(90));
const rotatedBytes = await srcDoc.save();
const rotatedPath = "D:/workbuddy/2026-07-16-18-55-51/ship-cert-web/test/_rotated_tmp.pdf";
writeFileSync(rotatedPath, rotatedBytes);

const okOrig = await verifyOn(bytes, "正向页(原始)");
const okRot = await verifyOn(rotatedBytes, "旋转页副本(前6页旋转90°)");
process.exit(okOrig && okRot ? 0 : 1);
