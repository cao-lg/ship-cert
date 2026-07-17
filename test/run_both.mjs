// 用 processPdf(官方主流程)处理两个 PDF, 输出标注PDF+汇总Excel
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import http from "node:http";
import fs from "fs";
import path from "path";

const STD_DIR = path.resolve("node_modules/pdfjs-dist/standard_fonts");
const server = http.createServer((req, res) => {
  const fp = path.join(STD_DIR, decodeURIComponent(req.url.split("?")[0]));
  if (fp.startsWith(STD_DIR) && fs.existsSync(fp)) { res.setHeader("Content-Type", "application/octet-stream"); fs.createReadStream(fp).pipe(res); }
  else { res.statusCode = 404; res.end("nf"); }
});
await new Promise((r) => server.listen(0, r));
const std = `http://127.0.0.1:${server.address().port}/`;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = std;

const { processPdf } = await import("../src/engine.js");
const { buildExcelWorkbook } = await import("../src/excel.js");

const CASES = [
  {
    label: "航海家",
    src: "C:/Users/caolg/Downloads/2.船舶证书（航海家）.pdf",
    outPdf: "D:/workbuddy/2026-07-16-18-55-51/2.船舶证书（航海家）-标注.pdf",
    outXlsx: "D:/workbuddy/2026-07-16-18-55-51/船舶证书信息-航海家.xlsx",
  },
  {
    label: "古弗尼尔",
    src: "C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf",
    outPdf: "D:/workbuddy/2026-07-16-18-55-51/2.船舶证书-古弗尼尔-标注.pdf",
    outXlsx: "D:/workbuddy/2026-07-16-18-55-51/船舶证书信息-古弗尼尔.xlsx",
  },
];

for (const c of CASES) {
  console.log(`\n${"=".repeat(60)}\n  ${c.label}\n${"=".repeat(60)}`);
  const bytes = new Uint8Array(fs.readFileSync(c.src));
  const result = await processPdf(bytes, { fileName: path.basename(c.src), standardFontDataUrl: std });
  console.log(`red=${result.red} blue=${result.blue} records=${result.records.length}`);

  for (let i = 0; i < result.records.length; i++) {
    const r = result.records[i];
    console.log(`  ${i + 1}. [${r.type}] no=${r.no || "-"} issue=${r.issue || "-"} expiry=${r.expiry || "-"} annual=${r.annual || "-"}`);
  }

  // 写 PDF
  fs.writeFileSync(c.outPdf, Buffer.from(result.bytes));
  // 写 Excel
  const tpl = new Uint8Array(fs.readFileSync(path.resolve("public/cert-template.xlsx")));
  const xbuf = await buildExcelWorkbook(tpl, result.records);
  fs.writeFileSync(c.outXlsx, Buffer.from(xbuf));
  console.log(`→ ${c.outPdf}\n→ ${c.outXlsx}`);
}

server.close();
console.log("\nDone.");
