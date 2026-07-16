// Node 冒烟测试: 在真实样例 PDF 上运行引擎, 核对红/绿框数与识别结果。
// 仅用于本地验证, 不随站点发布。
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "path";
import { pathToFileURL } from "url";
import fs from "fs";

const workerPath = path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = pathToFileURL(path.resolve("node_modules/pdfjs-dist/standard_fonts") + path.sep).href;

// 注入 legacy pdf.js 给引擎
await import("../src/engine.js").then(async (engine) => {
  engine.configurePdfjs(pdfjsLib);

  const samples = [
    "C:/Users/caolg/Downloads/2.船舶证书（航海家）.pdf",
    "C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf",
  ];

  for (const sp of samples) {
    if (!fs.existsSync(sp)) { console.log(`跳过(不存在): ${sp}`); continue; }
    const bytes = new Uint8Array(fs.readFileSync(sp));
    console.log(`\n========== ${path.basename(sp)} ==========`);
    const { bytes: outBytes, records, red, blue } = await engine.processPdf(bytes, {
      annualColor: "blue",
      fileName: path.basename(sp),
      standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
    });
    console.log(`红框=${red}  年检框=${blue}  证书数=${records.length}`);
    records.forEach((r, i) =>
      console.log(`  ${i + 1}. ${r.type} | ${r.no || "-"} | 签发 ${r.issue || "-"} | 有效 ${r.expiry || "-"} | 年检 ${r.annual || "-"} | ${r.remark}`)
    );
    const outPath = path.basename(sp).replace(/\.pdf$/i, "") + "-web-标注.pdf";
    fs.writeFileSync(outPath, outBytes);
    console.log(`  已写出标注 PDF: ${outPath} (${outBytes.length} bytes)`);

    // Excel 汇总验证
    const tpl = new Uint8Array(fs.readFileSync("public/船舶证书信息模板.xlsx"));
    const { buildExcelWorkbook } = await import("../src/excel.js");
    const xbuf = await buildExcelWorkbook(tpl, records);
    fs.writeFileSync("汇总-web.xlsx", Buffer.from(xbuf));
    console.log(`  已写出汇总 Excel: 汇总-web.xlsx`);
  }
  console.log("\n冒烟测试结束。");
});
