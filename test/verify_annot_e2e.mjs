// 端到端验证: 用引擎真实处理带 CTM 的源 PDF, 检查 /Square 注释是否对齐可见文字。
import { readFileSync, writeFileSync } from 'fs';
import { inflateSync } from 'zlib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PDFLibPkg from 'pdf-lib';
import { processPdf, configurePdfjs } from '../src/engine.js';
const { PDFDocument, PDFName, PDFArray } = PDFLibPkg;

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;

const SRC = process.argv[2] || 'C:/Users/caolg/Downloads/船舶证书标注合并_2026-07-17-标注.pdf';
const bytes = readFileSync(SRC);

const { bytes: out, red } = await processPdf(new Uint8Array(bytes), {
  annualColor: 'blue',
  fileName: 'e2e-test',
  ocr: false,
  onWarn: () => {},
});
console.log('processPdf done. red boxes =', red);
writeFileSync('/tmp/e2e-annot-out.pdf', out);

// 用 pdf-lib 重载输出, 确认注释是否真的写入
const outDoc = await PDFDocument.load(new Uint8Array(out), { ignoreEncryption: true });
let reloadTotal = 0, anyAnnots = 0;
for (let i = 0; i < outDoc.getPageCount(); i++) {
  const a = outDoc.getPages()[i].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (a) { anyAnnots += a.size(); for (const ref of a.asArray()) {
    const o = outDoc.context.lookup(ref);
    const st = o.lookup(PDFName.of('Subtype'));
    if (st && st.asString?.() === 'Square') reloadTotal++;
  } }
}
console.log('pdf-lib 重载: 全部 Annots 条目 =', anyAnnots, ', 其中 /Square =', reloadTotal);

// 扫描输出 PDF 所有流中的 /Square 注释 Rect
const s = Buffer.from(out).toString('latin1');
const reStream = /stream\r?\n([\s\S]*?)endstream/g;
let m;
const rects = [];
while ((m = reStream.exec(s))) {
  const raw = Buffer.from(m[1].replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, ''), 'latin1');
  let dec; try { dec = inflateSync(raw); } catch (e) { continue; }
  const t = dec.toString('latin1');
  if (t.includes('/Square')) {
    const rectMatch = t.match(/\/Rect\s*\[([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\]/);
    if (rectMatch) rects.push([+rectMatch[1], +rectMatch[2], +rectMatch[3], +rectMatch[4]]);
  }
}
console.log('Output /Square annotations found:', rects.length);
rects.forEach((r, i) => console.log('  #' + (i + 1) + ' Rect=[' + r.map(v => v.toFixed(1)).join(', ') + ']  (x1,y1=左下 x2,y2=右上)'));

// 用 pdf.js 提取第1页过期日期(可见坐标, 顶部原点)
const pdfjsDoc = await pdfjs.getDocument({ data: new Uint8Array(out) }).promise;
const page = await pdfjsDoc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const tc = await page.getTextContent();
let dateX0 = 1e9, dateX1 = -1e9, dateYTop = -1e9;
for (const it of tc.items) {
  const str = it.str || '';
  if (/december|2026/i.test(str)) {
    dateX0 = Math.min(dateX0, it.transform[4]);
    dateX1 = Math.max(dateX1, it.transform[4] + (it.width || 0));
    dateYTop = Math.max(dateYTop, it.transform[5]);
  }
}
const expX1 = dateX0 - 3, expX2 = dateX1 + 3;
const expY1 = vp.height - dateYTop - 3;
const expY2 = vp.height - dateYTop + 18;
console.log('\nPage1 过期日期可见坐标: x=[' + dateX0.toFixed(1) + ',' + dateX1.toFixed(1) + '] y(top)=' + dateYTop.toFixed(1));
console.log('期望 Rect(左下,右上): [' + expX1.toFixed(1) + ', ' + expY1.toFixed(1) + ', ' + expX2.toFixed(1) + ', ' + expY2.toFixed(1) + ']');

// 找最接近期望的注释
let best = null, bestErr = 1e9;
for (const r of rects) {
  const err = Math.abs(r[0] - expX1) + Math.abs(r[1] - expY1) + Math.abs(r[2] - expX2) + Math.abs(r[3] - expY2);
  if (err < bestErr) { bestErr = err; best = r; }
}
if (best) {
  const ok = bestErr < 50;
  console.log('\n' + (ok ? '✅ 标注框已正确对齐可见文字' : '❌ 偏移过大') + ' (误差=' + bestErr.toFixed(1) + 'pt < 容差50)');
} else {
  console.log('\n❌ 无注释可对比');
}
