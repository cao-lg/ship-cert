// 验证: 1) OCR/特殊字符清洗 2) 按证书类型排序合并 3) 新版 Excel 模板
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import http from "node:http";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { configurePdfjs, processPdf, mergePdfs } from "../src/engine.js";
import { buildExcelWorkbook } from "../src/excel.js";
import { certOrderKey } from "../src/kb.js";
import {
  normSp, toIso, normalizeDateString, cleanInvisible,
  prepDateText, phraseIndex, firstDateAfter,
} from "../src/helpers.js";

// ---- pdf.js Node 环境(标准字体走本地 HTTP) ----
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
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")
).href;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = std;
configurePdfjs(pdfjsLib);

// ============ 1) 清洗函数单元测试 ============
let pass = 0, fail = 0;
function eq(name, got, exp) {
  const ok = got === exp;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  =>  ${JSON.stringify(got)}${ok ? "" : "  (期望 " + JSON.stringify(exp) + ")"}`);
}
const ZW = "​"; // U+200B 零宽空格

eq("全角日期 2024.09.18", toIso("２０２４．０９．１８"), "2024-09-18");
eq("全角日期 2024/09/18", toIso("２０２４／０９／１８"), "2024-09-18");
eq("em-dash 连接符", toIso("2024—09—18"), "2024-09-18");
eq("en-dash 连接符", toIso("2024–09–18"), "2024-09-18");
eq("minus 连接符", toIso("2024−09−18"), "2024-09-18");
eq("O->0 (2024-0l-18)", toIso("2024-0l-18"), "2024-01-18");
eq("I->1 (20l9-06-01)", toIso("20l9-06-01"), "2019-06-01");
eq("l->1 粘连 (2024-0l-18)", toIso("2024-0l-18"), "2024-01-18");
eq("S->5 (2024-05-1S)", toIso("2024-05-1S"), "2024-05-15");
eq("B->8 (20B8 误读)", toIso("20B8-01-01"), "2088-01-01");
eq("月份名不被破坏 (18 September 2026)", toIso("18 September 2026"), "2026-09-18");
eq("中文有效日期标签(零宽)", normSp(`有${ZW}效${ZW}日${ZW}期`), "有效日期");
eq("BOM 去除", normSp("﻿有效期至"), "有效期至");
eq("软连字符去除", normSp("valid­until"), "validuntil");
eq("firstDateAfter 含零宽", firstDateAfter(`valid until${ZW} 2026-09-18`, ["valid until"]), "2026-09-18");
eq("firstDateAfter 全角标点", firstDateAfter("有效期至：２０２６．０９．１８", ["有效期至"]), "2026-09-18");
eq("phraseIndex 空格无关", phraseIndex("Certificate  No :  ABC", normSp("certificate no")), 0);
eq("cleanInvisible 全角->半角保留", cleanInvisible("ＡＢＣ").normalize("NFKC"), "ABC");

console.log(`\n清洗单测: ${pass} 通过, ${fail} 失败\n`);

// ============ 2) 真实 10 份证书: 标注 + 排序合并 + Excel ============
const dir = "C:/Users/caolg/Documents/ship-cert-pdf";
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"))
  .sort((a, b) => a.localeCompare(b, "zh"));
console.log(`发现 ${files.length} 份 PDF:\n  ` + files.join("\n  "));

const entries = [];
for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  try {
    const { bytes: out, records, red, blue, textStats } = await processPdf(bytes, {
      annualColor: "blue", fileName: f, standardFontDataUrl: std, ocr: false,
    });
    entries.push({ name: f, out, records, red, blue });
    console.log(`\n== ${f} ==  红框=${red} 年检框=${blue} 证书=${records.length}`);
    records.forEach((r) =>
      console.log(`   [${certOrderKey(r.type)}] ${r.type} | 编号=${r.no || "-"} | 签发=${r.issue || "-"} | 有效=${r.expiry || "-"} | 年检=${r.annual || "-"}`)
    );
  } catch (e) {
    console.log(`\n== ${f} ==  ✗ 失败: ${e.message}`);
  }
}

// 排序(按证书类型指定顺序)
const keyOf = (e) => { let k = 999; for (const r of e.records) { const kk = certOrderKey(r.type); if (kk < k) k = kk; } return k; };
entries.sort((a, b) => keyOf(a) - keyOf(b));
console.log("\n合并顺序: " + entries.map((e) => e.name.replace(/\.pdf$/i, "")).join("  →  "));

const outPdfs = entries.map((e) => ({ name: e.name.replace(/\.pdf$/i, "") + "-标注.pdf", bytes: e.out }));
const allRecords = entries.flatMap((e) => e.records);

const merged = await mergePdfs(outPdfs.map((p) => p.bytes));
fs.writeFileSync("out-merged.pdf", merged);
console.log(`\n合并 PDF 字节数: ${merged.length}`);

const tpl = new Uint8Array(fs.readFileSync("public/cert-template.xlsx"));
const excelBuf = await buildExcelWorkbook(tpl, allRecords);
fs.writeFileSync("out-summary.xlsx", excelBuf);
console.log(`汇总 Excel 字节数: ${excelBuf.length}, 记录数: ${allRecords.length}`);

// 回读 Excel 校验行数/内容
const ExcelJS = (await import("exceljs")).default;
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(excelBuf);
const ws = wb.getWorksheet("船舶证书信息");
let dataRows = 0;
for (let r = 3; r <= ws.rowCount; r++) {
  const c2 = ws.getRow(r).getCell(2).value;
  if (c2) dataRows++;
}
console.log(`Excel 数据行数(第3行起有证书类型): ${dataRows}`);
console.log("\n全部完成。");
server.close();
