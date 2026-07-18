// 端到端验证(内容流画框 + CTM 抵消):
// 引擎返回每张框的绝对页面坐标; 在输出 PDF 中逐页追踪 CTM + 路径(m/l/h/B),
// 提取实际渲染的矩形中心, 与引擎期望坐标比对, 确认框落在正确位置(尤其翻转页已抵消)。
import { readFileSync, writeFileSync } from "fs";
import Pako from "pako";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import PDFLibPkg from "pdf-lib";
import { processPdf, configurePdfjs } from "../src/engine.js";
const { PDFDocument, PDFArray } = PDFLibPkg;

configurePdfjs(pdfjs);
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

const SRC = process.argv[2] || "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
const bytes = readFileSync(SRC);
const { bytes: out, red, blue, drawnBoxes } = await processPdf(new Uint8Array(bytes), {
  annualColor: "blue", fileName: "e2e", ocr: false, onWarn: () => {},
});
console.log("processPdf 完成: red =", red, " blue =", blue, " drawnBoxes =", drawnBoxes.length, " out bytes =", out.length);
writeFileSync("/tmp/rect-out.pdf", out);

const _dec = new TextDecoder("latin1");
function pageContentStr(libPage) {
  const ctx = libPage.node.context;
  const contents = libPage.node.Contents();
  const refs = [];
  if (contents instanceof PDFArray) for (let k = 0; k < contents.size(); k++) refs.push(contents.get(k));
  else if (contents) refs.push(contents);
  let s = "";
  for (const ref of refs) {
    try {
      const st = ctx.lookup(ref);
      const comp = st.getContents();
      let raw; try { raw = Pako.inflate(new Uint8Array(comp)); } catch { raw = comp; }
      s += " " + _dec.decode(raw);
    } catch { /* ignore */ }
  }
  return s;
}
function finalCTMOfStr(str) {
  const t = String(str).replace(/\r/g, " ").split(/\s+/).filter(Boolean);
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0; const stack = []; let i = 0;
  while (i < t.length) { const op = t[i];
    if (op === "q") { stack.push([a, b, c, d, e, f]); i++; continue; }
    if (op === "Q") { if (stack.length) [a, b, c, d, e, f] = stack.pop(); i++; continue; }
    if (op === "cm") { const ma=+t[i-6],mb=+t[i-5],mc=+t[i-4],md=+t[i-3],me=+t[i-2],mf=+t[i-1];
      if([ma,mb,mc,md,me,mf].every(Number.isFinite)){ const na=a*ma+c*mb,nb=b*ma+d*mb,nc=a*mc+c*md,nd=b*mc+d*md,ne=a*me+c*mf+e,nf=b*me+d*mf+f; a=na;b=nb;c=nc;d=nd;e=ne;f=nf; } i++; continue; }
    i++; }
  return [a, b, c, d, e, f];
}

