import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import http from "node:http";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

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
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = std;

const engine = await import("../src/engine.js");
engine.configurePdfjs(pdfjsLib);
const { buildLines, computeBoxes } = engine;

async function analyze(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), standardFontDataUrl: std }).promise;
  const pages = [];
  for (let pno = 0; pno < doc.numPages; pno++) {
    const page = await doc.getPage(pno + 1);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => it.str && it.str.trim().length)
      .map((it) => ({ str: it.str, x0: it.transform[4], y: it.transform[5], width: it.width, height: it.height }));
    const { lines } = buildLines(items);
    pages.push({ lines, SCALE: 1, pageHeight: 1, libPage: null });
  }
  await doc.destroy();
  const { boxes, red, blue } = computeBoxes(pages, "blue");
  console.log(`\n===== ${path.basename(file)} =====`);
  console.log(`红框(过期)=${red}  蓝框(年检)=${blue}`);
  boxes.forEach((b) => {
    const isRed = b.stroke[0] === 1 && b.stroke[1] === 0 && b.stroke[2] === 0;
    console.log(`  [${isRed ? "红" : "蓝"}] ${b.group.iso}`);
  });
  return { red, blue };
}

await analyze("C:/Users/caolg/Downloads/2.船舶证书（航海家）.pdf");
await analyze("C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf");
server.close();
