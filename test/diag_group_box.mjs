// 诊断: 逐页展示"画框 vs 分组"的对应关系, 找出红框数≠记录数的根因
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import http from "node:http";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";

const STD_DIR = path.resolve("node_modules/pdfjs-dist/standard_fonts");
const server = http.createServer((req, res) => {
  const fp = path.join(STD_DIR, decodeURIComponent(req.url.split("?")[0]));
  if (fp.startsWith(STD_DIR) && fs.existsSync(fp)) { res.setHeader("Content-Type", "application/octet-stream"); fs.createReadStream(fp).pipe(res); }
  else { res.statusCode = 404; res.end("nf"); }
});
await new Promise((r) => server.listen(0, r));
const std = `http://127.0.0.1:${server.address().port}/`;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = std;

const engine = await import("../src/engine.js");
const { buildLines, findDateGroups, computeBoxes, groupCertificates, processPdf } = engine;
engine.configurePdfjs(pdfjsLib);

const PDFS = [
  ["航海家", "C:/Users/caolg/Downloads/2.船舶证书（航海家）.pdf"],
  ["古弗尼尔", "C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf"],
];

for (const [label, src] of PDFS) {
  console.log(`\n${"=".repeat(70)}\n  ${label}: ${path.basename(src)}\n${"=".repeat(70)}`);
  const bytes = new Uint8Array(fs.readFileSync(src));

  // --- 调用 processPdf 获取官方 boxes + records ---
  const result = await processPdf(bytes, { fileName: path.basename(src), standardFontDataUrl: std });
  console.log(`[processPdf] red=${result.red} blue=${result.blue} records=${result.records.length}`);

  // --- 同时手动跑一遍,逐页展示分组与画框 ---
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
    const items = tc.items
      .map((it) => ({ str: it.str, x0: it.transform[4], y: it.transform[5], width: it.width, height: it.height }))
      .filter((it) => it.str && it.str.trim().length);
    const { lines, plainText } = buildLines(items);
    pages.push({ pno, items, lines, plainText, topHeading: null, libPage, SCALE, pageHeight });
  }
  await pdfjsDoc.destroy();

  // detectTopHeading on each page
  for (const p of pages) {
    const half = 800; // approximate
    for (const l of p.lines) {
      const yAvg = l.items.reduce((s, i) => s + i.y, 0) / l.items.length;
      if (yAvg > half) continue;
      const up = l.text.toUpperCase();
      if (!(up.includes("CERTIFICATE") || up.includes("REGISTRY") || up.includes("REGISTRATION"))) continue;
      // ... simplified: just check if any title head matches
      break;
    }
  }

  // 分组
  const groups = groupCertificates(pages);
  console.log(`\n--- 分组详情 (${groups.length} 组) ---`);
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const pgIndices = g.pageIndices;
    const rec = result.records[gi] || {};
    console.log(`  Group#${gi} [${g.type || "?"}] pages=[${pgIndices.join(",")}] → rec: type="${rec.type}" no="${rec.no}" issue="${rec.issue}" expiry="${rec.expiry}" annual="${rec.annual}"`);
  }

  // 画框: 每个框落在哪个页、哪个组
  const { boxes, red, blue } = computeBoxes(pages, "blue");
  const pageIndexToGroup = new Array(pages.length).fill(-1);
  for (let gi = 0; gi < groups.length; gi++) {
    for (const pi of groups[gi].pageIndices) pageIndexToGroup[pi] = gi;
  }

  console.log(`\n--- 画框详情 (red=${red}, blue=${blue}) ---`);
  for (let bi = 0; bi < boxes.length; bi++) {
    const b = boxes[bi];
    // find which page this box is on
    let onPage = -1;
    for (let pi = 0; pi < pages.length; pi++) {
      if (b.libPage === pages[pi].libPage) { onPage = pi; break; }
    }
    const gIdx = pageIndexToGroup[onPage];
    const color = (b.stroke[0] > 0.5) ? "RED" : "BLUE"; // rough heuristic
    const dateIso = b.group.iso;
    console.log(`  Box#${bi} [${color}] page=${onPage} group#${gIdx} date=${dateIso}`);
  }

  // 统计: 每组落了多少红/蓝框
  const groupBoxCount = Array.from({ length: groups.length }, () => ({ r: 0, b: 0 }));
  for (const b of boxes) {
    let onPage = -1;
    for (let pi = 0; pi < pages.length; pi++) {
      if (b.libPage === pages[pi].libPage) { onPage = pi; break; }
    }
    const gIdx = pageIndexToGroup[onPage];
    if (gIdx >= 0) {
      const isRed = b.stroke[0] > 0.5;
      isRed ? groupBoxCount[gIdx].r++ : groupBoxCount[gIdx].b++;
    }
  }

  console.log(`\n--- 每组框统计 vs 记录 ---`);
  for (let gi = 0; gi < groups.length; gi++) {
    const gc = groupBoxCount[gi];
    const rec = result.records[gi] || {};
    const hasExpiry = !!rec.expiry;
    const hasAnnual = !!rec.annual;
    console.log(
      `  G#${gi} [${groups[gi].type}] red_box=${gc.r} blue_box=${gc.b}` +
      ` | record: expiry="${rec.expiry}" annual="${rec.annual}"` +
      ` | MISMATCH_R=${gc.r > 0 && !hasExpiry ? "⚠有框无expiry" : gc.r === 0 && hasExpiry ? "⚠有expiry无框" : "✓"}` +
      `   MISMATCH_B=${gc.b > 0 && !hasAnnual ? "⚠有框无annual" : gc.b === 0 && hasAnnual ? "⚠有annual无框" : "✓"}`
    );
  }
}

server.close();
console.log("\nDone.");
