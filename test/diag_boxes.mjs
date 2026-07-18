import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import PDFLibPkg from 'pdf-lib';
const { PDFDocument } = PDFLibPkg;

const path = process.argv[2] || 'C:/Users/caolg/Downloads/船舶证书标注合并_2026-07-17-标注.pdf';
const bytes = readFileSync(path);
const buf = new Uint8Array(bytes);

const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
console.log('=== PAGE COUNT ===', doc.numPages);

for (let pno = 0; pno < Math.min(doc.numPages, 3); pno++) {
  const page = await doc.getPage(pno + 1);
  const vp = page.getViewport({ scale: 1 });
  console.log('\n=== PAGE', pno + 1, '===');
  console.log('viewport:', vp.width.toFixed(1), 'x', vp.height.toFixed(1), 'rotation=', vp.rotation);

  const tc = await page.getTextContent();
  const dateItems = [];
  for (const it of tc.items) {
    const s = it.str || '';
    if (/expires|valid|2024|2025|2026|2027|december|january|february|survey|annual/i.test(s)) {
      dateItems.push({ str: s.trim(), x: it.transform[4], y: it.transform[5], w: it.width });
    }
  }
  console.log('--- date/keyword items (pdf.js viewport coords, Y from TOP) ---');
  dateItems.slice(0, 25).forEach(d => console.log('  "' + d.str + '"  x=' + d.x.toFixed(1) + ' y=' + d.y.toFixed(1) + ' w=' + (d.w || 0).toFixed(1)));

  const libDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const libPage = libDoc.getPages()[pno];
  console.log('libPage (pdf-lib):', libPage.getWidth().toFixed(1), 'x', libPage.getHeight().toFixed(1));
  const content = libPage.node.Contents();
  const stream = Array.isArray(content) ? content[0] : content;
  // 取内容流的原始(可能压缩)字节
  let rawBytes = null;
  if (stream.contents) rawBytes = stream.contents;
  else if (stream.getRawContent) rawBytes = stream.getRawContent();
  else if (stream.getContents) rawBytes = stream.getContents();
  let txt = '';
  if (rawBytes) {
    try {
      const dec = inflateSync(Buffer.from(rawBytes));
      txt = dec.toString('latin1');
    } catch (e) {
      txt = Buffer.from(rawBytes).toString('latin1');
    }
  } else {
    console.log('  [cannot read stream contents]');
  }
  const reOp = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g;
  let m; const rects = [];
  while ((m = reOp.exec(txt))) rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
  console.log('--- rectangles (PDF coords, bottom-left origin) ---');
  rects.forEach(r => console.log('  x=' + r.x.toFixed(1) + ' y=' + r.y.toFixed(1) + ' w=' + r.w.toFixed(1) + ' h=' + r.h.toFixed(1) + '  right=' + (r.x + r.w).toFixed(1) + ' top=' + (r.y + r.h).toFixed(1)));
}