// 追踪 CTM + 路径, 收集每个被填充/描边的轴对齐矩形(渲染后页面坐标, 左下原点 y 向上)
function pathRects(str) {
  const t = String(str).replace(/\r/g, " ").split(/\s+/).filter(Boolean);
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
  const stack = [];
  const sub = []; // 当前子路径的点(页面坐标)
  let startSet = false;
  const rects = [];
  const pt = (px, py) => [a * px + c * py + e, b * px + d * py + f];
  const flush = () => {
    // closePath(h) 会重复首点 → 5 点, 先去掉闭合重复点
    if (sub.length === 5 && sub[0] && sub[4] && Math.hypot(sub[0][0] - sub[4][0], sub[0][1] - sub[4][1]) < 0.5) sub.pop();
    if (sub.length === 4) {
      const xs = sub.map((p) => p[0]), ys = sub.map((p) => p[1]);
      // 轴对齐判定: 4 点构成矩形
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const corners = [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]];
      const isRect = corners.every(([cx, cy]) =>
        sub.some(([sx, sy]) => Math.abs(sx - cx) < 0.5 && Math.abs(sy - cy) < 0.5));
      if (isRect) rects.push({ cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w: maxx - minx, h: maxy - miny });
    }
    sub.length = 0;
  };
  let i = 0;
  while (i < t.length) {
    const op = t[i];
    if (op === "q") { stack.push([a, b, c, d, e, f]); i++; continue; }
    if (op === "Q") { if (stack.length) [a, b, c, d, e, f] = stack.pop(); i++; continue; }
    if (op === "cm") { const ma=+t[i-6],mb=+t[i-5],mc=+t[i-4],md=+t[i-3],me=+t[i-2],mf=+t[i-1];
      if([ma,mb,mc,md,me,mf].every(Number.isFinite)){ const na=a*ma+c*mb,nb=b*ma+d*mb,nc=a*mc+c*md,nd=b*mc+d*md,ne=a*me+c*mf+e,nf=b*me+d*mf+f; a=na;b=nb;c=nc;d=nd;e=ne;f=nf; } i++; continue; }
    if (op === "m") { flush(); sub.push(pt(+t[i-2], +t[i-1])); i++; continue; }
    if (op === "l") { sub.push(pt(+t[i-2], +t[i-1])); i++; continue; }
    if (op === "h") { if (sub.length) sub.push(sub[0]); flush(); i++; continue; }
    if (op === "re") { flush(); sub.push(pt(+t[i-4],+t[i-3])); sub.push(pt(+t[i-4]+ +t[i-2],+t[i-3])); sub.push(pt(+t[i-4]+ +t[i-2],+t[i-3]+ +t[i-1])); sub.push(pt(+t[i-4],+t[i-3]+ +t[i-1])); flush(); i++; continue; }
    if (op === "B" || op === "f" || op === "S" || op === "b" || op === "s" || op === "n") { flush(); i++; continue; }
    i++;
  }
  return rects;
}

const outDoc = await PDFDocument.load(new Uint8Array(out), { ignoreEncryption: true });

// 按页汇总输出中的路径矩形
const outRectsByPage = [];
for (let p = 0; p < outDoc.getPageCount(); p++) {
  outRectsByPage[p] = pathRects(pageContentStr(outDoc.getPages()[p]));
}

// 用引擎返回的 drawnBoxes 比对: 期望中心 vs 输出中最近矩形中心
let ok = 0, bad = 0;
const flippedReports = [];
for (const box of drawnBoxes) {
  const pageRects = outRectsByPage[box.pno] || [];
  const ex = box.x + box.w / 2, ey = box.y + box.h / 2;
  let best = 1e9, bestRect = null;
  for (const r of pageRects) {
    const dist = Math.hypot(r.cx - ex, r.cy - ey);
    if (dist < best) { best = dist; bestRect = r; }
  }
  const pass = best < 8;
  if (pass) ok++; else bad++;
  // 翻转页单独报告
  const s = pageContentStr(outDoc.getPages()[box.pno]);
  const fctm = finalCTMOfStr(s);
  const isFlipped = Math.abs(fctm[3] + 1) < 1e-6 && Math.abs(fctm[1]) < 1e-6 && Math.abs(fctm[2]) < 1e-6;
  if (isFlipped || !pass) {
    flippedReports.push(`  p${String(box.pno + 1).padStart(2)} ${isFlipped ? "[翻转]" : "     "} 期望中心=(${ex.toFixed(1)}, ${ey.toFixed(1)}) 命中=(${bestRect ? bestRect.cx.toFixed(1) + ", " + bestRect.cy.toFixed(1) : "无"}) 误差=${best.toFixed(1)}${pass ? " ✅" : " ❌"}`);
  }
}
console.log(`\n翻转页框验证(已抵消 Y 翻转):`);
flippedReports.forEach((r) => console.log(r));
console.log(`\n全部框: 命中=${ok}  偏差过大=${bad}`);
console.log(bad === 0 && ok > 0 ? "\n✅ 所有框均精确落在期望的日期坐标(翻转页已正确抵消)" : (bad === 0 ? "⚠️ 无框可验证" : "\n❌ 存在偏移框"));
