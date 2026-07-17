// 测试合并功能 + textStats + ignoreEncryption
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// 用 legacy pdfjs
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "";
import { processPdf, configurePdfjs, mergePdfs } from "../src/engine.js";
configurePdfjs(pdfjs);
const STD_FONTS = `${root}/dist/pdfjs-standard-fonts/`;

async function main() {
  const files = [
    { name: "航海家", path: "C:/Users/caolg/Downloads/2.船舶证书（航海家）.pdf" },
    { name: "古弗尼尔", path: "C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf" },
  ];

  const results = [];
  for (const f of files) {
    try {
      const buf = readFileSync(f.path);
      const r = await processPdf(new Uint8Array(buf), {
        annualColor: "blue",
        fileName: f.name,
        standardFontDataUrl: STD_FONTS,
      });
      console.log(`[${f.name}] red=${r.red} blue=${r.blue} records=${r.records.length}`);
      console.log(`  textStats: pages=${r.textStats.numPages} items=${r.textStats.totalItems} lines=${r.textStats.totalLines} scanned=${r.textStats.isLikelyScanned}`);
      // 写标注PDF
      const outName = `D:/workbuddy/2026-07-16-18-55-51/${f.name}-标注-test.pdf`;
      writeFileSync(outName, Buffer.from(r.bytes));
      console.log(`  wrote ${outName}`);
      results.push(r.bytes);
    } catch (e) {
      console.log(`[${f.name}] ERROR: ${e.message}`);
    }
  }

  if (results.length >= 2) {
    console.log("\n=== MERGE TEST ===");
    const merged = await mergePdfs(results, { title: "测试合并" });
    const mergedPath = "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf";
    writeFileSync(mergedPath, Buffer.from(merged));
    console.log(`Merged PDF written: ${mergedPath} (${(merged.byteLength / 1024).toFixed(0)} KB)`);
  }
}

main().catch(console.error);
