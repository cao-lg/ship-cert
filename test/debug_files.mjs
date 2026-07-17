import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import http from "node:http";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { configurePdfjs } from "../src/engine.js";
import { detectType, normSp } from "../src/helpers.js";

const STD_DIR = path.resolve("node_modules/pdfjs-dist/standard_fonts");
const server = http.createServer((req, res) => {
  const fp = path.join(STD_DIR, decodeURIComponent(req.url.split("?")[0]));
  if (fp.startsWith(STD_DIR) && fs.existsSync(fp)) { res.setHeader("Content-Type","application/octet-stream"); fs.createReadStream(fp).pipe(res); }
  else { res.statusCode = 404; res.end("nf"); }
});
await new Promise((r) => server.listen(0, r));
const std = `http://127.0.0.1:${server.address().port}/`;
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = std;
configurePdfjs(pdfjsLib);

const dir = "C:/Users/caolg/Documents/ship-cert-pdf";
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();

for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), standardFontDataUrl: std }).promise;
  let totalItems = 0;
  const pageHeads = [];
  const allText = [];
  for (let pno = 0; pno < doc.numPages; pno++) {
    const page = await doc.getPage(pno + 1);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim().length)
      .map((it) => ({ str: it.str, x0: it.transform[4], y: it.transform[5], width: it.width, height: it.height }));
    totalItems += items.length;
    // 行重建(简化)
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x0 - b.x0);
    const lines = []; let cur = null, curY = null;
    for (const it of sorted) {
      if (cur === null || Math.abs(it.y - curY) > 4) { cur = []; curY = it.y; lines.push(cur); }
      cur.push(it);
    }
    const lineTexts = lines.map((arr) => arr.map((i) => i.str).join(" "));
    pageHeads.push(lineTexts.slice(0, 3));
    allText.push(...lineTexts);
  }
  await doc.destroy();
  const fullRaw = allText.join("\n");
  console.log(`\n########## ${f}  (文本元素=${totalItems}, 页数=${doc.numPages})`);
  console.log(`  前3行/页: ${JSON.stringify(pageHeads)}`);
  console.log(`  detectType(fullRaw): ${detectType(fullRaw) || "(无)"}`);
  console.log(`  前 25 行文本:`);
  allText.slice(0, 25).forEach((l) => console.log(`    | ${l.slice(0, 90)}`));
}
server.close();
