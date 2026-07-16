import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import http from "node:http";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { PDFDocument, rgb } from "pdf-lib";

const STD_DIR = path.resolve("node_modules/pdfjs-dist/standard_fonts");
const server = http.createServer((req, res) => {
  const fp = path.join(STD_DIR, decodeURIComponent(req.url.split("?")[0]));
  if (fp.startsWith(STD_DIR) && fs.existsSync(fp)) {
    res.setHeader("Content-Type", "application/octet-stream");
    fs.createReadStream(fp).pipe(res);
  } else { res.statusCode = 404; res.end("nf"); }
});
await new Promise((r) => server.listen(0, r));
const std = `http://127.0.0.1:${server.address().port}/`;
// 不设置 workerSrc -> pdf.js 用主线程 fake worker, 字体加载失败只是警告, 不会让独立 worker 线程崩掉整个进程
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = std;

process.on("unhandledRejection", (e) => console.error("UNHANDLED REJECTION:", e && (e.stack || e)));
process.on("uncaughtException", (e) => console.error("UNCAUGHT:", e && (e.stack || e)));

const engine = await import("../src/engine.js");
const { buildLines, findDateGroups, computeBoxes } = engine;
engine.configurePdfjs(pdfjsLib);
const H = await import("../src/helpers.js");
const { detectType, detectSociety, extractNumber, firstDateAfter, ISSUE_PHRASES, EXPIRY_PHRASES, UNIQUE_TITLES } = H;
const { buildExcelWorkbook } = await import("../src/excel.js");

const SRC = "C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf";
const OUT_PDF = "D:/workbuddy/2026-07-16-18-55-51/2.船舶证书-古弗尼尔-标注.pdf";
const OUT_XLSX = "D:/workbuddy/2026-07-16-18-55-51/船舶证书信息-古弗尼尔.xlsx";

try {
  const bytes = new Uint8Array(fs.readFileSync(SRC));
  const pdfLibDoc = await PDFDocument.load(bytes);
  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0), standardFontDataUrl: std }).promise;
  const pages = [];
  for (let pno = 0; pno < pdfjsDoc.numPages; pno++) {
    const page = await pdfjsDoc.getPage(pno + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const libPage = pdfLibDoc.getPages()[pno];
    const SCALE = vp.width / libPage.getWidth();
    const pageHeight = libPage.getHeight();
    const items = tc.items.map((it) => ({ str: it.str, x0: it.transform[4], y: it.transform[5], width: it.width, height: it.height })).filter((it) => it.str && it.str.trim().length);
    const { lines, plainText } = buildLines(items);
    pages.push({ pno, items, lines, plainText, libPage, SCALE, pageHeight });
  }
  await pdfjsDoc.destroy();
  const { boxes, red, blue } = computeBoxes(pages, "blue");
  const drawGroup = (libPage, g, SCALE, pageHeight, stroke, fill) => {
    const pad = 3;
    libPage.drawRectangle({ x: g.x0Dev / SCALE - pad, y: pageHeight - g.yBotDev / SCALE - pad, width: (g.x1Dev - g.x0Dev) / SCALE + pad * 2, height: (g.yTopDev - g.yBotDev) / SCALE + pad * 2, borderColor: rgb(stroke[0], stroke[1], stroke[2]), borderWidth: 1.6, backgroundColor: rgb(fill[0], fill[1], fill[2]), opacity: 0.4, borderOpacity: 0.9 });
  };
  for (const b of boxes) drawGroup(b.libPage, b.group, b.SCALE, b.pageHeight, b.stroke, b.fill);
  console.log(`红框(过期/有效日期)=${red}  蓝框(年检)=${blue}`);

  // ---- 简易证书分组(用导出函数复刻 buildRecord 逻辑) ----
  const isStart = (p) => {
    const low = p.plainText.toLowerCase();
    if (UNIQUE_TITLES.some(([kw]) => low.includes(kw.toLowerCase()))) return true;
    return p.lines.some((l) => EXPIRY_PHRASES.some((ph) => l.text.toLowerCase().includes(ph.toLowerCase())) && !/annual|survey/i.test(l.text));
  };
  const groups = [];
  let cur = null;
  for (let i = 0; i < pages.length; i++) {
    if (isStart(pages[i])) { cur = { pages: [i] }; groups.push(cur); }
    else if (cur) cur.pages.push(i);
    else { cur = { pages: [i] }; groups.push(cur); }
  }
  console.log("grouping done:", groups.length);
  const records = groups.map((g, gi) => {
    const pg = g.pages.map((i) => pages[i]);
    const fullRaw = pg.map((p) => p.plainText).join("\n");
    if (gi === 0) fs.writeFileSync("test/g0.txt", fullRaw);
    console.log(`  -> rec#${gi} start, rawLen=${fullRaw.length}`);
    let type, no, issue, expiry, annual = "", society = "";
    try { type = detectType(fullRaw) || "证书"; } catch (e) { console.log("    detectType ERR", e.message); }
    try { no = extractNumber(fullRaw); } catch (e) { console.log("    extractNumber ERR", e.message); }
    try { issue = firstDateAfter(fullRaw, ISSUE_PHRASES); } catch (e) { console.log("    issue ERR", e.message); }
    try { expiry = firstDateAfter(fullRaw, EXPIRY_PHRASES); } catch (e) { console.log("    expiry ERR", e.message); }
    const annualDates = [];
    for (const p of pg) for (const l of p.lines) {
      const low = l.text.toLowerCase();
      if ((low.includes("annual") || low.includes("intermediate") || low.includes("年度") || low.includes("期间") || low.includes("中间")) && (low.includes("survey") || low.includes("检验")))
        for (const d of findDateGroups(l.items)) annualDates.push(d.iso);
    }
    const uniq = [...new Set(annualDates)].sort();
    annual = uniq.length ? uniq[uniq.length - 1] : "";
    try { society = detectSociety(fullRaw); } catch (e) { console.log("    detectSociety ERR", e.message); }
    const parts = [];
    if (society) parts.push(`签发机构:${society}`);
    if (uniq.length) parts.push(`年度/中间检验:${uniq.join("、")}`);
    console.log(`  rec#${gi} [${type}] no=${no} issue=${issue} expiry=${expiry} annual=${annual}`);
    return { type, no, issue, expiry, annual, remark: parts.join("；") };
  });
  console.log(`证书记录(${records.length} 条) built`);

  const outBytes = await pdfLibDoc.save();
  fs.writeFileSync(OUT_PDF, Buffer.from(outBytes));
  const tpl = new Uint8Array(fs.readFileSync(path.resolve("public/cert-template.xlsx")));
  const xbuf = await buildExcelWorkbook(tpl, records);
  fs.writeFileSync(OUT_XLSX, Buffer.from(xbuf));
  console.log(`\n已写出:\n  ${OUT_PDF}\n  ${OUT_XLSX}`);
  server.close();
} catch (e) {
  console.error("ERROR:", e && (e.stack || e));
  server.close();
  process.exit(2);
}
